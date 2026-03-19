"""
PLC Modbus Sensor Module for Viam.

Reads the RAIV truck's PLC state via Modbus TCP and returns structured
sensor readings for remote monitoring.  Connects to a Click PLC
C0-10DD2E-D at 192.168.0.10.

Register map (see docs/click-plc-setup-guide.md for full documentation):
  Registers 0-24:   E-Cat cable signals (25-pin cable pinout)
  Registers 100-117: Optional sensor/analytics data (zero on Click PLC)
  DD1 (Modbus 16384-16385): Encoder pulse count (32-bit signed, quadrature x1)
    16384: low 16 bits of DD1
    16385: high 16 bits of DD1
    Direction derived from count delta (positive = forward, negative = reverse)

The Click PLC ladder logic manages servo power state, system state, and
counters in holding registers.  This module reads those registers directly
— no software latch or coil reads needed.
"""

import asyncio
import collections
import math
import time
from typing import Any, ClassVar, Deque, Dict, List, Mapping, Optional, Sequence, Tuple

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

# Fault code lookups — code 4 can originate from either the PLC ladder
# logic (e-stop triggered) or the old simulator (clamp_fail).
_FAULT_NAMES = {0: "none", 1: "vibration", 2: "temperature", 3: "pressure", 4: "estop_triggered"}

# E-Cat signal names for registers 0-24 (25-pin cable pinout)
_ECAT_SIGNAL_NAMES = [
    "servo_power_on",       # Register 0  — Pin 1
    "servo_disable",        # Register 1  — Pin 2
    "plate_cycle",          # Register 2  — Pin 3 (Start / Plate Cycle)
    "abort_stow",           # Register 3  — Pin 4
    "speed",                # Register 4  — Pin 5
    "gripper_lock",         # Register 5  — Pin 6
    "clear_position",       # Register 6  — Pin 7
    "belt_forward",         # Register 7  — Pin 8
    "belt_reverse",         # Register 8  — Pin 9
    "lamp_servo_power",     # Register 9  — Pin 10
    "lamp_servo_disable",   # Register 10 — Pin 11
    "lamp_plate_cycle",     # Register 11 — Pin 12
    "lamp_abort_stow",      # Register 12 — Pin 13
    "lamp_speed",           # Register 13 — Pin 14
    "lamp_gripper_lock",    # Register 14 — Pin 15
    "lamp_clear_position",  # Register 15 — Pin 16
    "lamp_belt_forward",    # Register 16 — Pin 17
    "lamp_belt_reverse",    # Register 17 — Pin 18
    "emag_status",          # Register 18 — Pin 19
    "emag_on",              # Register 19 — Pin 20
    "emag_part_detect",     # Register 20 — Pin 21
    "emag_malfunction",     # Register 21 — Pin 22
    "poe_status",           # Register 22 — Pin 23
    "estop_enable",         # Register 23 — Pin 24
    "estop_off",            # Register 24 — Pin 25
]

# Connection timeout in seconds
_CONNECT_TIMEOUT = 2

# Encoder constants
_ENCODER_PPR = 1000          # Pulses per revolution (from SICK DBS60E-BDEC01000 datasheet)
_ENCODER_QUADRATURE = 1      # Production HSC uses x1 count mode
_ENCODER_COUNTS_PER_REV = _ENCODER_PPR * _ENCODER_QUADRATURE  # 1000
_DEFAULT_WHEEL_DIAMETER_MM = 406.4  # 16 inches — DMF RW-1650 railgear guide wheel

# Rolling window size for plates-per-minute calculation
_PLATE_DROP_WINDOW_SECONDS = 60.0


def _uint16(value: int) -> int:
    """Ensure a register value is treated as unsigned 16-bit integer.

    Some pymodbus versions may return signed int16 values. This ensures
    all values are in the 0-65535 range.
    """
    return value & 0xFFFF


def _int16_to_float(value: int, scale: float = 100.0) -> float:
    """Convert an unsigned Modbus register value back to a signed float.

    Signed values are encoded as unsigned int16:
      positive: stored directly (e.g., 981 = 9.81)
      negative: stored as 65536 + value (e.g., 65531 = -0.05)
    """
    value = _uint16(value)
    if value > 32767:
        value -= 65536
    return round(value / scale, 2)


class PlcSensor(Sensor):
    """Reads PLC state from the RAIV truck via Modbus TCP.

    Returns the full register map as human-readable sensor readings,
    including 25-pin E-Cat cable signals and sensor data.
    """

    MODEL: ClassVar[Model] = Model(
        ModelFamily("viam-staubli-apera-poc", "monitor"),
        "plc-sensor",
    )

    def __init__(self, name: str, *, host: str, port: int,
                 wheel_diameter_mm: float = _DEFAULT_WHEEL_DIAMETER_MM):
        super().__init__(name)
        self.host = host
        self.port = port
        self.client: Optional[ModbusTcpClient] = None
        self._start_time: float = time.time()
        # Software counters — edge detection on PLC register values
        self._servo_press_count: int = 0
        self._estop_count: int = 0
        self._prev_servo_on: Optional[int] = None   # DS1 previous value
        self._prev_estop_active: Optional[bool] = None
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
        sensor = cls(
            config.name,
            host=fields["host"].string_value or "192.168.0.10",
            port=int(fields["port"].number_value or 502),
            wheel_diameter_mm=wheel_dia,
        )
        LOGGER.info(
            "PlcSensor configured: host=%s port=%d wheel_diameter_mm=%.1f",
            sensor.host, sensor.port, sensor._wheel_diameter_mm,
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
        """Connect to the PLC if not already connected. Returns True on success."""
        if self.client is not None and self.client.connected:
            return True

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
                LOGGER.info("Connected to PLC at %s:%d", self.host, self.port)
            else:
                LOGGER.warning("Failed to connect to PLC at %s:%d", self.host, self.port)
                self._disconnect()
            return connected
        except Exception as e:
            LOGGER.error("Connection error to PLC at %s:%d: %s", self.host, self.port, e)
            self._disconnect()
            return False

    @staticmethod
    def _disconnected_readings(reason: str) -> Mapping[str, SensorReading]:
        """Return a full readings dict with connected=False and all values zeroed."""
        readings: Dict[str, Any] = {
            "connected": False,
            "fault": True,
        }
        # E-Cat signals — all zeroed, using the same keys as _ECAT_SIGNAL_NAMES
        for name in _ECAT_SIGNAL_NAMES:
            readings[name] = 0
        # Sensor data — all zeroed
        readings.update({
            "vibration_x": 0.0,
            "vibration_y": 0.0,
            "vibration_z": 0.0,
            "gyro_x": 0.0,
            "gyro_y": 0.0,
            "gyro_z": 0.0,
            "temperature_f": 0.0,
            "humidity_pct": 0.0,
            "pressure_simulated": 0,
            "servo1_position": 0,
            "servo2_position": 0,
            "cycle_count": 0,
            "system_state": "disconnected",
            "last_fault": reason,
            "servo_power_press_count": 0,
            "estop_activation_count": 0,
            "current_uptime_seconds": 0,
            # Encoder data
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
        })
        return readings

    async def get_readings(
        self,
        extra: Optional[Dict[str, Any]] = None,
        **kwargs,
    ) -> Mapping[str, SensorReading]:
        """Return current PLC state as structured sensor readings.

        Reads all Modbus registers and returns human-readable keys matching
        the 25-pin E-Cat cable labels plus sensor data.  On any failure the
        client is closed so the next poll cycle creates a fresh connection.
        """
        connected = self._ensure_connected()

        if not connected:
            return self._disconnected_readings("connection_failed")

        try:
            # Read E-Cat cable registers (0-24)
            ecat_result = self.client.read_holding_registers(address=0, count=25)
            if ecat_result.isError():
                LOGGER.warning("Error reading E-Cat registers: %s", ecat_result)
                self._disconnect()
                return self._disconnected_readings("ecat_read_error")

            ecat = [_uint16(v) for v in ecat_result.registers]

            # Read sensor/analytics registers (100-117) — optional, zero on Click PLC
            sensor = [0] * 18
            try:
                sensor_result = self.client.read_holding_registers(address=100, count=18)
                if not sensor_result.isError():
                    sensor = [_uint16(v) for v in sensor_result.registers]
            except Exception:
                pass

            # Read encoder count from DD1 (Modbus address 16384, 2 registers)
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

            # ── Read state directly from PLC ladder-logic registers ──
            # DS1 (reg 0):   servo_power_on (1=on, 0=off)
            # DS113 (reg 112): system_state (0=idle, 1=running, 2=fault, 3=e-stopped)
            # DS114 (reg 113): last_fault code
            # DS115 (reg 114): servo_power_press_count
            # DS116 (reg 115): estop_activation_count
            servo_on = ecat[0]  # DS1
            estop_active = ecat[24] == 0  # DS25: estop_off=0 means active

            _STATE_MAP = {0: "idle", 1: "running", 2: "fault", 3: "e-stopped"}
            derived_state = _STATE_MAP.get(sensor[12], "unknown")  # DS113 = reg 112
            fault_code = sensor[13]  # DS114 = reg 113

            # ── Software counters — detect rising edges on PLC register values ──
            # Servo press: count transitions of DS1 from 0→1 (servo toggled on)
            if self._prev_servo_on is not None and self._prev_servo_on == 0 and servo_on == 1:
                self._servo_press_count += 1
            self._prev_servo_on = servo_on

            # E-stop: count transitions from not-active to active
            if self._prev_estop_active is not None and not self._prev_estop_active and estop_active:
                self._estop_count += 1
            self._prev_estop_active = estop_active

            # ── Build readings ──
            readings: Dict[str, Any] = {
                "connected": True,
                "fault": derived_state == "fault",
            }

            # E-Cat cable signals (registers 0-24) with named keys
            for i, name in enumerate(_ECAT_SIGNAL_NAMES):
                readings[name] = ecat[i]

            # Sensor data (registers 100-117)
            readings.update({
                "vibration_x": _int16_to_float(sensor[0]),
                "vibration_y": _int16_to_float(sensor[1]),
                "vibration_z": _int16_to_float(sensor[2]),
                "gyro_x": _int16_to_float(sensor[3]),
                "gyro_y": _int16_to_float(sensor[4]),
                "gyro_z": _int16_to_float(sensor[5]),
                "temperature_f": _int16_to_float(sensor[6], 10.0),
                "humidity_pct": _int16_to_float(sensor[7], 10.0),
                "pressure_simulated": sensor[8],
                "servo1_position": sensor[9],
                "servo2_position": sensor[10],
                "cycle_count": sensor[11],
                "system_state": derived_state,
                "last_fault": _FAULT_NAMES.get(fault_code, f"unknown({fault_code})"),
                "servo_power_press_count": self._servo_press_count,
                "estop_activation_count": self._estop_count,
                "current_uptime_seconds": round(time.time() - self._start_time),
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
                "encoder_ignore": ecat[0],              # DS1
                "adjustable_tie_spacing": ecat[1],      # DS2
                "ds3_value": ecat[2],                    # DS3
                "detector_offset_bits": ecat[4],        # DS5
                "ds6_value": ecat[5],                    # DS6
                "ds7_value": ecat[6],                    # DS7
                "ds10_value": ecat[9],                   # DS10
                "ds11_value": ecat[10],                  # DS11
                "ds12_value": ecat[11],                  # DS12
                "ds13_value": ecat[12],                  # DS13
                "ds14_value": ecat[13],                  # DS14
                # TPS derived readings
                "encoder_enabled": encoder_enabled,
                "plate_drop_count": self._plate_drop_count,
                "plates_per_minute": round(plates_per_minute, 1),
            })

            return readings

        except Exception as e:
            LOGGER.error("Error reading PLC registers: %s", e)
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
