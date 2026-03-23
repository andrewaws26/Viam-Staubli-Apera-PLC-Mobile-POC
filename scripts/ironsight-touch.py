#!/usr/bin/env python3
"""
IronSight Touch Command Display — Interactive 3.5" touchscreen interface.

Touch-friendly UI with big buttons for glove operation on the truck.
Renders to Linux framebuffer, reads touch from evdev (ADS7846/XPT2046).

Pages:
  HOME     — 5 navigation buttons: LIVE, COMMANDS, CHAT, LOGS, SYSTEM
  LIVE     — Real-time PLC data (encoder, plates, speed, spacing)
  COMMANDS — Actionable buttons (restart, test PLC, WiFi, etc.)
  CHAT     — Push-to-talk voice chat with Claude AI
  LOGS     — Scrollable recent activity & incidents
  SYSTEM   — Health dashboard (disk, CPU, network, services)

Requires: pip3 install Pillow evdev anthropic faster-whisper
"""

import json
import mmap
import os
import subprocess
import sys
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional, Tuple, List

try:
    from PIL import Image, ImageDraw, ImageFont
    HAS_PILLOW = True
except ImportError:
    HAS_PILLOW = False

try:
    import evdev
    from evdev import ecodes
    HAS_EVDEV = True
except ImportError:
    HAS_EVDEV = False

try:
    import anthropic as _anthropic_mod
    HAS_ANTHROPIC = True
except ImportError:
    HAS_ANTHROPIC = False

try:
    from faster_whisper import WhisperModel
    HAS_WHISPER = True
except ImportError:
    HAS_WHISPER = False

# ─────────────────────────────────────────────────────────────
#  Configuration
# ─────────────────────────────────────────────────────────────

STATUS_FILE = Path("/tmp/ironsight-status.json")
HISTORY_FILE = Path("/tmp/ironsight-history.json")
CALIBRATION_FILE = Path("/etc/ironsight-touch-cal.json")

DATA_REFRESH_INTERVAL = 2.0   # seconds between data fetches
TOUCH_POLL_HZ = 20            # touch polling rate
TAP_DEBOUNCE_MS = 250         # minimum ms between taps
FEEDBACK_DURATION = 3.0        # seconds to show command result toast

# Colors (RGB) — high contrast for sunlight
BLACK = (0, 0, 0)
WHITE = (255, 255, 255)
GREEN = (0, 200, 80)
RED = (220, 50, 50)
YELLOW = (240, 200, 0)
BLUE = (40, 120, 220)
CYAN = (0, 180, 220)
DARK_GRAY = (30, 30, 35)
MID_GRAY = (60, 60, 70)
LIGHT_GRAY = (180, 180, 190)
ORANGE = (240, 140, 20)
DARK_GREEN = (0, 80, 40)
DARK_RED = (80, 20, 20)
DARK_BLUE = (20, 50, 100)
DARK_CYAN = (0, 70, 90)
DARK_ORANGE = (100, 55, 10)

PISUGAR_SOCK = "/tmp/pisugar-server.sock"
CHAT_HISTORY_FILE = Path("/tmp/ironsight-chat.json")
WHISPER_MODEL = "tiny"  # tiny=39MB, base=74MB — both fast on Pi 5
MAX_RECORD_SECONDS = 30
SAMPLE_RATE = 16000
AUDIO_DEVICE = "default"  # ALSA device for USB mic

LEVEL_COLORS = {
    "info": LIGHT_GRAY,
    "success": GREEN,
    "warning": YELLOW,
    "error": RED,
}


# ─────────────────────────────────────────────────────────────
#  Framebuffer (reuse from ironsight-display.py)
# ─────────────────────────────────────────────────────────────

class Framebuffer:
    """Write PIL Images directly to a Linux framebuffer device."""

    def __init__(self, fb_path: str = "/dev/fb0"):
        self.fb_path = fb_path
        self.width = 0
        self.height = 0
        self.bpp = 0
        self.stride = 0
        self._fb_fd = None
        self._fb_mmap = None
        self._detect()

    def _detect(self):
        fb_name = os.path.basename(self.fb_path)
        sysfs = Path(f"/sys/class/graphics/{fb_name}")
        try:
            vsize = (sysfs / "virtual_size").read_text().strip()
            w, h = vsize.split(",")
            self.width = int(w)
            self.height = int(h)
        except Exception:
            try:
                out = subprocess.check_output(
                    ["fbset", "-fb", self.fb_path, "-s"],
                    text=True, timeout=5
                )
                for line in out.splitlines():
                    if "geometry" in line:
                        parts = line.split()
                        self.width = int(parts[1])
                        self.height = int(parts[2])
                        self.bpp = int(parts[5])
            except Exception:
                pass

        try:
            self.bpp = int((sysfs / "bits_per_pixel").read_text().strip())
        except Exception:
            if self.bpp == 0:
                self.bpp = 16

        try:
            self.stride = int((sysfs / "stride").read_text().strip())
        except Exception:
            self.stride = self.width * (self.bpp // 8)

    def is_available(self) -> bool:
        return self.width > 0 and self.height > 0 and os.path.exists(self.fb_path)

    def open(self):
        self._fb_fd = os.open(self.fb_path, os.O_RDWR)
        fb_size = self.stride * self.height
        self._fb_mmap = mmap.mmap(self._fb_fd, fb_size)

    def close(self):
        if self._fb_mmap:
            self._fb_mmap.close()
        if self._fb_fd is not None:
            os.close(self._fb_fd)

    def show(self, image: "Image.Image"):
        if not self._fb_mmap:
            self.open()
        if image.size != (self.width, self.height):
            image = image.resize((self.width, self.height))
        if self.bpp == 16:
            self._write_rgb565(image)
        elif self.bpp == 32:
            self._write_rgba(image)
        else:
            fb_data = image.convert("RGB").tobytes()
            self._fb_mmap.seek(0)
            self._fb_mmap.write(fb_data)

    def _write_rgb565(self, image):
        """Convert RGB to RGB565 — uses numpy if available for speed."""
        pixels = image.convert("RGB").tobytes()
        try:
            import numpy as np
            arr = np.frombuffer(pixels, dtype=np.uint8).reshape(-1, 3)
            r = arr[:, 0].astype(np.uint16)
            g = arr[:, 1].astype(np.uint16)
            b = arr[:, 2].astype(np.uint16)
            rgb565 = ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3)
            fb_data = rgb565.astype(np.uint16).tobytes()
        except ImportError:
            # Pure Python fallback
            fb_data = bytearray(self.width * self.height * 2)
            for i in range(0, len(pixels), 3):
                r, g, b = pixels[i], pixels[i + 1], pixels[i + 2]
                rgb565 = ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3)
                j = (i // 3) * 2
                fb_data[j] = rgb565 & 0xFF
                fb_data[j + 1] = (rgb565 >> 8) & 0xFF
        self._fb_mmap.seek(0)
        self._fb_mmap.write(bytes(fb_data) if isinstance(fb_data, bytearray) else fb_data)

    def _write_rgba(self, image):
        """Convert RGBA to BGRA for 32-bit framebuffer."""
        pixels = image.convert("RGBA").tobytes()
        try:
            import numpy as np
            arr = np.frombuffer(pixels, dtype=np.uint8).reshape(-1, 4).copy()
            # Swap R and B channels
            arr[:, [0, 2]] = arr[:, [2, 0]]
            fb_data = arr.tobytes()
        except ImportError:
            fb_data = bytearray(len(pixels))
            for i in range(0, len(pixels), 4):
                fb_data[i] = pixels[i + 2]
                fb_data[i + 1] = pixels[i + 1]
                fb_data[i + 2] = pixels[i]
                fb_data[i + 3] = pixels[i + 3]
        self._fb_mmap.seek(0)
        self._fb_mmap.write(bytes(fb_data) if isinstance(fb_data, bytearray) else fb_data)


# ─────────────────────────────────────────────────────────────
#  Touch Input
# ─────────────────────────────────────────────────────────────

class TouchInput:
    """Read touch events from ADS7846/XPT2046 via evdev."""

    def __init__(self, screen_w: int = 480, screen_h: int = 320):
        self.screen_w = screen_w
        self.screen_h = screen_h
        self.device = None
        self._tap_queue: List[Tuple[int, int]] = []
        self._lock = threading.Lock()
        self._thread = None
        self._running = False

        # Raw ADC calibration — defaults for typical SunFounder 3.5"
        self.cal = {
            "min_x": 150, "max_x": 3900,
            "min_y": 200, "max_y": 3850,
            "swap_xy": True,
            "invert_x": True,
            "invert_y": True,
        }
        self._load_calibration()

        # Touch state tracking
        self._raw_x = 0
        self._raw_y = 0
        self._touching = False
        self._touch_start_time = 0
        self._last_tap_time = 0

        # Double-tap detection
        self._double_tap_queue: List[Tuple[int, int]] = []
        self._prev_tap_time = 0
        self._prev_tap_pos = (0, 0)
        self.DOUBLE_TAP_MS = 400   # max time between taps
        self.DOUBLE_TAP_PX = 50    # max distance between taps

    def _load_calibration(self):
        """Load calibration from file if it exists."""
        try:
            data = json.loads(CALIBRATION_FILE.read_text())
            self.cal.update(data)
        except Exception:
            pass

    def save_calibration(self):
        """Save current calibration to file."""
        try:
            CALIBRATION_FILE.write_text(json.dumps(self.cal, indent=2))
        except Exception as e:
            print(f"Could not save calibration: {e}")

    def find_device(self) -> bool:
        """Find the ADS7846 touchscreen device."""
        if not HAS_EVDEV:
            return False
        try:
            for path in evdev.list_devices():
                dev = evdev.InputDevice(path)
                if "ADS7846" in dev.name or "ads7846" in dev.name.lower():
                    self.device = dev
                    print(f"Touch device found: {dev.name} at {path}")
                    return True
                # Also try generic touchscreen names
                if "touch" in dev.name.lower() and "screen" in dev.name.lower():
                    self.device = dev
                    print(f"Touch device found: {dev.name} at {path}")
                    return True
        except Exception as e:
            print(f"Error finding touch device: {e}")
        return False

    def _map_coordinates(self, raw_x: int, raw_y: int) -> Tuple[int, int]:
        """Map raw ADC coordinates to screen coordinates."""
        cal = self.cal
        if cal["swap_xy"]:
            raw_x, raw_y = raw_y, raw_x

        # Normalize to 0.0-1.0
        norm_x = (raw_x - cal["min_x"]) / max(1, cal["max_x"] - cal["min_x"])
        norm_y = (raw_y - cal["min_y"]) / max(1, cal["max_y"] - cal["min_y"])

        if cal["invert_x"]:
            norm_x = 1.0 - norm_x
        if cal["invert_y"]:
            norm_y = 1.0 - norm_y

        # Clamp and scale to screen
        sx = max(0, min(self.screen_w - 1, int(norm_x * self.screen_w)))
        sy = max(0, min(self.screen_h - 1, int(norm_y * self.screen_h)))
        return sx, sy

    def start(self):
        """Start reading touch events in a background thread."""
        if not self.device:
            if not self.find_device():
                print("No touch device found — touch disabled")
                return
        self._running = True
        self._thread = threading.Thread(target=self._read_loop, daemon=True)
        self._thread.start()

    def stop(self):
        self._running = False
        if self._thread:
            self._thread.join(timeout=2)

    def _read_loop(self):
        """Background thread reading evdev events."""
        try:
            for event in self.device.read_loop():
                if not self._running:
                    break

                if event.type == ecodes.EV_ABS:
                    if event.code == ecodes.ABS_X:
                        self._raw_x = event.value
                    elif event.code == ecodes.ABS_Y:
                        self._raw_y = event.value
                    elif event.code == ecodes.ABS_PRESSURE:
                        if event.value > 0 and not self._touching:
                            # Touch down
                            self._touching = True
                            self._touch_start_time = time.time()
                        elif event.value == 0 and self._touching:
                            # Touch up — register as tap
                            self._touching = False
                            now = time.time()
                            # Debounce
                            if (now - self._last_tap_time) * 1000 > TAP_DEBOUNCE_MS:
                                sx, sy = self._map_coordinates(self._raw_x, self._raw_y)
                                with self._lock:
                                    self._tap_queue.append((sx, sy))
                                    self._check_double_tap(sx, sy)
                                self._last_tap_time = now

                elif event.type == ecodes.EV_KEY:
                    if event.code == ecodes.BTN_TOUCH:
                        if event.value == 1 and not self._touching:
                            self._touching = True
                            self._touch_start_time = time.time()
                        elif event.value == 0 and self._touching:
                            self._touching = False
                            now = time.time()
                            if (now - self._last_tap_time) * 1000 > TAP_DEBOUNCE_MS:
                                sx, sy = self._map_coordinates(self._raw_x, self._raw_y)
                                with self._lock:
                                    self._tap_queue.append((sx, sy))
                                    self._check_double_tap(sx, sy)
                                self._last_tap_time = now

        except Exception as e:
            print(f"Touch read error: {e}")

    def _check_double_tap(self, sx: int, sy: int):
        """Check if this tap forms a double-tap with the previous one."""
        now = time.time()
        dt = (now - self._prev_tap_time) * 1000
        dx = abs(sx - self._prev_tap_pos[0])
        dy = abs(sy - self._prev_tap_pos[1])
        if dt < self.DOUBLE_TAP_MS and dx < self.DOUBLE_TAP_PX and dy < self.DOUBLE_TAP_PX:
            self._double_tap_queue.append((sx, sy))
            self._prev_tap_time = 0  # reset so triple-tap doesn't fire again
        else:
            self._prev_tap_time = now
            self._prev_tap_pos = (sx, sy)

    def get_tap(self) -> Optional[Tuple[int, int]]:
        """Return the most recent tap, or None. Non-blocking."""
        with self._lock:
            if self._tap_queue:
                tap = self._tap_queue[-1]
                self._tap_queue.clear()
                return tap
        return None

    def get_double_tap(self) -> Optional[Tuple[int, int]]:
        """Return the most recent double-tap, or None. Non-blocking."""
        with self._lock:
            if self._double_tap_queue:
                tap = self._double_tap_queue[-1]
                self._double_tap_queue.clear()
                return tap
        return None


# ─────────────────────────────────────────────────────────────
#  PTT Button (USB presenter clicker / any USB HID button)
# ─────────────────────────────────────────────────────────────

class PTTButton:
    """Listen for a USB HID button press/release for push-to-talk.

    Works with wireless presenter clickers, USB arcade buttons, or any
    USB device that sends keyboard key events. Ignores the Pi's built-in
    keyboard (if any) and the touchscreen.
    """

    IGNORED_NAMES = {"ADS7846", "ads7846", "raspberrypi", "vc4"}

    def __init__(self):
        self.device = None
        self.held = False  # True while any key is held down
        self._lock = threading.Lock()
        self._pressed = False   # edge-detected: became pressed
        self._released = False  # edge-detected: became released
        self._thread = None
        self._running = False

    def find_device(self) -> bool:
        """Find a USB HID input device (not the touchscreen)."""
        if not HAS_EVDEV:
            return False
        try:
            for path in evdev.list_devices():
                dev = evdev.InputDevice(path)
                # Skip known non-button devices
                if any(skip in dev.name for skip in self.IGNORED_NAMES):
                    continue
                # Must have EV_KEY capability (keyboard/button events)
                caps = dev.capabilities(verbose=False)
                if ecodes.EV_KEY not in caps:
                    continue
                # Skip if it has ABS events (probably a touchscreen/mouse)
                if ecodes.EV_ABS in caps:
                    continue
                self.device = dev
                print(f"PTT button found: {dev.name} at {path}")
                return True
        except Exception as e:
            print(f"Error finding PTT device: {e}")
        return False

    def start(self):
        """Start listening for button events in background."""
        if not self.device:
            if not self.find_device():
                print("No PTT button found — use touchscreen instead")
                return
        self._running = True
        self._thread = threading.Thread(target=self._read_loop, daemon=True)
        self._thread.start()

    def stop(self):
        self._running = False
        if self._thread:
            self._thread.join(timeout=2)

    def _read_loop(self):
        """Background thread reading HID key events."""
        try:
            for event in self.device.read_loop():
                if not self._running:
                    break
                if event.type == ecodes.EV_KEY:
                    with self._lock:
                        if event.value == 1:  # key down
                            self.held = True
                            self._pressed = True
                        elif event.value == 0:  # key up
                            self.held = False
                            self._released = True
        except Exception as e:
            print(f"PTT read error: {e}")
            # Device may have been unplugged — try to reconnect
            self.device = None
            while self._running:
                time.sleep(5)
                if self.find_device():
                    print("PTT button reconnected")
                    try:
                        for event in self.device.read_loop():
                            if not self._running:
                                return
                            if event.type == ecodes.EV_KEY:
                                with self._lock:
                                    if event.value == 1:
                                        self.held = True
                                        self._pressed = True
                                    elif event.value == 0:
                                        self.held = False
                                        self._released = True
                    except Exception:
                        self.device = None
                        continue

    def get_pressed(self) -> bool:
        """Returns True once when button is first pressed (edge detect)."""
        with self._lock:
            if self._pressed:
                self._pressed = False
                return True
        return False

    def get_released(self) -> bool:
        """Returns True once when button is released (edge detect)."""
        with self._lock:
            if self._released:
                self._released = False
                return True
        return False


# ─────────────────────────────────────────────────────────────
#  Button system
# ─────────────────────────────────────────────────────────────

@dataclass
class Button:
    x: int
    y: int
    w: int
    h: int
    label: str
    action: str
    color: tuple = MID_GRAY
    text_color: tuple = WHITE
    icon: str = ""
    enabled: bool = True

    def contains(self, px: int, py: int) -> bool:
        return self.x <= px <= self.x + self.w and self.y <= py <= self.y + self.h


def draw_button(draw, btn: Button, font, pressed: bool = False):
    """Draw a single button with optional pressed state."""
    if not btn.enabled:
        fill = MID_GRAY
        text_color = DARK_GRAY
    elif pressed:
        fill = WHITE
        text_color = BLACK
    else:
        fill = btn.color
        text_color = btn.text_color

    # Button background with slight rounding
    draw.rounded_rectangle(
        [btn.x, btn.y, btn.x + btn.w, btn.y + btn.h],
        radius=8, fill=fill
    )

    # Center the label text
    label = btn.label
    if btn.icon:
        label = f"{btn.icon}  {label}"

    bbox = draw.textbbox((0, 0), label, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    tx = btn.x + (btn.w - tw) // 2
    ty = btn.y + (btn.h - th) // 2
    draw.text((tx, ty), label, fill=text_color, font=font)


def find_hit(buttons: List[Button], x: int, y: int) -> Optional[Button]:
    """Find which button was tapped."""
    for btn in buttons:
        if btn.enabled and btn.contains(x, y):
            return btn
    return None


# ─────────────────────────────────────────────────────────────
#  Font helper
# ─────────────────────────────────────────────────────────────

_font_cache = {}

def find_font(size: int):
    if size in _font_cache:
        return _font_cache[size]
    font_paths = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf",
    ]
    for fp in font_paths:
        if os.path.exists(fp):
            font = ImageFont.truetype(fp, size)
            _font_cache[size] = font
            return font
    font = ImageFont.load_default()
    _font_cache[size] = font
    return font


# ─────────────────────────────────────────────────────────────
#  Data sources (same as ironsight-display.py)
# ─────────────────────────────────────────────────────────────

def _pisugar_query(cmd: str) -> str:
    """Query the PiSugar server via Unix socket. Returns response or empty string."""
    try:
        import socket as _sock
        s = _sock.socket(_sock.AF_UNIX, _sock.SOCK_STREAM)
        s.settimeout(1)
        s.connect(PISUGAR_SOCK)
        s.sendall((cmd + "\n").encode())
        data = s.recv(256).decode().strip()
        s.close()
        return data
    except Exception:
        return ""


def get_battery_status() -> dict:
    """Read battery info from PiSugar 3 Plus."""
    battery = {
        "available": False,
        "percent": -1,
        "voltage": 0.0,
        "charging": False,
        "power_plugged": False,
    }
    try:
        resp = _pisugar_query("get battery")
        if resp and ":" in resp:
            battery["percent"] = float(resp.split(":")[1].strip())
            battery["available"] = True

        resp = _pisugar_query("get battery_v")
        if resp and ":" in resp:
            battery["voltage"] = float(resp.split(":")[1].strip())

        resp = _pisugar_query("get battery_charging")
        if resp and ":" in resp:
            battery["charging"] = resp.split(":")[1].strip().lower() == "true"

        resp = _pisugar_query("get battery_power_plugged")
        if resp and ":" in resp:
            battery["power_plugged"] = resp.split(":")[1].strip().lower() == "true"
    except Exception:
        pass
    return battery


def get_component_status() -> dict:
    try:
        data = json.loads(STATUS_FILE.read_text())
        return data.get("components", {})
    except Exception:
        return {}


def get_activity_history() -> list:
    try:
        return json.loads(HISTORY_FILE.read_text())
    except Exception:
        return []


def get_system_status() -> dict:
    """Gather live system health."""
    status = {
        "viam_server": False,
        "plc_reachable": False,
        "plc_ip": "unknown",
        "internet": False,
        "disk_pct": 0,
        "uptime": "",
        "truck_id": "unknown",
        "connected": False,
        "travel_ft": 0.0,
        "speed_ftpm": 0.0,
        "plate_count": 0,
        "plates_per_min": 0.0,
        "system_state": "unknown",
        "last_spacing_in": 0.0,
        "avg_spacing_in": 0.0,
        "ds_registers": {},
        "eth0_carrier": False,
        "wifi_ssid": "",
        "wifi_signal_dbm": 0,
        "iphone_connected": False,
        "cpu_temp": 0.0,
        "mem_pct": 0,
        "tailscale_ip": "",
        "eth0_ip": "",
        "battery": {"available": False, "percent": -1, "voltage": 0.0, "charging": False, "power_plugged": False},
    }

    # viam-server
    try:
        r = subprocess.run(["systemctl", "is-active", "viam-server"],
                           capture_output=True, text=True, timeout=5)
        status["viam_server"] = r.stdout.strip() == "active"
    except Exception:
        pass

    # Internet
    try:
        r = subprocess.run(["ping", "-c", "1", "-W", "2", "8.8.8.8"],
                           capture_output=True, timeout=5)
        status["internet"] = r.returncode == 0
    except Exception:
        pass

    # Disk
    try:
        r = subprocess.check_output(["df", "/", "--output=pcent"], text=True, timeout=5)
        for line in r.strip().splitlines():
            line = line.strip()
            if line.endswith("%"):
                status["disk_pct"] = int(line.rstrip("%"))
    except Exception:
        pass

    # Uptime
    try:
        up = float(Path("/proc/uptime").read_text().split()[0])
        hours = int(up // 3600)
        mins = int((up % 3600) // 60)
        status["uptime"] = f"{hours}h {mins}m"
    except Exception:
        status["uptime"] = "?"

    # eth0 carrier + IP
    try:
        status["eth0_carrier"] = Path("/sys/class/net/eth0/carrier").read_text().strip() == "1"
    except Exception:
        pass
    try:
        r = subprocess.check_output(
            ["ip", "-4", "addr", "show", "eth0"], text=True, timeout=5
        )
        for line in r.splitlines():
            if "inet " in line:
                status["eth0_ip"] = line.strip().split()[1].split("/")[0]
    except Exception:
        pass

    # WiFi SSID + signal strength
    try:
        r = subprocess.check_output(["iwgetid", "-r"], text=True, timeout=5)
        status["wifi_ssid"] = r.strip()
    except Exception:
        pass
    try:
        r = subprocess.check_output(
            ["iwconfig", "wlan0"], text=True, timeout=5, stderr=subprocess.DEVNULL
        )
        for line in r.splitlines():
            if "Signal level" in line:
                # Format: "Signal level=-52 dBm" or "Signal level=48/100"
                import re
                m = re.search(r"Signal level[=:]?\s*(-?\d+)", line)
                if m:
                    status["wifi_signal_dbm"] = int(m.group(1))
    except Exception:
        pass

    # iPhone USB tethering
    try:
        # Check for ipheth driver on any interface
        import glob
        for driver_path in glob.glob("/sys/class/net/*/device/driver"):
            if "ipheth" in os.readlink(driver_path):
                status["iphone_connected"] = True
                break
    except Exception:
        pass

    # Tailscale IP
    try:
        r = subprocess.check_output(["tailscale", "ip", "-4"], text=True, timeout=5)
        status["tailscale_ip"] = r.strip()
    except Exception:
        pass

    # CPU temp
    try:
        temp = float(Path("/sys/class/thermal/thermal_zone0/temp").read_text().strip())
        status["cpu_temp"] = temp / 1000.0
    except Exception:
        pass

    # Memory
    try:
        mem = Path("/proc/meminfo").read_text()
        total = avail = 0
        for line in mem.splitlines():
            if line.startswith("MemTotal:"):
                total = int(line.split()[1])
            elif line.startswith("MemAvailable:"):
                avail = int(line.split()[1])
        if total > 0:
            status["mem_pct"] = int(100 * (total - avail) / total)
    except Exception:
        pass

    # Battery (PiSugar 3 Plus)
    status["battery"] = get_battery_status()

    # PLC config
    try:
        config_path = Path(__file__).resolve().parent.parent / "config" / "viam-server.json"
        config = json.loads(config_path.read_text())
        for comp in config.get("components", []):
            if comp.get("name") == "plc-monitor":
                status["plc_ip"] = comp["attributes"]["host"]
                status["truck_id"] = comp["attributes"].get("truck_id", "unknown")
    except Exception:
        pass

    # PLC reachability
    try:
        import socket
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(1)
        result = sock.connect_ex((status["plc_ip"], 502))
        sock.close()
        status["plc_reachable"] = result == 0
        status["connected"] = result == 0
    except Exception:
        pass

    # Latest reading from offline buffer
    try:
        buf_dir = Path("/home/andrew/.viam/offline-buffer")
        if buf_dir.exists():
            jsonl_files = sorted(buf_dir.glob("readings_*.jsonl"))
            if jsonl_files:
                with open(jsonl_files[-1], "rb") as f:
                    # Read last 4KB and grab the last complete JSON line
                    f.seek(0, 2)
                    size = f.tell()
                    f.seek(max(0, size - 4096))
                    chunk = f.read()
                    lines = chunk.strip().split(b"\n")
                    # Last line is complete; second-to-last might be partial
                    data = None
                    for line in reversed(lines):
                        try:
                            data = json.loads(line)
                            break
                        except (json.JSONDecodeError, ValueError):
                            continue
                    if data:
                        status["travel_ft"] = data.get("encoder_distance_ft", 0)
                        status["speed_ftpm"] = data.get("encoder_speed_ftpm", 0)
                        status["plate_count"] = data.get("plate_drop_count", 0)
                        status["plates_per_min"] = data.get("plates_per_minute", 0)
                        status["system_state"] = data.get("system_state", "unknown")
                        status["last_spacing_in"] = data.get("last_drop_spacing_in", 0)
                        status["avg_spacing_in"] = data.get("avg_drop_spacing_in", 0)
                        status["connected"] = data.get("connected", False)
                        for i in range(1, 26):
                            key = f"ds{i}"
                            if key in data:
                                status["ds_registers"][key] = data[key]
    except Exception:
        pass

    return status


# ─────────────────────────────────────────────────────────────
#  Command executor
# ─────────────────────────────────────────────────────────────

class CommandExecutor:
    """Execute system commands with feedback for the display."""

    def __init__(self):
        self.feedback_message = ""
        self.feedback_level = "info"  # info, success, error
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
                    capture_output=True, text=True, timeout=30
                )
                if r.returncode == 0:
                    self._set_feedback("viam-server restarted OK", "success")
                else:
                    self._set_feedback(f"Restart failed: {r.stderr[:40]}", "error")

            elif action == "cmd_test_plc":
                self._set_feedback("Testing PLC connection...", "info")
                import socket
                sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                sock.settimeout(3)
                result = sock.connect_ex(("169.168.10.21", 502))
                sock.close()
                if result == 0:
                    self._set_feedback("PLC reachable at 169.168.10.21:502", "success")
                else:
                    self._set_feedback("PLC unreachable (no carrier?)", "error")

            elif action == "cmd_switch_wifi":
                self._set_feedback("Scanning WiFi networks...", "info")
                r = subprocess.run(
                    ["nmcli", "device", "wifi", "rescan"],
                    capture_output=True, text=True, timeout=15
                )
                r2 = subprocess.run(
                    ["nmcli", "-t", "-f", "SSID,SIGNAL,IN-USE", "device", "wifi", "list"],
                    capture_output=True, text=True, timeout=10
                )
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
                buf_dir = Path("/home/andrew/.viam/offline-buffer")
                count = 0
                if buf_dir.exists():
                    for f in buf_dir.glob("readings_*.jsonl"):
                        f.unlink()
                        count += 1
                self._set_feedback(f"Cleared {count} buffer files", "success")

            elif action == "cmd_force_sync":
                self._set_feedback("Triggering cloud sync...", "info")
                # Restart data manager by restarting viam-server briefly
                r = subprocess.run(
                    ["sudo", "systemctl", "restart", "viam-server"],
                    capture_output=True, text=True, timeout=30
                )
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


# ─────────────────────────────────────────────────────────────
#  Voice Chat system
# ─────────────────────────────────────────────────────────────

@dataclass
class ChatMessage:
    role: str       # "user" or "assistant"
    text: str
    timestamp: str

    def to_dict(self):
        return {"role": self.role, "text": self.text, "timestamp": self.timestamp}

    @classmethod
    def from_dict(cls, d):
        return cls(role=d["role"], text=d["text"], timestamp=d.get("timestamp", ""))


class VoiceChat:
    """Push-to-talk voice chat with Claude via whisper + Anthropic API."""

    def __init__(self, sys_status_fn):
        self.messages: List[ChatMessage] = []
        self.scroll_offset = 0
        self.state = "idle"  # idle, recording, transcribing, thinking, error
        self.state_message = ""
        self._recording = False
        self._audio_data = []
        self._record_thread = None
        self._process_thread = None
        self._whisper_model = None
        self._sys_status_fn = sys_status_fn
        self._load_history()

    def _load_history(self):
        """Load chat history from disk."""
        try:
            data = json.loads(CHAT_HISTORY_FILE.read_text())
            self.messages = [ChatMessage.from_dict(m) for m in data[-50:]]
        except Exception:
            self.messages = []

    def _save_history(self):
        """Save chat history to disk."""
        try:
            data = [m.to_dict() for m in self.messages[-50:]]
            CHAT_HISTORY_FILE.write_text(json.dumps(data))
        except Exception:
            pass

    def _get_whisper(self):
        """Lazy-load whisper model."""
        if self._whisper_model is None and HAS_WHISPER:
            self.state = "loading"
            self.state_message = "Loading whisper model..."
            try:
                self._whisper_model = WhisperModel(
                    WHISPER_MODEL, device="cpu", compute_type="int8"
                )
            except Exception as e:
                print(f"Whisper load error: {e}")
                self.state = "error"
                self.state_message = f"Whisper failed: {str(e)[:30]}"
        return self._whisper_model

    def start_recording(self):
        """Start recording audio from USB mic."""
        if self._recording or self.state in ("transcribing", "thinking"):
            return
        self._recording = True
        self._audio_data = []
        self.state = "recording"
        self.state_message = "Recording... release to send"
        self._record_thread = threading.Thread(target=self._record_loop, daemon=True)
        self._record_thread.start()

    def _record_loop(self):
        """Record audio via arecord subprocess."""
        try:
            self._audio_file = f"/tmp/ironsight-voice-{int(time.time())}.wav"
            self._record_proc = subprocess.Popen(
                ["arecord", "-D", AUDIO_DEVICE, "-f", "S16_LE",
                 "-r", str(SAMPLE_RATE), "-c", "1", "-t", "wav",
                 "-d", str(MAX_RECORD_SECONDS), self._audio_file],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
            )
            # Wait for recording to stop (either timeout or stop_recording called)
            self._record_proc.wait()
        except Exception as e:
            print(f"Record error: {e}")
            self.state = "error"
            self.state_message = f"Mic error: {str(e)[:30]}"
            self._recording = False

    def stop_recording(self):
        """Stop recording and process the audio."""
        if not self._recording:
            return
        self._recording = False
        # Kill the arecord process
        try:
            if hasattr(self, '_record_proc') and self._record_proc.poll() is None:
                self._record_proc.terminate()
                self._record_proc.wait(timeout=2)
        except Exception:
            pass
        # Process in background
        self._process_thread = threading.Thread(target=self._process_audio, daemon=True)
        self._process_thread.start()

    def _process_audio(self):
        """Transcribe audio and send to Claude."""
        audio_file = getattr(self, '_audio_file', None)
        if not audio_file or not os.path.exists(audio_file):
            self.state = "error"
            self.state_message = "No audio recorded"
            return

        # Check file size — too small means no audio
        file_size = os.path.getsize(audio_file)
        if file_size < 1000:
            self.state = "error"
            self.state_message = "No audio detected — check mic"
            try:
                os.unlink(audio_file)
            except Exception:
                pass
            return

        # Transcribe
        self.state = "transcribing"
        self.state_message = "Transcribing..."
        transcript = self._transcribe(audio_file)

        # Clean up audio file
        try:
            os.unlink(audio_file)
        except Exception:
            pass

        if not transcript or not transcript.strip():
            self.state = "error"
            self.state_message = "Could not understand audio"
            return

        # Add user message
        user_msg = ChatMessage(
            role="user", text=transcript.strip(),
            timestamp=time.strftime("%H:%M")
        )
        self.messages.append(user_msg)
        self.scroll_offset = 0  # scroll to bottom

        # Send to Claude
        self.state = "thinking"
        self.state_message = "Claude is thinking..."
        response = self._ask_claude(transcript.strip())

        if response:
            assistant_msg = ChatMessage(
                role="assistant", text=response,
                timestamp=time.strftime("%H:%M")
            )
            self.messages.append(assistant_msg)
        else:
            self.state = "error"
            self.state_message = "Claude API error"
            return

        self._save_history()
        self.state = "idle"
        self.state_message = ""

    def _transcribe(self, audio_file: str) -> str:
        """Transcribe audio file using faster-whisper."""
        model = self._get_whisper()
        if model:
            try:
                segments, _ = model.transcribe(
                    audio_file, beam_size=1, language="en",
                    vad_filter=True
                )
                return " ".join(seg.text for seg in segments).strip()
            except Exception as e:
                print(f"Transcription error: {e}")

        # Fallback: no whisper — show error
        self.state = "error"
        self.state_message = "Whisper not available"
        return ""

    def _ask_claude(self, user_text: str) -> str:
        """Send message to Claude via the claude CLI (already authenticated)."""
        try:
            # Build system context from current system status
            sys_status = self._sys_status_fn()
            bat = sys_status.get("battery", {})

            context = (
                "You are IronSight, an AI assistant on a TPS railroad truck. "
                "Keep responses SHORT (2-3 sentences max) for a tiny 3.5 inch screen. "
                "No markdown, no bullet points, plain text only.\n\n"
                f"System: PLC {'connected' if sys_status['connected'] else 'disconnected'} "
                f"({sys_status['plc_ip']}), "
                f"viam-server {'running' if sys_status['viam_server'] else 'stopped'}, "
                f"Internet {'connected' if sys_status['internet'] else 'offline'} "
                f"(WiFi: {sys_status['wifi_ssid']}), "
                f"eth0 {'linked' if sys_status['eth0_carrier'] else 'NO CARRIER'}, "
                f"Plates: {sys_status['plate_count']}, "
                f"Travel: {sys_status['travel_ft']:.1f}ft, "
                f"Speed: {sys_status['speed_ftpm']:.1f}ft/m, "
                f"Spacing: last {sys_status['last_spacing_in']:.1f}\" avg {sys_status['avg_spacing_in']:.1f}\", "
                f"Battery: {'{:.0f}%'.format(bat['percent']) if bat.get('available') else 'N/A'}, "
                f"CPU: {sys_status['cpu_temp']:.0f}C, Disk: {sys_status['disk_pct']}%, "
                f"Up: {sys_status['uptime']}"
            )

            # Build conversation with recent history
            prompt_parts = [context, ""]
            for msg in self.messages[-6:]:
                role = "User" if msg.role == "user" else "Assistant"
                prompt_parts.append(f"{role}: {msg.text}")
            prompt_parts.append(f"User: {user_text}")
            prompt_parts.append("Respond in 2-3 short sentences:")

            full_prompt = "\n".join(prompt_parts)

            result = subprocess.run(
                ["claude", "-p", "--model", "sonnet"],
                input=full_prompt,
                capture_output=True, text=True, timeout=60
            )

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

    def clear_history(self):
        """Clear chat history."""
        self.messages = []
        self.scroll_offset = 0
        self._save_history()


# ─────────────────────────────────────────────────────────────
#  Page renderers
# ─────────────────────────────────────────────────────────────

# Screen is 480x320. All rendering is at native resolution.
W, H = 480, 320
MARGIN = 10
HEADER_H = 32
BACK_BTN_H = 40
BACK_BTN_W = 80


def _draw_status_bar(draw, sys_status):
    """Draw thin status bar at top — always visible."""
    font = find_font(11)
    font_sm = find_font(9)

    draw.rectangle([0, 0, W, HEADER_H], fill=(15, 15, 20))

    # IRONSIGHT brand
    draw.text((MARGIN, 8), "IRONSIGHT", fill=BLUE, font=font)

    # Battery indicator (right side)
    bat = sys_status.get("battery", {})
    x_right = W - MARGIN
    if bat.get("available"):
        pct = bat.get("percent", 0)
        charging = bat.get("charging", False)

        # Battery icon: outline rectangle with fill level
        bat_w, bat_h = 24, 12
        bat_x = x_right - bat_w
        bat_y = 10
        # Battery body
        draw.rectangle([bat_x, bat_y, bat_x + bat_w, bat_y + bat_h], outline=LIGHT_GRAY, width=1)
        # Battery tip
        draw.rectangle([bat_x + bat_w, bat_y + 3, bat_x + bat_w + 3, bat_y + bat_h - 3], fill=LIGHT_GRAY)
        # Fill level
        fill_w = max(0, int((bat_w - 2) * pct / 100))
        bat_color = GREEN if pct > 30 else YELLOW if pct > 15 else RED
        if charging:
            bat_color = CYAN
        if fill_w > 0:
            draw.rectangle([bat_x + 1, bat_y + 1, bat_x + 1 + fill_w, bat_y + bat_h - 1], fill=bat_color)
        # Percentage text
        pct_str = f"{pct:.0f}%"
        if charging:
            pct_str = f"+{pct_str}"
        pw = draw.textlength(pct_str, font=font_sm)
        draw.text((bat_x - pw - 4, 9), pct_str, fill=bat_color, font=font_sm)
        x_right = bat_x - pw - 10

    # Connection info (right to left)
    x = x_right

    # iPhone indicator
    if sys_status.get("iphone_connected"):
        iph_str = "iPhone"
        iw = draw.textlength(iph_str, font=font_sm)
        x -= iw + 6
        draw.text((x, 9), iph_str, fill=CYAN, font=font_sm)

    # WiFi SSID + signal strength
    ssid = sys_status.get("wifi_ssid", "")
    signal_dbm = sys_status.get("wifi_signal_dbm", 0)
    if ssid:
        if signal_dbm >= -40:
            sig_label, sig_color = "Strong", GREEN
        elif signal_dbm >= -55:
            sig_label, sig_color = "Good", GREEN
        elif signal_dbm >= -70:
            sig_label, sig_color = "Fair", YELLOW
        elif signal_dbm >= -80:
            sig_label, sig_color = "Weak", ORANGE
        elif signal_dbm < -80:
            sig_label, sig_color = "Poor", RED
        else:
            sig_label, sig_color = "", LIGHT_GRAY
        wifi_str = f"{ssid} ({sig_label})" if sig_label else ssid
        ww = draw.textlength(wifi_str, font=font_sm)
        x -= ww + 8
        draw.text((x, 9), wifi_str, fill=sig_color, font=font_sm)
    elif not sys_status.get("iphone_connected"):
        # No WiFi and no iPhone — show "No Network"
        nw_str = "No Network"
        nw = draw.textlength(nw_str, font=font_sm)
        x -= nw + 8
        draw.text((x, 9), nw_str, fill=RED, font=font_sm)

    # Time
    now_str = time.strftime("%I:%M %p")
    tw = draw.textlength(now_str, font=font_sm)
    draw.text((x - tw - 8, 9), now_str, fill=LIGHT_GRAY, font=font_sm)


def _back_button() -> Button:
    """Standard back button for sub-pages — full width, easy to hit with gloves."""
    return Button(
        x=MARGIN, y=H - BACK_BTN_H - 5,
        w=W - MARGIN * 2, h=BACK_BTN_H,
        label="< BACK", action="nav_home",
        color=MID_GRAY, text_color=WHITE
    )


def _system_subtitle(sys_status: dict) -> str:
    """Build subtitle for SYSTEM button on home screen."""
    bat = sys_status.get("battery", {})
    if bat.get("available"):
        pct = bat.get("percent", 0)
        charging = bat.get("charging", False)
        chg = " CHG" if charging else ""
        return f"BAT {pct:.0f}%{chg} | CPU {sys_status['cpu_temp']:.0f}C"
    return f"CPU {sys_status['cpu_temp']:.0f}C | Disk {sys_status['disk_pct']}%"


def render_home(sys_status: dict) -> Tuple["Image.Image", List[Button]]:
    """HOME — 4 big quadrant buttons."""
    img = Image.new("RGB", (W, H), DARK_GRAY)
    draw = ImageDraw.Draw(img)
    _draw_status_bar(draw, sys_status)

    buttons = []
    font = find_font(16)
    font_sm = find_font(10)

    # Grid layout: row 1 = 3 buttons, row 2 = 2 buttons + CHAT (wider)
    gap = 5
    top = HEADER_H + gap
    total_h = H - top - MARGIN
    row_h = (total_h - gap) // 2

    # Row 1: LIVE, COMMANDS, LOGS (3 equal buttons)
    r1_btn_w = (W - MARGIN * 2 - gap * 2) // 3
    row1 = [
        ("LIVE", "nav_live", DARK_GREEN,
         f"{'ON' if sys_status['connected'] else 'OFF'} | {sys_status['plate_count']}pl"),
        ("COMMANDS", "nav_commands", DARK_ORANGE, "Restart, test"),
        ("LOGS", "nav_logs", DARK_BLUE, "Events"),
    ]
    for i, (label, action, color, subtitle) in enumerate(row1):
        bx = MARGIN + i * (r1_btn_w + gap)
        by = top
        btn = Button(bx, by, r1_btn_w, row_h, label, action, color=color)
        buttons.append(btn)
        draw.rounded_rectangle([bx, by, bx + r1_btn_w, by + row_h], radius=10, fill=color)
        bbox = draw.textbbox((0, 0), label, font=font)
        tw = bbox[2] - bbox[0]
        draw.text((bx + (r1_btn_w - tw) // 2, by + row_h // 2 - 18), label, fill=WHITE, font=font)
        bbox2 = draw.textbbox((0, 0), subtitle, font=font_sm)
        sw = bbox2[2] - bbox2[0]
        draw.text((bx + (r1_btn_w - sw) // 2, by + row_h // 2 + 6), subtitle, fill=LIGHT_GRAY, font=font_sm)

    # Row 2: SYSTEM, CHAT (2 buttons, CHAT gets more space)
    r2_y = top + row_h + gap
    sys_w = (W - MARGIN * 2 - gap) * 2 // 5
    chat_w = W - MARGIN * 2 - gap - sys_w

    # SYSTEM button
    sys_sub = _system_subtitle(sys_status)
    btn = Button(MARGIN, r2_y, sys_w, row_h, "SYSTEM", "nav_system", color=DARK_CYAN)
    buttons.append(btn)
    draw.rounded_rectangle([MARGIN, r2_y, MARGIN + sys_w, r2_y + row_h], radius=10, fill=DARK_CYAN)
    bbox = draw.textbbox((0, 0), "SYSTEM", font=font)
    tw = bbox[2] - bbox[0]
    draw.text((MARGIN + (sys_w - tw) // 2, r2_y + row_h // 2 - 18), "SYSTEM", fill=WHITE, font=font)
    bbox2 = draw.textbbox((0, 0), sys_sub, font=font_sm)
    sw = bbox2[2] - bbox2[0]
    draw.text((MARGIN + (sys_w - sw) // 2, r2_y + row_h // 2 + 6), sys_sub, fill=LIGHT_GRAY, font=font_sm)

    # CHAT button (larger, prominent)
    chat_x = MARGIN + sys_w + gap
    PURPLE = (100, 40, 140)
    btn = Button(chat_x, r2_y, chat_w, row_h, "CHAT", "nav_chat", color=PURPLE)
    buttons.append(btn)
    draw.rounded_rectangle([chat_x, r2_y, chat_x + chat_w, r2_y + row_h], radius=10, fill=PURPLE)
    chat_label = "CHAT"
    bbox = draw.textbbox((0, 0), chat_label, font=font)
    tw = bbox[2] - bbox[0]
    draw.text((chat_x + (chat_w - tw) // 2, r2_y + row_h // 2 - 18), chat_label, fill=WHITE, font=font)
    chat_sub = "Push to talk"
    bbox2 = draw.textbbox((0, 0), chat_sub, font=font_sm)
    sw = bbox2[2] - bbox2[0]
    draw.text((chat_x + (chat_w - sw) // 2, r2_y + row_h // 2 + 6), chat_sub, fill=LIGHT_GRAY, font=font_sm)

    return img, buttons


def render_live(sys_status: dict) -> Tuple["Image.Image", List[Button]]:
    """LIVE — real-time PLC data."""
    img = Image.new("RGB", (W, H), DARK_GRAY)
    draw = ImageDraw.Draw(img)
    _draw_status_bar(draw, sys_status)

    font_big = find_font(28)
    font_lg = find_font(18)
    font_med = find_font(14)
    font_sm = find_font(11)

    y = HEADER_H + 4

    # PLC connection bar
    connected = sys_status["connected"]
    bar_color = DARK_GREEN if connected else DARK_RED
    conn_text = "ONLINE" if connected else "OFFLINE"
    draw.rectangle([0, y, W, y + 22], fill=bar_color)
    draw.text((MARGIN, y + 3), f"PLC {sys_status['plc_ip']}", fill=WHITE, font=font_sm)
    cw = draw.textlength(conn_text, font=font_sm)
    draw.text((W - MARGIN - cw, y + 3), conn_text, fill=WHITE, font=font_sm)
    y += 26

    # Big travel number
    draw.text((MARGIN, y), "TRAVEL", fill=LIGHT_GRAY, font=font_sm)
    y += 14
    travel_str = f"{sys_status['travel_ft']:.1f} ft"
    draw.text((MARGIN, y), travel_str, fill=WHITE, font=font_big)
    y += 34

    # Speed + Plates side by side
    mid = W // 2
    draw.text((MARGIN, y), "SPEED", fill=LIGHT_GRAY, font=font_sm)
    draw.text((mid, y), "PLATES", fill=LIGHT_GRAY, font=font_sm)
    y += 14
    draw.text((MARGIN, y), f"{sys_status['speed_ftpm']:.1f} ft/m", fill=WHITE, font=font_lg)
    draw.text((mid, y), str(sys_status['plate_count']), fill=WHITE, font=font_lg)
    rate_text = f"({sys_status['plates_per_min']:.1f}/min)"
    plates_w = draw.textlength(str(sys_status['plate_count']), font=font_lg)
    draw.text((mid + plates_w + 6, y + 4), rate_text, fill=LIGHT_GRAY, font=font_sm)
    y += 26

    # Spacing
    draw.line([(MARGIN, y), (W - MARGIN, y)], fill=MID_GRAY, width=1)
    y += 6
    draw.text((MARGIN, y), "SPACING", fill=LIGHT_GRAY, font=font_sm)
    y += 14
    last_sp = sys_status["last_spacing_in"]
    avg_sp = sys_status["avg_spacing_in"]
    sp_color = GREEN if abs(last_sp - 19.5) < 2 else (YELLOW if abs(last_sp - 19.5) < 5 else RED)
    if last_sp == 0:
        sp_color = LIGHT_GRAY
    draw.text((MARGIN, y), f"Last: {last_sp:.1f}\"", fill=sp_color, font=font_lg)
    draw.text((mid, y), f"Avg: {avg_sp:.1f}\"", fill=WHITE, font=font_lg)
    y += 24

    # State
    state = sys_status["system_state"]
    state_color = GREEN if state == "running" else YELLOW
    draw.text((MARGIN, y), f"State: {state}", fill=state_color, font=font_med)

    # Back button
    back = _back_button()
    draw_button(draw, back, find_font(14))

    return img, [back]


def render_commands(sys_status: dict) -> Tuple["Image.Image", List[Button]]:
    """COMMANDS — actionable buttons."""
    img = Image.new("RGB", (W, H), DARK_GRAY)
    draw = ImageDraw.Draw(img)
    _draw_status_bar(draw, sys_status)

    font = find_font(14)
    font_title = find_font(12)

    y = HEADER_H + 6
    draw.text((MARGIN, y), "COMMANDS", fill=LIGHT_GRAY, font=font_title)
    y += 20

    commands = [
        ("Restart viam-server", "cmd_restart_viam", DARK_ORANGE, True),
        ("Test PLC Connection", "cmd_test_plc", DARK_BLUE, False),
        ("Scan WiFi Networks", "cmd_switch_wifi", DARK_CYAN, False),
        ("Clear Offline Buffer", "cmd_clear_buffer", DARK_RED, True),
        ("Force Cloud Sync", "cmd_force_sync", DARK_GREEN, False),
    ]

    buttons = []
    btn_w = W - MARGIN * 2
    # Calculate button height to fit above the back button without overlap
    back_top = H - BACK_BTN_H - 5
    available_h = back_top - y - 10  # 10px gap above back button
    gap = 6
    btn_h = min(42, (available_h - gap * (len(commands) - 1)) // len(commands))

    for label, action, color, needs_confirm in commands:
        btn_action = f"confirm_{action}" if needs_confirm else action
        btn = Button(MARGIN, y, btn_w, btn_h, label, btn_action, color=color)
        buttons.append(btn)
        draw_button(draw, btn, font)
        y += btn_h + gap

    # Back button (appended last so it draws on top)
    back = _back_button()
    draw_button(draw, back, find_font(14))
    buttons.append(back)

    return img, buttons


def render_logs(sys_status: dict, scroll_offset: int = 0) -> Tuple["Image.Image", List[Button]]:
    """LOGS — scrollable event history."""
    img = Image.new("RGB", (W, H), DARK_GRAY)
    draw = ImageDraw.Draw(img)
    _draw_status_bar(draw, sys_status)

    font = find_font(10)
    font_sm = find_font(9)
    font_title = find_font(12)

    y = HEADER_H + 6
    draw.text((MARGIN, y), "RECENT EVENTS", fill=LIGHT_GRAY, font=font_title)
    y += 20

    history = get_activity_history()
    # Show newest first
    history = list(reversed(history))

    row_h = 18
    max_visible = (H - y - BACK_BTN_H - 15) // row_h
    visible = history[scroll_offset:scroll_offset + max_visible]

    for entry in visible:
        if y > H - BACK_BTN_H - 15:
            break
        t = entry.get("time", "??:??")
        comp = entry.get("component", "?")[:6]
        msg = entry.get("message", "")
        level = entry.get("level", "info")

        text_color = LEVEL_COLORS.get(level, LIGHT_GRAY)
        # Truncate message to fit
        max_chars = 42
        display_msg = msg[:max_chars] + ("..." if len(msg) > max_chars else "")

        draw.text((MARGIN, y), t, fill=MID_GRAY, font=font_sm)
        draw.text((MARGIN + 50, y), comp[:4].upper(), fill=CYAN, font=font_sm)
        draw.text((MARGIN + 85, y), display_msg, fill=text_color, font=font_sm)
        y += row_h

    buttons = []

    # Scroll buttons on the right
    scroll_btn_w = 50
    scroll_btn_h = 40

    if scroll_offset > 0:
        up_btn = Button(
            W - scroll_btn_w - MARGIN, HEADER_H + 30,
            scroll_btn_w, scroll_btn_h,
            "UP", "scroll_up", color=MID_GRAY
        )
        buttons.append(up_btn)
        draw_button(draw, up_btn, find_font(12))

    if scroll_offset + max_visible < len(history):
        dn_btn = Button(
            W - scroll_btn_w - MARGIN, H - BACK_BTN_H - scroll_btn_h - 15,
            scroll_btn_w, scroll_btn_h,
            "DN", "scroll_down", color=MID_GRAY
        )
        buttons.append(dn_btn)
        draw_button(draw, dn_btn, find_font(12))

    # Back button
    back = _back_button()
    draw_button(draw, back, find_font(14))
    buttons.append(back)

    return img, buttons


def render_system(sys_status: dict) -> Tuple["Image.Image", List[Button]]:
    """SYSTEM — health dashboard."""
    img = Image.new("RGB", (W, H), DARK_GRAY)
    draw = ImageDraw.Draw(img)
    _draw_status_bar(draw, sys_status)

    font = find_font(12)
    font_sm = find_font(10)
    font_title = find_font(12)

    y = HEADER_H + 6
    draw.text((MARGIN, y), "SYSTEM HEALTH", fill=LIGHT_GRAY, font=font_title)
    y += 20

    # Service/connection status rows
    health_rows = [
        ("viam-server", sys_status["viam_server"],
         "active" if sys_status["viam_server"] else "STOPPED"),
        ("PLC", sys_status["plc_reachable"], sys_status["plc_ip"]),
        ("Internet", sys_status["internet"],
         "connected" if sys_status["internet"] else "OFFLINE"),
        ("Ethernet", sys_status["eth0_carrier"],
         sys_status.get("eth0_ip", "") or ("linked" if sys_status["eth0_carrier"] else "NO CARRIER")),
        ("WiFi", bool(sys_status["wifi_ssid"]),
         sys_status["wifi_ssid"] or "disconnected"),
    ]

    row_h = 20
    for label, ok, detail in health_rows:
        color = GREEN if ok else RED
        sq = 10
        draw.rectangle([MARGIN, y + 3, MARGIN + sq, y + 3 + sq], fill=color)
        draw.text((MARGIN + sq + 6, y), label, fill=WHITE, font=font)
        dw = draw.textlength(detail, font=font_sm)
        draw.text((W - MARGIN - dw, y + 2), detail, fill=LIGHT_GRAY, font=font_sm)
        y += row_h

    y += 6
    draw.line([(MARGIN, y), (W - MARGIN, y)], fill=MID_GRAY, width=1)
    y += 8

    # Resource gauges
    bar_w = W - MARGIN * 2
    gauges = [
        ("CPU", sys_status["cpu_temp"], f"{sys_status['cpu_temp']:.0f}C",
         GREEN if sys_status["cpu_temp"] < 70 else YELLOW if sys_status["cpu_temp"] < 80 else RED),
        ("MEM", sys_status["mem_pct"], f"{sys_status['mem_pct']}%",
         GREEN if sys_status["mem_pct"] < 70 else YELLOW if sys_status["mem_pct"] < 85 else RED),
        ("DISK", sys_status["disk_pct"], f"{sys_status['disk_pct']}%",
         GREEN if sys_status["disk_pct"] < 80 else YELLOW if sys_status["disk_pct"] < 90 else RED),
    ]

    # Add battery gauge if available
    bat = sys_status.get("battery", {})
    if bat.get("available"):
        pct = bat.get("percent", 0)
        charging = bat.get("charging", False)
        v = bat.get("voltage", 0)
        bat_label = f"{pct:.0f}% {v:.2f}V" + (" CHG" if charging else "")
        bat_color = CYAN if charging else (GREEN if pct > 30 else YELLOW if pct > 15 else RED)
        gauges.append(("BAT", pct, bat_label, bat_color))

    for label, value, text, color in gauges:
        draw.text((MARGIN, y), label, fill=LIGHT_GRAY, font=font_sm)
        y += 14
        bar_h = 10
        draw.rectangle([MARGIN, y, MARGIN + bar_w, y + bar_h], fill=MID_GRAY)
        fill_pct = min(100, max(0, value if isinstance(value, (int, float)) else 0))
        if label == "CPU":
            fill_pct = min(100, max(0, (value - 30) / 60 * 100))
        fill_w = int(bar_w * fill_pct / 100)
        if fill_w > 0:
            draw.rectangle([MARGIN, y, MARGIN + fill_w, y + bar_h], fill=color)
        tw = draw.textlength(text, font=font_sm)
        draw.text((W - MARGIN - tw, y - 1), text, fill=WHITE, font=font_sm)
        y += bar_h + 6

    # Info row at bottom
    y += 4
    tailscale = sys_status.get("tailscale_ip", "")
    uptime = sys_status["uptime"]
    truck = sys_status["truck_id"]
    draw.text((MARGIN, y), f"Up: {uptime}", fill=LIGHT_GRAY, font=font_sm)
    draw.text((W // 2, y), f"Truck: {truck}", fill=LIGHT_GRAY, font=font_sm)
    y += 14
    if tailscale:
        draw.text((MARGIN, y), f"Tailscale: {tailscale}", fill=LIGHT_GRAY, font=font_sm)

    # Back button
    back = _back_button()
    draw_button(draw, back, find_font(14))

    return img, [back]


def render_chat(sys_status: dict, voice_chat: "VoiceChat") -> Tuple["Image.Image", List[Button]]:
    """CHAT — full-screen chat with double-tap-to-talk.

    Double-tap anywhere to start recording, double-tap again to stop and send.
    Swipe/scroll with UP/DN only when history overflows. No button bar — all
    screen space goes to the conversation.
    """
    img = Image.new("RGB", (W, H), DARK_GRAY)
    draw = ImageDraw.Draw(img)

    font = find_font(10)
    font_sm = find_font(9)
    font_hint = find_font(8)

    buttons = []
    state = voice_chat.state

    # Thin status line at top (smaller than normal header to save space)
    status_h = 18
    if state == "recording":
        draw.rectangle([0, 0, W, status_h], fill=DARK_RED)
        draw.text((MARGIN, 3), "RECORDING  — double-tap to send", fill=RED, font=font_sm)
        # Recording time
        elapsed = time.time() - voice_chat._touch_start_time if hasattr(voice_chat, '_touch_start_time') else 0
        # Show a pulsing dot
        dot_color = RED if int(time.time() * 2) % 2 == 0 else DARK_RED
        draw.ellipse([W - 20, 5, W - 12, 13], fill=dot_color)
    elif state in ("transcribing", "thinking", "loading"):
        draw.rectangle([0, 0, W, status_h], fill=DARK_BLUE)
        draw.text((MARGIN, 3), voice_chat.state_message, fill=CYAN, font=font_sm)
        # Spinner dots
        dots = "." * (int(time.time() * 3) % 4)
        draw.text((W - 30, 3), dots, fill=CYAN, font=font_sm)
    elif state == "error":
        draw.rectangle([0, 0, W, status_h], fill=DARK_RED)
        draw.text((MARGIN, 3), voice_chat.state_message, fill=RED, font=font_sm)
    else:
        draw.rectangle([0, 0, W, status_h], fill=(15, 15, 20))
        # Show hint + back/clear as text links
        draw.text((MARGIN, 3), "CHAT", fill=BLUE, font=font_sm)
        hint = "double-tap to talk"
        hw = draw.textlength(hint, font=font_hint)
        draw.text(((W - hw) // 2, 4), hint, fill=MID_GRAY, font=font_hint)
        # Back and Clear as small text buttons (top corners)
        draw.text((W - 60, 3), "BACK", fill=LIGHT_GRAY, font=font_sm)
        back_btn = Button(W - 65, 0, 55, status_h, "", "nav_home")
        buttons.append(back_btn)
        draw.text((W - 100, 3), "CLR", fill=MID_GRAY, font=font_sm)
        clr_btn = Button(W - 105, 0, 40, status_h, "", "chat_clear")
        buttons.append(clr_btn)

    # Chat area — full screen below status line
    chat_top = status_h + 2
    chat_bottom = H - 2
    chat_h = chat_bottom - chat_top

    # Render chat messages
    messages = voice_chat.messages
    line_h = 14
    max_chars = 55  # more chars now with full width

    # Word-wrap messages into display lines
    display_lines = []
    for msg in messages:
        prefix = "You: " if msg.role == "user" else "AI: "
        color = CYAN if msg.role == "user" else GREEN
        full_text = prefix + msg.text
        words = full_text.split()
        line = ""
        for word in words:
            test = (line + " " + word).strip()
            if len(test) > max_chars:
                if line:
                    display_lines.append((line, color))
                line = word
            else:
                line = test
        if line:
            display_lines.append((line, color))
        display_lines.append(("", BLACK))  # spacer between messages

    # Calculate visible window
    visible_lines = chat_h // line_h
    total_lines = len(display_lines)

    # Auto-scroll to bottom unless user scrolled up
    start = max(0, total_lines - visible_lines - voice_chat.scroll_offset)
    end = start + visible_lines
    visible = display_lines[start:end]

    # Draw messages
    y = chat_top
    for text, color in visible:
        if text:
            draw.text((MARGIN, y), text, fill=color, font=font)
        y += line_h

    # Empty state
    if not messages and state == "idle":
        empty_msgs = [
            "Double-tap anywhere to start talking.",
            "I can see PLC status, plates, speed,",
            "battery, network — ask me anything.",
        ]
        y = chat_top + 40
        for line in empty_msgs:
            lw = draw.textlength(line, font=font)
            draw.text(((W - lw) // 2, y), line, fill=MID_GRAY, font=font)
            y += 20

    # Scroll indicators (small, unobtrusive)
    if start > 0:
        draw.text((W - 20, chat_top + 2), "^", fill=LIGHT_GRAY, font=font)
        up_btn = Button(W - 30, chat_top, 30, 25, "", "chat_scroll_up")
        buttons.append(up_btn)

    if end < total_lines:
        draw.text((W - 20, chat_bottom - 14), "v", fill=LIGHT_GRAY, font=font)
        dn_btn = Button(W - 30, chat_bottom - 20, 30, 25, "", "chat_scroll_down")
        buttons.append(dn_btn)

    return img, buttons


def render_confirm_dialog(base_img: "Image.Image", action: str) -> Tuple["Image.Image", List[Button]]:
    """Overlay a confirmation dialog on the current page."""
    img = base_img.copy()
    draw = ImageDraw.Draw(img)

    font = find_font(14)
    font_sm = find_font(11)

    # Darken background
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 160))
    img.paste(Image.alpha_composite(
        img.convert("RGBA"), overlay
    ).convert("RGB"))
    draw = ImageDraw.Draw(img)

    # Dialog box
    dw, dh = 360, 160
    dx = (W - dw) // 2
    dy = (H - dh) // 2

    draw.rounded_rectangle([dx, dy, dx + dw, dy + dh], radius=12, fill=DARK_GRAY, outline=LIGHT_GRAY)

    # Title
    titles = {
        "confirm_cmd_restart_viam": "Restart viam-server?",
        "confirm_cmd_clear_buffer": "Clear offline buffer?",
        "confirm_cmd_force_sync": "Force cloud sync?",
    }
    title = titles.get(action, "Confirm action?")
    bbox = draw.textbbox((0, 0), title, font=font)
    tw = bbox[2] - bbox[0]
    draw.text((dx + (dw - tw) // 2, dy + 20), title, fill=WHITE, font=font)

    # Warning message
    warnings = {
        "confirm_cmd_restart_viam": "PLC monitoring pauses ~10 sec",
        "confirm_cmd_clear_buffer": "Unsent data will be lost!",
        "confirm_cmd_force_sync": "Restarts viam-server briefly",
    }
    warn = warnings.get(action, "Are you sure?")
    bbox2 = draw.textbbox((0, 0), warn, font=font_sm)
    ww = bbox2[2] - bbox2[0]
    draw.text((dx + (dw - ww) // 2, dy + 50), warn, fill=YELLOW, font=font_sm)

    # Confirm / Cancel buttons
    btn_w = 140
    btn_h = 45
    btn_y = dy + dh - btn_h - 20

    confirm = Button(
        dx + 20, btn_y, btn_w, btn_h,
        "CONFIRM", f"do_{action.replace('confirm_', '')}",
        color=DARK_GREEN, text_color=WHITE
    )
    cancel = Button(
        dx + dw - btn_w - 20, btn_y, btn_w, btn_h,
        "CANCEL", "dialog_cancel",
        color=DARK_RED, text_color=WHITE
    )

    draw_button(draw, confirm, font)
    draw_button(draw, cancel, font)

    return img, [confirm, cancel]


def render_feedback_toast(draw, executor: CommandExecutor):
    """Draw a feedback toast overlay at the bottom."""
    if not executor.has_feedback:
        return

    font = find_font(12)
    msg = executor.feedback_message
    level = executor.feedback_level

    bg_color = DARK_GREEN if level == "success" else DARK_RED if level == "error" else DARK_BLUE
    text_color = WHITE

    toast_h = 36
    toast_y = H - BACK_BTN_H - toast_h - 10
    draw.rounded_rectangle(
        [MARGIN, toast_y, W - MARGIN, toast_y + toast_h],
        radius=6, fill=bg_color
    )

    # Truncate if needed
    display_msg = msg[:55] + ("..." if len(msg) > 55 else "")
    bbox = draw.textbbox((0, 0), display_msg, font=font)
    tw = bbox[2] - bbox[0]
    draw.text(
        ((W - tw) // 2, toast_y + 9),
        display_msg, fill=text_color, font=font
    )


# ─────────────────────────────────────────────────────────────
#  Calibration mode
# ─────────────────────────────────────────────────────────────

def run_calibration(fb: Framebuffer, touch: TouchInput):
    """Interactive touch calibration — tap crosshairs at screen corners."""
    font = find_font(14)
    font_sm = find_font(11)

    # Temporarily disable coordinate mapping
    touch.cal = {
        "min_x": 0, "max_x": 4095,
        "min_y": 0, "max_y": 4095,
        "swap_xy": False,
        "invert_x": False,
        "invert_y": False,
    }

    targets = [
        (40, 40, "TOP-LEFT"),
        (W - 40, 40, "TOP-RIGHT"),
        (40, H - 40, "BOTTOM-LEFT"),
        (W - 40, H - 40, "BOTTOM-RIGHT"),
    ]

    raw_points = []
    touch.start()

    for tx, ty, label in targets:
        # Draw crosshair
        img = Image.new("RGB", (W, H), BLACK)
        draw = ImageDraw.Draw(img)
        draw.text((W // 2 - 80, H // 2 - 30), f"Tap the {label}", fill=WHITE, font=font)
        draw.text((W // 2 - 60, H // 2), "crosshair", fill=LIGHT_GRAY, font=font_sm)

        # Draw crosshair
        draw.line([(tx - 15, ty), (tx + 15, ty)], fill=RED, width=2)
        draw.line([(tx, ty - 15), (tx, ty + 15)], fill=RED, width=2)
        draw.ellipse([tx - 5, ty - 5, tx + 5, ty + 5], outline=RED, width=2)

        fb.show(img)

        # Wait for tap (reading raw coordinates)
        while True:
            # Read raw from the device directly
            tap = touch.get_tap()
            if tap:
                # tap is already mapped through calibration, but since we set
                # cal to identity, raw values pass through
                raw_points.append((touch._raw_x, touch._raw_y))
                break
            time.sleep(0.05)

        time.sleep(0.5)  # brief pause between taps

    touch.stop()

    # Calculate calibration from the 4 corner taps
    # raw_points[0] = top-left, [1] = top-right, [2] = bottom-left, [3] = bottom-right
    tl, tr, bl, br = raw_points

    # Determine if X and Y are swapped by checking which raw axis
    # has more variation horizontally vs vertically
    x_range_horiz = abs(tr[0] - tl[0])
    y_range_horiz = abs(tr[1] - tl[1])
    swap_xy = y_range_horiz > x_range_horiz

    if swap_xy:
        # Swap raw coordinates
        tl = (tl[1], tl[0])
        tr = (tr[1], tr[0])
        bl = (bl[1], bl[0])
        br = (br[1], br[0])

    # min/max from corners
    min_x = min(tl[0], bl[0])
    max_x = max(tr[0], br[0])
    min_y = min(tl[1], tr[1])
    max_y = max(bl[1], br[1])

    # Check if inverted
    invert_x = tl[0] > tr[0]
    invert_y = tl[1] > bl[1]

    if invert_x:
        min_x, max_x = max_x, min_x
        min_x = min(tl[0], bl[0])
        max_x = max(tr[0], br[0])

    if invert_y:
        min_y, max_y = max_y, min_y
        min_y = min(tl[1], tr[1])
        max_y = max(bl[1], br[1])

    touch.cal = {
        "min_x": min(min_x, max_x),
        "max_x": max(min_x, max_x),
        "min_y": min(min_y, max_y),
        "max_y": max(min_y, max_y),
        "swap_xy": swap_xy,
        "invert_x": invert_x,
        "invert_y": invert_y,
    }
    touch.save_calibration()

    # Show result
    img = Image.new("RGB", (W, H), BLACK)
    draw = ImageDraw.Draw(img)
    draw.text((MARGIN, 20), "Calibration saved!", fill=GREEN, font=font)
    draw.text((MARGIN, 50), f"swap_xy: {swap_xy}", fill=WHITE, font=font_sm)
    draw.text((MARGIN, 70), f"invert_x: {invert_x}  invert_y: {invert_y}", fill=WHITE, font=font_sm)
    draw.text((MARGIN, 90), f"X: {touch.cal['min_x']}-{touch.cal['max_x']}", fill=WHITE, font=font_sm)
    draw.text((MARGIN, 110), f"Y: {touch.cal['min_y']}-{touch.cal['max_y']}", fill=WHITE, font=font_sm)
    draw.text((MARGIN, 150), "Starting display in 3s...", fill=LIGHT_GRAY, font=font_sm)
    fb.show(img)
    time.sleep(3)


# ─────────────────────────────────────────────────────────────
#  Main loop
# ─────────────────────────────────────────────────────────────

def main():
    import argparse
    parser = argparse.ArgumentParser(description="IronSight Touch Command Display")
    parser.add_argument("--fb", default="/dev/fb0", help="Framebuffer device")
    parser.add_argument("--calibrate", action="store_true", help="Run touch calibration")
    parser.add_argument("--no-touch", action="store_true", help="Disable touch (display only)")
    parser.add_argument("--terminal", action="store_true", help="Terminal mode (no framebuffer)")
    args = parser.parse_args()

    if not HAS_PILLOW:
        print("ERROR: Pillow is required. Install: pip3 install Pillow")
        sys.exit(1)

    # Set up framebuffer
    fb = None
    for fb_path in [args.fb, "/dev/fb1", "/dev/fb0"]:
        if os.path.exists(fb_path):
            fb = Framebuffer(fb_path)
            if fb.is_available():
                print(f"Framebuffer: {fb_path} ({fb.width}x{fb.height} @ {fb.bpp}bpp)")
                fb.open()
                break
            fb = None

    if not fb and not args.terminal:
        print("No framebuffer available. Use --terminal for terminal mode.")
        sys.exit(1)

    # Adjust global dimensions to match actual framebuffer
    global W, H
    if fb:
        W, H = fb.width, fb.height

    # Set up touch input
    touch = TouchInput(screen_w=W, screen_h=H)
    if not args.no_touch:
        if args.calibrate:
            run_calibration(fb, touch)
        touch.start()
    else:
        print("Touch input disabled")

    # Set up command executor
    executor = CommandExecutor()

    # Set up voice chat
    voice_chat = VoiceChat(sys_status_fn=get_system_status)

    # Set up PTT button (USB presenter clicker / any USB HID button)
    ptt_button = PTTButton()
    ptt_button.start()

    # App state
    current_page = "home"
    pending_dialog = None  # action string for confirm dialog
    scroll_offset = 0
    sys_status = {}
    last_data_refresh = 0
    needs_redraw = True
    chat_recording = False  # double-tap toggle state

    print("IronSight Touch Display started")
    print(f"Touch: {'enabled' if not args.no_touch and touch.device else 'disabled'}")
    print(f"PTT button: {ptt_button.device.name if ptt_button.device else 'not found (use touchscreen)'}")
    print(f"Whisper: {'available' if HAS_WHISPER else 'not installed'}")
    print(f"Claude: via CLI")

    try:
        while True:
            now = time.time()

            # Refresh data periodically
            if now - last_data_refresh > DATA_REFRESH_INTERVAL:
                sys_status = get_system_status()
                last_data_refresh = now
                needs_redraw = True

            # Poll USB PTT button (works from any page — hold style)
            if ptt_button.get_pressed():
                if current_page != "chat":
                    current_page = "chat"
                    scroll_offset = 0
                voice_chat.start_recording()
                needs_redraw = True
            if ptt_button.get_released() and voice_chat.state == "recording":
                voice_chat.stop_recording()
                needs_redraw = True

            # Check for double-tap (toggle recording in chat mode)
            dtap = touch.get_double_tap()
            if dtap and current_page == "chat":
                if not chat_recording and voice_chat.state == "idle":
                    # Start recording
                    chat_recording = True
                    voice_chat.start_recording()
                    needs_redraw = True
                elif chat_recording and voice_chat.state == "recording":
                    # Stop recording and send
                    chat_recording = False
                    voice_chat.stop_recording()
                    needs_redraw = True

            # Reset recording flag when processing finishes
            if chat_recording and voice_chat.state not in ("recording", "idle"):
                chat_recording = False

            # Poll for touch
            tap = touch.get_tap()
            if tap:
                needs_redraw = True
                tx, ty = tap

                if pending_dialog:
                    base_img, _ = _render_current_page(
                        current_page, sys_status, scroll_offset, voice_chat)
                    _, dialog_buttons = render_confirm_dialog(base_img, pending_dialog)
                    hit = find_hit(dialog_buttons, tx, ty)
                    if hit:
                        if hit.action == "dialog_cancel":
                            pending_dialog = None
                        elif hit.action.startswith("do_"):
                            real_action = hit.action.replace("do_", "")
                            executor.execute(real_action)
                            pending_dialog = None
                else:
                    _, buttons = _render_current_page(
                        current_page, sys_status, scroll_offset, voice_chat)
                    hit = find_hit(buttons, tx, ty)
                    if hit:
                        action = hit.action
                        if action.startswith("nav_"):
                            current_page = action.replace("nav_", "")
                            scroll_offset = 0
                        elif action.startswith("confirm_"):
                            pending_dialog = action
                        elif action == "scroll_up":
                            scroll_offset = max(0, scroll_offset - 5)
                        elif action == "scroll_down":
                            scroll_offset += 5
                        elif action.startswith("cmd_"):
                            executor.execute(action)
                        # Chat actions
                        elif action == "chat_scroll_up":
                            voice_chat.scroll_offset += 5
                        elif action == "chat_scroll_down":
                            voice_chat.scroll_offset = max(0, voice_chat.scroll_offset - 5)
                        elif action == "chat_clear":
                            voice_chat.clear_history()

            # Redraw if needed, or if chat state is active (recording/thinking)
            if current_page == "chat" and voice_chat.state in ("recording", "transcribing", "thinking", "loading"):
                needs_redraw = True

            if needs_redraw and fb:
                img, _ = _render_current_page(
                    current_page, sys_status, scroll_offset, voice_chat)

                if pending_dialog:
                    img, _ = render_confirm_dialog(img, pending_dialog)

                if executor.has_feedback:
                    draw = ImageDraw.Draw(img)
                    render_feedback_toast(draw, executor)

                fb.show(img)
                needs_redraw = False

            if executor.has_feedback:
                needs_redraw = True

            time.sleep(1.0 / TOUCH_POLL_HZ)

    except KeyboardInterrupt:
        print("\nStopping...")
    finally:
        touch.stop()
        ptt_button.stop()
        if fb:
            fb.close()


def _render_current_page(page: str, sys_status: dict,
                         scroll_offset: int,
                         voice_chat: "VoiceChat" = None) -> Tuple["Image.Image", List[Button]]:
    """Render the current page and return (image, buttons)."""
    if page == "home":
        return render_home(sys_status)
    elif page == "live":
        return render_live(sys_status)
    elif page == "commands":
        return render_commands(sys_status)
    elif page == "chat" and voice_chat:
        return render_chat(sys_status, voice_chat)
    elif page == "logs":
        return render_logs(sys_status, scroll_offset)
    elif page == "system":
        return render_system(sys_status)
    else:
        return render_home(sys_status)


if __name__ == "__main__":
    main()
