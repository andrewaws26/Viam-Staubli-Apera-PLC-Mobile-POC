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
import json
import os
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
from .obd2_poller import OBD2Poller

LOGGER = getLogger(__name__)

# Default offline buffer config
_DEFAULT_BUFFER_DIR = "/home/andrew/.viam/offline-buffer/truck"
_DEFAULT_BUFFER_MAX_MB = 50.0


def _serialise(value: Any) -> Any:
    """Make a value JSON-safe."""
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float, str)):
        return value
    return str(value)


class OfflineBuffer:
    """Append-only JSONL buffer that persists readings to local disk.

    Each reading is written as a single JSON line to a date-stamped file.
    When the buffer directory exceeds max_mb, the oldest files are pruned.
    This ensures vehicle data survives cloud sync failures and reboots.
    """

    def __init__(self, buffer_dir: str, max_mb: float = _DEFAULT_BUFFER_MAX_MB):
        self._dir = buffer_dir
        self._max_bytes = int(max_mb * 1024 * 1024)
        os.makedirs(self._dir, exist_ok=True)
        LOGGER.info("OfflineBuffer initialised: dir=%s max_mb=%.0f", self._dir, max_mb)

    def _current_file(self) -> str:
        date_str = time.strftime("%Y%m%d")
        return os.path.join(self._dir, f"readings_{date_str}.jsonl")

    def write(self, readings: Mapping[str, Any]) -> None:
        """Append a single reading as a JSON line with an ISO timestamp."""
        record = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "epoch": time.time(),
            **{k: _serialise(v) for k, v in readings.items()},
        }
        path = self._current_file()
        try:
            with open(path, "a") as f:
                f.write(json.dumps(record, separators=(",", ":")) + "\n")
        except Exception as exc:
            LOGGER.warning("OfflineBuffer write failed: %s", exc)
            return
        self._maybe_prune()

    def _maybe_prune(self) -> None:
        """Remove oldest JSONL files if total size exceeds the cap."""
        try:
            files = sorted(
                (os.path.join(self._dir, f) for f in os.listdir(self._dir) if f.endswith(".jsonl")),
                key=os.path.getmtime,
            )
            total = sum(os.path.getsize(f) for f in files)
            while total > self._max_bytes and len(files) > 1:
                oldest = files.pop(0)
                size = os.path.getsize(oldest)
                os.remove(oldest)
                total -= size
                LOGGER.info("OfflineBuffer pruned %s (%.1f KB)", oldest, size / 1024)
        except Exception as exc:
            LOGGER.warning("OfflineBuffer prune error: %s", exc)


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
        protocol (str): "j1939" (default) or "obd2". Selects passive J1939 listener
            or active OBD-II PID polling mode.
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
        self._protocol = "j1939"
        self._obd2_poller: OBD2Poller | None = None
        self._offline_buffer: OfflineBuffer | None = None
        # State inference
        self._prev_speed: float = 0.0
        self._prev_accel_pedal: float = 0.0
        self._prev_readings_time: float = 0.0

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
        protocol = fields.get("protocol")
        if protocol and protocol.string_value:
            if protocol.string_value not in ("j1939", "obd2"):
                raise ValueError(
                    f"protocol must be 'j1939' or 'obd2', got '{protocol.string_value}'"
                )
        return [], []

    def reconfigure(self, config: ComponentConfig,
                    dependencies: Mapping[ResourceName, ResourceBase]) -> None:
        # Stop existing listener / poller if running
        self._stop_listener()
        if self._obd2_poller:
            self._obd2_poller.stop()
            self._obd2_poller = None

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
        self._protocol = (
            fields["protocol"].string_value
            if "protocol" in fields and fields["protocol"].string_value
            else "j1939"
        )

        # Offline buffer — local JSONL backup for when cloud sync fails
        buf_dir = _DEFAULT_BUFFER_DIR
        buf_max_mb = _DEFAULT_BUFFER_MAX_MB
        if "offline_buffer_dir" in fields and fields["offline_buffer_dir"].string_value:
            buf_dir = fields["offline_buffer_dir"].string_value
        if "offline_buffer_max_mb" in fields and fields["offline_buffer_max_mb"].number_value:
            buf_max_mb = fields["offline_buffer_max_mb"].number_value
        self._offline_buffer = OfflineBuffer(buf_dir, buf_max_mb)

        # PGN filter (J1939 only, but parse regardless)
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

        # Start the appropriate protocol handler
        if self._protocol == "obd2":
            self._obd2_poller = OBD2Poller(
                can_interface=self._can_interface,
                bus_type=self._bus_type,
                bitrate=self._bitrate,
            )
            self._obd2_poller.start()
            LOGGER.info("Configured in OBD-II polling mode")
        else:
            self._start_listener()
            LOGGER.info("Configured in J1939 passive listener mode")

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
        # J1939 Transport Protocol (TP) reassembly state
        # Key = (source_address, target_pgn), Value = {total_bytes, packets, data}
        tp_sessions: dict[tuple[int, int], dict] = {}

        while self._running and self._bus:
            try:
                msg = self._bus.recv(timeout=1.0)
                if msg is None:
                    continue
                if not msg.is_extended_id:
                    continue  # J1939 uses extended (29-bit) IDs only

                pgn = extract_pgn_from_can_id(msg.arbitration_id)
                sa = extract_source_address(msg.arbitration_id)

                # --- TP.CM (Connection Management) — PGN 60416 (0xEC00) ---
                if pgn == 60416 and len(msg.data) >= 8:
                    ctrl = msg.data[0]
                    if ctrl == 32:  # BAM (Broadcast Announce Message)
                        total_bytes = msg.data[1] | (msg.data[2] << 8)
                        total_packets = msg.data[3]
                        target_pgn = msg.data[5] | (msg.data[6] << 8) | (msg.data[7] << 16)
                        tp_sessions[(sa, target_pgn)] = {
                            "total_bytes": total_bytes,
                            "total_packets": total_packets,
                            "data": bytearray(),
                            "received": 0,
                        }
                    continue

                # --- TP.DT (Data Transfer) — PGN 60160 (0xEB00) ---
                if pgn == 60160 and len(msg.data) >= 2:
                    seq = msg.data[0]  # sequence number (1-based)
                    payload = msg.data[1:8]

                    # Find which session this belongs to
                    for key, session in tp_sessions.items():
                        if key[0] == sa:
                            session["data"].extend(payload)
                            session["received"] += 1

                            # Check if complete
                            if session["received"] >= session["total_packets"]:
                                target_pgn = key[1]
                                raw = bytes(session["data"][:session["total_bytes"]])
                                self._decode_tp_message(target_pgn, sa, raw)
                                del tp_sessions[key]
                            break
                    continue

                # --- Standard single-frame PGN decode ---
                _, decoded = decode_can_frame(msg.arbitration_id, msg.data)

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

                        self._readings[f"pgn_{pgn}_source_addr"] = sa

            except Exception as e:
                if self._running:
                    LOGGER.warning(f"CAN read error: {e}")
                    time.sleep(0.1)

    def _decode_tp_message(self, pgn: int, sa: int, data: bytes):
        """Decode a reassembled multi-packet J1939 message."""
        decoded = {}

        if pgn == 65260:  # Vehicle Identification (VI) — contains VIN
            # VIN is ASCII, first byte is count, then the VIN string
            raw_str = data.decode("ascii", errors="ignore").rstrip("\x00").rstrip("*").strip()
            # Extract only alphanumeric VIN chars (17 chars standard)
            vin = "".join(c for c in raw_str if c.isalnum())[:17]
            if len(vin) >= 10:
                decoded["vin"] = vin
                LOGGER.info(f"VIN decoded: {vin}")

        elif pgn == 65242:  # Software Identification
            raw_str = data.decode("ascii", errors="ignore").rstrip("\x00").strip()
            # Take just the first meaningful part (before repeating P01* patterns)
            sw_id = raw_str.split("*")[0].strip() if "*" in raw_str else raw_str[:30]
            if sw_id:
                decoded["software_id"] = sw_id

        elif pgn == 65259:  # Component Identification
            raw_str = data.decode("ascii", errors="ignore").rstrip("\x00").strip()
            comp_id = raw_str[:50]  # truncate
            if comp_id:
                decoded["component_id"] = comp_id

        if decoded:
            with self._readings_lock:
                self._readings.update(decoded)
                self._frame_count += 1
                self._last_frame_time = time.time()

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
        if self._protocol == "obd2" and self._obd2_poller:
            readings = self._obd2_poller.get_readings()
            readings["_can_interface"] = self._can_interface
            readings["_protocol"] = "obd2"
            readings["_bus_connected"] = self._obd2_poller.bus_connected
        else:
            with self._readings_lock:
                readings = dict(self._readings)

            readings["_can_interface"] = self._can_interface
            readings["_protocol"] = "j1939"
            readings["_frame_count"] = self._frame_count
            readings["_bus_connected"] = self._bus is not None and self._running

            if self._last_frame_time > 0:
                readings["_seconds_since_last_frame"] = round(
                    time.time() - self._last_frame_time, 2
                )
            else:
                readings["_seconds_since_last_frame"] = -1

        # ---------------------------------------------------------------
        # Task 2: Vehicle State Inference
        # ---------------------------------------------------------------
        rpm = readings.get("engine_rpm", None)
        secs_since = readings.get("_seconds_since_last_frame", -1)
        frame_count = readings.get("_frame_count", 0)

        if frame_count == 0 or secs_since > 60 or secs_since == -1:
            readings["vehicle_state"] = "Truck Off"
        elif rpm is not None and rpm > 0:
            readings["vehicle_state"] = "Engine On"
        elif rpm is not None and rpm == 0:
            readings["vehicle_state"] = "Ignition On"
        elif rpm is None and secs_since >= 0 and secs_since < 60:
            # Receiving frames but no RPM decoded — could be KOEO
            has_any_data = any(
                k in readings for k in ("battery_voltage_v", "coolant_temp_f", "oil_pressure_psi")
            )
            readings["vehicle_state"] = "Ignition On" if has_any_data else "Unknown"
        else:
            readings["vehicle_state"] = "Unknown"

        # ---------------------------------------------------------------
        # Task 3: Derived Fleet Metrics
        # ---------------------------------------------------------------
        now = time.time()
        speed = readings.get("vehicle_speed_mph", 0) or 0
        accel = readings.get("accel_pedal_pos_pct", 0) or 0
        pto = readings.get("pto_engaged", None)

        # Idle Waste: engine on, not moving, PTO not engaged
        readings["idle_waste_active"] = (
            readings["vehicle_state"] == "Engine On"
            and speed == 0
            and (pto is None or pto == 0)
        )

        # Harsh Behavior: rapid delta in speed or accelerator pedal
        dt = now - self._prev_readings_time if self._prev_readings_time > 0 else 1.0
        if dt > 0 and dt < 10:  # only valid for consecutive 1Hz readings
            speed_delta = abs(speed - self._prev_speed)
            accel_delta = abs(accel - self._prev_accel_pedal)
            # Thresholds: >7 mph/s decel = hard brake, >30% pedal change/s = aggressive
            readings["harsh_braking"] = speed_delta > 7 and speed < self._prev_speed
            readings["harsh_acceleration"] = accel_delta > 30
            readings["harsh_behavior_flag"] = readings["harsh_braking"] or readings["harsh_acceleration"]
        else:
            readings["harsh_braking"] = False
            readings["harsh_acceleration"] = False
            readings["harsh_behavior_flag"] = False

        self._prev_speed = speed
        self._prev_accel_pedal = accel
        self._prev_readings_time = now

        # ---------------------------------------------------------------
        # Task 3b: Additional Derived Fleet Metrics
        # ---------------------------------------------------------------
        fuel_rate = readings.get("fuel_rate_gph", None)
        engine_hours = readings.get("engine_hours", None)
        idle_hours = readings.get("idle_engine_hours", None)
        idle_fuel = readings.get("idle_fuel_used_gal", None)
        total_fuel = readings.get("total_fuel_used_gal", None)
        distance = readings.get("vehicle_distance_hr_mi", None) or readings.get("vehicle_distance_mi", None)

        # Fuel cost per hour (assume $3.80/gal diesel)
        FUEL_PRICE = 3.80
        if fuel_rate is not None and fuel_rate > 0:
            readings["fuel_cost_per_hour"] = round(fuel_rate * FUEL_PRICE, 2)

        # Idle waste dollars
        if idle_fuel is not None:
            readings["idle_waste_dollars"] = round(idle_fuel * FUEL_PRICE, 2)

        # Idle percentage
        if idle_hours is not None and engine_hours is not None and engine_hours > 0:
            readings["idle_pct"] = round((idle_hours / engine_hours) * 100, 1)

        # Cost per mile — use instantaneous fuel economy, not lifetime totals
        fuel_econ = readings.get("fuel_economy_mpg", None)
        if fuel_econ is not None and fuel_econ > 0:
            readings["fuel_cost_per_mile"] = round(FUEL_PRICE / fuel_econ, 3)
        elif total_fuel is not None and distance is not None and distance > 100:
            # Fallback to lifetime average only if we have significant distance
            readings["fuel_cost_per_mile"] = round((total_fuel * FUEL_PRICE) / distance, 3)

        # PTO duty cycle
        pto_status = readings.get("pto_engaged", None)
        if pto_status is not None and engine_hours is not None and engine_hours > 0:
            # We track PTO state — can estimate from idle vs PTO
            readings["pto_active"] = pto_status > 0

        # DPF health indicator
        soot = readings.get("dpf_soot_load_pct", None)
        if soot is not None:
            if soot > 80:
                readings["dpf_health"] = "CRITICAL"
            elif soot > 60:
                readings["dpf_health"] = "WARNING"
            else:
                readings["dpf_health"] = "OK"

        # DEF level alert
        def_level = readings.get("def_level_pct", None)
        if def_level is not None:
            readings["def_low"] = def_level < 15

        # Battery health — 12.0-12.6V is normal for engine-off, 13.5-14.5V for running
        batt = readings.get("battery_voltage_v", None)
        rpm = readings.get("engine_rpm", 0) or 0
        if batt is not None:
            if rpm > 0:
                # Engine running — alternator should be charging
                if batt < 13.0:
                    readings["battery_health"] = "LOW"
                elif batt > 15.0:
                    readings["battery_health"] = "OVERCHARGE"
                else:
                    readings["battery_health"] = "OK"
            else:
                # Engine off — resting voltage
                if batt < 11.5:
                    readings["battery_health"] = "CRITICAL"
                elif batt < 12.0:
                    readings["battery_health"] = "LOW"
                else:
                    readings["battery_health"] = "OK"

        # ---------------------------------------------------------------
        # System health + offline buffer
        # ---------------------------------------------------------------
        try:
            readings.update(get_system_health())
        except Exception:
            pass  # health data is optional

        # Persist to local offline buffer (survives reboots + cloud outages)
        if self._offline_buffer is not None:
            self._offline_buffer.write(readings)

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
            # Route to OBD-II poller if in OBD-II mode
            if self._protocol == "obd2" and self._obd2_poller:
                return self._obd2_poller.clear_dtcs()
            return await self._clear_dtcs()
        elif cmd == "get_freeze_frame":
            if self._protocol == "obd2" and self._obd2_poller and self._obd2_poller._advanced_diag:
                return {"success": True, "freeze_frame": self._obd2_poller._advanced_diag.get_freeze_frame()}
            return {"error": "Freeze frame only available in OBD-II mode"}
        elif cmd == "get_readiness":
            if self._protocol == "obd2" and self._obd2_poller and self._obd2_poller._advanced_diag:
                return {"success": True, "readiness": self._obd2_poller._advanced_diag.get_readiness_monitors()}
            return {"error": "Readiness monitors only available in OBD-II mode"}
        elif cmd == "get_pending_dtcs":
            if self._protocol == "obd2" and self._obd2_poller and self._obd2_poller._advanced_diag:
                return {"success": True, "pending_dtcs": self._obd2_poller._advanced_diag.get_pending_dtcs()}
            return {"error": "Pending DTCs only available in OBD-II mode"}
        elif cmd == "get_permanent_dtcs":
            if self._protocol == "obd2" and self._obd2_poller and self._obd2_poller._advanced_diag:
                return {"success": True, "permanent_dtcs": self._obd2_poller._advanced_diag.get_permanent_dtcs()}
            return {"error": "Permanent DTCs only available in OBD-II mode"}
        elif cmd == "get_vin":
            if self._protocol == "obd2" and self._obd2_poller and self._obd2_poller._advanced_diag:
                vin = self._obd2_poller._advanced_diag.get_vin()
                return {"success": bool(vin), "vin": vin}
            return {"error": "VIN query only available in OBD-II mode"}
        elif cmd == "get_history":
            return self._get_history(command.get("days", 7))
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
                    "available": ["clear_dtcs", "get_freeze_frame",
                                  "get_readiness", "get_pending_dtcs",
                                  "get_permanent_dtcs", "get_vin",
                                  "request_pgn", "get_supported_pgns",
                                  "get_bus_stats", "send_raw"]}

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

    def _get_history(self, days: int = 7) -> dict[str, Any]:
        """Read historical data from the offline JSONL buffer and return summary + time series."""
        import glob as _glob

        buffer_dir = getattr(self, '_offline_buffer', None)
        if buffer_dir is None:
            return {"error": "No offline buffer configured", "totalPoints": 0}

        buf_path = buffer_dir._dir

        # Read JSONL files line by line — filter as we go to keep memory low on Pi Zero (512MB)
        all_points = []
        for d in range(min(int(days), 7)):
            if len(all_points) >= 3600:
                break
            ts = time.time() - d * 86400
            date_str = time.strftime("%Y%m%d", time.localtime(ts))
            path = os.path.join(buf_path, f"readings_{date_str}.jsonl")
            if os.path.exists(path):
                try:
                    with open(path, "r") as f:
                        for line in f:
                            try:
                                pt = json.loads(line.strip())
                                if pt.get("_bus_connected") or (isinstance(pt.get("engine_rpm"), (int, float)) and pt["engine_rpm"] > 0):
                                    all_points.append(pt)
                                    if len(all_points) >= 3600:
                                        break
                            except (json.JSONDecodeError, ValueError):
                                pass
                except OSError:
                    pass

        if not all_points:
            return {"totalPoints": 0, "source": "offline-buffer", "summary": None}

        all_points.sort(key=lambda p: p.get("epoch", 0))

        def _nums(key):
            return [p[key] for p in all_points if isinstance(p.get(key), (int, float)) and p[key] != 0]

        def _avg(arr):
            return round(sum(arr) / len(arr), 2) if arr else 0

        first, last = all_points[0], all_points[-1]
        total_min = round((last.get("epoch", 0) - first.get("epoch", 0)) / 60)

        # DTC events
        dtc_events = []
        prev_count = 0
        for p in all_points:
            c = p.get("active_dtc_count", 0) or 0
            if c > 0 and c != prev_count:
                for i in range(min(int(c), 5)):
                    code = p.get(f"obd2_dtc_{i}")
                    if code:
                        dtc_events.append({"timestamp": p.get("ts", ""), "code": str(code)})
            prev_count = c

        rpms = _nums("engine_rpm")
        coolants = _nums("coolant_temp_f")
        speeds = [p.get("vehicle_speed_mph", 0) for p in all_points if isinstance(p.get("vehicle_speed_mph"), (int, float))]
        batts = _nums("battery_voltage_v")
        fuels = _nums("fuel_level_pct")
        st = [p.get("short_fuel_trim_b1_pct", 0) for p in all_points if isinstance(p.get("short_fuel_trim_b1_pct"), (int, float))]
        lt = [p.get("long_fuel_trim_b1_pct", 0) for p in all_points if isinstance(p.get("long_fuel_trim_b1_pct"), (int, float))]

        # Downsample time series (max 100 points to keep response under 50KB for WebRTC)
        step = max(1, len(all_points) // 100)
        ts_data = []
        for i in range(0, len(all_points), step):
            p = all_points[i]
            ts_data.append({
                "t": p.get("ts", ""),
                "rpm": p.get("engine_rpm", 0),
                "coolant_f": p.get("coolant_temp_f", 0),
                "speed_mph": p.get("vehicle_speed_mph", 0),
                "battery_v": p.get("battery_voltage_v", 0),
                "fuel_pct": p.get("fuel_level_pct", 0),
                "short_trim": p.get("short_fuel_trim_b1_pct", 0),
                "long_trim": p.get("long_fuel_trim_b1_pct", 0),
            })

        return {
            "totalPoints": len(all_points),
            "source": "offline-buffer",
            "totalMinutes": total_min,
            "periodStart": first.get("ts", ""),
            "periodEnd": last.get("ts", ""),
            "summary": {
                "engine_rpm": {"avg": round(_avg(rpms)), "max": max(rpms) if rpms else 0, "min": min(rpms) if rpms else 0},
                "coolant_temp_f": {"avg": round(_avg(coolants), 1), "max": round(max(coolants), 1) if coolants else 0, "min": round(min(coolants), 1) if coolants else 0},
                "vehicle_speed_mph": {"avg": round(_avg(speeds), 1), "max": round(max(speeds), 1) if speeds else 0},
                "battery_voltage_v": {"avg": round(_avg(batts), 2), "min": round(min(batts), 2) if batts else 0, "max": round(max(batts), 2) if batts else 0},
                "fuel_level_pct": {"start": round(fuels[0], 1) if fuels else 0, "end": round(fuels[-1], 1) if fuels else 0, "consumed": round(fuels[0] - fuels[-1], 1) if fuels else 0},
                "short_fuel_trim_b1_pct": {"avg": round(_avg(st), 2), "min": round(min(st), 2) if st else 0, "max": round(max(st), 2) if st else 0},
                "long_fuel_trim_b1_pct": {"avg": round(_avg(lt), 2), "min": round(min(lt), 2) if lt else 0, "max": round(max(lt), 2) if lt else 0},
            },
            "dtcEvents": dtc_events,
            "timeSeries": ts_data,
        }

    async def close(self):
        """Clean up CAN bus resources."""
        LOGGER.info(f"Closing J1939 sensor {self.name}")
        self._stop_listener()
        if self._obd2_poller:
            self._obd2_poller.stop()
            self._obd2_poller = None
