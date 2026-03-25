"""
Voice chat and AI diagnosis system for IronSight touch interface.

ChatMessage: Dataclass for chat messages (user/assistant, severity, timestamp).
VoiceChat: Push-to-talk voice chat with Claude, plus diagnostic agent integration.

Usage:
    from lib.voice_chat import VoiceChat, ChatMessage

    voice_chat = VoiceChat(sys_status_fn=get_system_status)
    voice_chat.proactive_diagnosis()
"""

import json
import os
import struct
import subprocess
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import List

from lib.plc_constants import CAPTURE_DIR, DS_SHORT_LABELS
from lib.buffer_reader import read_latest_entry

try:
    from faster_whisper import WhisperModel
    HAS_WHISPER = True
except ImportError:
    HAS_WHISPER = False

# Voice chat config
CHAT_HISTORY_FILE = Path("/tmp/ironsight-chat.json")
WHISPER_MODEL = "tiny"
MAX_RECORD_SECONDS = 30
SAMPLE_RATE = 16000
AUDIO_DEVICE = "plughw:0,0"


@dataclass
class ChatMessage:
    role: str       # "user" or "assistant"
    text: str
    timestamp: str
    severity: str = ""  # "ok", "warning", "critical", or "" (unset)

    def to_dict(self):
        d = {"role": self.role, "text": self.text, "timestamp": self.timestamp}
        if self.severity:
            d["severity"] = self.severity
        return d

    @classmethod
    def from_dict(cls, d):
        return cls(role=d["role"], text=d["text"], timestamp=d.get("timestamp", ""),
                   severity=d.get("severity", ""))


class VoiceChat:
    """Push-to-talk voice chat with Claude via whisper + diagnostic agent."""

    def __init__(self, sys_status_fn):
        self.messages: List[ChatMessage] = []
        self.scroll_offset = 0
        self.state = "idle"
        self.state_message = ""
        self._recording = False
        self._audio_data = []
        self._record_thread = None
        self._process_thread = None
        self._whisper_model = None
        self._sys_status_fn = sys_status_fn
        self._init_mic_volume()
        self._load_history()

    def _init_mic_volume(self):
        """Set USB mic capture volume to 100% (defaults to 0% on boot)."""
        try:
            subprocess.run(["amixer", "-c", "0", "set", "Mic", "100%"],
                           capture_output=True, timeout=3)
        except Exception:
            pass

    def _load_history(self):
        try:
            data = json.loads(CHAT_HISTORY_FILE.read_text())
            self.messages = [ChatMessage.from_dict(m) for m in data[-50:]]
        except Exception:
            self.messages = []

    def _save_history(self):
        try:
            data = [m.to_dict() for m in self.messages[-50:]]
            CHAT_HISTORY_FILE.write_text(json.dumps(data))
        except Exception:
            pass

    def _get_whisper(self):
        if self._whisper_model is None and HAS_WHISPER:
            self.state = "loading"
            self.state_message = "Loading whisper model..."
            try:
                self._whisper_model = WhisperModel(
                    WHISPER_MODEL, device="cpu", compute_type="int8")
            except Exception as e:
                print(f"Whisper load error: {e}")
                self.state = "error"
                self.state_message = f"Whisper failed: {str(e)[:30]}"
        return self._whisper_model

    def start_recording(self):
        if self._recording or self.state in ("transcribing", "thinking"):
            return
        self._recording = True
        self._audio_data = []
        self.state = "recording"
        self.state_message = "Recording... release to send"
        self._record_thread = threading.Thread(target=self._record_loop, daemon=True)
        self._record_thread.start()

    def _record_loop(self):
        try:
            self._audio_file = f"/tmp/ironsight-voice-{int(time.time())}.wav"
            self._record_proc = subprocess.Popen(
                ["arecord", "-D", AUDIO_DEVICE, "-f", "S16_LE",
                 "-r", str(SAMPLE_RATE), "-c", "1", "-t", "wav",
                 "-d", str(MAX_RECORD_SECONDS), self._audio_file],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            self._record_proc.wait()
        except Exception as e:
            print(f"Record error: {e}")
            self.state = "error"
            self.state_message = f"Mic error: {str(e)[:30]}"
            self._recording = False

    def stop_recording(self):
        if not self._recording:
            return
        self._recording = False
        try:
            if hasattr(self, '_record_proc') and self._record_proc.poll() is None:
                self._record_proc.terminate()
                self._record_proc.wait(timeout=2)
        except Exception:
            pass
        self._process_thread = threading.Thread(target=self._process_audio, daemon=True)
        self._process_thread.start()

    @staticmethod
    def _fix_wav_header(filepath):
        """Fix WAV header after arecord termination via plughw.

        When arecord is killed (SIGTERM/SIGINT) while recording through the
        plughw ALSA plugin, it doesn't update the RIFF/data chunk sizes in the
        WAV header — they still reflect the original -d max duration. This
        causes audio readers that trust the header to see phantom silence after
        the real audio data. Fix by patching the header to match actual file
        size.
        """
        try:
            file_size = os.path.getsize(filepath)
            if file_size < 44:
                return
            with open(filepath, 'r+b') as f:
                # RIFF chunk size = file_size - 8
                f.seek(4)
                f.write(struct.pack('<I', file_size - 8))
                # data chunk size = file_size - 44 (standard PCM WAV header)
                f.seek(40)
                f.write(struct.pack('<I', file_size - 44))
        except Exception:
            pass

    def _process_audio(self):
        audio_file = getattr(self, '_audio_file', None)
        if not audio_file or not os.path.exists(audio_file):
            self.state = "error"
            self.state_message = "No audio recorded"
            return

        file_size = os.path.getsize(audio_file)
        if file_size < 1000:
            self.state = "error"
            self.state_message = "No audio detected — check mic"
            try:
                os.unlink(audio_file)
            except Exception:
                pass
            return

        # Fix WAV header — arecord via plughw leaves wrong sizes after kill
        self._fix_wav_header(audio_file)

        self.state = "transcribing"
        self.state_message = "Transcribing..."
        transcript = self._transcribe(audio_file)

        try:
            os.unlink(audio_file)
        except Exception:
            pass

        if not transcript or not transcript.strip():
            self.state = "error"
            self.state_message = "Could not understand audio"
            return

        user_msg = ChatMessage(
            role="user", text=transcript.strip(),
            timestamp=time.strftime("%H:%M"))
        self.messages.append(user_msg)
        self.scroll_offset = 0

        self.state = "thinking"
        self.state_message = "Claude is thinking..."
        response = self._ask_claude(transcript.strip())

        if response:
            assistant_msg = ChatMessage(
                role="assistant", text=response,
                timestamp=time.strftime("%H:%M"))
            self.messages.append(assistant_msg)
        else:
            self.state = "error"
            self.state_message = "Claude API error"
            return

        self._save_history()
        self.state = "idle"
        self.state_message = ""

    # Common Whisper hallucinations on silence/noise (tiny model)
    _HALLUCINATIONS = {
        "thank you", "thanks for watching", "thanks for listening",
        "please subscribe", "like and subscribe", "see you next time",
        "bye", "goodbye", "you", "the end",
    }

    def _transcribe(self, audio_file: str) -> str:
        model = self._get_whisper()
        if model:
            try:
                # No VAD filter — this is push-to-talk, so we know speech is
                # present. VAD's default threshold (0.5) rejects speech in noisy
                # environments like a railroad shop where ambient RMS is 3-5%.
                segments, info = model.transcribe(
                    audio_file, beam_size=5, language="en", vad_filter=False)
                text = " ".join(seg.text for seg in segments).strip()
                # Filter out common Whisper hallucinations on noise/silence
                if text.lower().rstrip(".!,") in self._HALLUCINATIONS:
                    print(f"Whisper hallucination filtered: '{text}'")
                    return ""
                return text
            except Exception as e:
                print(f"Transcription error: {e}")
        self.state = "error"
        self.state_message = "Whisper not available"
        return ""

    def _ask_claude(self, user_text: str) -> str:
        try:
            context = self._build_system_context()
            prompt_parts = [context, ""]
            for msg in self.messages[-6:]:
                role = "User" if msg.role == "user" else "Assistant"
                prompt_parts.append(f"{role}: {msg.text}")
            prompt_parts.append(f"User: {user_text}")
            prompt_parts.append(
                "Respond in 2-3 short sentences. Plain text, no markdown. "
                "Give practical advice for a railroad operator in the field — "
                "things they can physically check or do at the truck. "
                "Do NOT suggest checking PLC registers or running software commands:")

            full_prompt = "\n".join(prompt_parts)
            claude_env = {**os.environ, "HOME": "/home/andrew"}
            result = subprocess.run(
                ["claude", "-p", "--model", "haiku"],
                input=full_prompt,
                capture_output=True, text=True, timeout=30, env=claude_env)

            if result.returncode == 0 and result.stdout.strip():
                return result.stdout.strip()
            else:
                err = result.stderr.strip()[:50] if result.stderr else "no output"
                return f"Claude error: {err}"
        except subprocess.TimeoutExpired:
            return "Claude took too long to respond."
        except Exception as e:
            print(f"Claude CLI error: {e}")
            return f"Error: {str(e)[:50]}"

    def _build_system_context(self) -> str:
        """Build comprehensive system context for voice chat Claude prompts."""
        sys_status = self._sys_status_fn()
        bat = sys_status.get("battery", {})
        diagnostics = [d for d in sys_status.get("diagnostics", []) if isinstance(d, dict)]
        sensor = read_latest_entry() or {}

        # Check Viam capture status
        capture_status = "unknown"
        try:
            if CAPTURE_DIR.exists():
                prog_files = sorted(CAPTURE_DIR.glob("*.prog"))
                if prog_files:
                    latest = prog_files[-1]
                    cap_size = latest.stat().st_size
                    cap_age = time.time() - latest.stat().st_mtime
                    if cap_age < 30 and cap_size > 100:
                        capture_status = f"active ({cap_size}B, {cap_age:.0f}s ago)"
                    elif cap_age < 300:
                        capture_status = f"recent ({cap_age:.0f}s ago)"
                    else:
                        capture_status = f"stale ({cap_age / 60:.0f}min ago)"
                cap_files = list(CAPTURE_DIR.glob("*.capture"))
                capture_status += f", {len(cap_files)} completed files"
        except Exception:
            pass

        ctx = (
            "You are IronSight, an AI assistant on a TPS (Tie Plate System) railroad truck. "
            "Keep responses SHORT (2-3 sentences max) for a tiny 3.5 inch screen. "
            "No markdown, no bullet points, plain text only.\n\n"
        )

        ctx += "CONNECTION:\n"
        ctx += f"  PLC: {'CONNECTED' if sys_status['connected'] else 'DISCONNECTED'} ({sys_status['plc_ip']}:502)\n"
        ctx += f"  eth0: {'linked' if sys_status['eth0_carrier'] else 'NO CARRIER'}"
        if sensor.get("eth0_status"):
            ctx += f" | {sensor['eth0_status']}"
        ctx += "\n"
        ctx += f"  viam-server: {'RUNNING' if sys_status['viam_server'] else 'STOPPED'}\n"
        ctx += f"  Viam capture: {capture_status}\n"
        ctx += f"  Internet: {'connected' if sys_status['internet'] else 'OFFLINE'}"
        ctx += f" (WiFi: {sys_status['wifi_ssid'] or 'none'})\n"
        if sensor.get("modbus_response_time_ms") is not None:
            ctx += f"  Modbus latency: {sensor['modbus_response_time_ms']:.1f}ms\n"
        data_age = sys_status.get("data_age_seconds", float("inf"))
        if data_age < float("inf"):
            ctx += f"  Data age: {data_age:.0f}s\n"

        ctx += "\nPRODUCTION:\n"
        ctx += f"  TPS Power: {'ON' if sys_status.get('tps_power_loop') else 'OFF'}\n"
        ctx += f"  Plates: {sys_status['plate_count']} | Speed: {sys_status['speed_ftpm']:.1f} ft/min\n"
        ctx += f"  Direction: {sys_status.get('encoder_direction', 'unknown')}\n"
        if sys_status.get('last_spacing_in', 0) > 0:
            ctx += f"  Spacing: last {sys_status['last_spacing_in']:.1f}\" avg {sys_status['avg_spacing_in']:.1f}\"\n"

        # PLC Registers
        ds_regs = sys_status.get("ds_registers", {})
        if ds_regs:
            ctx += "\nPLC REGISTERS:\n"
            for key in sorted(ds_regs.keys(), key=lambda k: int(k[2:])):
                label = DS_SHORT_LABELS.get(key, "")
                label_str = f" ({label})" if label else ""
                ctx += f"  {key.upper()}={ds_regs[key]}{label_str}\n"

        # Signal metrics
        for field, label in [
            ("camera_detections_per_min", "Flipper rate"),
            ("camera_rate_trend", "Flipper trend"),
            ("eject_rate_per_min", "Eject rate"),
            ("encoder_noise", "Encoder noise"),
        ]:
            val = sensor.get(field)
            if val is not None:
                ctx += f"  {label}: {val}\n"

        # Control bits
        ctx += "\nCONTROL STATE:\n"
        for field, label in [
            ("drop_enable", "Drop Enable"), ("lay_ties_set", "Lay Ties Set"),
            ("drop_ties", "Drop Ties"), ("camera_signal", "Camera Signal"),
            ("backup_alarm", "Backup Alarm"),
        ]:
            val = sensor.get(field)
            if val is not None:
                ctx += f"  {label}: {'ON' if val else 'OFF'}\n"

        # System health
        ctx += "\nSYSTEM HEALTH:\n"
        cpu_f = sys_status['cpu_temp'] * 9 / 5 + 32
        ctx += f"  CPU: {cpu_f:.0f}F | Disk: {sys_status['disk_pct']}% | Uptime: {sys_status['uptime']}\n"
        if bat.get("available"):
            ctx += f"  Battery: {bat['percent']:.0f}% {'charging' if bat.get('charging') else 'discharging'}\n"

        # Diagnostics
        if diagnostics:
            ctx += "\nACTIVE DIAGNOSTICS:\n"
            for d in diagnostics[:8]:
                sev = d.get("severity", "info")
                title = d.get("title", "unknown")
                ctx += f"  [{sev.upper()}] {title}\n"
        else:
            ctx += "\nDIAGNOSTICS: All clear.\n"

        return ctx

    def proactive_diagnosis(self, retry: bool = False):
        """Run AI diagnosis. Falls back to local-only if no internet."""
        if self.state in ("loading", "thinking"):
            return

        sys_status = self._sys_status_fn()
        diagnostics = [d for d in sys_status.get("diagnostics", []) if isinstance(d, dict)]
        active = [d for d in diagnostics if d.get("severity") in ("critical", "warning")]

        has_critical = any(d.get("severity") == "critical" for d in active)
        has_warning = any(d.get("severity") == "warning" for d in active)
        msg_severity = "critical" if has_critical else "warning" if has_warning else "ok"

        # Check internet — if offline, show local diagnosis only
        has_internet = sys_status.get("internet", False)
        if not has_internet:
            local_text = self._local_diagnosis(sys_status, active, retry)
            local_text += "\n\n(Offline — local diagnosis only)"
            self.messages.append(ChatMessage(
                role="assistant", text=local_text,
                timestamp=time.strftime("%H:%M"), severity=msg_severity))
            self.scroll_offset = 0
            self._save_history()
            return

        # Online — show placeholder, run AI agent
        self.messages.append(ChatMessage(
            role="assistant", text="Analyzing...",
            timestamp=time.strftime("%H:%M"), severity=msg_severity))
        self.scroll_offset = 0

        self.state = "thinking"
        self.state_message = "Gathering evidence..."
        threading.Thread(
            target=self._run_diagnosis,
            args=(retry, sys_status, active, msg_severity),
            daemon=True).start()

    def _run_diagnosis(self, retry: bool, sys_status: dict,
                       active: list, msg_severity: str):
        """Background thread: run the diagnostic agent."""
        agent_script = Path(__file__).resolve().parent.parent / "diagnose_agent.py"
        cmd = [sys.executable, str(agent_script)]

        if retry:
            cmd.append("--retry")
            prev_text = ""
            for msg in reversed(self.messages[:-1]):
                if msg.role == "assistant":
                    prev_text = msg.text
                    break
            if prev_text:
                cmd.extend(["--prev-diagnosis", prev_text])

        progress_file = Path("/tmp/ironsight-diagnose-progress.txt")

        try:
            proc = subprocess.Popen(
                cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                text=True, env={**os.environ, "HOME": "/home/andrew"})

            while proc.poll() is None:
                try:
                    if progress_file.exists():
                        progress = progress_file.read_text().strip()
                        if progress:
                            self.state_message = progress
                except Exception:
                    pass
                time.sleep(0.5)

            stdout = proc.stdout.read()
            stderr = proc.stderr.read()

            if proc.returncode == 0 and stdout.strip():
                try:
                    result = json.loads(stdout.strip())
                    ai_text = result.get("diagnosis", "")
                    ai_severity = result.get("severity", msg_severity)

                    if ai_text and self.messages:
                        self.messages[-1] = ChatMessage(
                            role="assistant", text=ai_text,
                            timestamp=time.strftime("%H:%M"),
                            severity=ai_severity)
                except (json.JSONDecodeError, KeyError):
                    if self.messages:
                        self.messages[-1].text = "AI response error. Tap RETRY."
            else:
                if self.messages:
                    err_hint = ""
                    if stderr and "anthropic" in stderr.lower():
                        err_hint = " -- check API key"
                    elif stderr and "timeout" in stderr.lower():
                        err_hint = " -- check internet"
                    self.messages[-1].text = f"AI analysis failed{err_hint}. Tap RETRY."

        except FileNotFoundError:
            if self.messages:
                self.messages[-1].text = "Agent script not found."
        except Exception as e:
            if self.messages:
                self.messages[-1].text = f"Agent error: {str(e)[:50]}"
        finally:
            try:
                progress_file.unlink(missing_ok=True)
            except Exception:
                pass

        self.state = "idle"
        self.state_message = ""
        self.scroll_offset = 0
        self._save_history()

    def _build_diagnosis_context(self, sys_status: dict) -> str:
        """Build focused context for diagnosis prompts."""
        bat = sys_status.get("battery", {})
        diagnostics = [d for d in sys_status.get("diagnostics", []) if isinstance(d, dict)]

        ctx = "TPS TRUCK STATUS:\n"
        ctx += f"PLC: {'CONNECTED' if sys_status['connected'] else 'DISCONNECTED'}\n"
        ctx += f"eth0: {'linked' if sys_status['eth0_carrier'] else 'NO CARRIER'}\n"
        ctx += f"Internet: {'connected' if sys_status['internet'] else 'OFFLINE'}"
        ctx += f" (WiFi: {sys_status['wifi_ssid'] or 'none'})\n"
        ctx += f"viam-server: {'RUNNING' if sys_status['viam_server'] else 'STOPPED'}\n"

        ctx += f"\nPlates: {sys_status['plate_count']} | "
        ctx += f"Speed: {sys_status['speed_ftpm']:.1f} ft/min | "
        ctx += f"Distance: {sys_status['travel_ft']:.1f} ft\n"
        ctx += f"TPS Power: {'ON' if sys_status.get('tps_power_loop') else 'OFF'}\n"

        cpu_f = sys_status['cpu_temp'] * 9 / 5 + 32
        ctx += f"\nCPU: {cpu_f:.0f}F | Disk: {sys_status['disk_pct']}%\n"

        if diagnostics:
            ctx += "\nACTIVE DIAGNOSTICS:\n"
            for d in diagnostics[:8]:
                sev = d.get("severity", "info")
                title = d.get("title", "unknown")
                action = d.get("action", "")
                ctx += f"  [{sev.upper()}] {title}\n"
                if action:
                    ctx += f"    Suggested: {action}\n"
        else:
            ctx += "\nDIAGNOSTICS: All clear.\n"

        return ctx

    def clear_history(self):
        self.messages.clear()
        self.scroll_offset = 0
        try:
            CHAT_HISTORY_FILE.unlink(missing_ok=True)
        except Exception:
            pass

    def _local_diagnosis(self, sys_status: dict, active: list, retry: bool) -> str:
        lines = []
        if retry:
            lines.append("RE-CHECKING...")
            lines.append("")

        if not active:
            speed = sys_status.get("speed_ftpm", 0.0)
            plates = sys_status.get("plate_count", 0)
            connected = sys_status.get("connected", False)
            if connected:
                lines.append(f"ALL CLEAR. PLC connected, {plates} plates, {speed:.1f} ft/min.")
            else:
                lines.append("PLC not connected. Check Ethernet cable to PLC or verify PLC has power.")
        else:
            for d in active[:3]:
                sev = d.get("severity", "")
                title = d.get("title", "Issue detected")
                action_text = d.get("action", "")
                icon = "!!" if sev == "critical" else "!"
                lines.append(f"{icon} {title}")
                if action_text:
                    steps = [s.strip() for s in action_text.split("\n") if s.strip()]
                    for step in steps[:2]:
                        lines.append(f"  -> {step}")
            if len(active) > 3:
                lines.append(f"(+{len(active) - 3} more)")

        return "\n".join(lines)
