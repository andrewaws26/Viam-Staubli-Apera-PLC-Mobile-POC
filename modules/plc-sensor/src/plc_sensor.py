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
import time
import uuid
from typing import Any, ClassVar, Deque, Dict, Mapping, Optional, Sequence

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

# Encoder constants
_ENCODER_PPR = 1000          # Pulses per revolution (from SICK DBS60E-BDEC01000 datasheet)
_ENCODER_QUADRATURE = 1      # Production HSC uses x1 count mode
_ENCODER_COUNTS_PER_REV = _ENCODER_PPR * _ENCODER_QUADRATURE  # 1000
_DEFAULT_WHEEL_DIAMETER_MM = 406.4  # 16 inches — DMF RW-1650 railgear guide wheel

# DS8 travel accumulator: the PLC ladder increments DS8 as the encoder
# counts pulses.  Calibrated: ~40 encoder pulses per DS8 count.
# DD1 (raw HSC) is NOT usable — the PLC ladder resets it each scan cycle,
# so it only holds a per-scan delta that bounces around zero.
# NOTE: Original value (485) was 12× too high — caused all distances to
# read in feet instead of the correct inches (e.g. 39 ft vs 39 in spacing).
_DS8_PULSES_PER_COUNT = 40  # encoder pulses per DS8 increment (calibrated)

# Rolling window size for plates-per-minute calculation
_PLATE_DROP_WINDOW_SECONDS = 60.0

# Plate drop spacing history — how many recent drops to keep for diagnostics
_MAX_DROP_HISTORY = 20

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
        self._wheel_diameter_mm = wheel_diameter_mm
        wheel_circumference_mm = math.pi * wheel_diameter_mm
        self._mm_per_count = wheel_circumference_mm / _ENCODER_COUNTS_PER_REV
        # DS8 travel accumulator: mm per DS8 count
        self._mm_per_ds8 = _DS8_PULSES_PER_COUNT * self._mm_per_count
        # Encoder: speed tracking (delta DS8 / delta time)
        self._prev_ds8: Optional[int] = None
        self._prev_ds8_time: Optional[float] = None
        self._encoder_speed_mmps: float = 0.0  # mm per second
        self._encoder_direction: int = 0  # 0=forward, 1=reverse
        # TPS plate drop counter — tracks OFF→ON transitions on Y1 (Eject TPS_1)
        self._prev_eject_tps1: Optional[bool] = None
        self._plate_drop_count: int = 0
        self._plate_drop_times: Deque[float] = collections.deque()  # rolling window timestamps
        # Plate drop spacing diagnostics — encoder count at each drop
        self._drop_encoder_counts: Deque[int] = collections.deque(maxlen=_MAX_DROP_HISTORY)
        self._drop_spacings_mm: Deque[float] = collections.deque(maxlen=_MAX_DROP_HISTORY)
        self._drop_spacings_in: Deque[float] = collections.deque(maxlen=_MAX_DROP_HISTORY)
        self._drop_spacings_ft: Deque[float] = collections.deque(maxlen=_MAX_DROP_HISTORY)
        # Self-healing: exponential backoff on repeated connection failures
        self._consecutive_failures: int = 0
        self._next_retry_time: float = 0.0
        self._total_reads: int = 0
        self._total_errors: int = 0

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
        backoff = min(
            _INITIAL_BACKOFF_SECONDS * (2 ** (self._consecutive_failures - 1)),
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
            "plates_per_minute": 0.0,
            "plate_drop_count": 0,
            # Plate drop spacing diagnostics
            "last_drop_spacing_in": 0.0,
            "last_drop_spacing_ft": 0.0,
            "last_drop_encoder_count": 0,
            "avg_drop_spacing_in": 0.0,
            "avg_drop_spacing_ft": 0.0,
            "min_drop_spacing_in": 0.0,
            "min_drop_spacing_ft": 0.0,
            "max_drop_spacing_in": 0.0,
            "max_drop_spacing_ft": 0.0,
            "drop_count_in_window": 0,
            "distance_since_last_drop_in": 0.0,
            "distance_since_last_drop_ft": 0.0,
            # Discrete inputs (raw)
            "x1": False,
            "x2": False,
            "x8": False,
        }
        # DS Holding Registers — all 25 zeroed
        for i in range(1, 26):
            readings[f"ds{i}"] = 0
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
            # ── Read DS holding registers (0-24) — all 25 TPS registers ──
            ds_result = self.client.read_holding_registers(address=0, count=25)
            if ds_result.isError():
                LOGGER.warning("Error reading DS registers: %s", ds_result)
                self._disconnect()
                return self._disconnected_readings("ds_read_error")

            ds = [_uint16(v) for v in ds_result.registers]

            # ── Read raw DD1 for reference (Modbus address 16384, 2 registers) ──
            # DD1 is the HSC fed by encoder on X1/X2, but the PLC ladder resets
            # it each scan cycle so it only holds a per-scan delta — not usable
            # for distance or direction tracking.
            enc_lo, enc_hi = 0, 0
            try:
                enc_result = self.client.read_holding_registers(address=16384, count=2)
                if not enc_result.isError():
                    enc_lo = _uint16(enc_result.registers[0])
                    enc_hi = _uint16(enc_result.registers[1])
            except Exception:
                pass
            dd1_raw = (enc_hi << 16) | enc_lo
            if dd1_raw > 0x7FFFFFFF:
                dd1_raw -= 0x100000000

            # ── Travel distance from DS8 (PLC-accumulated distance counter) ──
            # DS8 is the authoritative travel counter maintained by the PLC
            # ladder logic.  Left spin (forward) = DS8 increases.
            # Right spin (reverse) = DS8 decreases.
            travel_count = ds[7]  # DS8

            # Direction from DS8 delta (stable — no per-scan jitter)
            now_ts = time.time()
            if self._prev_ds8 is not None:
                delta = travel_count - self._prev_ds8
                if delta > 0:
                    self._encoder_direction = 0  # forward
                elif delta < 0:
                    self._encoder_direction = 1  # reverse
                # delta == 0: keep previous direction
            encoder_direction = self._encoder_direction

            # Distance: DS8 * mm_per_ds8 (each DS8 count ≈ 485 encoder pulses)
            encoder_distance_mm = travel_count * self._mm_per_ds8
            encoder_distance_ft = encoder_distance_mm / 304.8
            encoder_revolutions = (travel_count * _DS8_PULSES_PER_COUNT) / _ENCODER_COUNTS_PER_REV

            # Speed from DS8 delta / delta time
            if self._prev_ds8 is not None and self._prev_ds8_time is not None:
                dt = now_ts - self._prev_ds8_time
                if dt > 0.01:
                    delta_counts = abs(travel_count - self._prev_ds8)
                    self._encoder_speed_mmps = (delta_counts * self._mm_per_ds8) / dt
            self._prev_ds8 = travel_count
            self._prev_ds8_time = now_ts

            # Keep DD1 raw value as encoder_count for reference in readings
            encoder_count = dd1_raw

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

            # ── TPS plate drop counter — detect OFF→ON on Y1 (Eject TPS_1) ──
            if self._prev_eject_tps1 is not None and not self._prev_eject_tps1 and eject_tps_1:
                self._plate_drop_count += 1
                self._plate_drop_times.append(now_ts)
                # Record DS8 position at this drop for spacing analysis
                self._drop_encoder_counts.append(travel_count)
                if len(self._drop_encoder_counts) >= 2:
                    delta_ds8 = abs(self._drop_encoder_counts[-1] - self._drop_encoder_counts[-2])
                    spacing_mm = delta_ds8 * self._mm_per_ds8
                    spacing_in = spacing_mm / 25.4
                    spacing_ft = spacing_mm / 304.8
                    self._drop_spacings_mm.append(round(spacing_mm, 1))
                    self._drop_spacings_in.append(round(spacing_in, 1))
                    self._drop_spacings_ft.append(round(spacing_ft, 2))
                    LOGGER.info(
                        "📍 Plate drop #%d — ds8=%d delta=%d spacing=%.1fin (%.1fmm)",
                        self._plate_drop_count, travel_count, delta_ds8,
                        spacing_in, spacing_mm,
                    )
            self._prev_eject_tps1 = eject_tps_1

            # ── Distance since last drop — for predictive sync monitoring ──
            # Compares current DS8 position to last drop position.
            # If this exceeds DS2 target without Y1 firing, the dropper is late.
            if self._drop_encoder_counts:
                ds8_since_last_drop = abs(travel_count - self._drop_encoder_counts[-1])
                distance_since_last_drop_mm = ds8_since_last_drop * self._mm_per_ds8
                distance_since_last_drop_in = distance_since_last_drop_mm / 25.4
                distance_since_last_drop_ft = distance_since_last_drop_mm / 304.8
            else:
                distance_since_last_drop_mm = 0.0
                distance_since_last_drop_in = 0.0
                distance_since_last_drop_ft = 0.0

            # Expire old entries outside the rolling window
            cutoff = now_ts - _PLATE_DROP_WINDOW_SECONDS
            while self._plate_drop_times and self._plate_drop_times[0] < cutoff:
                self._plate_drop_times.popleft()
            plates_per_minute = float(len(self._plate_drop_times))

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
                "plates_per_minute": round(plates_per_minute, 1),
                "plate_drop_count": self._plate_drop_count,
                # Plate drop spacing diagnostics — summary stats (not full history)
                "last_drop_spacing_in": self._drop_spacings_in[-1] if self._drop_spacings_in else 0.0,
                "last_drop_spacing_ft": self._drop_spacings_ft[-1] if self._drop_spacings_ft else 0.0,
                "last_drop_encoder_count": self._drop_encoder_counts[-1] if self._drop_encoder_counts else 0,
                "avg_drop_spacing_in": round(sum(self._drop_spacings_in) / len(self._drop_spacings_in), 1) if self._drop_spacings_in else 0.0,
                "avg_drop_spacing_ft": round(sum(self._drop_spacings_ft) / len(self._drop_spacings_ft), 2) if self._drop_spacings_ft else 0.0,
                "min_drop_spacing_in": min(self._drop_spacings_in) if self._drop_spacings_in else 0.0,
                "min_drop_spacing_ft": min(self._drop_spacings_ft) if self._drop_spacings_ft else 0.0,
                "max_drop_spacing_in": max(self._drop_spacings_in) if self._drop_spacings_in else 0.0,
                "max_drop_spacing_ft": max(self._drop_spacings_ft) if self._drop_spacings_ft else 0.0,
                "drop_count_in_window": len(self._drop_spacings_ft),
                # Live sync tracking — distance accumulating since last plate drop
                "distance_since_last_drop_in": round(distance_since_last_drop_in, 1),
                "distance_since_last_drop_ft": round(distance_since_last_drop_ft, 2),
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
            }

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
