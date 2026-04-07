"""
Cell network device monitor.

Pings known devices on the cell network and reports reachability + latency.
Uses async subprocess ping (no raw sockets, no root required).
"""

import asyncio
import logging
import time
from dataclasses import dataclass
from typing import Any

logger = logging.getLogger("cell-sensor.network")

# Known cell network devices (from topology dump)
DEFAULT_DEVICES = [
    ("Staubli CS9", "192.168.0.254"),
    ("Apera Vue PC", "192.168.3.151"),
    ("JTEKT PLC", "192.168.0.10"),
    ("Seedsware Panel", "192.168.0.22"),
    ("Stridelinx VPN", "192.168.0.1"),
]


@dataclass
class DeviceStatus:
    name: str
    ip: str
    reachable: bool = False
    latency_ms: float = 0.0
    last_seen: str = ""

    def to_dict(self, prefix: str = "") -> dict[str, Any]:
        p = f"{prefix}{self.name.lower().replace(' ', '_')}"
        return {
            f"{p}_ip": self.ip,
            f"{p}_reachable": self.reachable,
            f"{p}_latency_ms": self.latency_ms,
        }


async def ping_host(ip: str, timeout: float = 2.0) -> tuple[bool, float]:
    """Ping a host and return (reachable, latency_ms).

    Uses system ping command — works without root.
    """
    try:
        proc = await asyncio.create_subprocess_exec(
            "ping", "-c", "1", "-W", str(int(timeout)), ip,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout + 1)

        if proc.returncode == 0:
            # Parse latency from ping output: "time=1.23 ms"
            output = stdout.decode()
            for part in output.split():
                if part.startswith("time="):
                    try:
                        return True, float(part.split("=")[1])
                    except ValueError:
                        return True, 0.0
            return True, 0.0
        return False, 0.0

    except (asyncio.TimeoutError, Exception) as e:
        logger.debug("Ping %s failed: %s", ip, e)
        return False, 0.0


async def check_all_devices(
    devices: list[tuple[str, str]] | None = None,
) -> list[DeviceStatus]:
    """Ping all cell network devices concurrently.

    Returns list of DeviceStatus with reachability and latency.
    """
    if devices is None:
        devices = DEFAULT_DEVICES

    async def check_one(name: str, ip: str) -> DeviceStatus:
        reachable, latency = await ping_host(ip)
        status = DeviceStatus(
            name=name,
            ip=ip,
            reachable=reachable,
            latency_ms=latency,
        )
        if reachable:
            from datetime import datetime, timezone
            status.last_seen = datetime.now(timezone.utc).isoformat()
        return status

    results = await asyncio.gather(
        *[check_one(name, ip) for name, ip in devices]
    )
    return list(results)
