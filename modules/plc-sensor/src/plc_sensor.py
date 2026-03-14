"""
PLC Modbus Sensor Module for Viam.

Phase 1 priority module. Reads digital I/O states from a PLC via Modbus TCP
and returns a simple status struct for remote monitoring.

Currently uses placeholder values. Replace with real pymodbus calls once
the PLC brand/model and Modbus register map are confirmed by the hardware
integration lead.
"""

import asyncio
from typing import Any, ClassVar, Dict, List, Mapping, Optional, Sequence

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

# TODO: Replace with real pymodbus client once hardware details are confirmed.
# from pymodbus.client import ModbusTcpClient


class PlcSensor(Sensor):
    """Reads PLC digital I/O state via Modbus TCP.

    Returns a fixed schema:
        connected (bool):    Whether the PLC is reachable over Modbus TCP.
        fault (bool):        Whether a communication fault bit is set.
        button_state (bool): State of the operator button on the junction box.
    """

    MODEL: ClassVar[Model] = Model(
        ModelFamily("viam-staubli-apera-poc", "monitor"),
        "plc-sensor",
    )

    def __init__(self, name: str, *, host: str, port: int, button_coil: int, fault_coil: int):
        super().__init__(name)
        self.host = host
        self.port = port
        self.button_coil = button_coil
        self.fault_coil = fault_coil
        # self.client: Optional[ModbusTcpClient] = None

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
            button_coil=int(config.attributes.fields["button_coil"].number_value or 0),
            fault_coil=int(config.attributes.fields["fault_coil"].number_value or 1),
        )
        LOGGER.info(
            "PlcSensor configured: host=%s port=%d button_coil=%d fault_coil=%d",
            sensor.host, sensor.port, sensor.button_coil, sensor.fault_coil,
        )
        return sensor

    @classmethod
    def validate_config(cls, config: ComponentConfig) -> Sequence[str]:
        """Validate that required attributes are present."""
        fields = config.attributes.fields
        if "host" not in fields or not fields["host"].string_value:
            raise ValueError("'host' attribute is required (PLC IP address)")
        return []

    async def get_readings(
        self,
        extra: Optional[Dict[str, Any]] = None,
        **kwargs,
    ) -> Mapping[str, SensorReading]:
        """Return current PLC state.

        Schema (fixed — see architecture doc section 6 on privacy by design):
            connected (bool):    PLC reachable over Modbus TCP
            fault (bool):        Communication fault bit set
            button_state (bool): Operator button state from junction box
        """
        # ---------------------------------------------------------------
        # TODO: Replace placeholder logic with real Modbus TCP reads.
        #
        # Real implementation will look roughly like:
        #
        #   if self.client is None or not self.client.connected:
        #       self.client = ModbusTcpClient(self.host, port=self.port)
        #       connected = self.client.connect()
        #   else:
        #       connected = True
        #
        #   if connected:
        #       coils = self.client.read_coils(self.button_coil, count=2)
        #       button_state = coils.bits[0]
        #       fault = coils.bits[1]
        #   else:
        #       button_state = False
        #       fault = True
        # ---------------------------------------------------------------

        # Placeholder: simulate a healthy, connected PLC
        connected = True
        fault = False
        button_state = False

        return {
            "connected": connected,
            "fault": fault,
            "button_state": button_state,
        }

    async def close(self):
        LOGGER.info("%s is closing.", self.name)
        # if self.client is not None:
        #     self.client.close()


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
