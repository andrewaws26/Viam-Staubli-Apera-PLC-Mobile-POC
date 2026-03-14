#!/usr/bin/env python3
"""
Apera AI Vision Health Sensor Module for Viam.

Performs basic health checks against the vision system server:
  1. ICMP ping to verify network reachability.
  2. TCP port probe to verify the vision software is listening.

This module is functional without access to the actual Apera hardware —
it only needs an IP address and port number to check. It does NOT access
camera feeds, image data, or vision results (see architecture doc section 6).
"""

import asyncio
import subprocess
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

DEFAULT_HOST = "8.8.8.8"
DEFAULT_PORT = 53
PING_TIMEOUT_S = 2
TCP_TIMEOUT_S = 3


class VisionHealthSensor(Sensor):
    """Checks network reachability and service availability of the vision server.

    Returns a fixed schema:
        connected (bool):       Server responds to ICMP ping.
        process_running (bool): Vision software TCP port is accepting connections.
    """

    MODEL: ClassVar[Model] = Model(
        ModelFamily("viam-staubli-apera-poc", "monitor"),
        "vision-health-sensor",
    )

    def __init__(self, name: str, *, host: str, port: int):
        super().__init__(name)
        self.host = host
        self.port = port

    @classmethod
    def new(
        cls,
        config: ComponentConfig,
        dependencies: Mapping[ResourceName, ResourceBase],
    ) -> Self:
        sensor = cls(config.name, host=DEFAULT_HOST, port=DEFAULT_PORT)
        sensor.reconfigure(config, dependencies)
        return sensor

    @classmethod
    def validate_config(cls, config: ComponentConfig) -> Sequence[str]:
        fields = config.attributes.fields
        if "host" not in fields or not fields["host"].string_value:
            raise ValueError("'host' attribute is required (vision server IP address)")
        return []

    def reconfigure(
        self,
        config: ComponentConfig,
        dependencies: Mapping[ResourceName, ResourceBase],
    ):
        fields = config.attributes.fields
        self.host = fields["host"].string_value if "host" in fields else DEFAULT_HOST
        port_field = fields.get("port")
        self.port = int(port_field.number_value) if port_field else DEFAULT_PORT
        LOGGER.info(
            "VisionHealthSensor configured: host=%s port=%d",
            self.host, self.port,
        )

    async def _ping(self) -> bool:
        """ICMP ping the vision server. Returns True if reachable."""
        try:
            proc = await asyncio.create_subprocess_exec(
                "ping", "-c", "1", "-W", str(PING_TIMEOUT_S), self.host,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            returncode = await proc.wait()
            return returncode == 0
        except OSError:
            LOGGER.warning("ping command not available on this system")
            return False

    async def _tcp_probe(self) -> bool:
        """Attempt a TCP connection to the vision software port."""
        try:
            _, writer = await asyncio.wait_for(
                asyncio.open_connection(self.host, self.port),
                timeout=TCP_TIMEOUT_S,
            )
            writer.close()
            await writer.wait_closed()
            return True
        except (OSError, asyncio.TimeoutError):
            return False

    async def get_readings(
        self,
        extra: Optional[Dict[str, Any]] = None,
        **kwargs,
    ) -> Mapping[str, SensorReading]:
        """Return current vision server health.

        Schema (fixed — see architecture doc section 6 on privacy by design):
            connected (bool):       Server responds to ICMP ping
            process_running (bool): Vision software TCP port accepts connections

        This sensor intentionally does NOT read image data, detection results,
        or any other vision pipeline output.
        """
        connected, process_running = await asyncio.gather(
            self._ping(),
            self._tcp_probe(),
        )

        if not connected:
            LOGGER.warning("Vision server %s is not reachable via ping", self.host)
        if not process_running:
            LOGGER.warning(
                "Vision server %s:%d is not accepting TCP connections",
                self.host, self.port,
            )

        return {
            "connected": connected,
            "process_running": process_running,
        }

    async def close(self):
        LOGGER.info("%s is closing.", self.name)


async def main():
    Registry.register_resource_creator(
        Sensor.API,
        VisionHealthSensor.MODEL,
        ResourceCreatorRegistration(VisionHealthSensor.new, VisionHealthSensor.validate_config),
    )
    module = Module.from_args()
    module.add_model_from_registry(Sensor.API, VisionHealthSensor.MODEL)
    await module.start()


if __name__ == "__main__":
    asyncio.run(main())
