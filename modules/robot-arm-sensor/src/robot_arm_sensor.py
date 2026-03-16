"""
Stäubli CS9 Robot Arm Sensor Module for Viam.

INCOMPLETE — scaffold only. Pending hardware protocol details from the
hardware integration lead. See docs/architecture.md section 8 for the
list of assumptions that must be validated before this module can be
completed.

Two implementation paths are possible (see architecture doc section 3):
  Option A: VAL3 TCP socket server on the CS9 pushes JSON status.
  Option B: Read Modbus TCP registers from the CS9's built-in server.

The choice depends on answers to assumptions #1 and #2.
"""

import asyncio
from typing import Any, ClassVar, Dict, Mapping, Optional, Sequence

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


class RobotArmSensor(Sensor):
    """Monitors Stäubli CS9 robot arm state.

    Returns a fixed schema:
        connected (bool):  Whether the CS9 controller is reachable.
        mode (str):        Operating mode — "auto", "manual", or "teach".
        fault (bool):      Whether the controller is reporting a fault.
        fault_code (int):  Numeric fault code (0 = no fault).
    """

    MODEL: ClassVar[Model] = Model(
        ModelFamily("viam-staubli-apera-poc", "monitor"),
        "robot-arm-sensor",
    )

    def __init__(self, name: str, *, host: str, port: int, protocol: str):
        super().__init__(name)
        self.host = host
        self.port = port
        self.protocol = protocol  # "modbus" or "val3-socket"

    @classmethod
    def new(
        cls,
        config: ComponentConfig,
        dependencies: Mapping[ResourceName, ResourceBase],
    ) -> Self:
        fields = config.attributes.fields
        sensor = cls(
            config.name,
            host=fields["host"].string_value or "raiv-cs9.local",
            port=int(fields["port"].number_value or 502),
            protocol=fields["protocol"].string_value or "modbus",
        )
        LOGGER.info(
            "RobotArmSensor configured: host=%s port=%d protocol=%s",
            sensor.host, sensor.port, sensor.protocol,
        )
        return sensor

    @classmethod
    def validate_config(cls, config: ComponentConfig) -> Sequence[str]:
        fields = config.attributes.fields
        if "host" not in fields or not fields["host"].string_value:
            raise ValueError("'host' attribute is required (CS9 controller IP address)")
        protocol = fields.get("protocol")
        if protocol and protocol.string_value not in ("modbus", "val3-socket"):
            raise ValueError("'protocol' must be 'modbus' or 'val3-socket'")
        return []

    async def get_readings(
        self,
        extra: Optional[Dict[str, Any]] = None,
        **kwargs,
    ) -> Mapping[str, SensorReading]:
        """Return current robot arm state.

        Schema (fixed — see architecture doc section 6 on privacy by design):
            connected (bool):  CS9 controller reachable
            mode (str):        Operating mode
            fault (bool):      Controller reporting a fault
            fault_code (int):  Numeric fault code
        """
        # ---------------------------------------------------------------
        # TODO: Implement real hardware communication.
        #
        # OPTION A — VAL3 TCP Socket:
        #   Connect to CS9 VAL3 socket server, read JSON status blob.
        #   Requires: hardware lead to deploy VAL3 program on CS9.
        #
        #   async with asyncio.open_connection(self.host, self.port) as (r, w):
        #       data = await r.readline()
        #       status = json.loads(data)
        #       return {
        #           "connected": True,
        #           "mode": status["mode"],
        #           "fault": status["fault"],
        #           "fault_code": status["fault_code"],
        #       }
        #
        # OPTION B — Modbus TCP:
        #   Read status registers from CS9's built-in Modbus server.
        #   Requires: confirmation that Modbus TCP is enabled on CS9,
        #   plus the register map from hardware lead.
        #
        #   client = ModbusTcpClient(self.host, port=self.port)
        #   if client.connect():
        #       result = client.read_holding_registers(REGISTER_ADDR, count=N)
        #       # Parse registers into mode, fault, fault_code
        #       client.close()
        # ---------------------------------------------------------------

        # Placeholder: simulate a healthy, connected robot in auto mode
        LOGGER.debug("RobotArmSensor returning placeholder readings")
        return {
            "connected": True,
            "mode": "auto",
            "fault": False,
            "fault_code": 0,
        }

    async def close(self):
        LOGGER.info("%s is closing.", self.name)


async def main():
    Registry.register_resource_creator(
        Sensor.API,
        RobotArmSensor.MODEL,
        ResourceCreatorRegistration(RobotArmSensor.new, RobotArmSensor.validate_config),
    )
    module = Module.from_args()
    module.add_model_from_registry(Sensor.API, RobotArmSensor.MODEL)
    await module.start()


if __name__ == "__main__":
    asyncio.run(main())
