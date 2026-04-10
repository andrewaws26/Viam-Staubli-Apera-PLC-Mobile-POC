"""
Cell Sensor Module for Viam — Robot Cell Monitor.

Polls three data sources concurrently and returns combined readings:
  1. Staubli TX2-140 CS9 REST API  (joints, TCP, temps, safety, production)
  2. Apera Vue AI Vision socket     (pipeline state, detections, calibration)
  3. Cell network devices            (ping reachability + latency)

Plug-and-play: connect Pi 5 to the cell switch and this module auto-discovers
available devices. No manual IP configuration needed beyond Viam attributes.

All polling is READ-ONLY — never sends motion commands, pick triggers, or
configuration changes to any device.
"""

import asyncio
import logging
import time
from collections.abc import Mapping, Sequence
from typing import Any, ClassVar, Self

from apera_client import AperaClient, AperaState
from network_monitor import (
    DEFAULT_DEVICES, DeviceStatus, InternetHealth, SwitchVpnHealth,
    check_all_devices, check_internet_health, check_switch_vpn,
)
from staubli_client import StaubliClient, StaubliState
from staubli_log_scraper import StaubliLogScraper, StaubliLogState
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

# Poll intervals — how often each subsystem is queried (seconds)
_STAUBLI_INTERVAL = 2.0
_APERA_INTERVAL = 2.0
_NETWORK_INTERVAL = 30.0  # Pings are slow; don't hammer the network
_INTERNET_INTERVAL = 60.0  # Internet health check (5-ping burst + DNS + Viam TCP)
_STAUBLI_LOG_INTERVAL = 60.0  # FTP log scrape (heavy — once per minute)


class CellSensor(Sensor):
    """Combined robot cell monitor — Staubli + Apera + network.

    Returns a flat dict of all readings keyed by subsystem prefix:
      staubli_*   — robot controller state
      apera_*     — vision system state
      net_*       — cell network device reachability
      cell_*      — module-level metadata
    """

    MODEL: ClassVar[Model] = Model(
        ModelFamily("viam-staubli-apera-poc", "monitor"),
        "cell-sensor",
    )

    def __init__(
        self,
        name: str,
        *,
        staubli_host: str = "192.168.0.254",
        staubli_port: int = 80,
        apera_host: str = "192.168.3.151",
        apera_port: int = 14040,
        apera_pipeline: str = "RAIV_pick_belt_1",
        network_devices: list[tuple[str, str]] | None = None,
    ):
        super().__init__(name)
        self._staubli = StaubliClient(host=staubli_host, port=staubli_port)
        self._apera = AperaClient(
            host=apera_host, port=apera_port, pipeline=apera_pipeline
        )
        self._network_devices = network_devices or DEFAULT_DEVICES
        self._staubli_logs = StaubliLogScraper(host=staubli_host)

        # Cached state from each subsystem
        self._staubli_state = StaubliState()
        self._apera_state = AperaState()
        self._staubli_log_state = StaubliLogState()
        self._network_state: list[DeviceStatus] = []
        self._internet_health = InternetHealth()
        self._switch_vpn_health = SwitchVpnHealth()

        # Timing — stagger polls so we don't query everything every read
        self._last_staubli_poll: float = 0.0
        self._last_apera_poll: float = 0.0
        self._last_network_poll: float = 0.0
        self._last_internet_poll: float = 0.0
        self._last_staubli_log_poll: float = 0.0

        # Per-subsystem staleness — tracks when each last returned real data
        self._staubli_data_age: float = 0.0  # monotonic timestamp of last successful poll
        self._apera_data_age: float = 0.0
        self._network_data_age: float = 0.0
        self._internet_data_age: float = 0.0
        self._staubli_log_data_age: float = 0.0

        # Module stats
        self._total_reads: int = 0
        self._start_time: float = time.time()

    @classmethod
    def new(
        cls,
        config: ComponentConfig,
        dependencies: Mapping[ResourceName, ResourceBase],
    ) -> Self:
        fields = config.attributes.fields

        staubli_host = "192.168.0.254"
        if "staubli_host" in fields and fields["staubli_host"].string_value:
            staubli_host = fields["staubli_host"].string_value

        staubli_port = 80
        if "staubli_port" in fields and fields["staubli_port"].number_value:
            staubli_port = int(fields["staubli_port"].number_value)

        apera_host = "192.168.3.151"
        if "apera_host" in fields and fields["apera_host"].string_value:
            apera_host = fields["apera_host"].string_value

        apera_port = 14040
        if "apera_port" in fields and fields["apera_port"].number_value:
            apera_port = int(fields["apera_port"].number_value)

        apera_pipeline = "RAIV_pick_belt_1"
        if "apera_pipeline" in fields and fields["apera_pipeline"].string_value:
            apera_pipeline = fields["apera_pipeline"].string_value

        # Custom network devices: list of "Name:IP" strings
        net_devices = None
        if "network_devices" in fields:
            lv = fields["network_devices"].list_value
            if lv and lv.values:
                net_devices = []
                for v in lv.values:
                    s = v.string_value
                    if ":" in s:
                        name, ip = s.split(":", 1)
                        net_devices.append((name.strip(), ip.strip()))

        sensor = cls(
            config.name,
            staubli_host=staubli_host,
            staubli_port=staubli_port,
            apera_host=apera_host,
            apera_port=apera_port,
            apera_pipeline=apera_pipeline,
            network_devices=net_devices,
        )
        LOGGER.info(
            "CellSensor configured: staubli=%s:%d apera=%s:%d pipeline=%s devices=%d",
            staubli_host, staubli_port, apera_host, apera_port,
            apera_pipeline, len(sensor._network_devices),
        )
        return sensor

    @classmethod
    def validate_config(cls, config: ComponentConfig) -> Sequence[str]:
        """No required attributes — all have sensible defaults."""
        return []

    async def get_readings(
        self,
        *,
        extra: dict[str, Any] | None = None,
        timeout: float | None = None,
        **kwargs: Any,
    ) -> Mapping[str, SensorReading]:
        """Return combined cell readings from all subsystems.

        Polls each subsystem only when its interval has elapsed,
        otherwise returns cached state. This keeps get_readings() fast
        even at high capture rates.
        """
        now = time.monotonic()
        tasks: list[asyncio.Task] = []

        # Schedule polls for subsystems whose interval has elapsed
        if now - self._last_staubli_poll >= _STAUBLI_INTERVAL:
            tasks.append(asyncio.create_task(self._poll_staubli()))
        if now - self._last_apera_poll >= _APERA_INTERVAL:
            tasks.append(asyncio.create_task(self._poll_apera()))
        if now - self._last_network_poll >= _NETWORK_INTERVAL:
            tasks.append(asyncio.create_task(self._poll_network()))
        if now - self._last_internet_poll >= _INTERNET_INTERVAL:
            tasks.append(asyncio.create_task(self._poll_internet()))
        if now - self._last_staubli_log_poll >= _STAUBLI_LOG_INTERVAL:
            tasks.append(asyncio.create_task(self._poll_staubli_logs()))

        # Run all due polls concurrently
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

        # Build flat readings dict
        readings: dict[str, Any] = {}

        # Staubli readings
        readings.update(self._staubli_state.to_dict())

        # Apera readings
        readings.update(self._apera_state.to_dict())

        # Staubli FTP log readings
        readings.update(self._staubli_log_state.to_dict())

        # Network readings
        for dev in self._network_state:
            readings.update(dev.to_dict(prefix="net_"))

        # Internet uplink health
        readings.update(self._internet_health.to_dict())

        # Switch and VPN gateway health
        readings.update(self._switch_vpn_health.to_dict())

        # Pi system health
        readings.update(await self._read_pi_health())

        # Module metadata
        self._total_reads += 1
        now_mono = time.monotonic()
        readings["cell_total_reads"] = self._total_reads
        readings["cell_uptime_s"] = round(time.time() - self._start_time, 1)
        readings["cell_staubli_connected"] = self._staubli_state.connected
        readings["cell_apera_connected"] = self._apera_state.connected
        readings["cell_devices_reachable"] = sum(
            1 for d in self._network_state if d.reachable
        )
        readings["cell_devices_total"] = len(self._network_devices)

        # Per-subsystem data staleness (seconds since last successful poll)
        readings["cell_staubli_data_age_s"] = round(now_mono - self._staubli_data_age, 1) if self._staubli_data_age else -1
        readings["cell_apera_data_age_s"] = round(now_mono - self._apera_data_age, 1) if self._apera_data_age else -1
        readings["cell_network_data_age_s"] = round(now_mono - self._network_data_age, 1) if self._network_data_age else -1
        readings["cell_internet_data_age_s"] = round(now_mono - self._internet_data_age, 1) if self._internet_data_age else -1
        readings["cell_staubli_log_data_age_s"] = round(now_mono - self._staubli_log_data_age, 1) if self._staubli_log_data_age else -1

        return readings

    async def _poll_staubli(self) -> None:
        try:
            self._staubli_state = await self._staubli.poll()
            self._last_staubli_poll = time.monotonic()
            if self._staubli_state.connected:
                self._staubli_data_age = time.monotonic()
                LOGGER.debug(
                    "Staubli poll OK (%.0f ms)", self._staubli_state.last_poll_ms
                )
            else:
                LOGGER.debug("Staubli unreachable: %s", self._staubli_state.error)
        except Exception as e:
            LOGGER.warning("Staubli poll error: %s", e)
            self._staubli_state.connected = False
            self._staubli_state.error = str(e)

    async def _poll_apera(self) -> None:
        try:
            self._apera_state = await self._apera.poll()
            self._last_apera_poll = time.monotonic()
            if self._apera_state.connected:
                self._apera_data_age = time.monotonic()
                LOGGER.debug(
                    "Apera poll OK (%.0f ms)", self._apera_state.last_poll_ms
                )
            else:
                LOGGER.debug("Apera unreachable: %s", self._apera_state.error)
        except Exception as e:
            LOGGER.warning("Apera poll error: %s", e)
            self._apera_state.connected = False
            self._apera_state.error = str(e)

    async def _poll_network(self) -> None:
        try:
            self._network_state = await check_all_devices(self._network_devices)
            self._last_network_poll = time.monotonic()
            self._network_data_age = time.monotonic()
            reachable = sum(1 for d in self._network_state if d.reachable)
            LOGGER.info(
                "Network scan: %d/%d devices reachable",
                reachable, len(self._network_devices),
            )
        except Exception as e:
            LOGGER.warning("Network scan error: %s", e)

    async def _poll_internet(self) -> None:
        try:
            self._internet_health = await check_internet_health()
            self._switch_vpn_health = await check_switch_vpn(
                device_results=self._network_state
            )
            self._last_internet_poll = time.monotonic()
            self._internet_data_age = time.monotonic()
        except Exception as e:
            LOGGER.warning("Internet health check error: %s", e)

    async def _poll_staubli_logs(self) -> None:
        try:
            self._staubli_log_state = await self._staubli_logs.scrape()
            self._last_staubli_log_poll = time.monotonic()
            if self._staubli_log_state.log_connected:
                self._staubli_log_data_age = time.monotonic()
                LOGGER.debug(
                    "Staubli log scrape OK (%.0f ms, %d URPS, %d safety)",
                    self._staubli_log_state.last_scrape_ms,
                    self._staubli_log_state.urps_events_24h,
                    self._staubli_log_state.safety_stops_24h,
                )
            else:
                LOGGER.debug(
                    "Staubli log scrape failed: %s", self._staubli_log_state.error
                )
        except Exception as e:
            LOGGER.warning("Staubli log scrape error: %s", e)
            self._staubli_log_state.log_connected = False
            self._staubli_log_state.error = str(e)

    @staticmethod
    async def _read_pi_health() -> dict[str, Any]:
        """Read Raspberry Pi system metrics — CPU, memory, temp, disk.

        All reads are from /proc and /sys (instant, non-blocking).
        vcgencmd is run via asyncio subprocess to avoid blocking the event loop.
        """
        h: dict[str, Any] = {}
        # CPU temperature
        try:
            with open("/sys/class/thermal/thermal_zone0/temp") as f:
                h["pi_cpu_temp_c"] = round(int(f.read().strip()) / 1000, 1)
        except Exception:
            pass
        # CPU usage from /proc/loadavg
        try:
            with open("/proc/loadavg") as f:
                parts = f.read().split()
                h["pi_load_1m"] = float(parts[0])
                h["pi_load_5m"] = float(parts[1])
                h["pi_load_15m"] = float(parts[2])
        except Exception:
            pass
        # Memory from /proc/meminfo
        try:
            mem = {}
            with open("/proc/meminfo") as f:
                for line in f:
                    if ":" in line:
                        key, val = line.split(":", 1)
                        mem[key.strip()] = int(val.strip().split()[0])  # kB
            total = mem.get("MemTotal", 1)
            avail = mem.get("MemAvailable", 0)
            h["pi_mem_total_mb"] = round(total / 1024, 0)
            h["pi_mem_available_mb"] = round(avail / 1024, 0)
            h["pi_mem_used_pct"] = round((1 - avail / total) * 100, 1)
        except Exception:
            pass
        # Disk usage from /proc/mounts + statvfs
        try:
            import os
            st = os.statvfs("/")
            total_gb = (st.f_blocks * st.f_frsize) / (1024 ** 3)
            free_gb = (st.f_bavail * st.f_frsize) / (1024 ** 3)
            h["pi_disk_total_gb"] = round(total_gb, 1)
            h["pi_disk_free_gb"] = round(free_gb, 1)
            h["pi_disk_used_pct"] = round((1 - free_gb / total_gb) * 100, 1)
        except Exception:
            pass
        # Uptime
        try:
            with open("/proc/uptime") as f:
                h["pi_uptime_hours"] = round(float(f.read().split()[0]) / 3600, 1)
        except Exception:
            pass
        # Throttle flags (Raspberry Pi firmware — undervoltage, thermal throttle)
        # Uses async subprocess to avoid blocking the event loop
        try:
            proc = await asyncio.create_subprocess_exec(
                "vcgencmd", "get_throttled",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL,
            )
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=3.0)
            output = stdout.decode().strip()
            # Output: "throttled=0x0" — 0 means no issues
            if "=" in output:
                flags = int(output.split("=")[1].strip(), 16)
                h["pi_throttled_raw"] = flags
                h["pi_undervoltage_now"] = bool(flags & 0x1)
                h["pi_freq_capped_now"] = bool(flags & 0x2)
                h["pi_throttled_now"] = bool(flags & 0x4)
                h["pi_undervoltage_ever"] = bool(flags & 0x10000)
                h["pi_freq_capped_ever"] = bool(flags & 0x20000)
                h["pi_throttled_ever"] = bool(flags & 0x40000)
        except Exception:
            pass
        return h

    async def do_command(
        self,
        command: Mapping[str, Any],
        *,
        timeout: float | None = None,
        **kwargs: Any,
    ) -> Mapping[str, Any]:
        """Handle manual commands.

        Commands:
          {"command": "status"}           — full module status
          {"command": "discover"}         — re-run Staubli API discovery
          {"command": "poll_all"}         — force immediate poll of all subsystems
          {"command": "raw_staubli"}      — last raw Staubli API response
          {"command": "raw_apera"}        — last raw Apera socket response
          {"command": "apera_health"}     — check Apera Vue management ports
          {"command": "apera_reconnect"}  — force reconnect Apera socket
          {"command": "apera_restart"}    — restart Apera via app manager API
          {"command": "raw_staubli_logs"} — last Staubli FTP log scrape state
        """
        cmd = command.get("command", "")

        if cmd == "status":
            return {
                "uptime_s": round(time.time() - self._start_time, 1),
                "total_reads": self._total_reads,
                "staubli_connected": self._staubli_state.connected,
                "staubli_api": self._staubli._discovered_endpoints.get("hmi", "none"),
                "apera_connected": self._apera_state.connected,
                "apera_pipeline_state": self._apera_state.pipeline_state,
                "apera_system_status": self._apera_state.system_status,
                "devices_reachable": sum(
                    1 for d in self._network_state if d.reachable
                ),
                "devices_total": len(self._network_devices),
            }

        if cmd == "discover":
            result = await self._staubli.discover()
            return {"discovered_api": result or "none"}

        if cmd == "poll_all":
            await asyncio.gather(
                self._poll_staubli(),
                self._poll_apera(),
                self._poll_network(),
                return_exceptions=True,
            )
            return {
                "staubli_connected": self._staubli_state.connected,
                "apera_connected": self._apera_state.connected,
                "devices_reachable": sum(
                    1 for d in self._network_state if d.reachable
                ),
            }

        if cmd == "raw_staubli":
            return {"raw": self._staubli.last_raw}

        if cmd == "raw_apera":
            return {"raw": self._apera.last_raw}

        if cmd == "raw_staubli_logs":
            return self._staubli_log_state.to_dict()

        if cmd == "apera_health":
            return await self._apera.check_health()

        if cmd == "apera_reconnect":
            LOGGER.info("Manual Apera socket reconnect requested")
            return await self._apera.reconnect()

        if cmd == "apera_restart":
            LOGGER.warning("Apera restart requested via app manager API")
            return await self._apera.restart_via_app_manager()

        return {"error": f"Unknown command: {cmd}"}

    async def close(self) -> None:
        LOGGER.info("%s is closing.", self.name)
        await asyncio.gather(
            self._staubli.close(),
            self._apera.close(),
            asyncio.to_thread(self._staubli_logs.close),
            return_exceptions=True,
        )


async def main():
    Registry.register_resource_creator(
        Sensor.API,
        CellSensor.MODEL,
        ResourceCreatorRegistration(CellSensor.new, CellSensor.validate_config),
    )
    module = Module.from_args()
    module.add_model_from_registry(Sensor.API, CellSensor.MODEL)
    await module.start()


if __name__ == "__main__":
    asyncio.run(main())
