"""Signal monitoring classes for PLC sensor diagnostics.

ConnectionQualityMonitor: Ethernet link quality detection.
SignalMetrics: Rolling window signal analysis for the diagnostic engine.
"""

import collections
import subprocess
import time
from collections import deque as Deque
from typing import Any, Dict, Optional

from viam.logging import getLogger

LOGGER = getLogger(__name__)


class ConnectionQualityMonitor:
    """Monitor ethernet link quality to detect cable degradation.

    Reads ethtool statistics and kernel link events to classify
    connection health:
      - "healthy":     Link up, zero errors, stable
      - "degraded":    Link up but CRC/frame errors increasing
      - "flapping":    Link going up and down repeatedly (bad cable/connector)
      - "down":        Link down, no carrier
      - "down_endofday": Link down, matches end-of-shift pattern

    Also tracks: link speed changes, error rates, time-of-day patterns.
    """

    def __init__(self, interface: str = "eth0"):
        self._iface = interface
        self._prev_errors: Dict[str, int] = {}
        self._error_deltas: Deque[Dict[str, int]] = collections.deque(maxlen=60)
        self._link_events: Deque[Dict[str, Any]] = collections.deque(maxlen=50)
        self._last_check: float = 0
        self._check_interval: float = 10.0  # seconds between checks
        self._last_link_state: Optional[bool] = None
        self._link_flap_count: int = 0
        self._link_flap_window: Deque[float] = collections.deque(maxlen=20)
        self._link_up_time: Optional[float] = None
        self._link_down_time: Optional[float] = None
        self._link_speed: str = "unknown"
        # Summary state
        self.status: str = "unknown"
        self.error_rate: float = 0.0  # errors per minute
        self.link_uptime_seconds: float = 0.0
        self.total_crc_errors: int = 0
        self.total_link_flaps: int = 0
        self.link_speed_mbps: int = 0
        self.diagnosis: str = ""

    def check(self) -> Dict[str, Any]:
        """Run a connection quality check. Call this every read cycle."""
        now = time.time()
        if now - self._last_check < self._check_interval:
            return self._current_state()
        self._last_check = now

        # 1. Check carrier state
        carrier = self._read_carrier()

        # 2. Detect link state changes
        if self._last_link_state is not None and carrier != self._last_link_state:
            event = {
                "ts": now,
                "time": time.strftime("%H:%M:%S"),
                "event": "link_up" if carrier else "link_down",
            }
            self._link_events.append(event)

            if carrier:
                self._link_up_time = now
                self._link_speed = self._read_link_speed()
                LOGGER.info("🔗 eth0 link UP — speed: %s", self._link_speed)
            else:
                self._link_down_time = now
                LOGGER.warning("🔗 eth0 link DOWN")

            # Track flapping
            self._link_flap_count += 1
            self._link_flap_window.append(now)
            self.total_link_flaps += 1

        self._last_link_state = carrier

        # 3. Read error counters (only when link is up)
        if carrier:
            errors = self._read_ethtool_stats()
            if errors and self._prev_errors:
                deltas = {}
                for key in errors:
                    delta = errors[key] - self._prev_errors.get(key, 0)
                    if delta > 0:
                        deltas[key] = delta
                if deltas:
                    self._error_deltas.append(deltas)
                    LOGGER.warning("⚠️ eth0 errors detected: %s", deltas)
            self._prev_errors = errors

            # Calculate error rate (errors per minute over last 60 checks)
            total_recent_errors = sum(
                sum(d.values()) for d in self._error_deltas
            )
            window_minutes = (len(self._error_deltas) * self._check_interval) / 60.0
            self.error_rate = total_recent_errors / max(window_minutes, 0.1)

            # Track CRC specifically
            if errors:
                self.total_crc_errors = errors.get("rx_frame_check_sequence_errors", 0)

            # Link uptime
            if self._link_up_time:
                self.link_uptime_seconds = now - self._link_up_time

            # Read speed
            try:
                self.link_speed_mbps = int(self._link_speed.replace("Mbps", "").strip())
            except (ValueError, AttributeError):
                self.link_speed_mbps = 0

        # 4. Classify connection status
        self.status, self.diagnosis = self._classify(carrier, now)

        return self._current_state()

    def _classify(self, carrier: bool, now: float) -> tuple:
        """Classify the connection health."""
        if not carrier:
            # Check time of day — end of shift?
            hour = time.localtime(now).tm_hour
            if self._link_down_time:
                down_hour = time.localtime(self._link_down_time).tm_hour
                if 15 <= down_hour <= 18:
                    return "down_endofday", "Link down — likely end-of-shift PLC shutdown"
                down_duration = now - self._link_down_time
                if down_duration > 3600:
                    return "down", f"Link down for {down_duration/3600:.1f} hours — PLC off or cable disconnected"
            return "down", "No carrier — cable disconnected or PLC powered off"

        # Link is up — check quality
        # Flapping? (>3 link events in last 5 minutes)
        recent_flaps = sum(1 for t in self._link_flap_window if now - t < 300)
        if recent_flaps > 3:
            return "flapping", f"Link flapping ({recent_flaps} state changes in 5 min) — check cable/connector"

        # Error rate?
        if self.error_rate > 10:
            return "degraded", f"High error rate ({self.error_rate:.1f}/min) — cable may be damaged"
        if self.error_rate > 1:
            return "degraded", f"Elevated errors ({self.error_rate:.1f}/min) — monitor cable"

        # Speed drop?
        if self.link_speed_mbps > 0 and self.link_speed_mbps < 100:
            return "degraded", f"Link speed {self.link_speed_mbps}Mbps (expected 100) — cable quality issue"

        return "healthy", "Link up, no errors"

    def _read_carrier(self) -> bool:
        try:
            return open(f"/sys/class/net/{self._iface}/carrier").read().strip() == "1"
        except Exception:
            return False

    def _read_link_speed(self) -> str:
        try:
            speed = open(f"/sys/class/net/{self._iface}/speed").read().strip()
            return f"{speed}Mbps"
        except Exception:
            return "unknown"

    def _read_ethtool_stats(self) -> Dict[str, int]:
        """Read ethernet error counters from ethtool -S."""
        error_keys = {
            "rx_frame_check_sequence_errors",
            "rx_alignment_errors",
            "rx_symbol_errors",
            "rx_length_field_frame_errors",
            "rx_overruns",
            "rx_resource_errors",
            "tx_carrier_sense_errors",
            "tx_excessive_collisions",
            "tx_late_collisions",
            "rx_ip_header_checksum_errors",
            "rx_tcp_checksum_errors",
        }
        stats = {}
        try:
            out = subprocess.check_output(
                ["ethtool", "-S", self._iface],
                text=True, timeout=5, stderr=subprocess.DEVNULL
            )
            for line in out.splitlines():
                line = line.strip()
                if ":" in line:
                    key, val = line.split(":", 1)
                    key = key.strip()
                    if key in error_keys:
                        stats[key] = int(val.strip())
        except Exception:
            LOGGER.debug("Failed to read ethtool stats for %s", self._iface)
        return stats

    def _current_state(self) -> Dict[str, Any]:
        """Return current connection quality as a dict for readings."""
        return {
            "eth0_status": self.status,
            "eth0_diagnosis": self.diagnosis,
            "eth0_error_rate": round(self.error_rate, 2),
            "eth0_link_speed_mbps": self.link_speed_mbps,
            "eth0_link_uptime_seconds": round(self.link_uptime_seconds),
            "eth0_crc_errors": self.total_crc_errors,
            "eth0_link_flaps": self.total_link_flaps,
        }


class SignalMetrics:
    """Rolling window signal analysis for diagnostic engine.

    Tracks edge rates, state durations, camera trend classification,
    and encoder noise — all bounded by deque maxlen to prevent leaks.
    """

    WINDOW_SEC = 60   # 1-minute rolling window for rates
    TREND_SEC = 300   # 5-minute buffer for trend analysis

    def __init__(self):
        self._x3_edges: collections.deque = collections.deque(maxlen=300)
        self._y1_edges: collections.deque = collections.deque(maxlen=300)
        self._c30_edges: collections.deque = collections.deque(maxlen=300)
        self._prev_x3: bool = False
        self._prev_y1: bool = False
        self._prev_c30: bool = False
        self._encoder_reversals: collections.deque = collections.deque(maxlen=300)
        self._prev_encoder_dir: int = 0
        self._modbus_times: collections.deque = collections.deque(maxlen=60)
        self._camera_rate_history: collections.deque = collections.deque(maxlen=300)
        # State tracking: signal_name -> timestamp of last change
        self._state_times: Dict[str, float] = {}
        # State tracking: signal_name -> current bool value
        self._state_vals: Dict[str, bool] = {}

    def update(self, *, x3: bool, y1: bool, c30: bool,
               encoder_dir: int, modbus_ms: float,
               now: Optional[float] = None) -> Dict[str, Any]:
        """Called once per read cycle. Returns computed metrics dict."""
        if now is None:
            now = time.time()

        # ── Rising edge detection ──
        if x3 and not self._prev_x3:
            self._x3_edges.append(now)
        self._prev_x3 = x3

        if y1 and not self._prev_y1:
            self._y1_edges.append(now)
        self._prev_y1 = y1

        if c30 and not self._prev_c30:
            self._c30_edges.append(now)
        self._prev_c30 = c30

        # ── Encoder direction reversals ──
        if encoder_dir != self._prev_encoder_dir and self._prev_encoder_dir != 0:
            self._encoder_reversals.append(now)
        self._prev_encoder_dir = encoder_dir

        # ── Modbus response time tracking ──
        self._modbus_times.append(modbus_ms)

        # ── Compute rates (edges in last WINDOW_SEC) ──
        cutoff = now - self.WINDOW_SEC
        cam_rate = sum(1 for t in self._x3_edges if t > cutoff)
        eject_rate = sum(1 for t in self._y1_edges if t > cutoff)
        det_eject_rate = sum(1 for t in self._c30_edges if t > cutoff)
        reversals = sum(1 for t in self._encoder_reversals if t > cutoff)

        # ── Camera rate history (for trend) ──
        self._camera_rate_history.append((now, cam_rate))

        # ── Camera rate trend classification ──
        camera_rate_trend = self._classify_camera_trend(now, cam_rate)

        # ── State duration tracking ──
        for name, val in [("camera_signal", x3), ("tps_power_loop", False)]:
            # tps_power_loop is tracked externally; just camera here
            pass
        self._track_state("camera_signal", x3, now)

        cam_dur = now - self._state_times.get("camera_signal", now)

        # ── Encoder noise: reversals per minute ──
        encoder_noise = reversals  # already per WINDOW_SEC (60s)

        # ── Modbus avg response time ──
        avg_modbus_ms = 0.0
        if self._modbus_times:
            avg_modbus_ms = sum(self._modbus_times) / len(self._modbus_times)

        return {
            "camera_detections_per_min": cam_rate,
            "camera_rate_trend": camera_rate_trend,
            "camera_signal_duration_s": round(cam_dur, 1),
            "eject_rate_per_min": eject_rate,
            "detector_eject_rate_per_min": det_eject_rate,
            "encoder_noise": encoder_noise,
            "encoder_reversals_per_min": reversals,
            "modbus_response_time_ms": round(avg_modbus_ms, 2),
        }

    def _track_state(self, name: str, val: bool, now: float) -> None:
        """Track when a boolean signal last changed state."""
        prev = self._state_vals.get(name)
        if prev is None or val != prev:
            self._state_times[name] = now
        self._state_vals[name] = val

    def track_power(self, tps_power: bool, now: Optional[float] = None) -> float:
        """Track TPS power state. Returns duration in current state."""
        if now is None:
            now = time.time()
        self._track_state("tps_power_loop", tps_power, now)
        return now - self._state_times.get("tps_power_loop", now)

    def _classify_camera_trend(self, now: float, current_rate: int) -> str:
        """Classify camera detection trend over the last 5 minutes.

        Returns one of: "dead", "declining", "intermittent", "stable".
        """
        trend_cutoff = now - self.TREND_SEC
        recent = [(t, r) for t, r in self._camera_rate_history if t > trend_cutoff]

        if len(recent) < 10:
            return "stable"  # not enough data yet

        rates = [r for _, r in recent]

        # dead: rate has been 0 for >30 consecutive seconds
        zero_streak = 0
        for _, r in reversed(recent):
            if r == 0:
                zero_streak += 1
            else:
                break
        if zero_streak > 30:
            return "dead"

        # declining: rate dropped >50% from 5-min peak
        peak = max(rates)
        if peak > 0 and current_rate < (peak * 0.5):
            return "declining"

        # intermittent: rate alternated between >0 and 0 at least 3 times
        transitions = 0
        prev_zero = rates[0] == 0
        for r in rates[1:]:
            is_zero = (r == 0)
            if is_zero != prev_zero:
                transitions += 1
            prev_zero = is_zero
        if transitions >= 6:  # 3 full cycles = 6 transitions
            return "intermittent"

        return "stable"
