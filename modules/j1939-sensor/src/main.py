"""
IronSight J1939 Truck Sensor — Viam module entry point.

Registers the J1939TruckSensor model and starts the module server.
"""

import asyncio

from viam.components.sensor import Sensor
from viam.module.module import Module
from viam.resource.registry import Registry, ResourceCreatorRegistration

from .models.j1939_sensor import J1939TruckSensor


async def main():
    Registry.register_resource_creator(
        Sensor.API,
        J1939TruckSensor.MODEL,
        ResourceCreatorRegistration(
            J1939TruckSensor.new,
            J1939TruckSensor.validate_config,
        ),
    )
    module = Module.from_args()
    module.add_model_from_registry(Sensor.API, J1939TruckSensor.MODEL)
    await module.start()


if __name__ == "__main__":
    asyncio.run(main())
