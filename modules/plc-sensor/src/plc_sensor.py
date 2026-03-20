"""
PLC Modbus Sensor Module for Viam — TPS Production Monitor.

Reads the TPS (Tie Plate System) PLC state via Modbus TCP and returns
structured sensor readings for remote monitoring.  Connects to a Click PLC
C0-10DD2E-D.

Register map — only real PLC ladder logic, no simulated values:
  DS1-DS14 (addr 0-13):  TPS production config registers
  DD1 (addr 16384-16385): Encoder pulse count (32-bit signed, quadrature x1)
  X1-X8 (discrete):      TPS discrete inputs (power loop, camera, air eagles)
  Y1-Y3 (coils 8192+):   TPS eject output coils
  C1999-C2000 (coils):   Encoder reset, floating zero

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

# Rolling window size for plates-per-minute calculation
_PLATE_DROP_WINDOW_SECONDS = 60.0

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
                 offline_buffer_max_mb: float = _DEFAULT_BUFFER_MAX_MB):
        super().__init__(name)
        self.host = host
        self.port = port
        self.client: Optional[ModbusTcpClient] = None
        self._start_time: float = time.time()
        # Offline buffer — persists readings to local disk across reboots
        self._offline_buffer: Optional[OfflineBuffer] = None
        if offline_buffer_dir:
            self._offline_buffer = OfflineBuffer(offline_buffer_dir, offline_buffer_max_mb)
        # Software counters — edge detection on PLC register values
        self._servo_press_count: int = 0
        self._prev_servo_on: Optional[int] = None   # DS1 previous value
        # Encoder: distance-per-count derived from wheel diameter
        self._wheel_diameter_mm = wheel_diameter_mm
        wheel_circumference_mm = math.pi * wheel_diameter_mm
        self._mm_per_count = wheel_circumference_mm / _ENCODER_COUNTS_PER_REV
        # Encoder: speed tracking (delta count / delta time)
        self._prev_encoder_count: Optional[int] = None
        self._prev_encoder_time: Optional[float] = None
        self._encoder_speed_mmps: float = 0.0  # mm per second
        # TPS plate drop counter — tracks OFF→ON transitions on Y1 (Eject TPS_1)
        self._prev_eject_tps1: Optional[bool] = None
        self._plate_drop_count: int = 0
        self._plate_drop_times: Deque[float] = collections.deque()  # rolling window timestamps
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
        sensor = cls(
            config.name,
            host=fields["host"].string_value or "192.168.0.10",
            port=int(fields["port"].number_value or 502),
            wheel_diameter_mm=wheel_dia,
            offline_buffer_dir=buf_dir,
            offline_buffer_max_mb=buf_max_mb,
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

    @staticmethod
    def _disconnected_readings(reason: str) -> Mapping[str, SensorReading]:
        """Return a full readings dict with connected=False and all values zeroed."""
        return {
            "connected": False,
            "fault": True,
            "system_state": "disconnected",
            "last_fault": reason,
            "servo_power_press_count": 0,
            "current_uptime_seconds": 0,
            # Encoder
            "encoder_count": 0,
            "encoder_direction": "forward",
            "encoder_distance_mm": 0.0,
            "encoder_distance_ft": 0.0,
            "encoder_speed_mmps": 0.0,
            "encoder_speed_ftpm": 0.0,
            "encoder_revolutions": 0.0,
            # TPS discrete inputs
            "tps_power_loop": False,
            "camera_signal": False,
            "air_eagle_1_feedback": False,
            "air_eagle_2_feedback": False,
            "air_eagle_3_enable": False,
            # TPS output coils
            "eject_tps_1": False,
            "eject_left_tps_2": False,
            "eject_right_tps_2": False,
            # TPS internal coils
            "encoder_reset": False,
            "floating_zero": False,
            # TPS production registers
            "encoder_ignore": 0,
            "adjustable_tie_spacing": 0,
            "ds3_value": 0,
            "detector_offset_bits": 0,
            "ds6_value": 0,
            "ds7_value": 0,
            "ds10_value": 0,
            "ds11_value": 0,
            "ds12_value": 0,
            "ds13_value": 0,
            "ds14_value": 0,
            # TPS derived readings
            "encoder_enabled": False,
            "plate_drop_count": 0,
            "plates_per_minute": 0.0,
        }

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
            # ── Read DS holding registers (0-14) — TPS production config ──
            ds_result = self.client.read_holding_registers(address=0, count=15)
            if ds_result.isError():
                LOGGER.warning("Error reading DS registers: %s", ds_result)
                self._disconnect()
                return self._disconnected_readings("ds_read_error")

            ds = [_uint16(v) for v in ds_result.registers]

            # ── Read encoder count from DD1 (Modbus address 16384, 2 registers) ──
            # DD1 is the production HSC current count value — 32-bit signed quadrature x1
            enc_lo, enc_hi = 0, 0
            try:
                enc_result = self.client.read_holding_registers(address=16384, count=2)
                if not enc_result.isError():
                    enc_lo = _uint16(enc_result.registers[0])
                    enc_hi = _uint16(enc_result.registers[1])
            except Exception:
                pass

            # Combine into signed 32-bit count
            encoder_count = (enc_hi << 16) | enc_lo
            if encoder_count > 0x7FFFFFFF:
                encoder_count -= 0x100000000

            # Derive direction from count delta
            encoder_direction = 0  # default forward
            if self._prev_encoder_count is not None:
                delta = encoder_count - self._prev_encoder_count
                if delta < 0:
                    encoder_direction = 1  # reverse

            # Compute distance from encoder count
            encoder_distance_mm = abs(encoder_count) * self._mm_per_count
            encoder_distance_ft = encoder_distance_mm / 304.8
            encoder_revolutions = abs(encoder_count) / _ENCODER_COUNTS_PER_REV

            # Compute speed (mm/s) from delta count / delta time
            now_ts = time.time()
            if self._prev_encoder_count is not None and self._prev_encoder_time is not None:
                dt = now_ts - self._prev_encoder_time
                if dt > 0.01:  # avoid division by near-zero
                    delta_counts = abs(encoder_count - self._prev_encoder_count)
                    self._encoder_speed_mmps = (delta_counts * self._mm_per_count) / dt
            self._prev_encoder_count = encoder_count
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

            # ── TPS plate drop counter — detect OFF→ON on Y1 (Eject TPS_1) ──
            if self._prev_eject_tps1 is not None and not self._prev_eject_tps1 and eject_tps_1:
                self._plate_drop_count += 1
                self._plate_drop_times.append(now_ts)
            self._prev_eject_tps1 = eject_tps_1

            # Expire old entries outside the rolling window
            cutoff = now_ts - _PLATE_DROP_WINDOW_SECONDS
            while self._plate_drop_times and self._plate_drop_times[0] < cutoff:
                self._plate_drop_times.popleft()
            plates_per_minute = float(len(self._plate_drop_times))

            # Encoder enabled: True when C1999 (Encoder Reset) is OFF and encoder is counting
            encoder_enabled = not encoder_reset_coil and encoder_count != 0

            # ── Derive system state from real PLC signals ──
            servo_on = ds[0]  # DS1: servo_power_on (also used as encoder_ignore)
            # System state derived from discrete inputs and coil states
            system_state = "running" if tps_power_loop else "idle"

            # ── Software counters — detect rising edges on PLC register values ──
            # Servo press: count transitions of DS1 from 0→1 (servo toggled on)
            if self._prev_servo_on is not None and self._prev_servo_on == 0 and servo_on == 1:
                self._servo_press_count += 1
            self._prev_servo_on = servo_on

            # ── Build readings — only real PLC data ──
            readings: Dict[str, Any] = {
                "connected": True,
                "fault": False,
                "system_state": system_state,
                "last_fault": "none",
                "servo_power_on": servo_on,
                "servo_power_press_count": self._servo_press_count,
                "current_uptime_seconds": round(time.time() - self._start_time),
                "total_reads": self._total_reads,
                "total_errors": self._total_errors,
                # Encoder data (SICK DBS60E-BDEC01000)
                "encoder_count": encoder_count,
                "encoder_direction": "forward" if encoder_direction == 0 else "reverse",
                "encoder_distance_mm": round(encoder_distance_mm, 1),
                "encoder_distance_ft": round(encoder_distance_ft, 2),
                "encoder_speed_mmps": round(self._encoder_speed_mmps, 1),
                "encoder_speed_ftpm": round(encoder_speed_ftpm, 1),
                "encoder_revolutions": round(encoder_revolutions, 2),
                # TPS discrete inputs
                "tps_power_loop": tps_power_loop,
                "camera_signal": camera_signal,
                "air_eagle_1_feedback": air_eagle_1_feedback,
                "air_eagle_2_feedback": air_eagle_2_feedback,
                "air_eagle_3_enable": air_eagle_3_enable,
                # TPS output coils
                "eject_tps_1": eject_tps_1,
                "eject_left_tps_2": eject_left_tps_2,
                "eject_right_tps_2": eject_right_tps_2,
                # TPS internal coils
                "encoder_reset": encoder_reset_coil,
                "floating_zero": floating_zero,
                # TPS production registers (from DS holding registers)
                "encoder_ignore": ds[0],                 # DS1
                "adjustable_tie_spacing": ds[1],         # DS2
                "ds3_value": ds[2],                      # DS3
                "detector_offset_bits": ds[4],           # DS5
                "ds6_value": ds[5],                      # DS6
                "ds7_value": ds[6],                      # DS7
                "ds10_value": ds[9],                     # DS10
                "ds11_value": ds[10],                    # DS11
                "ds12_value": ds[11],                    # DS12
                "ds13_value": ds[12],                    # DS13
                "ds14_value": ds[13],                    # DS14
                # TPS derived readings
                "encoder_enabled": encoder_enabled,
                "plate_drop_count": self._plate_drop_count,
                "plates_per_minute": round(plates_per_minute, 1),
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
