"""
Modbus TCP server exposing the PLC simulator's register map.

Register Layout — mirrors the real RAIV truck's 25-pin E-Cat cable:

  Holding Registers 0-24: E-Cat cable pin signals
    0-8   (Pins 1-9):   Command registers (writable by remote operator)
    9-17  (Pins 10-18): Status lamp registers (read-only feedback)
    18-24 (Pins 19-25): System state registers

  Holding Registers 100-117: Sensor data
    100: Accel X (int16, scaled: value = m/s^2 * 100)
    101: Accel Y
    102: Accel Z
    103: Gyro X (int16, scaled: value = °/s * 100)
    104: Gyro Y
    105: Gyro Z
    106: Temperature (int16, °F * 10, so 72.5°F = 725)
    107: Humidity (int16, % * 10)
    108: Potentiometer / simulated pressure (0-1023)
    109: Servo 1 position (0-180)
    110: Servo 2 position (0-180)
    111: Cycle count (demo cycles: power-on → e-stop → reset)
    112: System state (0=idle, 1=running, 2=fault, 3=e-stopped)
    113: Last fault code (0=none, 1=vibration, 2=temp, 3=pressure, 4=clamp_fail)
    114: Servo Power press count (total since startup)
    115: E-stop activation count (total since startup)
    116: Current uptime in seconds (since last Servo Power ON, 0 when off)
    117: Last E-stop duration in seconds
"""

import logging
import threading
from typing import Any, Dict, Optional

from pymodbus.datastore import (
    ModbusDeviceContext,
    ModbusSequentialDataBlock,
    ModbusServerContext,
)
from pymodbus.server import StartTcpServer

logger = logging.getLogger(__name__)

# Register map constants — human-readable names for the 25-pin cable
# Indices into the holding register block (0-based)
PIN_SERVO_POWER_ON = 0        # Pin 1
PIN_SERVO_DISABLE = 1          # Pin 2
PIN_PLATE_CYCLE = 2            # Pin 3 — Start/Plate Cycle
PIN_ABORT_STOW = 3             # Pin 4
PIN_SPEED = 4                  # Pin 5
PIN_GRIPPER_LOCK = 5           # Pin 6
PIN_CLEAR_POSITION = 6         # Pin 7
PIN_BELT_FORWARD = 7           # Pin 8
PIN_BELT_REVERSE = 8           # Pin 9

PIN_SERVO_POWER_LAMP = 9       # Pin 10
PIN_SERVO_DISABLE_LAMP = 10    # Pin 11
PIN_PLATE_CYCLE_LAMP = 11      # Pin 12
PIN_ABORT_STOW_LAMP = 12       # Pin 13
PIN_SPEED_LAMP = 13            # Pin 14
PIN_GRIPPER_LOCK_LAMP = 14     # Pin 15
PIN_CLEAR_POSITION_LAMP = 15   # Pin 16
PIN_BELT_FORWARD_LAMP = 16     # Pin 17
PIN_BELT_REVERSE_LAMP = 17     # Pin 18

PIN_EMAG_STATUS = 18           # Pin 19 — E-Mag Status / E-Mag OFF
PIN_MAG_ON = 19                # Pin 20
PIN_MAG_PART_DETECT = 20       # Pin 21
PIN_EMAG_MALFUNCTION = 21      # Pin 22
PIN_POE_SYSTEM = 22            # Pin 23
PIN_ESTOP_ENABLE = 23          # Pin 24
PIN_ESTOP_OFF = 24             # Pin 25

# Sensor data register offsets (actual register address = SENSOR_BASE + offset)
SENSOR_BASE = 100
REG_ACCEL_X = 0
REG_ACCEL_Y = 1
REG_ACCEL_Z = 2
REG_GYRO_X = 3
REG_GYRO_Y = 4
REG_GYRO_Z = 5
REG_TEMPERATURE = 6
REG_HUMIDITY = 7
REG_PRESSURE = 8
REG_SERVO1_POS = 9
REG_SERVO2_POS = 10
REG_CYCLE_COUNT = 11
REG_SYSTEM_STATE = 12
REG_FAULT_CODE = 13
REG_SERVO_PRESS_COUNT = 14     # register 114
REG_ESTOP_COUNT = 15           # register 115
REG_UPTIME = 16                # register 116
REG_ESTOP_DURATION = 17        # register 117

# System states
STATE_IDLE = 0
STATE_RUNNING = 1
STATE_FAULT = 2
STATE_ESTOPPED = 3

# Fault codes
FAULT_NONE = 0
FAULT_VIBRATION = 1
FAULT_TEMPERATURE = 2
FAULT_PRESSURE = 3
FAULT_CLAMP_FAIL = 4

# Total register space: 0-24 for E-Cat + gap + 100-117 for sensors = address range 0..117
# pymodbus 3.x needs count+1 to make the last address readable
_REGISTER_COUNT = 119


def _float_to_int16(value: float, scale: float = 100.0) -> int:
    """Convert a float to a signed int16 representation for Modbus registers.

    The value is multiplied by scale and clamped to int16 range.
    The remote reader divides by the same scale to recover the float.
    """
    scaled = int(round(value * scale))
    # Clamp to int16 range
    scaled = max(-32768, min(32767, scaled))
    # Modbus holding registers are unsigned 16-bit; encode signed as unsigned
    if scaled < 0:
        scaled += 65536
    return scaled


class PLCModbusServer:
    """Modbus TCP server that exposes the PLC simulator's registers.

    The register block is shared between the Modbus server thread and
    the main application. The application writes sensor values and state
    into the registers; remote Modbus clients read them.
    """

    def __init__(self, config: Dict[str, Any]):
        self._host = config["modbus"]["host"]
        self._port = config["modbus"]["port"]

        # Create a data block large enough for all registers (0 through 113)
        initial_values = [0] * _REGISTER_COUNT
        self._store = ModbusDeviceContext(
            hr=ModbusSequentialDataBlock(0, initial_values),
            ir=ModbusSequentialDataBlock(0, [0] * _REGISTER_COUNT),
            di=ModbusSequentialDataBlock(0, [0] * 32),
            co=ModbusSequentialDataBlock(0, [0] * 32),
        )
        self._context = ModbusServerContext(devices=self._store, single=True)
        self._server_thread: Optional[threading.Thread] = None
        self._server = None

        # Set initial system state
        self.write_register(SENSOR_BASE + REG_SYSTEM_STATE, STATE_IDLE)
        # Servo disabled by default (awaiting servo power button press)
        self.write_register(PIN_SERVO_DISABLE, 1)
        # POE system ON by default
        self.write_register(PIN_POE_SYSTEM, 1)

        logger.info("Modbus server configured on %s:%d", self._host, self._port)

    def write_register(self, address: int, value: int) -> None:
        """Write a single value to a holding register."""
        self._store.setValues(3, address, [value])

    def read_register(self, address: int) -> int:
        """Read a single holding register value."""
        result = self._store.getValues(3, address, 1)
        return result[0]

    def write_coil(self, address: int, value: bool) -> None:
        """Write a single coil (discrete output)."""
        self._store.setValues(1, address, [value])

    def read_coil(self, address: int) -> bool:
        """Read a single coil value."""
        result = self._store.getValues(1, address, 1)
        return bool(result[0])

    def write_sensor_data(
        self,
        accel: Dict[str, float],
        gyro: Dict[str, float],
        temperature_f: float,
        humidity_pct: float,
        pressure: int,
        servo1_pos: float,
        servo2_pos: float,
        cycle_count: int,
        system_state: int,
        fault_code: int,
    ) -> None:
        """Bulk write all sensor values to the register block."""
        base = SENSOR_BASE
        self.write_register(base + REG_ACCEL_X, _float_to_int16(accel.get("accel_x", 0)))
        self.write_register(base + REG_ACCEL_Y, _float_to_int16(accel.get("accel_y", 0)))
        self.write_register(base + REG_ACCEL_Z, _float_to_int16(accel.get("accel_z", 0)))
        self.write_register(base + REG_GYRO_X, _float_to_int16(gyro.get("gyro_x", 0)))
        self.write_register(base + REG_GYRO_Y, _float_to_int16(gyro.get("gyro_y", 0)))
        self.write_register(base + REG_GYRO_Z, _float_to_int16(gyro.get("gyro_z", 0)))
        self.write_register(base + REG_TEMPERATURE, _float_to_int16(temperature_f, 10.0))
        self.write_register(base + REG_HUMIDITY, _float_to_int16(humidity_pct, 10.0))
        self.write_register(base + REG_PRESSURE, pressure)
        self.write_register(base + REG_SERVO1_POS, int(round(servo1_pos)))
        self.write_register(base + REG_SERVO2_POS, int(round(servo2_pos)))
        self.write_register(base + REG_CYCLE_COUNT, cycle_count)
        self.write_register(base + REG_SYSTEM_STATE, system_state)
        self.write_register(base + REG_FAULT_CODE, fault_code)

    def update_lamp_registers(self, system_state: int) -> None:
        """Update status lamp registers to mirror the current command registers.

        In the real system, the PLC illuminates lamps based on active commands.
        We simulate this by echoing command register states to lamp registers.
        """
        for cmd_reg, lamp_reg in [
            (PIN_SERVO_POWER_ON, PIN_SERVO_POWER_LAMP),
            (PIN_SERVO_DISABLE, PIN_SERVO_DISABLE_LAMP),
            (PIN_PLATE_CYCLE, PIN_PLATE_CYCLE_LAMP),
            (PIN_ABORT_STOW, PIN_ABORT_STOW_LAMP),
            (PIN_SPEED, PIN_SPEED_LAMP),
            (PIN_GRIPPER_LOCK, PIN_GRIPPER_LOCK_LAMP),
            (PIN_CLEAR_POSITION, PIN_CLEAR_POSITION_LAMP),
            (PIN_BELT_FORWARD, PIN_BELT_FORWARD_LAMP),
            (PIN_BELT_REVERSE, PIN_BELT_REVERSE_LAMP),
        ]:
            self.write_register(lamp_reg, self.read_register(cmd_reg))

    def start(self) -> None:
        """Start the Modbus TCP server in a daemon thread."""
        def run_server():
            logger.info("Modbus TCP server starting on %s:%d", self._host, self._port)
            StartTcpServer(
                context=self._context,
                address=(self._host, self._port),
            )

        self._server_thread = threading.Thread(target=run_server, daemon=True)
        self._server_thread.start()
        logger.info("Modbus server thread started")

    def stop(self) -> None:
        """Stop the Modbus server (daemon thread exits with process)."""
        logger.info("Modbus server stopping")
