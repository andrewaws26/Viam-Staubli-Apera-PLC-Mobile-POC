#!/usr/bin/env python3
"""
IronSight Discovery Daemon -- monitors hardware changes and auto-discovers devices.

Watches:
  - udevadm monitor: USB device attach/detach events
  - ip monitor link: Network interface state changes (eth0 up/down)
  - Periodic heartbeat: checks known devices are still reachable

When eth0 comes up:
  1. Waits for link negotiation + IP assignment
  2. Scans the subnet for PLCs
  3. Probes each device found
  4. Records device profiles to ~/.ironsight/devices/
  5. Logs all events

Install as systemd service:
  sudo cp config/ironsight-discovery-daemon.service /etc/systemd/system/
  sudo systemctl enable --now ironsight-discovery-daemon

Or run directly:
  python3 scripts/ironsight-discovery-daemon.py
"""

import json
import logging
import os
import signal
import sys
import threading
import time
import subprocess
from datetime import datetime

# -- Setup paths --
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(SCRIPT_DIR, "lib"))

from ironsight_memory import IronSightMemory
from config_updater import (
    DISCOVERY_AVAILABLE,
    get_carrier,
    get_interface_ip,
    get_interface_subnet,
    check_tcp,
    identify_usb_device,
    probe_plc,
    scan_subnet,
)

# -- Constants --
try:
    from lib.plc_constants import PLC_HOST as KNOWN_PLC_HOST, PLC_PORT as KNOWN_PLC_PORT
except ImportError:
    KNOWN_PLC_HOST = "169.168.10.21"
    KNOWN_PLC_PORT = 502

HEARTBEAT_INTERVAL = 300  # 5 minutes
LINK_SETTLE_TIME = 5      # seconds to wait after eth0 comes up
USB_SETTLE_TIME = 2       # seconds to wait after USB device appears

# Network interfaces to watch
WATCH_INTERFACES = {"eth0", "eth1", "usb0", "enp1s0", "end0"}


# -- Daemon --

class DiscoveryDaemon:
    """Watches for hardware changes and auto-discovers connected devices."""

    def __init__(self):
        self.memory = IronSightMemory()
        self.memory.ensure_seed_files()
        self.running = True
        self.logger = self._setup_logging()
        self._discovery_lock = threading.Lock()
        self._last_eth0_state = get_carrier("eth0")

    def _setup_logging(self) -> logging.Logger:
        """Configure logging to file and stdout."""
        log_file = os.path.join(self.memory.logs_dir, "discovery-daemon.log")
        logger = logging.getLogger("ironsight-discovery")
        logger.setLevel(logging.INFO)

        from logging.handlers import RotatingFileHandler
        fh = RotatingFileHandler(log_file, maxBytes=10_000_000, backupCount=3)
        fh.setFormatter(logging.Formatter(
            "%(asctime)s [%(levelname)s] %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S"
        ))
        logger.addHandler(fh)

        sh = logging.StreamHandler()
        sh.setFormatter(logging.Formatter(
            "%(asctime)s [%(levelname)s] %(message)s",
            datefmt="%H:%M:%S"
        ))
        logger.addHandler(sh)

        return logger

    # -- Main loop --

    def start(self):
        """Start all monitor threads and block until signaled."""
        self.logger.info("IronSight Discovery Daemon starting")
        self.logger.info(f"  Memory: {self.memory.base_dir}")
        self.logger.info(f"  Discovery module: {'available' if DISCOVERY_AVAILABLE else 'NOT available'}")
        self.logger.info(f"  Known PLC: {KNOWN_PLC_HOST}:{KNOWN_PLC_PORT}")
        self.logger.info(f"  eth0 carrier: {self._last_eth0_state}")

        self.memory.log_event("discovery-daemon", "started", {
            "discovery_available": DISCOVERY_AVAILABLE,
            "eth0_carrier": self._last_eth0_state,
        })

        if self._last_eth0_state == 1:
            threading.Thread(target=self._run_discovery, args=("startup",), daemon=True).start()

        threads = [
            threading.Thread(target=self._watch_network_link, name="net-watcher", daemon=True),
            threading.Thread(target=self._watch_udev, name="udev-watcher", daemon=True),
            threading.Thread(target=self._periodic_heartbeat, name="heartbeat", daemon=True),
        ]

        for t in threads:
            t.start()
            self.logger.info(f"  Started thread: {t.name}")

        signal.signal(signal.SIGTERM, self._handle_signal)
        signal.signal(signal.SIGINT, self._handle_signal)

        while self.running:
            time.sleep(1)

        self.logger.info("IronSight Discovery Daemon stopped")
        self.memory.log_event("discovery-daemon", "stopped")

    def _handle_signal(self, signum, frame):
        sig_name = signal.Signals(signum).name
        self.logger.info(f"Received {sig_name}, shutting down")
        self.running = False

    # -- Network link watcher --

    def _watch_network_link(self):
        """Monitor network interface state changes via ip monitor link."""
        self.logger.info("Network link watcher started")

        try:
            proc = subprocess.Popen(
                ["ip", "monitor", "link"],
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                text=True,
                bufsize=1,
            )
        except FileNotFoundError:
            self.logger.error("'ip' command not found -- network monitoring disabled")
            return

        while self.running:
            line = proc.stdout.readline()
            if not line:
                if proc.poll() is not None:
                    self.logger.warning("ip monitor exited, restarting in 10s")
                    time.sleep(10)
                    return self._watch_network_link()
                continue

            line = line.strip()
            if not line:
                continue

            for iface in WATCH_INTERFACES:
                if iface in line:
                    if "state UP" in line or "LOWER_UP" in line:
                        self._on_interface_up(iface, line)
                    elif "state DOWN" in line or "NO-CARRIER" in line:
                        self._on_interface_down(iface, line)

        proc.terminate()

    def _on_interface_up(self, iface: str, raw: str):
        """Network interface came up."""
        carrier = get_carrier(iface)
        if iface == "eth0" and self._last_eth0_state == carrier == 1:
            return
        if iface == "eth0":
            self._last_eth0_state = carrier

        self.logger.info(f"{iface} link UP")
        self.memory.log_event("discovery-daemon", f"{iface}_up", {"raw": raw[:200]})

        threading.Thread(
            target=self._delayed_discovery,
            args=(iface,),
            daemon=True,
        ).start()

    def _on_interface_down(self, iface: str, raw: str):
        """Network interface went down."""
        if iface == "eth0":
            if self._last_eth0_state == 0:
                return
            self._last_eth0_state = 0

        self.logger.info(f"{iface} link DOWN")
        self.memory.log_event("discovery-daemon", f"{iface}_down", {"raw": raw[:200]})

    def _delayed_discovery(self, iface: str):
        """Wait for link negotiation/DHCP, then scan."""
        self.logger.info(f"Waiting {LINK_SETTLE_TIME}s for {iface} to settle")
        time.sleep(LINK_SETTLE_TIME)

        if get_carrier(iface) != 1:
            self.logger.info(f"{iface} went back down before discovery could run")
            return

        ip = None
        for _ in range(15):
            ip = get_interface_ip(iface)
            if ip:
                break
            time.sleep(1)

        if ip:
            self.logger.info(f"{iface} has IP {ip} -- starting discovery")
            self._run_discovery(f"{iface}_up")
        else:
            self.logger.warning(f"{iface} is up but no IP assigned after 15s")
            self._run_discovery(f"{iface}_up_no_ip")

    # -- USB watcher --

    def _watch_udev(self):
        """Monitor USB device events via udevadm monitor."""
        self.logger.info("USB watcher started")

        try:
            proc = subprocess.Popen(
                ["udevadm", "monitor", "--kernel", "--subsystem-match=usb",
                 "--subsystem-match=tty", "--subsystem-match=net",
                 "--subsystem-match=video4linux"],
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                text=True,
                bufsize=1,
            )
        except FileNotFoundError:
            self.logger.error("'udevadm' not found -- USB monitoring disabled")
            return
        except PermissionError:
            self.logger.warning("udevadm requires elevated privileges -- USB monitoring limited")
            return

        while self.running:
            line = proc.stdout.readline()
            if not line:
                if proc.poll() is not None:
                    self.logger.warning("udevadm exited, restarting in 10s")
                    time.sleep(10)
                    return self._watch_udev()
                continue

            line = line.strip()
            if not line or line.startswith("monitor"):
                continue

            if " add " in line.lower():
                self._on_usb_add(line)
            elif " remove " in line.lower():
                self._on_usb_remove(line)

        proc.terminate()

    def _on_usb_add(self, raw: str):
        """USB device was plugged in."""
        device_info = identify_usb_device(raw)
        self.logger.info(f"USB device added: {device_info.get('description', raw[:100])}")
        self.memory.log_event("discovery-daemon", "usb_add", device_info)

        if device_info.get("type") == "network_adapter":
            self.logger.info("Network adapter detected -- watching for new interface")

        if device_info.get("type") in ("serial_adapter", "serial_device"):
            dev_path = device_info.get("device", "")
            self.logger.info(f"Serial device at {dev_path} -- available for Modbus RTU or sensor")
            self.memory.log_event("discovery-daemon", "serial_available", {
                "path": dev_path,
                "description": device_info.get("description", "unknown"),
            })

    def _on_usb_remove(self, raw: str):
        """USB device was unplugged."""
        self.logger.info(f"USB device removed: {raw[:100]}")
        self.memory.log_event("discovery-daemon", "usb_remove", {"raw": raw[:200]})

    # -- Network discovery --

    def _run_discovery(self, trigger: str):
        """Scan the network for PLCs and other devices."""
        if not self._discovery_lock.acquire(blocking=False):
            self.logger.info("Discovery already running, skipping")
            return

        try:
            self.logger.info(f"=== Discovery triggered by: {trigger} ===")
            self.memory.log_event("discovery-daemon", "discovery_started", {"trigger": trigger})

            devices_found = []

            # 1. Check the known PLC first (fast path)
            if check_tcp(KNOWN_PLC_HOST, KNOWN_PLC_PORT, timeout=3):
                self.logger.info(f"Known PLC reachable at {KNOWN_PLC_HOST}:{KNOWN_PLC_PORT}")
                device = probe_plc(KNOWN_PLC_HOST, KNOWN_PLC_PORT, logger=self.logger)
                if device:
                    devices_found.append(device)
                    self._save_device(device)

            # 2. Scan eth0 subnet for other devices
            eth0_subnet = get_interface_subnet("eth0")
            if eth0_subnet:
                self.logger.info(f"Scanning subnet {eth0_subnet}")
                found = scan_subnet(eth0_subnet, logger=self.logger)
                for device in found:
                    if device.get("ip") != KNOWN_PLC_HOST:
                        devices_found.append(device)
                        self._save_device(device)

            # 3. Check for any other network interfaces with subnets
            for iface in WATCH_INTERFACES:
                if iface == "eth0":
                    continue
                subnet = get_interface_subnet(iface)
                if subnet:
                    self.logger.info(f"Also scanning {iface} subnet {subnet}")
                    for device in scan_subnet(subnet, logger=self.logger):
                        devices_found.append(device)
                        self._save_device(device)

            self.logger.info(f"Discovery complete: {len(devices_found)} device(s) found")
            self.memory.log_event("discovery-daemon", "discovery_complete", {
                "trigger": trigger,
                "devices_found": len(devices_found),
                "devices": [
                    {"ip": d.get("ip"), "vendor": d.get("vendor", "unknown")}
                    for d in devices_found
                ],
            })

        except Exception as e:
            self.logger.error(f"Discovery error: {e}", exc_info=True)
            self.memory.log_event("discovery-daemon", "discovery_error", {"error": str(e)})
        finally:
            self._discovery_lock.release()

    def _save_device(self, device: dict):
        """Save a device profile to ~/.ironsight/devices/."""
        ip = device.get("ip", "unknown").replace(".", "_")
        device_id = f"{device.get('type', 'device')}-{ip}"
        self.memory.write_device(device_id, device)
        self.logger.info(f"Saved device profile: {device_id}")

    # -- Heartbeat --

    def _periodic_heartbeat(self):
        """Periodically check known devices and interfaces."""
        self.logger.info(f"Heartbeat started (every {HEARTBEAT_INTERVAL}s)")

        while self.running:
            time.sleep(HEARTBEAT_INTERVAL)
            if not self.running:
                break

            try:
                self._heartbeat()
            except Exception as e:
                self.logger.error(f"Heartbeat error: {e}")

    def _heartbeat(self):
        """Single heartbeat check."""
        status = {}

        eth0_carrier = get_carrier("eth0")
        status["eth0_carrier"] = eth0_carrier
        eth0_ip = get_interface_ip("eth0")
        status["eth0_ip"] = eth0_ip

        if eth0_carrier == 1 and self._last_eth0_state == 0:
            self.logger.info("Heartbeat detected eth0 came up (missed by monitor)")
            self._last_eth0_state = 1
            threading.Thread(target=self._run_discovery, args=("heartbeat_eth0_up",), daemon=True).start()
        elif eth0_carrier == 0 and self._last_eth0_state == 1:
            self.logger.info("Heartbeat detected eth0 went down (missed by monitor)")
            self._last_eth0_state = 0
            self.memory.log_event("discovery-daemon", "eth0_down", {"source": "heartbeat"})

        plc_reachable = check_tcp(KNOWN_PLC_HOST, KNOWN_PLC_PORT, timeout=3)
        status["plc_reachable"] = plc_reachable

        for device_id in self.memory.list_devices():
            device = self.memory.read_device(device_id)
            if device and device.get("ip"):
                port = device.get("port", 502)
                reachable = check_tcp(device["ip"], port, timeout=3)
                if reachable != device.get("reachable"):
                    state = "reachable" if reachable else "unreachable"
                    self.logger.info(f"Device {device_id} is now {state}")
                    device["reachable"] = reachable
                    device["last_state_change"] = datetime.now().isoformat()
                    if reachable:
                        device["last_seen"] = datetime.now().isoformat()
                    self.memory.write_device(device_id, device)
                    self.memory.log_event("discovery-daemon", f"device_{state}", {
                        "device_id": device_id,
                        "ip": device["ip"],
                    })

        self.logger.debug(f"Heartbeat: {json.dumps(status)}")


# -- Entry point --

def main():
    daemon = DiscoveryDaemon()
    daemon.start()


if __name__ == "__main__":
    main()
