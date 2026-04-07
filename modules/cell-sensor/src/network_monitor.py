"""
Cell network device monitor.

Pings known devices on the cell network and reports reachability + latency.
Monitors internet uplink health (latency, jitter, packet loss, DNS, route).
Uses async subprocess ping (no raw sockets, no root required).
"""

import asyncio
import logging
import time
from dataclasses import dataclass, field
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


@dataclass
class InternetHealth:
    """Internet uplink health metrics from the cellular router."""
    reachable: bool = False
    latency_ms: float = 0.0
    jitter_ms: float = 0.0
    packet_loss_pct: float = 100.0
    dns_ok: bool = False
    dns_resolve_ms: float = 0.0
    viam_reachable: bool = False
    viam_latency_ms: float = 0.0
    gateway_ip: str = ""
    interface: str = ""
    link_speed_mbps: int = 0
    rx_bytes: int = 0
    tx_bytes: int = 0
    rx_errors: int = 0
    tx_errors: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {f"inet_{k}": v for k, v in self.__dict__.items()}


async def _ping_multi(ip: str, count: int = 5, timeout: float = 10.0) -> tuple[float, float, float]:
    """Ping with multiple packets, return (avg_ms, jitter_ms, loss_pct)."""
    try:
        proc = await asyncio.create_subprocess_exec(
            "ping", "-c", str(count), "-W", "2", ip,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        output = stdout.decode()

        # Parse loss: "3 packets transmitted, 3 received, 0% packet loss"
        loss = 100.0
        for line in output.splitlines():
            if "packet loss" in line:
                for part in line.split(","):
                    part = part.strip()
                    if "%" in part and "loss" in part:
                        loss = float(part.split("%")[0].strip().split()[-1])
                        break

        # Parse rtt: "rtt min/avg/max/mdev = 43.367/94.089/178.716/60.232 ms"
        avg_ms = 0.0
        jitter_ms = 0.0
        for line in output.splitlines():
            if "min/avg/max" in line:
                vals = line.split("=")[1].strip().split("/")
                if len(vals) >= 4:
                    avg_ms = float(vals[1])
                    jitter_ms = float(vals[3].split()[0])
                break

        return avg_ms, jitter_ms, loss
    except Exception as e:
        logger.debug("Multi-ping %s failed: %s", ip, e)
        return 0.0, 0.0, 100.0


async def _check_dns(hostname: str = "app.viam.com", timeout: float = 5.0) -> tuple[bool, float]:
    """Resolve a hostname and return (success, resolve_time_ms)."""
    try:
        loop = asyncio.get_event_loop()
        t0 = time.monotonic()
        await asyncio.wait_for(
            loop.getaddrinfo(hostname, 443),
            timeout=timeout,
        )
        return True, (time.monotonic() - t0) * 1000
    except Exception as e:
        logger.debug("DNS resolve %s failed: %s", hostname, e)
        return False, 0.0


async def _check_viam_cloud(timeout: float = 10.0) -> tuple[bool, float]:
    """TCP connect to Viam Cloud to verify full path works."""
    try:
        t0 = time.monotonic()
        _, writer = await asyncio.wait_for(
            asyncio.open_connection("app.viam.com", 443),
            timeout=timeout,
        )
        latency = (time.monotonic() - t0) * 1000
        writer.close()
        await writer.wait_closed()
        return True, latency
    except Exception as e:
        logger.debug("Viam Cloud connect failed: %s", e)
        return False, 0.0


def _read_interface_stats(iface: str = "eth0") -> dict[str, Any]:
    """Read interface stats from /proc/net/dev and /sys/class/net/."""
    stats: dict[str, Any] = {"interface": iface}
    try:
        with open("/proc/net/dev") as f:
            for line in f:
                if iface in line:
                    parts = line.split()
                    # Format: iface: rx_bytes rx_packets rx_errs ... tx_bytes tx_packets tx_errs ...
                    stats["rx_bytes"] = int(parts[1])
                    stats["rx_errors"] = int(parts[3])
                    stats["tx_bytes"] = int(parts[9])
                    stats["tx_errors"] = int(parts[11])
                    break
    except Exception:
        pass
    try:
        with open(f"/sys/class/net/{iface}/speed") as f:
            stats["link_speed_mbps"] = int(f.read().strip())
    except Exception:
        stats["link_speed_mbps"] = 0
    return stats


async def _get_default_gateway() -> tuple[str, str]:
    """Read default gateway IP and interface from ip route."""
    try:
        proc = await asyncio.create_subprocess_exec(
            "ip", "route", "show", "default",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        stdout, _ = await proc.communicate()
        # "default via 192.168.0.1 dev eth0 ..."
        parts = stdout.decode().split()
        gw_ip = parts[2] if len(parts) > 2 else ""
        iface = parts[4] if len(parts) > 4 else ""
        return gw_ip, iface
    except Exception:
        return "", ""


async def check_internet_health() -> InternetHealth:
    """Run all internet health checks concurrently."""
    health = InternetHealth()

    # Get gateway and interface first
    gw_ip, iface = await _get_default_gateway()
    health.gateway_ip = gw_ip
    health.interface = iface

    # Read interface stats (sync, fast)
    if iface:
        stats = _read_interface_stats(iface)
        health.link_speed_mbps = stats.get("link_speed_mbps", 0)
        health.rx_bytes = stats.get("rx_bytes", 0)
        health.tx_bytes = stats.get("tx_bytes", 0)
        health.rx_errors = stats.get("rx_errors", 0)
        health.tx_errors = stats.get("tx_errors", 0)

    # Run ping, DNS, and Viam check concurrently
    ping_task = _ping_multi("8.8.8.8", count=5)
    dns_task = _check_dns()
    viam_task = _check_viam_cloud()

    (avg_ms, jitter_ms, loss_pct), (dns_ok, dns_ms), (viam_ok, viam_ms) = (
        await asyncio.gather(ping_task, dns_task, viam_task)
    )

    health.reachable = loss_pct < 100.0
    health.latency_ms = round(avg_ms, 1)
    health.jitter_ms = round(jitter_ms, 1)
    health.packet_loss_pct = round(loss_pct, 1)
    health.dns_ok = dns_ok
    health.dns_resolve_ms = round(dns_ms, 1)
    health.viam_reachable = viam_ok
    health.viam_latency_ms = round(viam_ms, 1)

    logger.info(
        "Internet health: reachable=%s latency=%.0fms jitter=%.0fms loss=%.0f%% dns=%s viam=%s gw=%s via %s",
        health.reachable, health.latency_ms, health.jitter_ms,
        health.packet_loss_pct, health.dns_ok, health.viam_reachable,
        health.gateway_ip, health.interface,
    )
    return health


@dataclass
class SwitchVpnHealth:
    """Stridelinx VPN router and switch health."""
    # Switch (inferred from eth0 link state + device reachability spread)
    eth0_up: bool = False
    eth0_speed_mbps: int = 0
    eth0_duplex: str = ""
    devices_on_switch: int = 0  # how many cell devices respond

    # Stridelinx VPN gateway
    vpn_reachable: bool = False
    vpn_latency_ms: float = 0.0
    vpn_is_gateway: bool = False  # is it the default route?
    vpn_web_ok: bool = False  # responds on HTTP (management UI)
    vpn_ip: str = "192.168.0.1"

    def to_dict(self) -> dict[str, Any]:
        return {f"switch_{k}" if not k.startswith("vpn") else k: v
                for k, v in self.__dict__.items()}


def _read_eth0_link() -> tuple[bool, int, str]:
    """Read eth0 carrier, speed, duplex from sysfs."""
    up = False
    speed = 0
    duplex = ""
    try:
        with open("/sys/class/net/eth0/carrier") as f:
            up = f.read().strip() == "1"
    except Exception:
        pass
    try:
        with open("/sys/class/net/eth0/speed") as f:
            speed = int(f.read().strip())
    except Exception:
        pass
    try:
        with open("/sys/class/net/eth0/duplex") as f:
            duplex = f.read().strip()
    except Exception:
        pass
    return up, speed, duplex


async def _check_vpn_web(ip: str = "192.168.0.1", timeout: float = 3.0) -> bool:
    """Check if Stridelinx management web UI responds."""
    try:
        proc = await asyncio.create_subprocess_exec(
            "curl", "-s", "-o", "/dev/null", "-w", "%{http_code}",
            "--max-time", str(int(timeout)),
            f"http://{ip}/",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout + 1)
        code = stdout.decode().strip()
        return code != "000" and code != ""
    except Exception:
        return False


async def check_switch_vpn(
    vpn_ip: str = "192.168.0.1",
    device_results: list[DeviceStatus] | None = None,
) -> SwitchVpnHealth:
    """Check switch and VPN gateway health."""
    health = SwitchVpnHealth(vpn_ip=vpn_ip)

    # Eth0 link state
    health.eth0_up, health.eth0_speed_mbps, health.eth0_duplex = _read_eth0_link()

    # Count reachable devices on switch (from last network scan)
    if device_results:
        health.devices_on_switch = sum(1 for d in device_results if d.reachable)

    # Check if VPN is the default gateway
    gw_ip, _ = await _get_default_gateway()
    health.vpn_is_gateway = (gw_ip == vpn_ip)

    # Ping VPN + check web UI concurrently
    ping_task = ping_host(vpn_ip, timeout=2.0)
    web_task = _check_vpn_web(vpn_ip)

    (vpn_reach, vpn_lat), vpn_web = await asyncio.gather(ping_task, web_task)
    health.vpn_reachable = vpn_reach
    health.vpn_latency_ms = round(vpn_lat, 1)
    health.vpn_web_ok = vpn_web

    logger.info(
        "Switch/VPN: eth0=%s/%dMbps/%s devices=%d vpn=%s/%.0fms web=%s gw=%s",
        health.eth0_up, health.eth0_speed_mbps, health.eth0_duplex,
        health.devices_on_switch, health.vpn_reachable, health.vpn_latency_ms,
        health.vpn_web_ok, health.vpn_is_gateway,
    )
    return health
