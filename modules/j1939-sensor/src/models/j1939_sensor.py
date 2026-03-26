"""
Viam sensor component for J1939 CAN bus truck diagnostics.

Reads J1939 data from a CAN interface (via Waveshare RS485 CAN HAT or similar),
decodes PGNs into human-readable parameters, and exposes them through
the Viam Sensor API for cloud data capture and monitoring.

Supports:
- All standard engine/vehicle J1939 PGNs (RPM, temps, pressures, fuel, etc.)
- Active DTC (Diagnostic Trouble Code) reading via DM1
- DTC clearing via DM11 (clear active DTCs on the dash)
- PGN request messages for on-demand data
- Configurable CAN interface, bitrate, and PGN filters
"""

import asyncio
import struct
import threading
import time
from typing import Any, ClassVar, Mapping, Optional

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

import sys
import os
# Add parent dir for system_health import
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from system_health import get_system_health

from .pgn_decoder import (
    PGN_REGISTRY,
    decode_can_frame,
    extract_pgn_from_can_id,
    extract_source_address,
    get_supported_pgns,
)

LOGGER = getLogger(__name__)

# J1939 broadcast address
J1939_GLOBAL_ADDRESS = 0xFF

# DM11 — Clear/Reset Active DTCs (PGN 65235 / 0xFED3)
DM11_PGN = 65235

# Request PGN (PGN 59904 / 0xEA00)
REQUEST_PGN = 59904


def _build_can_id(priority: int, pgn: int, source_address: int,
                  destination_address: int = J1939_GLOBAL_ADDRESS) -> int:
    """Build a 29-bit J1939 CAN ID."""
    pdu_format = (pgn >> 8) & 0xFF
    if pdu_format < 240:
        # Peer-to-peer: PDU Specific = destination address
        pdu_specific = destination_address
    else:
        # Broadcast: PDU Specific is part of PGN
        pdu_specific = pgn & 0xFF

    data_page = (pgn >> 16) & 0x01
    reserved = (pgn >> 17) & 0x01

    can_id = ((priority & 0x07) << 26
              | (reserved << 25)
              | (data_page << 24)
              | (pdu_format << 16)
              | (pdu_specific << 8)
              | (source_address & 0xFF))
    return can_id


class J1939TruckSensor(Sensor):
    """
    Viam sensor that reads J1939 CAN bus data from heavy-duty trucks.

    Configuration attributes:
        can_interface (str): CAN interface name. Default: "can0"
        bitrate (int): CAN bus bitrate. Default: 500000 (J1939 standard for OBD-II)
        source_address (int): Our J1939 source address for sending. Default: 0xFE (null)
        pgn_filter (list[int]): Optional list of PGNs to capture. Empty = capture all known.
        include_raw (bool): Include raw hex data in readings. Default: false
        bus_type (str): python-can bus type. Default: "socketcan"
    """

    MODEL: ClassVar[Model] = Model(
        ModelFamily("ironsight", "j1939-truck-sensor"), "can-sensor"
    )

    def __init__(self, name: str):
        super().__init__(name)
        self._bus = None
        self._listener_thread = None
        self._running = False
        self._readings: dict[str, Any] = {}
        self._readings_lock = threading.Lock()
        self._last_frame_time: float = 0
        self._frame_count: int = 0
        self._can_interface = "can0"
        self._bitrate = 500000
        self._source_address = 0xFE
        self._pgn_filter: set[int] = set()
        self._include_raw = False
        self._bus_type = "socketcan"

    @classmethod
    def new(cls, config: ComponentConfig,
            dependencies: Mapping[ResourceName, ResourceBase]) -> Self:
        sensor = cls(config.name)
        sensor.reconfigure(config, dependencies)
        return sensor

    @classmethod
    def validate_config(cls, config: ComponentConfig) -> tuple[list[str], list[str]]:
        fields = config.attributes.fields
        bitrate = fields.get("bitrate")
        if bitrate and bitrate.number_value:
            br = int(bitrate.number_value)
            valid_bitrates = [250000, 500000, 1000000]
            if br not in valid_bitrates:
                raise ValueError(
                    f"bitrate must be one of {valid_bitrates}, got {br}"
                )
        return [], []

    def reconfigure(self, config: ComponentConfig,
                    dependencies: Mapping[ResourceName, ResourceBase]) -> None:
        # Stop existing listener if running
        self._stop_listener()

        fields = config.attributes.fields

        self._can_interface = (
            fields["can_interface"].string_value
            if "can_interface" in fields and fields["can_interface"].string_value
            else "can0"
        )
        self._bitrate = (
            int(fields["bitrate"].number_value)
            if "bitrate" in fields and fields["bitrate"].number_value
            else 500000
        )
        self._source_address = (
            int(fields["source_address"].number_value)
            if "source_address" in fields and fields["source_address"].number_value
            else 0xFE
        )
        self._include_raw = (
            fields["include_raw"].bool_value
            if "include_raw" in fields
            else False
        )
        self._bus_type = (
            fields["bus_type"].string_value
            if "bus_type" in fields and fields["bus_type"].string_value
            else "socketcan"
        )

        # PGN filter
        if "pgn_filter" in fields and fields["pgn_filter"].list_value:
            self._pgn_filter = {
                int(v.number_value) for v in fields["pgn_filter"].list_value.values
            }
        else:
            self._pgn_filter = set()

        # Reset readings
        with self._readings_lock:
            self._readings = {}
            self._frame_count = 0

        # Start CAN listener
        self._start_listener()

    def _start_listener(self):
        """Start the background CAN bus listener thread."""
        try:
            import can
            self._bus = can.Bus(
                channel=self._can_interface,
                interface=self._bus_type,
                bitrate=self._bitrate,
                receive_own_messages=False,
            )
            self._running = True
            self._listener_thread = threading.Thread(
                target=self._listen_loop,
                daemon=True,
                name=f"j1939-listener-{self._can_interface}",
            )
            self._listener_thread.start()
            LOGGER.info(
                f"CAN listener started on {self._can_interface} "
                f"at {self._bitrate} bps"
            )
        except Exception as e:
            LOGGER.error(f"Failed to start CAN listener: {e}")
            self._bus = None
            self._running = False

    def _stop_listener(self):
        """Stop the background CAN bus listener."""
        self._running = False
        if self._listener_thread and self._listener_thread.is_alive():
            self._listener_thread.join(timeout=3.0)
        if self._bus:
            try:
                self._bus.shutdown()
            except Exception:
                pass
            self._bus = None

    def _listen_loop(self):
        """Background thread: read CAN frames and decode J1939 PGNs."""
        while self._running and self._bus:
            try:
                msg = self._bus.recv(timeout=1.0)
                if msg is None:
                    continue
                if not msg.is_extended_id:
                    continue  # J1939 uses extended (29-bit) IDs only

                pgn, decoded = decode_can_frame(msg.arbitration_id, msg.data)

                # Apply PGN filter
                if self._pgn_filter and pgn not in self._pgn_filter:
                    continue

                if decoded:
                    with self._readings_lock:
                        self._readings.update(decoded)
                        self._frame_count += 1
                        self._last_frame_time = time.time()

                        if self._include_raw:
                            pgn_hex = f"pgn_{pgn}_raw"
                            self._readings[pgn_hex] = msg.data.hex()

                        # Store source address for decoded PGNs
                        sa = extract_source_address(msg.arbitration_id)
                        self._readings[f"pgn_{pgn}_source_addr"] = sa

            except Exception as e:
                if self._running:
                    LOGGER.warning(f"CAN read error: {e}")
                    time.sleep(0.1)

    async def get_readings(
        self,
        *,
        extra: Optional[Mapping[str, Any]] = None,
        timeout: Optional[float] = None,
        **kwargs,
    ) -> Mapping[str, SensorReading]:
        """
        Return the latest decoded J1939 readings.

        All decoded parameters are included as flat key-value pairs.
        Additional metadata:
          - _can_interface: which CAN interface is being read
          - _frame_count: total frames decoded since startup
          - _bus_connected: whether the CAN bus is active
          - _seconds_since_last_frame: time since last decoded frame
        """
        with self._readings_lock:
            readings = dict(self._readings)

        # Add metadata
        readings["_can_interface"] = self._can_interface
        readings["_frame_count"] = self._frame_count
        readings["_bus_connected"] = self._bus is not None and self._running

        if self._last_frame_time > 0:
            readings["_seconds_since_last_frame"] = round(
                time.time() - self._last_frame_time, 2
            )
        else:
            readings["_seconds_since_last_frame"] = -1

        # Merge system health into readings
        try:
            readings.update(get_system_health())
        except Exception:
            pass  # health data is optional

        return readings

    async def do_command(
        self,
        command: Mapping[str, Any],
        *,
        timeout: Optional[float] = None,
        **kwargs,
    ) -> Mapping[str, Any]:
        """
        Execute custom commands on the CAN bus.

        Supported commands:
            {"command": "clear_dtcs"}
                Send DM11 to clear active diagnostic trouble codes.

            {"command": "request_pgn", "pgn": <int>}
                Send a PGN request message to solicit data from the ECU.

            {"command": "get_supported_pgns"}
                Return list of PGN numbers and names this module can decode.

            {"command": "get_bus_stats"}
                Return CAN bus statistics (frame count, uptime, etc.)

            {"command": "send_raw", "can_id": <int>, "data": <hex_string>}
                Send a raw CAN frame (use with caution).
        """
        cmd = command.get("command", "")

        if cmd == "clear_dtcs":
            return await self._clear_dtcs()
        elif cmd == "request_pgn":
            pgn = command.get("pgn")
            if pgn is None:
                return {"error": "pgn parameter required"}
            return await self._request_pgn(int(pgn))
        elif cmd == "get_supported_pgns":
            return {"supported_pgns": get_supported_pgns()}
        elif cmd == "get_bus_stats":
            return self._get_bus_stats()
        elif cmd == "send_raw":
            can_id = command.get("can_id")
            data_hex = command.get("data", "")
            if can_id is None:
                return {"error": "can_id parameter required"}
            return await self._send_raw(int(can_id), data_hex)
        else:
            return {"error": f"Unknown command: {cmd}",
                    "available": ["clear_dtcs", "request_pgn",
                                  "get_supported_pgns", "get_bus_stats",
                                  "send_raw"]}

    async def _clear_dtcs(self) -> dict[str, Any]:
        """
        Send DM11 (PGN 65235) to clear active diagnostic trouble codes.

        DM11 is sent as a broadcast with 8 bytes of 0xFF (per J1939-73).
        The ECU should respond with DM12 (PGN 65236) confirming the clear.
        """
        if not self._bus:
            return {"success": False, "error": "CAN bus not connected"}

        try:
            import can
            # DM11 clear request: 8 bytes of 0xFF
            can_id = _build_can_id(
                priority=6,
                pgn=DM11_PGN,
                source_address=self._source_address,
                destination_address=J1939_GLOBAL_ADDRESS,
            )
            msg = can.Message(
                arbitration_id=can_id,
                data=bytes([0xFF] * 8),
                is_extended_id=True,
            )
            self._bus.send(msg)
            LOGGER.info("DM11 clear DTCs command sent")

            # Clear locally cached DTC readings
            with self._readings_lock:
                keys_to_remove = [k for k in self._readings
                                  if k.startswith("dtc_") or k == "active_dtc_count"
                                  or k.endswith("_lamp")]
                for k in keys_to_remove:
                    del self._readings[k]

            return {"success": True, "message": "DM11 clear DTCs sent"}
        except Exception as e:
            LOGGER.error(f"Failed to send DM11: {e}")
            return {"success": False, "error": str(e)}

    async def _request_pgn(self, pgn: int) -> dict[str, Any]:
        """
        Send a PGN request (PGN 59904) to solicit data from the ECU.

        The request contains the 3-byte little-endian PGN number.
        """
        if not self._bus:
            return {"success": False, "error": "CAN bus not connected"}

        try:
            import can
            # Request PGN format: 3 bytes LE of the requested PGN + 5 padding
            pgn_bytes = struct.pack("<I", pgn)[:3]
            data = pgn_bytes + bytes([0xFF] * 5)

            can_id = _build_can_id(
                priority=6,
                pgn=REQUEST_PGN,
                source_address=self._source_address,
                destination_address=J1939_GLOBAL_ADDRESS,
            )
            msg = can.Message(
                arbitration_id=can_id,
                data=data,
                is_extended_id=True,
            )
            self._bus.send(msg)
            LOGGER.info(f"PGN request sent for PGN {pgn}")
            return {"success": True, "message": f"Requested PGN {pgn}"}
        except Exception as e:
            LOGGER.error(f"Failed to request PGN {pgn}: {e}")
            return {"success": False, "error": str(e)}

    async def _send_raw(self, can_id: int, data_hex: str) -> dict[str, Any]:
        """Send a raw CAN frame."""
        if not self._bus:
            return {"success": False, "error": "CAN bus not connected"}

        try:
            import can
            data = bytes.fromhex(data_hex)
            msg = can.Message(
                arbitration_id=can_id,
                data=data,
                is_extended_id=True,
            )
            self._bus.send(msg)
            return {"success": True,
                    "message": f"Sent CAN ID 0x{can_id:08X} data={data_hex}"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def _get_bus_stats(self) -> dict[str, Any]:
        """Return CAN bus statistics."""
        return {
            "can_interface": self._can_interface,
            "bitrate": self._bitrate,
            "bus_type": self._bus_type,
            "bus_connected": self._bus is not None,
            "listener_running": self._running,
            "total_frames_decoded": self._frame_count,
            "last_frame_time": self._last_frame_time,
            "seconds_since_last_frame": (
                round(time.time() - self._last_frame_time, 2)
                if self._last_frame_time > 0 else -1
            ),
            "source_address": f"0x{self._source_address:02X}",
            "pgn_filter": list(self._pgn_filter) if self._pgn_filter else "all",
            "include_raw": self._include_raw,
            "unique_readings": len(self._readings),
        }

    async def close(self):
        """Clean up CAN bus resources."""
        LOGGER.info(f"Closing J1939 sensor {self.name}")
        self._stop_listener()
