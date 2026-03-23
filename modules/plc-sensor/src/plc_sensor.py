"""
PLC Modbus Sensor Module for Viam — TPS Production Monitor.

Reads the TPS (Tie Plate System) PLC state via Modbus TCP and returns
structured sensor readings for remote monitoring.  Connects to a Click PLC
C0-10DD2E-D.

Register map — everything the Click PLC ladder logic exposes:
  DS1-DS25 (addr 0-24):   TPS holding registers (config + status)
  DD1 (addr 16384-16385): Encoder pulse count (32-bit signed, quadrature x1)
  X1-X8 (discrete):       TPS discrete inputs (power loop, camera, air eagles)
  Y1-Y3 (coils 8192+):    TPS eject output coils
  C1999-C2000 (coils):    Encoder reset, floating zero

Offline buffering:
  When configured with offline_buffer_dir, readings are buffered to local
  JSONL files so no data is lost during network outages.  Viam's built-in
  data manager syncs the capture directory when connectivity is restored.
  The buffer also writes a separate JSONL file that persists across reboots
  and can be replayed or uploaded independently.
"""

import asyncio
import collections
import json
import math
import os
import subprocess
import time
import uuid
from collections import deque as Deque
from typing import Any, ClassVar, Dict, Mapping, Optional, Sequence

from pymodbus.client import ModbusTcpClient
from typing_extensions import Self

from viam.components.sensor import Sensor
from viam.logging import getLogger
from viam.module.module import Module
from viam.proto.app.robot import ComponentConfig
from viam.proto.common import ResourceName
from viam.resource.base import ResourceBase
from viam.resource.registry import Registry, ResourceCreatorRegistration
from viam.resource.types import Model, ModelFamily
from viam.utils import SensorReading

LOGGER = getLogger(__name__)

# Connection timeout in seconds
_CONNECT_TIMEOUT = 2

# Self-healing: retry backoff on repeated connection failures
_MAX_BACKOFF_SECONDS = 30.0
_INITIAL_BACKOFF_SECONDS = 1.0

# Encoder constants — SICK DBS60E-BDEC01000
_ENCODER_PPR = 1000          # Pulses per revolution (from datasheet)
_ENCODER_QUADRATURE = 1      # Production HSC uses x1 count mode
_ENCODER_COUNTS_PER_REV = _ENCODER_PPR * _ENCODER_QUADRATURE  # 1000
# Wheel diameter — physical DMF RW-1650 wheel is 406.4mm (16 in).
# Encoder is direct-drive (no gear ratio). Verified against PLC:
# Rung 0 defines 10 encoder counts = 0.5 inches, which with 1000 PPR
# gives mm_per_count = 1.277mm. That matches pi*406.4/1000 = 1.277mm.
# The previous 341.4mm "calibrated" value was 15.5% wrong.
_DEFAULT_WHEEL_DIAMETER_MM = 406.4  # 16 in physical wheel, direct-drive encoder

# Offline buffer defaults
_DEFAULT_BUFFER_MAX_MB = 50


class OfflineBuffer:
    """Append-only JSONL buffer that persists readings to local disk.

    Each reading is written as a single JSON line to a date-stamped file.
    When the buffer directory exceeds max_mb, the oldest files are pruned.
    Files are named ``readings_YYYYMMDD.jsonl`` so Viam's data manager or
    an external uploader can pick them up and delete after sync.
    """

    def __init__(self, buffer_dir: str, max_mb: float = _DEFAULT_BUFFER_MAX_MB):
        self._dir = buffer_dir
        self._max_bytes = int(max_mb * 1024 * 1024)
        os.makedirs(self._dir, exist_ok=True)
        LOGGER.info("OfflineBuffer initialised: dir=%s max_mb=%.0f", self._dir, max_mb)

    def _current_file(self) -> str:
        date_str = time.strftime("%Y%m%d")
        return os.path.join(self._dir, f"readings_{date_str}.jsonl")

    def write(self, readings: Mapping[str, Any]) -> None:
        """Append a single reading as a JSON line with an ISO timestamp."""
        record = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "epoch": time.time(),
            **{k: _serialise(v) for k, v in readings.items()},
        }
        path = self._current_file()
        try:
            with open(path, "a") as f:
                f.write(json.dumps(record, separators=(",", ":")) + "\n")
        except Exception as exc:
            LOGGER.warning("OfflineBuffer write failed: %s", exc)
            return
        self._maybe_prune()

    def _maybe_prune(self) -> None:
        """Remove oldest JSONL files if total size exceeds the cap."""
        try:
            files = sorted(
                (os.path.join(self._dir, f) for f in os.listdir(self._dir) if f.endswith(".jsonl")),
                key=os.path.getmtime,
            )
            total = sum(os.path.getsize(f) for f in files)
            while total > self._max_bytes and len(files) > 1:
                oldest = files.pop(0)
                size = os.path.getsize(oldest)
                os.remove(oldest)
                total -= size
                LOGGER.info("OfflineBuffer pruned %s (%.1f KB)", oldest, size / 1024)
        except Exception as exc:
            LOGGER.warning("OfflineBuffer prune error: %s", exc)


def _serialise(value: Any) -> Any:
    """Make a value JSON-safe (bools, ints, floats, strings)."""
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float, str)):
        return value
    return str(value)


def _uint16(value: int) -> int:
    """Ensure a register value is treated as unsigned 16-bit integer.

    Some pymodbus versions may return signed int16 values. This ensures
    all values are in the 0-65535 range.
    """
    return value & 0xFFFF


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
            pass
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


class PlcSensor(Sensor):
    """Reads TPS PLC state via Modbus TCP.

    Returns production readings: encoder, discrete inputs, output coils,
    internal coils, and DS holding registers — only what the real Click PLC
    ladder logic provides.  No simulated or placeholder values.
    """

    MODEL: ClassVar[Model] = Model(
        ModelFamily("viam-staubli-apera-poc", "monitor"),
        "plc-sensor",
    )

    def __init__(self, name: str, *, host: str, port: int,
                 wheel_diameter_mm: float = _DEFAULT_WHEEL_DIAMETER_MM,
                 offline_buffer_dir: Optional[str] = None,
                 offline_buffer_max_mb: float = _DEFAULT_BUFFER_MAX_MB,
                 truck_id: str = "truck-00"):
        super().__init__(name)
        self.host = host
        self.port = port
        self.client: Optional[ModbusTcpClient] = None
        self._start_time: float = time.time()
        self._session_id: str = uuid.uuid4().hex[:8]  # unique per power cycle
        self._truck_id: str = truck_id
        # Offline buffer — persists readings to local disk across reboots
        self._offline_buffer: Optional[OfflineBuffer] = None
        if offline_buffer_dir:
            self._offline_buffer = OfflineBuffer(offline_buffer_dir, offline_buffer_max_mb)
        # Encoder: distance-per-count derived from wheel diameter
        # mm_per_count = circumference / counts_per_rev
        #   = (π × 406.4) / 1000 = 1.2767 mm per encoder count
        #   = 0.05025 inches per count, 4.19 ft per revolution
        # Verified: PLC Rung 0 says 10 counts = 0.5", so 1 count = 1.27mm ✓
        self._wheel_diameter_mm = wheel_diameter_mm
        wheel_circumference_mm = math.pi * wheel_diameter_mm
        self._mm_per_count = wheel_circumference_mm / _ENCODER_COUNTS_PER_REV
        # Encoder: distance from DS10 (Encoder Next Tie countdown)
        self._prev_ds10: Optional[int] = None
        self._prev_distance_mm: Optional[float] = None
        self._prev_encoder_time: Optional[float] = None
        self._encoder_speed_mmps: float = 0.0  # mm per second
        self._accumulated_distance_mm: float = 0.0  # cumulative from DS10 deltas
        # Encoder hardware health — track if DD1 and DS10 are changing
        self._dd1_history: collections.deque = collections.deque(maxlen=30)
        self._ds10_history: collections.deque = collections.deque(maxlen=30)
        # TPS plate drop counter — tracks OFF→ON transitions on Y1 (Eject TPS_1)
        self._prev_eject_tps1: Optional[bool] = None
        self._plate_drop_count: int = 0
        # Self-healing: exponential backoff on repeated connection failures
        self._consecutive_failures: int = 0
        self._next_retry_time: float = 0.0
        self._total_reads: int = 0
        self._total_errors: int = 0
        # Connection quality monitor — detects cable issues, link flapping
        self._conn_monitor = ConnectionQualityMonitor()
        # Signal metrics — rolling window analysis for diagnostics
        self._signal_metrics = SignalMetrics()
        # Drop spacing tracking — distance between consecutive plate drops
        self._distance_at_last_drop: float = 0.0
        self._drop_spacings: collections.deque = collections.deque(maxlen=100)

    @classmethod
    def new(
        cls,
        config: ComponentConfig,
        dependencies: Mapping[ResourceName, ResourceBase],
    ) -> Self:
        fields = config.attributes.fields
        wheel_dia = _DEFAULT_WHEEL_DIAMETER_MM
        if "wheel_diameter_mm" in fields and fields["wheel_diameter_mm"].number_value:
            wheel_dia = fields["wheel_diameter_mm"].number_value
        # Offline buffer config
        buf_dir: Optional[str] = None
        if "offline_buffer_dir" in fields and fields["offline_buffer_dir"].string_value:
            buf_dir = fields["offline_buffer_dir"].string_value
        buf_max_mb = _DEFAULT_BUFFER_MAX_MB
        if "offline_buffer_max_mb" in fields and fields["offline_buffer_max_mb"].number_value:
            buf_max_mb = fields["offline_buffer_max_mb"].number_value
        truck_id = "truck-00"
        if "truck_id" in fields and fields["truck_id"].string_value:
            truck_id = fields["truck_id"].string_value
        sensor = cls(
            config.name,
            host=fields["host"].string_value or "192.168.0.10",
            port=int(fields["port"].number_value or 502),
            wheel_diameter_mm=wheel_dia,
            offline_buffer_dir=buf_dir,
            offline_buffer_max_mb=buf_max_mb,
            truck_id=truck_id,
        )
        LOGGER.info(
            "PlcSensor configured: host=%s port=%d wheel_diameter_mm=%.1f buffer=%s",
            sensor.host, sensor.port, sensor._wheel_diameter_mm,
            buf_dir or "disabled",
        )
        return sensor

    @classmethod
    def validate_config(cls, config: ComponentConfig) -> Sequence[str]:
        """Validate that required attributes are present."""
        fields = config.attributes.fields
        if "host" not in fields or not fields["host"].string_value:
            raise ValueError("'host' attribute is required (PLC IP address)")
        return []

    def _disconnect(self) -> None:
        """Close and discard the Modbus client so the next poll reconnects."""
        if self.client is not None:
            try:
                self.client.close()
            except Exception:
                pass
            self.client = None

    def _ensure_connected(self) -> bool:
        """Connect to the PLC if not already connected. Returns True on success.

        Self-healing: on repeated failures, backs off exponentially up to
        _MAX_BACKOFF_SECONDS to avoid hammering a down PLC.  Resets
        immediately on successful connection.
        """
        if self.client is not None and self.client.connected:
            return True

        # Backoff: skip reconnect if we're in a cooldown period
        now = time.time()
        if now < self._next_retry_time:
            return False

        # Discard any dead socket before creating a fresh one
        self._disconnect()

        try:
            self.client = ModbusTcpClient(
                self.host,
                port=self.port,
                timeout=_CONNECT_TIMEOUT,
            )
            connected = self.client.connect()
            if connected:
                if self._consecutive_failures > 0:
                    LOGGER.info(
                        "🟢 PLC reconnected at %s:%d after %d failures — self-healed",
                        self.host, self.port, self._consecutive_failures,
                    )
                else:
                    LOGGER.info("🟢 Connected to PLC at %s:%d", self.host, self.port)
                self._consecutive_failures = 0
                self._next_retry_time = 0.0
                return True
            else:
                self._on_connection_failure("TCP connect returned False")
                return False
        except Exception as e:
            self._on_connection_failure(str(e))
            return False

    def _on_connection_failure(self, reason: str) -> None:
        """Handle a connection failure: log diagnostics and schedule retry."""
        self._disconnect()
        self._consecutive_failures += 1
        self._total_errors += 1
        capped_exp = min(self._consecutive_failures - 1, 5)  # cap at 32s to avoid OverflowError
        backoff = min(
            _INITIAL_BACKOFF_SECONDS * (2 ** capped_exp),
            _MAX_BACKOFF_SECONDS,
        )
        self._next_retry_time = time.time() + backoff
        LOGGER.warning(
            "🔴 PLC connection failed [%s:%d]: %s | "
            "failures=%d | retry_in=%.1fs | total_reads=%d | total_errors=%d",
            self.host, self.port, reason,
            self._consecutive_failures, backoff,
            self._total_reads, self._total_errors,
        )
        if self._consecutive_failures == 1:
            LOGGER.info(
                "🔧 TROUBLESHOOT: Check that the PLC is powered (PWR+RUN LEDs green), "
                "Ethernet cable is connected to the PLC's Ethernet port, "
                "and the Pi is on the same subnet as %s",
                self.host,
            )

    def _disconnected_readings(self, reason: str) -> Mapping[str, SensorReading]:
        """Return a full readings dict with connected=False and all values zeroed.

        Must match the same keys returned by get_readings() so the dashboard
        always receives a consistent schema.
        """
        readings: Dict[str, Any] = {
            # Identity & session
            "truck_id": self._truck_id,
            "session_id": self._session_id,
            # System health
            "connected": False,
            "fault": True,
            "system_state": "disconnected",
            "last_fault": reason,
            "uptime_seconds": round(time.time() - self._start_time),
            "shift_hours": round((time.time() - self._start_time) / 3600.0, 2),
            "total_reads": self._total_reads,
            "total_errors": self._total_errors,
            # Encoder & Track Distance
            "encoder_count": 0,
            "dd1_frozen": True,
            "ds10_frozen": True,
            "encoder_direction": "forward",
            "encoder_distance_ft": 0.0,
            "encoder_speed_ftpm": 0.0,
            "encoder_revolutions": 0.0,
            # TPS Machine Status
            "tps_power_loop": False,
            "camera_signal": False,
            "encoder_enabled": False,
            "floating_zero": False,
            "encoder_reset": False,
            # TPS Eject System
            "eject_tps_1": False,
            "eject_left_tps_2": False,
            "eject_right_tps_2": False,
            "air_eagle_1_feedback": False,
            "air_eagle_2_feedback": False,
            "air_eagle_3_enable": False,
            # TPS Production
            "plate_drop_count": 0,
            # Discrete inputs (raw)
            "x1": False,
            "x2": False,
            "x8": False,
        }
        # DS Holding Registers — all 25 zeroed
        for i in range(1, 26):
            readings[f"ds{i}"] = 0
        # Operating Mode defaults
        readings["operating_mode"] = "None"
        readings["mode_tps1_single"] = False
        readings["mode_tps1_double"] = False
        readings["mode_tps2_both"] = False
        readings["mode_tps2_left"] = False
        readings["mode_tps2_right"] = False
        readings["mode_tie_team"] = False
        readings["mode_2nd_pass"] = False
        # Drop Pipeline defaults
        readings["drop_enable"] = False
        readings["drop_enable_latch"] = False
        readings["drop_software_eject"] = False
        readings["drop_detector_eject"] = False
        readings["drop_encoder_eject"] = False
        readings["first_tie_detected"] = False
        # Detection defaults
        readings["encoder_mode"] = False
        readings["camera_positive"] = False
        readings["backup_alarm"] = False
        readings["lay_ties_set"] = False
        readings["drop_ties"] = False
        # TD Timer defaults
        readings["td5_seconds_laying"] = 0
        readings["td6_tie_travel"] = 0
        # Drop spacing defaults
        readings["last_drop_spacing_in"] = 0.0
        readings["avg_drop_spacing_in"] = 0.0
        readings["min_drop_spacing_in"] = 0.0
        readings["max_drop_spacing_in"] = 0.0
        readings["distance_since_last_drop_in"] = 0.0
        readings["drop_count_in_window"] = 0
        # Signal metrics defaults
        readings["camera_detections_per_min"] = 0
        readings["camera_rate_trend"] = "stable"
        readings["camera_signal_duration_s"] = 0.0
        readings["eject_rate_per_min"] = 0
        readings["detector_eject_rate_per_min"] = 0
        readings["encoder_noise"] = 0
        readings["encoder_reversals_per_min"] = 0
        readings["modbus_response_time_ms"] = 0.0
        readings["tps_power_duration_s"] = 0.0
        # Diagnostics defaults
        readings["diagnostics"] = []
        readings["diagnostics_count"] = 0
        readings["diagnostics_critical"] = 0
        readings["diagnostics_warning"] = 0
        # Connection quality
        conn_quality = self._conn_monitor.check()
        readings.update(conn_quality)
        return readings

    async def get_readings(
        self,
        extra: Optional[Dict[str, Any]] = None,
        **kwargs,
    ) -> Mapping[str, SensorReading]:
        """Return current TPS PLC state as structured sensor readings.

        Reads only real PLC registers: DS holding registers, encoder (DD1),
        discrete inputs, output coils, and internal coils.  On any failure
        the client is closed so the next poll cycle creates a fresh connection.
        """
        self._total_reads += 1
        connected = self._ensure_connected()

        if not connected:
            return self._disconnected_readings("connection_failed")

        try:
            # ── Modbus timing for diagnostic engine ──
            _modbus_start = time.time()

            # ── Read DS holding registers (0-24) — all 25 TPS registers ──
            ds_result = self.client.read_holding_registers(address=0, count=25)
            if ds_result.isError():
                LOGGER.warning("Error reading DS registers: %s", ds_result)
                self._disconnect()
                return self._disconnected_readings("ds_read_error")

            ds = [_uint16(v) for v in ds_result.registers]

            # ── Read encoder count from DD1 (Modbus address 16384, 2 registers) ──
            # DD1 is the HSC current value — 32-bit signed, quadrature x1
            # 1000 counts per encoder revolution.
            enc_lo, enc_hi = 0, 0
            try:
                enc_result = self.client.read_holding_registers(address=16384, count=2)
                if not enc_result.isError():
                    enc_lo = _uint16(enc_result.registers[0])
                    enc_hi = _uint16(enc_result.registers[1])
            except Exception:
                pass
            encoder_count = (enc_hi << 16) | enc_lo
            if encoder_count > 0x7FFFFFFF:
                encoder_count -= 0x100000000

            # ── DD1 hardware health: is the encoder producing any pulses? ──
            # Only matters when TPS is on (production). When TPS is off,
            # DD1 may legitimately be frozen — don't diagnose at idle.
            self._dd1_history.append(encoder_count)
            dd1_unique = len(set(self._dd1_history))
            dd1_frozen = dd1_unique <= 1 and len(self._dd1_history) >= 10

            # ── DS10 health: is the PLC counting distance? ──
            # DS10 should change when TPS is on and encoder is moving.
            # If DS10 is frozen while DD1 is alive, the PLC isn't processing.
            self._ds10_history.append(ds[9])
            ds10_unique = len(set(self._ds10_history))
            ds10_frozen = ds10_unique <= 1 and len(self._ds10_history) >= 15

            # ── Distance from DS10 (Encoder Next Tie) ──
            # DD1 is NOT usable for distance — the PLC resets it every ~10
            # counts (Rung 0) at 0.1ms scan rate. We can't sample fast enough.
            #
            # Instead, use DS10 which counts down from DS3 (tie spacing in
            # 0.1" units, typically 195 = 19.5") to 0, then resets. Each
            # full cycle = one tie spacing of travel. We track the countdown
            # and accumulate distance from the deltas.
            ds10_encoder_next = ds[9]  # DS10: Encoder Next Tie (0.1" units)
            ds3_tie_spacing = ds[2]    # DS3: Tie Spacing (0.1" units)
            now_ts = time.time()
            encoder_direction = 0  # default forward

            if self._prev_ds10 is not None and ds3_tie_spacing > 0:
                delta_ds10 = self._prev_ds10 - ds10_encoder_next  # countdown: prev > current = forward
                if delta_ds10 < 0:
                    # DS10 reset (rolled over from near 0 back to ~195)
                    # Distance traveled = remaining from prev + amount used in new cycle
                    delta_ds10 = self._prev_ds10 + (ds3_tie_spacing - ds10_encoder_next)
                if delta_ds10 < 0:
                    # Reverse travel
                    encoder_direction = 1
                    delta_ds10 = abs(delta_ds10)
                if delta_ds10 > 0 and delta_ds10 < ds3_tie_spacing * 2:
                    # Convert 0.1" units to mm (1 unit = 0.1" = 2.54mm)
                    self._accumulated_distance_mm += delta_ds10 * 2.54
            self._prev_ds10 = ds10_encoder_next

            encoder_distance_mm = self._accumulated_distance_mm
            encoder_distance_ft = encoder_distance_mm / 304.8
            encoder_revolutions = encoder_distance_mm / (math.pi * self._wheel_diameter_mm)

            # Speed from distance delta / time delta
            if self._prev_distance_mm is not None and self._prev_encoder_time is not None:
                dt = now_ts - self._prev_encoder_time
                if dt > 0.01:
                    delta_mm = self._accumulated_distance_mm - self._prev_distance_mm
                    self._encoder_speed_mmps = delta_mm / dt
            self._prev_distance_mm = self._accumulated_distance_mm
            self._prev_encoder_time = now_ts

            # Speed in feet per minute (common railroad unit)
            encoder_speed_ftpm = (self._encoder_speed_mmps / 304.8) * 60.0

            # ── Read TPS discrete inputs (X1-X8) — FC02, address 0-7 ──
            discrete_bits = [False] * 8
            try:
                di_result = self.client.read_discrete_inputs(address=0, count=8)
                if not di_result.isError():
                    discrete_bits = list(di_result.bits[:8])
            except Exception as exc:
                LOGGER.warning("Error reading discrete inputs: %s", exc)

            tps_power_loop = bool(discrete_bits[3])       # X4
            camera_signal = bool(discrete_bits[2])         # X3
            air_eagle_1_feedback = bool(discrete_bits[4])  # X5
            air_eagle_2_feedback = bool(discrete_bits[5])  # X6
            air_eagle_3_enable = bool(discrete_bits[6])    # X7

            # ── Read TPS output coils (Y1-Y3) — FC01, address 8192-8194 ──
            output_coils = [False] * 3
            try:
                oc_result = self.client.read_coils(address=8192, count=3)
                if not oc_result.isError():
                    output_coils = list(oc_result.bits[:3])
            except Exception as exc:
                LOGGER.warning("Error reading output coils: %s", exc)

            eject_tps_1 = bool(output_coils[0])       # Y1
            eject_left_tps_2 = bool(output_coils[1])   # Y2
            eject_right_tps_2 = bool(output_coils[2])  # Y3

            # ── Read TPS internal coils (C1999, C2000) — FC01, address 1998-1999 ──
            internal_coils = [False] * 2
            try:
                ic_result = self.client.read_coils(address=1998, count=2)
                if not ic_result.isError():
                    internal_coils = list(ic_result.bits[:2])
            except Exception as exc:
                LOGGER.warning("Error reading internal coils: %s", exc)

            encoder_reset_coil = bool(internal_coils[0])  # C1999
            floating_zero = bool(internal_coils[1])        # C2000

            # ── Read C-bits C1-C34 for operating mode, drop pipeline, detection state ──
            c_app_bits = [False] * 34
            try:
                cb_result = self.client.read_coils(address=0, count=34)
                if not cb_result.isError():
                    c_app_bits = list(cb_result.bits[:34])
            except Exception:
                pass

            # Derived operating mode name from mutually-exclusive C-bits
            _mode_map = [
                (c_app_bits[19], "TPS-1 Single"), (c_app_bits[20], "TPS-1 Double"),
                (c_app_bits[21], "TPS-2 Both"), (c_app_bits[26], "Tie Team"),
                (c_app_bits[30], "2nd Pass"),
            ]
            _mode = next((name for active, name in _mode_map if active), "None")
            if c_app_bits[22]:
                _mode += " L"
            if c_app_bits[23]:
                _mode += " R"

            # ── Read TD timers (HR 24576, 12 registers) ──
            td5_laying = 0
            td6_travel = 0
            try:
                td_result = self.client.read_holding_registers(address=24576, count=12)
                if not td_result.isError():
                    td5_laying = (td_result.registers[9] << 16) | td_result.registers[8]
                    td6_travel = (td_result.registers[11] << 16) | td_result.registers[10]
            except Exception:
                pass

            # ── Modbus elapsed time ──
            _modbus_elapsed_ms = (time.time() - _modbus_start) * 1000

            # ── TPS plate drop counter — detect OFF→ON on Y1 (Eject TPS_1) ──
            # Also compute drop spacing (distance between consecutive drops)
            encoder_distance_in = (self._accumulated_distance_mm / 25.4)
            if self._prev_eject_tps1 is not None and not self._prev_eject_tps1 and eject_tps_1:
                self._plate_drop_count += 1
                spacing = encoder_distance_in - self._distance_at_last_drop
                if self._distance_at_last_drop > 0 and spacing > 0:
                    self._drop_spacings.append(spacing)
                self._distance_at_last_drop = encoder_distance_in
                LOGGER.info(
                    "Plate drop #%d — encoder=%d spacing=%.1fin",
                    self._plate_drop_count, encoder_count,
                    spacing if self._distance_at_last_drop > 0 else 0,
                )
            self._prev_eject_tps1 = eject_tps_1

            # Drop spacing stats
            _spacings = list(self._drop_spacings)
            last_drop_spacing_in = round(_spacings[-1], 2) if _spacings else 0.0
            avg_drop_spacing_in = round(sum(_spacings) / len(_spacings), 2) if _spacings else 0.0
            min_drop_spacing_in = round(min(_spacings), 2) if _spacings else 0.0
            max_drop_spacing_in = round(max(_spacings), 2) if _spacings else 0.0
            distance_since_last_drop_in = round(encoder_distance_in - self._distance_at_last_drop, 2)
            drop_count_in_window = len(_spacings)

            # Encoder enabled: True when C1999 (Encoder Reset) is OFF and encoder is counting
            encoder_enabled = not encoder_reset_coil and encoder_count != 0

            # ── Derive system state from real PLC signals ──
            system_state = "running" if tps_power_loop else "idle"

            # ── Build readings — everything the PLC exposes ──
            uptime_s = round(time.time() - self._start_time)
            readings: Dict[str, Any] = {
                # Identity & session — critical for fleet queries
                "truck_id": self._truck_id,
                "session_id": self._session_id,
                # System health
                "connected": True,
                "fault": False,
                "system_state": system_state,
                "last_fault": "none",
                "uptime_seconds": uptime_s,
                "shift_hours": round(uptime_s / 3600.0, 2),
                "total_reads": self._total_reads,
                "total_errors": self._total_errors,
                # Encoder & Track Distance (DD1 + derived)
                "encoder_count": encoder_count,
                "dd1_frozen": dd1_frozen,
                "ds10_frozen": ds10_frozen,
                "encoder_direction": "forward" if encoder_direction == 0 else "reverse",
                "encoder_distance_ft": round(encoder_distance_ft, 2),
                "encoder_speed_ftpm": round(encoder_speed_ftpm, 1),
                "encoder_revolutions": round(encoder_revolutions, 2),
                # TPS Machine Status (discrete inputs + internal coils)
                "tps_power_loop": tps_power_loop,
                "camera_signal": camera_signal,
                "encoder_enabled": encoder_enabled,
                "floating_zero": floating_zero,
                "encoder_reset": encoder_reset_coil,
                # TPS Eject System (output coils + air eagle feedback)
                "eject_tps_1": eject_tps_1,
                "eject_left_tps_2": eject_left_tps_2,
                "eject_right_tps_2": eject_right_tps_2,
                "air_eagle_1_feedback": air_eagle_1_feedback,
                "air_eagle_2_feedback": air_eagle_2_feedback,
                "air_eagle_3_enable": air_eagle_3_enable,
                # TPS Production (derived from coil transitions)
                "plate_drop_count": self._plate_drop_count,
                # DS Holding Registers — all 25 from Click PLC ladder logic
                "ds1": ds[0],
                "ds2": ds[1],
                "ds3": ds[2],
                "ds4": ds[3],
                "ds5": ds[4],
                "ds6": ds[5],
                "ds7": ds[6],
                "ds8": ds[7],
                "ds9": ds[8],
                "ds10": ds[9],
                "ds11": ds[10],
                "ds12": ds[11],
                "ds13": ds[12],
                "ds14": ds[13],
                "ds15": ds[14],
                "ds16": ds[15],
                "ds17": ds[16],
                "ds18": ds[17],
                "ds19": ds[18],
                "ds20": ds[19],
                "ds21": ds[20],
                "ds22": ds[21],
                "ds23": ds[22],
                "ds24": ds[23],
                "ds25": ds[24],
                # Discrete inputs X1-X8 (raw, for completeness)
                "x1": bool(discrete_bits[0]),
                "x2": bool(discrete_bits[1]),
                "x8": bool(discrete_bits[7]),
                # Operating Mode (mutually exclusive C-bits)
                "operating_mode": _mode,
                "mode_tps1_single": bool(c_app_bits[19]),    # C20
                "mode_tps1_double": bool(c_app_bits[20]),    # C21
                "mode_tps2_both": bool(c_app_bits[21]),      # C22
                "mode_tps2_left": bool(c_app_bits[22]),      # C23
                "mode_tps2_right": bool(c_app_bits[23]),     # C24
                "mode_tie_team": bool(c_app_bits[26]),       # C27
                "mode_2nd_pass": bool(c_app_bits[30]),       # C31
                # Drop Pipeline
                "drop_enable": bool(c_app_bits[15]),         # C16
                "drop_enable_latch": bool(c_app_bits[16]),   # C17
                "drop_software_eject": bool(c_app_bits[28]), # C29
                "drop_detector_eject": bool(c_app_bits[29]), # C30
                "drop_encoder_eject": bool(c_app_bits[31]),  # C32
                "first_tie_detected": bool(c_app_bits[33]),  # C34
                # Detection
                "encoder_mode": bool(c_app_bits[2]),         # C3
                "camera_positive": bool(c_app_bits[11]),     # C12
                "backup_alarm": bool(c_app_bits[6]),         # C7
                "lay_ties_set": bool(c_app_bits[12]),        # C13
                "drop_ties": bool(c_app_bits[13]),           # C14
                # TD Timers
                "td5_seconds_laying": td5_laying,
                "td6_tie_travel": td6_travel,
            }

            # ── Drop spacing metrics ──
            readings["last_drop_spacing_in"] = last_drop_spacing_in
            readings["avg_drop_spacing_in"] = avg_drop_spacing_in
            readings["min_drop_spacing_in"] = min_drop_spacing_in
            readings["max_drop_spacing_in"] = max_drop_spacing_in
            readings["distance_since_last_drop_in"] = distance_since_last_drop_in
            readings["drop_count_in_window"] = drop_count_in_window

            # ── Signal metrics — rolling window analysis ──
            sig = self._signal_metrics.update(
                x3=camera_signal,
                y1=eject_tps_1,
                c30=bool(c_app_bits[29]),  # C30 = detector eject
                encoder_dir=encoder_direction,
                modbus_ms=_modbus_elapsed_ms,
                now=now_ts,
            )
            readings.update(sig)

            # Track TPS power duration for diagnostics
            tps_power_duration_s = self._signal_metrics.track_power(
                tps_power_loop, now=now_ts,
            )
            readings["tps_power_duration_s"] = round(tps_power_duration_s, 1)

            # Connection quality monitoring — detect cable degradation
            conn_quality = self._conn_monitor.check()
            readings.update(conn_quality)

            # ── Diagnostic rules engine ──
            from diagnostics import evaluate as evaluate_diagnostics
            diagnostics = evaluate_diagnostics(readings)
            readings["diagnostics"] = diagnostics
            readings["diagnostics_count"] = len(diagnostics)
            readings["diagnostics_critical"] = sum(
                1 for d in diagnostics if d["severity"] == "critical"
            )
            readings["diagnostics_warning"] = sum(
                1 for d in diagnostics if d["severity"] == "warning"
            )

            # ── Diagnostic state change log ──
            # Track which rules are active and log transitions (fire/clear).
            # This flows to Viam Cloud for post-shift threshold tuning.
            current_rules = {d["rule"] for d in diagnostics}
            if not hasattr(self, "_prev_diag_rules"):
                self._prev_diag_rules: set = set()
            fired = current_rules - self._prev_diag_rules
            cleared = self._prev_diag_rules - current_rules
            if fired or cleared:
                log_parts = []
                for rule in fired:
                    diag = next((d for d in diagnostics if d["rule"] == rule), None)
                    evidence = diag.get("evidence", "") if diag else ""
                    severity = diag.get("severity", "?") if diag else "?"
                    log_parts.append(f"+{rule}({severity}): {evidence}")
                    LOGGER.info("DIAG FIRED: %s [%s] %s", rule, severity, evidence)
                for rule in cleared:
                    log_parts.append(f"-{rule}")
                    LOGGER.info("DIAG CLEARED: %s", rule)
                readings["diagnostic_log"] = " | ".join(log_parts)
            else:
                readings["diagnostic_log"] = ""
            self._prev_diag_rules = current_rules

            # Key metrics snapshot for threshold tuning (always logged)
            readings["diag_metrics"] = (
                f"cam_rate={readings.get('camera_detections_per_min', 0):.1f} "
                f"cam_trend={readings.get('camera_rate_trend', '?')} "
                f"eject_rate={readings.get('eject_rate_per_min', 0):.1f} "
                f"enc_noise={readings.get('encoder_noise', 0)} "
                f"modbus_ms={readings.get('modbus_response_time_ms', 0):.1f} "
                f"speed={readings.get('encoder_speed_ftpm', 0):.1f}"
            )

            # Persist to local offline buffer (survives reboots + cloud outages)
            if self._offline_buffer is not None:
                self._offline_buffer.write(readings)

            return readings

        except Exception as e:
            self._total_errors += 1
            LOGGER.error(
                "🔴 Error reading PLC registers: %s | total_reads=%d errors=%d",
                e, self._total_reads, self._total_errors,
            )
            self._disconnect()
            return self._disconnected_readings(str(e))

    async def do_command(
        self,
        command: Dict[str, Any],
        *,
        timeout: Optional[float] = None,
        **kwargs,
    ) -> Dict[str, Any]:
        """Execute remote commands on the PLC via Modbus writes.

        Supported commands:
          {"action": "test_eject", "output": "Y1"}  — Fire Y1/Y2/Y3 solenoid
          {"action": "software_eject"}               — Set C29 (Software Eject)
          {"action": "reset_counters"}               — Pulse C1 (Reset Plates and Time)
          {"action": "set_mode", "mode": "single"}   — Set operating mode C-bit

        SAFETY: TPS power (X4) must be ON for eject commands to work.
        The PLC ladder gates all solenoid outputs — we cannot bypass it.
        """
        action = command.get("action", "")
        result: Dict[str, Any] = {"action": action, "status": "error"}

        if not self.client or not self._ensure_connected():
            result["message"] = "PLC not connected"
            return result

        # Check TPS power for eject commands
        tps_on = False
        try:
            di = self.client.read_discrete_inputs(address=0, count=8)
            if not di.isError():
                tps_on = bool(di.bits[3])  # X4
        except Exception:
            pass

        if action == "test_eject":
            output = command.get("output", "Y1").upper()
            coil_map = {"Y1": 8192, "Y2": 8193, "Y3": 8194}
            addr = coil_map.get(output)
            if addr is None:
                result["message"] = f"Unknown output: {output}. Use Y1, Y2, or Y3."
                return result
            if not tps_on:
                result["message"] = "TPS power (X4) must be ON to fire eject. Turn on the TPS main switch first."
                result["tps_power"] = False
                return result
            try:
                self.client.write_coil(address=addr, value=True)
                import asyncio
                await asyncio.sleep(0.15)  # 150ms pulse
                self.client.write_coil(address=addr, value=False)
                result["status"] = "ok"
                result["message"] = f"{output} eject pulse fired (150ms)"
                result["tps_power"] = True
                LOGGER.info("DO_COMMAND: test_eject %s — fired", output)
            except Exception as e:
                result["message"] = f"Modbus write failed: {e}"
                LOGGER.error("DO_COMMAND: test_eject %s — error: %s", output, e)

        elif action == "software_eject":
            if not tps_on:
                result["message"] = "TPS power (X4) must be ON for software eject. Turn on the TPS main switch first."
                result["tps_power"] = False
                return result
            try:
                self.client.write_coil(address=28, value=True)  # C29 Software Eject
                import asyncio
                await asyncio.sleep(0.2)
                self.client.write_coil(address=28, value=False)
                result["status"] = "ok"
                result["message"] = "Software eject (C29) pulse fired"
                result["tps_power"] = True
                LOGGER.info("DO_COMMAND: software_eject — fired")
            except Exception as e:
                result["message"] = f"Modbus write failed: {e}"

        elif action == "reset_counters":
            try:
                self.client.write_coil(address=0, value=True)  # C1 Reset Plates and Time
                import asyncio
                await asyncio.sleep(0.2)
                self.client.write_coil(address=0, value=False)
                self._plate_drop_count = 0
                result["status"] = "ok"
                result["message"] = "Counters reset (C1 pulsed, Pi plate count zeroed)"
                LOGGER.info("DO_COMMAND: reset_counters — done")
            except Exception as e:
                result["message"] = f"Modbus write failed: {e}"

        elif action == "set_mode":
            mode = command.get("mode", "").lower()
            mode_map = {
                "single": (19, "TPS-1 Single"),      # C20
                "double": (20, "TPS-1 Double"),       # C21
                "both": (21, "TPS-2 Both"),           # C22
                "left": (22, "TPS-2 Left"),           # C23
                "right": (23, "TPS-2 Right"),         # C24
                "tie_team": (26, "TPS-2 Tie Team"),   # C27
                "2nd_pass": (30, "TPS-1 2nd Pass"),   # C31
            }
            if mode not in mode_map:
                result["message"] = f"Unknown mode: {mode}. Use: {', '.join(mode_map.keys())}"
                return result
            coil_addr, mode_name = mode_map[mode]
            try:
                # Clear all mode bits first
                for addr, _ in mode_map.values():
                    self.client.write_coil(address=addr, value=False)
                # Set the requested mode
                self.client.write_coil(address=coil_addr, value=True)
                result["status"] = "ok"
                result["message"] = f"Mode set to {mode_name}"
                LOGGER.info("DO_COMMAND: set_mode %s — done", mode_name)
            except Exception as e:
                result["message"] = f"Modbus write failed: {e}"

        else:
            result["message"] = f"Unknown action: {action}. Use: test_eject, software_eject, reset_counters, set_mode"

        return result

    async def close(self):
        LOGGER.info("%s is closing.", self.name)
        if self.client is not None:
            self.client.close()
            self.client = None


async def main():
    Registry.register_resource_creator(
        Sensor.API,
        PlcSensor.MODEL,
        ResourceCreatorRegistration(PlcSensor.new, PlcSensor.validate_config),
    )
    module = Module.from_args()
    module.add_model_from_registry(Sensor.API, PlcSensor.MODEL)
    await module.start()


if __name__ == "__main__":
    asyncio.run(main())
