"""
PLC Modbus Sensor Module for Viam.

Reads the RAIV truck's PLC state via Modbus TCP and returns structured
sensor readings for remote monitoring. In the POC, the "PLC" is a Pi Zero W
running the plc-simulator with the same Modbus register map as the real
Click PLC on the truck.

Register map (see plc-simulator/README.md for full documentation):
  Registers 0-8:    Command signals (Servo Power, Plate Cycle, etc.)
  Registers 9-17:   Status lamps (feedback from PLC)
  Registers 18-24:  System state (E-Mag, POE, E-stop)
  Registers 100-113: Sensor data (accel, gyro, temp, humidity, servos, state)
"""

import asyncio
from typing import Any, ClassVar, Dict, List, Mapping, Optional, Sequence

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

# State and fault code lookups (must match plc-simulator/src/modbus_server.py)
_STATE_NAMES = {0: "idle", 1: "running", 2: "fault", 3: "e-stopped"}
_FAULT_NAMES = {0: "none", 1: "vibration", 2: "temperature", 3: "pressure", 4: "clamp_fail"}


def _int16_to_float(value: int, scale: float = 100.0) -> float:
    """Convert an unsigned Modbus register value back to a signed float.

    The plc-simulator encodes signed floats as unsigned int16:
      positive: stored directly (e.g., 981 = 9.81)
      negative: stored as 65536 + value (e.g., 65531 = -0.05)
    """
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

    def __init__(self, name: str, *, host: str, port: int):
        super().__init__(name)
        self.host = host
        self.port = port
        self.client: Optional[ModbusTcpClient] = None

    @classmethod
    def new(
        cls,
        config: ComponentConfig,
        dependencies: Mapping[ResourceName, ResourceBase],
    ) -> Self:
        sensor = cls(
            config.name,
            host=config.attributes.fields["host"].string_value or "192.168.1.100",
            port=int(config.attributes.fields["port"].number_value or 502),
        )
        LOGGER.info(
            "PlcSensor configured: host=%s port=%d",
            sensor.host, sensor.port,
        )
        return sensor

    @classmethod
    def validate_config(cls, config: ComponentConfig) -> Sequence[str]:
        """Validate that required attributes are present."""
        fields = config.attributes.fields
        if "host" not in fields or not fields["host"].string_value:
            raise ValueError("'host' attribute is required (PLC IP address)")
        return []

    def _ensure_connected(self) -> bool:
        """Connect to the PLC if not already connected. Returns True on success."""
        if self.client is not None and self.client.connected:
            return True

        try:
            self.client = ModbusTcpClient(self.host, port=self.port, timeout=3)
            connected = self.client.connect()
            if connected:
                LOGGER.info("Connected to PLC at %s:%d", self.host, self.port)
            else:
                LOGGER.warning("Failed to connect to PLC at %s:%d", self.host, self.port)
            return connected
        except Exception as e:
            LOGGER.error("Connection error to PLC at %s:%d: %s", self.host, self.port, e)
            return False

    async def get_readings(
        self,
        extra: Optional[Dict[str, Any]] = None,
        **kwargs,
    ) -> Mapping[str, SensorReading]:
        """Return current PLC state as structured sensor readings.

        Reads all Modbus registers and returns human-readable keys matching
        the 25-pin E-Cat cable labels plus sensor data.
        """
        connected = self._ensure_connected()

        if not connected:
            return {
                "connected": False,
                "fault": True,
                "system_state": "disconnected",
                "last_fault": "connection_failed",
            }

        try:
            # Read E-Cat cable registers (0-24)
            ecat_result = self.client.read_holding_registers(0, 25)
            if ecat_result.isError():
                LOGGER.warning("Error reading E-Cat registers: %s", ecat_result)
                return {"connected": False, "fault": True, "system_state": "read_error"}

            ecat = ecat_result.registers

            # Read sensor data registers (100-113)
            sensor_result = self.client.read_holding_registers(100, 14)
            if sensor_result.isError():
                LOGGER.warning("Error reading sensor registers: %s", sensor_result)
                return {"connected": False, "fault": True, "system_state": "read_error"}

            sensor = sensor_result.registers

            # Build the readings dict with human-readable keys
            system_state_code = sensor[12]
            fault_code = sensor[13]

            return {
                # Connection status
                "connected": True,
                "fault": system_state_code == 2,  # STATE_FAULT

                # E-Cat cable command signals (Pins 1-9)
                "servo_power_on": bool(ecat[0]),
                "servo_disable": bool(ecat[1]),
                "plate_cycle_active": bool(ecat[2]),
                "abort_stow": bool(ecat[3]),
                "speed_signal": bool(ecat[4]),
                "gripper_lock": bool(ecat[5]),
                "clear_position": bool(ecat[6]),
                "belt_forward": bool(ecat[7]),
                "belt_reverse": bool(ecat[8]),

                # E-Cat cable status lamps (Pins 10-18)
                "servo_power_lamp": bool(ecat[9]),
                "servo_disable_lamp": bool(ecat[10]),
                "plate_cycle_lamp": bool(ecat[11]),
                "abort_stow_lamp": bool(ecat[12]),
                "speed_lamp": bool(ecat[13]),
                "gripper_lock_lamp": bool(ecat[14]),
                "clear_position_lamp": bool(ecat[15]),
                "belt_forward_lamp": bool(ecat[16]),
                "belt_reverse_lamp": bool(ecat[17]),

                # E-Cat cable system state (Pins 19-25)
                "emag_status": bool(ecat[18]),
                "mag_on": bool(ecat[19]),
                "mag_part_detect": bool(ecat[20]),
                "emag_malfunction": bool(ecat[21]),
                "poe_system": bool(ecat[22]),
                "estop_enable": bool(ecat[23]),
                "estop_off": bool(ecat[24]),

                # Sensor data
                "vibration_x": _int16_to_float(sensor[0]),
                "vibration_y": _int16_to_float(sensor[1]),
                "vibration_z": _int16_to_float(sensor[2]),
                "gyro_x": _int16_to_float(sensor[3]),
                "gyro_y": _int16_to_float(sensor[4]),
                "gyro_z": _int16_to_float(sensor[5]),
                "temperature_f": round(sensor[6] / 10.0, 1),
                "humidity_pct": round(sensor[7] / 10.0, 1),
                "pressure_simulated": sensor[8],
                "servo1_position": sensor[9],
                "servo2_position": sensor[10],
                "cycle_count": sensor[11],
                "system_state": _STATE_NAMES.get(system_state_code, f"unknown({system_state_code})"),
                "last_fault": _FAULT_NAMES.get(fault_code, f"unknown({fault_code})"),
            }

        except Exception as e:
            LOGGER.error("Error reading PLC registers: %s", e)
            self.client = None  # Force reconnect on next call
            return {
                "connected": False,
                "fault": True,
                "system_state": "error",
                "last_fault": str(e),
            }

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
