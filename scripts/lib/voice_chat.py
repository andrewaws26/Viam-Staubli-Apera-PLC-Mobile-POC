"""
Voice chat and AI diagnosis system for IronSight touch interface.

Records audio via USB mic (arecord), transcribes with faster_whisper (Whisper
tiny model, int8 quantized), and sends to Claude CLI for response. Also
supports proactive AI diagnosis via the diagnostic agent subprocess.

IMPORTANT: The ironsight-touch service runs as root (for /dev/fb0 and
/dev/input access). All Python packages used here (faster_whisper, etc.)
must be installed system-wide, not with pip --user.

Audio pipeline:
  USB mic (44100Hz) -> arecord via plughw:0,0 (resamples to 16kHz)
  -> WAV header fix (plughw doesn't update on SIGTERM)
  -> Whisper tiny (beam=5, no VAD/speech filters for noisy shop)
  -> hallucination filter -> Claude CLI (haiku)

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
    _HAS_WHISPER = True
except ImportError:
    _HAS_WHISPER = False

# ── Audio / Whisper config ──────────────────────────────────────────────
CHAT_HISTORY_FILE = Path("/tmp/ironsight-chat.json")
# Queue file for Viam Cloud sync — plc_sensor reads and clears this.
# Each line is a JSON object: {ts, type, user, response, severity}
CHAT_QUEUE_FILE = Path("/tmp/ironsight-chat-queue.jsonl")
WHISPER_MODEL = "tiny"          # ~39MB, fast on Pi 5 (~3s for 10s audio)
MAX_RECORD_SECONDS = 30         # arecord -d value (max before auto-stop)
SAMPLE_RATE = 16000             # Whisper expects 16kHz
AUDIO_DEVICE = "plughw:0,0"    # ALSA plugin device — auto-resamples from
                                # USB mic's native 44100Hz to 16kHz.
                                # Do NOT use "hw:0,0" (no resampling) or
                                # "default" (no rate conversion either).
_WAV_HEADER_SIZE = 44           # Standard PCM WAV header (verified via arecord)
_MIN_AUDIO_BYTES = 1000         # < this = no audio captured (just WAV header)

# Whisper tiny hallucinates these on silence/ambient noise. Filter them out
# so noise-only recordings correctly show "Could not understand audio" rather
# than sending garbage to Claude.
_HALLUCINATIONS = frozenset({
    "thank you", "thanks for watching", "thanks for listening",
    "please subscribe", "like and subscribe", "see you next time",
    "bye", "goodbye", "you", "the end",
})


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
    """Push-to-talk voice chat with Claude via Whisper + diagnostic agent."""

    def __init__(self, sys_status_fn):
        self.messages: List[ChatMessage] = []
        self.scroll_offset = 0
        self.state = "idle"             # idle|recording|transcribing|thinking|loading|error
        self.state_message = ""
        self._recording = False
        self._record_thread = None
        self._record_proc = None
        self._audio_file = None
        self._process_thread = None
        self._whisper_model = None
        self._sys_status_fn = sys_status_fn
        self._init_mic_volume()
        self._load_history()

        if not _HAS_WHISPER:
            print("WARNING: faster_whisper not installed — voice chat disabled. "
                  "Install with: sudo pip3 install faster-whisper --break-system-packages")

    # ── Mic / audio setup ───────────────────────────────────────────────

    @staticmethod
    def _init_mic_volume():
        """Set USB mic capture volume to 100% (defaults to 0% on boot)."""
        try:
            subprocess.run(["amixer", "-c", "0", "set", "Mic", "100%"],
                           capture_output=True, timeout=3)
        except Exception:
            pass

    # ── Chat history ────────────────────────────────────────────────────

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

    @staticmethod
    def _queue_for_cloud(event_type: str, user_text: str,
                         response_text: str, severity: str = ""):
        """Append a chat event to the cloud sync queue.

        plc_sensor picks these up on its next 1Hz reading cycle and includes
        them in the Viam Cloud capture data. The queue file is then cleared.
        This lets Andrew analyze operator chat usage across the fleet.
        """
        event = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "type": event_type,     # "voice" or "diagnosis"
            "user": user_text,
            "response": response_text,
            "severity": severity,
        }
        try:
            with open(CHAT_QUEUE_FILE, "a") as f:
                f.write(json.dumps(event, separators=(",", ":")) + "\n")
            # Ensure plc_sensor (runs as andrew) can read and clear this file,
            # since touch service runs as root.
            os.chmod(CHAT_QUEUE_FILE, 0o666)
        except Exception:
            pass

    # ── Whisper model (lazy load) ───────────────────────────────────────

    def _get_whisper(self):
        """Load Whisper model on first use. Returns None if unavailable."""
        if self._whisper_model is None and _HAS_WHISPER:
            self.state = "loading"
            self.state_message = "Loading whisper model..."
            try:
                self._whisper_model = WhisperModel(
                    WHISPER_MODEL, device="cpu", compute_type="int8")
            except Exception as e:
                print(f"Whisper load error: {e}")
        return self._whisper_model

    # ── Recording ───────────────────────────────────────────────────────

    def start_recording(self):
        """Begin recording from USB mic. Call stop_recording() when done."""
        if self._recording or self.state in ("transcribing", "thinking"):
            return
        self._recording = True
        self.state = "recording"
        self.state_message = "Recording... release to send"
        self._record_thread = threading.Thread(target=self._record_loop, daemon=True)
        self._record_thread.start()

    def _record_loop(self):
        """Background thread: run arecord until stopped or MAX_RECORD_SECONDS."""
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
        """Stop recording and begin transcription pipeline."""
        if not self._recording:
            return
        self._recording = False
        try:
            if self._record_proc and self._record_proc.poll() is None:
                self._record_proc.terminate()
                self._record_proc.wait(timeout=2)
        except Exception:
            pass
        self._process_thread = threading.Thread(target=self._process_audio, daemon=True)
        self._process_thread.start()

    # ── Audio processing pipeline ───────────────────────────────────────

    @staticmethod
    def _fix_wav_header(filepath):
        """Patch WAV header to match actual file size.

        When arecord is killed (SIGTERM/SIGINT) while recording through the
        plughw ALSA plugin, it exits without updating the RIFF/data chunk
        sizes — they still reflect the original -d max duration (e.g. 30s).
        This is harmless for ffmpeg-based readers (faster_whisper uses PyAV)
        but wrong for anything that trusts the header. Fix defensively.
        """
        try:
            file_size = os.path.getsize(filepath)
            if file_size < _WAV_HEADER_SIZE:
                return
            with open(filepath, 'r+b') as f:
                f.seek(4)
                f.write(struct.pack('<I', file_size - 8))           # RIFF chunk
                f.seek(_WAV_HEADER_SIZE - 4)
                f.write(struct.pack('<I', file_size - _WAV_HEADER_SIZE))  # data chunk
        except Exception:
            pass

    def _process_audio(self):
        """Transcribe recorded audio, send to Claude, update chat."""
        audio_file = self._audio_file
        if not audio_file or not os.path.exists(audio_file):
            self.state = "error"
            self.state_message = "No audio recorded"
            return

        file_size = os.path.getsize(audio_file)
        if file_size < _MIN_AUDIO_BYTES:
            self.state = "error"
            self.state_message = "No audio detected — check mic"
            self._cleanup_audio(audio_file)
            return

        self._fix_wav_header(audio_file)

        # Transcribe
        self.state = "transcribing"
        self.state_message = "Transcribing..."
        transcript = self._transcribe(audio_file)

        if not transcript or not transcript.strip():
            # Keep file for debugging: inspect with
            #   python3 -c "from faster_whisper import WhisperModel; ..."
            print(f"Transcription empty, audio kept: {audio_file} ({file_size}B)")
            self.state = "error"
            self.state_message = "Could not understand audio"
            return

        self._cleanup_audio(audio_file)

        # Add user message
        user_msg = ChatMessage(
            role="user", text=transcript.strip(),
            timestamp=time.strftime("%H:%M"))
        self.messages.append(user_msg)
        self.scroll_offset = 0

        # Get Claude response
        self.state = "thinking"
        self.state_message = "Claude is thinking..."
        response = self._ask_claude(transcript.strip())

        if response:
            self.messages.append(ChatMessage(
                role="assistant", text=response,
                timestamp=time.strftime("%H:%M")))
        else:
            self.state = "error"
            self.state_message = "Claude API error"
            return

        self._save_history()
        self._queue_for_cloud("voice", transcript.strip(), response)
        self.state = "idle"
        self.state_message = ""

    @staticmethod
    def _cleanup_audio(filepath):
        try:
            os.unlink(filepath)
        except Exception:
            pass

    # ── Transcription ───────────────────────────────────────────────────

    def _transcribe(self, audio_file: str) -> str:
        """Transcribe audio file with Whisper. Returns text or empty string.

        All of Whisper's built-in speech-filtering heuristics are disabled:
          - vad_filter: Silero VAD's threshold (0.5) rejects speech when shop
            ambient noise (3-5% RMS) suppresses probability scores.
          - no_speech_threshold: Model assigns >60% "no speech" probability to
            noisy audio even when someone is clearly talking.
          - log_prob_threshold: Low-confidence segments (speech + noise) get
            silently dropped.

        Since this is push-to-talk (user explicitly pressed a button), we
        trust speech is present and rely on the hallucination filter to catch
        noise-only recordings.
        """
        model = self._get_whisper()
        if not model:
            print("Whisper model not available — cannot transcribe")
            self.state = "error"
            self.state_message = "Whisper not available"
            return ""

        try:
            segments, _ = model.transcribe(
                audio_file,
                beam_size=5,
                language="en",
                vad_filter=False,
                no_speech_threshold=0.99,
                log_prob_threshold=-5.0,
            )
            text = " ".join(seg.text for seg in segments).strip()

            if text.lower().rstrip(".!,") in _HALLUCINATIONS:
                print(f"Whisper hallucination filtered: '{text}'")
                return ""
            return text
        except Exception as e:
            print(f"Transcription error: {e}")
            return ""

    # ── Claude CLI ──────────────────────────────────────────────────────

    def _ask_claude(self, user_text: str) -> str:
        """Send transcribed text to Claude CLI (haiku) with system context."""
        try:
            context = self._build_system_context()
            prompt_parts = [context, ""]
            # Include conversation history for follow-up context
            for msg in self.messages[-10:]:
                role = "User" if msg.role == "user" else "Assistant"
                prompt_parts.append(f"{role}: {msg.text}")
            prompt_parts.append(f"User: {user_text}")
            prompt_parts.append(
                "You are having a conversation with a railroad operator at a TPS truck. "
                "Be natural and conversational — they may ask follow-up questions, "
                "respond to your advice, or change topics. Keep responses SHORT "
                "(2-3 sentences for the 3.5 inch screen). Plain text, no markdown. "
                "Give practical advice — things to physically check or do at the truck. "
                "Do NOT suggest checking PLC registers or running software commands. "
                "If they say something worked or ask what else to try, build on "
                "the conversation naturally:")

            full_prompt = "\n".join(prompt_parts)
            result = subprocess.run(
                ["claude", "-p", "--model", "haiku"],
                input=full_prompt, capture_output=True, text=True, timeout=30,
                env={**os.environ, "HOME": "/home/andrew"})

            if result.returncode == 0 and result.stdout.strip():
                return result.stdout.strip()
            err = result.stderr.strip()[:50] if result.stderr else "no output"
            return f"Claude error: {err}"
        except subprocess.TimeoutExpired:
            return "Claude took too long to respond."
        except Exception as e:
            print(f"Claude CLI error: {e}")
            return f"Error: {str(e)[:50]}"

    # ── System context for Claude ───────────────────────────────────────

    def _build_system_context(self) -> str:
        """Build live system status string for Claude voice chat prompts."""
        sys_status = self._sys_status_fn()
        bat = sys_status.get("battery", {})
        diagnostics = [d for d in sys_status.get("diagnostics", []) if isinstance(d, dict)]
        sensor = read_latest_entry() or {}

        # Viam capture status
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

        # PLC registers
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

        # Active diagnostics
        if diagnostics:
            ctx += "\nACTIVE DIAGNOSTICS:\n"
            for d in diagnostics[:8]:
                ctx += f"  [{d.get('severity', 'info').upper()}] {d.get('title', 'unknown')}\n"
        else:
            ctx += "\nDIAGNOSTICS: All clear.\n"

        return ctx

    # ── AI Diagnosis ────────────────────────────────────────────────────

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

        # Offline: local diagnosis only (instant)
        if not sys_status.get("internet", False):
            local_text = self._local_diagnosis(sys_status, active, retry)
            local_text += "\n\n(Offline — local diagnosis only)"
            self.messages.append(ChatMessage(
                role="assistant", text=local_text,
                timestamp=time.strftime("%H:%M"), severity=msg_severity))
            self.scroll_offset = 0
            self._save_history()
            return

        # Online: show placeholder, run AI agent in background
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
        """Background thread: run the diagnostic agent subprocess."""
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

            # Poll for progress updates while agent runs
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
                        self._queue_for_cloud(
                            "diagnosis", "(auto)", ai_text, ai_severity)
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

    # ── Utilities ───────────────────────────────────────────────────────

    def clear_history(self):
        self.messages.clear()
        self.scroll_offset = 0
        try:
            CHAT_HISTORY_FILE.unlink(missing_ok=True)
        except Exception:
            pass

    @staticmethod
    def _local_diagnosis(sys_status: dict, active: list, retry: bool) -> str:
        """Generate local-only diagnosis text (no AI, instant)."""
        lines = []
        if retry:
            lines.append("RE-CHECKING...")
            lines.append("")

        if not active:
            speed = sys_status.get("speed_ftpm", 0.0)
            plates = sys_status.get("plate_count", 0)
            if sys_status.get("connected", False):
                lines.append(f"ALL CLEAR. PLC connected, {plates} plates, {speed:.1f} ft/min.")
            else:
                lines.append("PLC not connected. Check Ethernet cable to PLC or verify PLC has power.")
        else:
            for d in active[:3]:
                icon = "!!" if d.get("severity") == "critical" else "!"
                lines.append(f"{icon} {d.get('title', 'Issue detected')}")
                action_text = d.get("action", "")
                if action_text:
                    for step in [s.strip() for s in action_text.split("\n") if s.strip()][:2]:
                        lines.append(f"  -> {step}")
            if len(active) > 3:
                lines.append(f"(+{len(active) - 3} more)")

        return "\n".join(lines)
