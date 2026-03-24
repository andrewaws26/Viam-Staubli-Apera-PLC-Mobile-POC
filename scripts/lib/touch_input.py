"""
Touch and button input handlers for IronSight touchscreen.

TouchInput: Reads ADS7846/XPT2046 resistive touchscreen via evdev.
            Handles tap, double-tap, and swipe gesture detection.

PTTButton:  Reads USB HID buttons (presenter clickers, arcade buttons)
            for push-to-talk functionality.

Usage:
    from lib.touch_input import TouchInput, PTTButton

    touch = TouchInput(screen_w=480, screen_h=320)
    touch.start()
    tap = touch.get_tap()  # (x, y) or None
"""

import json
import threading
import time
from pathlib import Path
from typing import Optional, Tuple, List

try:
    import evdev
    from evdev import ecodes
    HAS_EVDEV = True
except ImportError:
    HAS_EVDEV = False

CALIBRATION_FILE = Path("/etc/ironsight-touch-cal.json")
TAP_DEBOUNCE_MS = 250


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
        self.DOUBLE_TAP_MS = 400
        self.DOUBLE_TAP_PX = 50

        # Swipe/drag detection
        self._swipe_queue: List[int] = []
        self._touch_start_y: int = 0
        self._touch_current_y: int = 0
        self._is_dragging: bool = False
        self.SWIPE_THRESHOLD_PX = 20

    def _load_calibration(self):
        try:
            data = json.loads(CALIBRATION_FILE.read_text())
            self.cal.update(data)
        except Exception:
            pass

    def save_calibration(self):
        try:
            CALIBRATION_FILE.write_text(json.dumps(self.cal, indent=2))
        except Exception as e:
            print(f"Could not save calibration: {e}")

    def find_device(self) -> bool:
        if not HAS_EVDEV:
            return False
        try:
            for path in evdev.list_devices():
                dev = evdev.InputDevice(path)
                if "ADS7846" in dev.name or "ads7846" in dev.name.lower():
                    self.device = dev
                    print(f"Touch device found: {dev.name} at {path}")
                    return True
                if "touch" in dev.name.lower() and "screen" in dev.name.lower():
                    self.device = dev
                    print(f"Touch device found: {dev.name} at {path}")
                    return True
        except Exception as e:
            print(f"Error finding touch device: {e}")
        return False

    def _map_coordinates(self, raw_x: int, raw_y: int) -> Tuple[int, int]:
        cal = self.cal
        if cal["swap_xy"]:
            raw_x, raw_y = raw_y, raw_x
        norm_x = (raw_x - cal["min_x"]) / max(1, cal["max_x"] - cal["min_x"])
        norm_y = (raw_y - cal["min_y"]) / max(1, cal["max_y"] - cal["min_y"])
        if cal["invert_x"]:
            norm_x = 1.0 - norm_x
        if cal["invert_y"]:
            norm_y = 1.0 - norm_y
        sx = max(0, min(self.screen_w - 1, int(norm_x * self.screen_w)))
        sy = max(0, min(self.screen_h - 1, int(norm_y * self.screen_h)))
        return sx, sy

    def start(self):
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
        try:
            for event in self.device.read_loop():
                if not self._running:
                    break
                if event.type == ecodes.EV_ABS:
                    if event.code == ecodes.ABS_X:
                        self._raw_x = event.value
                    elif event.code == ecodes.ABS_Y:
                        self._raw_y = event.value
                        if self._touching:
                            _, sy = self._map_coordinates(self._raw_x, self._raw_y)
                            self._touch_current_y = sy
                    elif event.code == ecodes.ABS_PRESSURE:
                        self._handle_pressure(event.value)
                elif event.type == ecodes.EV_KEY:
                    if event.code == ecodes.BTN_TOUCH:
                        self._handle_pressure(event.value)
        except Exception as e:
            print(f"Touch read error: {e}")

    def _handle_pressure(self, value: int):
        """Handle touch down/up from either ABS_PRESSURE or BTN_TOUCH."""
        if value > 0 and not self._touching:
            self._touching = True
            self._touch_start_time = time.time()
            _, sy = self._map_coordinates(self._raw_x, self._raw_y)
            self._touch_start_y = sy
            self._touch_current_y = sy
            self._is_dragging = False
        elif value == 0 and self._touching:
            self._touching = False
            now = time.time()
            delta_y = self._touch_start_y - self._touch_current_y
            if abs(delta_y) > self.SWIPE_THRESHOLD_PX:
                with self._lock:
                    self._swipe_queue.append(delta_y)
            else:
                if (now - self._last_tap_time) * 1000 > TAP_DEBOUNCE_MS:
                    sx, sy = self._map_coordinates(self._raw_x, self._raw_y)
                    with self._lock:
                        self._tap_queue.append((sx, sy))
                        self._check_double_tap(sx, sy)
                    self._last_tap_time = now

    def _check_double_tap(self, sx: int, sy: int):
        now = time.time()
        dt = (now - self._prev_tap_time) * 1000
        dx = abs(sx - self._prev_tap_pos[0])
        dy = abs(sy - self._prev_tap_pos[1])
        if dt < self.DOUBLE_TAP_MS and dx < self.DOUBLE_TAP_PX and dy < self.DOUBLE_TAP_PX:
            self._double_tap_queue.append((sx, sy))
            self._prev_tap_time = 0
        else:
            self._prev_tap_time = now
            self._prev_tap_pos = (sx, sy)

    def get_tap(self) -> Optional[Tuple[int, int]]:
        with self._lock:
            if self._tap_queue:
                tap = self._tap_queue[-1]
                self._tap_queue.clear()
                return tap
        return None

    def get_double_tap(self) -> Optional[Tuple[int, int]]:
        with self._lock:
            if self._double_tap_queue:
                tap = self._double_tap_queue[-1]
                self._double_tap_queue.clear()
                return tap
        return None

    def get_swipe(self) -> Optional[int]:
        with self._lock:
            if self._swipe_queue:
                delta = self._swipe_queue[-1]
                self._swipe_queue.clear()
                return delta
        return None


class PTTButton:
    """Listen for a USB HID button press/release for push-to-talk."""

    IGNORED_NAMES = {"ADS7846", "ads7846", "raspberrypi", "vc4"}

    def __init__(self):
        self.device = None
        self.held = False
        self._lock = threading.Lock()
        self._pressed = False
        self._released = False
        self._thread = None
        self._running = False

    def find_device(self) -> bool:
        if not HAS_EVDEV:
            return False
        try:
            for path in evdev.list_devices():
                dev = evdev.InputDevice(path)
                if any(skip in dev.name for skip in self.IGNORED_NAMES):
                    continue
                caps = dev.capabilities(verbose=False)
                if ecodes.EV_KEY not in caps:
                    continue
                if ecodes.EV_ABS in caps:
                    continue
                self.device = dev
                print(f"PTT button found: {dev.name} at {path}")
                return True
        except Exception as e:
            print(f"Error finding PTT device: {e}")
        return False

    def start(self):
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
        while self._running:
            try:
                if not self.device:
                    if not self.find_device():
                        time.sleep(5)
                        continue
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
            except Exception as e:
                print(f"PTT read error: {e}")
                self.device = None
                time.sleep(5)

    def get_pressed(self) -> bool:
        with self._lock:
            if self._pressed:
                self._pressed = False
                return True
        return False

    def get_released(self) -> bool:
        with self._lock:
            if self._released:
                self._released = False
                return True
        return False
