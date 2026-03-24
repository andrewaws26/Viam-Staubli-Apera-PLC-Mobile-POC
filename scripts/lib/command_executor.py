"""
Command executor for IronSight touch interface.

Executes system commands (restart viam, test PLC, wifi scan, etc.)
in background threads with toast feedback for the display.

Usage:
    from lib.command_executor import CommandExecutor

    executor = CommandExecutor()
    executor.execute("cmd_restart_viam")
"""

import socket
import subprocess
import threading
import time

from lib.plc_constants import PLC_HOST, PLC_PORT, OFFLINE_BUFFER_DIR

FEEDBACK_DURATION = 3.0  # seconds to show command result toast


class CommandExecutor:
    """Execute system commands with feedback for the display."""

    def __init__(self):
        self.feedback_message = ""
        self.feedback_level = "info"
        self.feedback_until = 0.0
        self._running = False

    @property
    def has_feedback(self) -> bool:
        return time.time() < self.feedback_until

    def _set_feedback(self, msg: str, level: str = "info"):
        self.feedback_message = msg
        self.feedback_level = level
        self.feedback_until = time.time() + FEEDBACK_DURATION

    def execute(self, action: str):
        """Execute a command action in a background thread."""
        if self._running:
            self._set_feedback("Command already running...", "warning")
            return
        thread = threading.Thread(target=self._run, args=(action,), daemon=True)
        thread.start()

    def _run(self, action: str):
        self._running = True
        try:
            if action == "cmd_restart_viam":
                self._set_feedback("Restarting viam-server...", "info")
                r = subprocess.run(
                    ["sudo", "systemctl", "restart", "viam-server"],
                    capture_output=True, text=True, timeout=30)
                if r.returncode == 0:
                    self._set_feedback("viam-server restarted OK", "success")
                else:
                    self._set_feedback(f"Restart failed: {r.stderr[:40]}", "error")

            elif action == "cmd_test_plc":
                self._set_feedback("Testing PLC connection...", "info")
                sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                sock.settimeout(3)
                result = sock.connect_ex((PLC_HOST, PLC_PORT))
                sock.close()
                if result == 0:
                    self._set_feedback(f"PLC reachable at {PLC_HOST}:{PLC_PORT}", "success")
                else:
                    self._set_feedback("PLC unreachable (no carrier?)", "error")

            elif action == "cmd_switch_wifi":
                self._set_feedback("Scanning WiFi networks...", "info")
                subprocess.run(["nmcli", "device", "wifi", "rescan"],
                               capture_output=True, text=True, timeout=15)
                r2 = subprocess.run(
                    ["nmcli", "-t", "-f", "SSID,SIGNAL,IN-USE", "device", "wifi", "list"],
                    capture_output=True, text=True, timeout=10)
                if r2.returncode == 0:
                    lines = [l for l in r2.stdout.strip().split("\n") if l.strip()]
                    current = ""
                    available = []
                    for line in lines[:5]:
                        parts = line.split(":")
                        ssid = parts[0] if parts else "?"
                        signal = parts[1] if len(parts) > 1 else "?"
                        in_use = "*" in (parts[2] if len(parts) > 2 else "")
                        if in_use:
                            current = ssid
                        if ssid:
                            available.append(f"{ssid}({signal}%)")
                    msg = f"On: {current} | " + ", ".join(available[:3])
                    self._set_feedback(msg[:60], "success")
                else:
                    self._set_feedback("WiFi scan failed", "error")

            elif action == "cmd_clear_buffer":
                self._set_feedback("Clearing offline buffer...", "info")
                count = 0
                if OFFLINE_BUFFER_DIR.exists():
                    for f in OFFLINE_BUFFER_DIR.glob("readings_*.jsonl"):
                        f.unlink()
                        count += 1
                self._set_feedback(f"Cleared {count} buffer files", "success")

            elif action == "cmd_force_sync":
                self._set_feedback("Triggering cloud sync...", "info")
                r = subprocess.run(
                    ["sudo", "systemctl", "restart", "viam-server"],
                    capture_output=True, text=True, timeout=30)
                if r.returncode == 0:
                    self._set_feedback("Sync triggered (server restarted)", "success")
                else:
                    self._set_feedback("Sync trigger failed", "error")

            else:
                self._set_feedback(f"Unknown action: {action}", "error")

        except subprocess.TimeoutExpired:
            self._set_feedback("Command timed out", "error")
        except Exception as e:
            self._set_feedback(f"Error: {str(e)[:40]}", "error")
        finally:
            self._running = False
