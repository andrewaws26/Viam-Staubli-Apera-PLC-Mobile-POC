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
import subprocess
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
    decode_dm1_lamps,
    extract_pgn_from_can_id,
    extract_source_address,
    get_supported_pgns,
    is_proprietary_pgn,
    classify_pgn,
)
from .obd2_poller import OBD2Poller
from .vehicle_profiles import (
    VehicleProfile,
    discover_broadcast_pgns,
    discover_supported_pids,
    get_or_create_profile,
    profile_needs_discovery,
    save_profile,
)

LOGGER = getLogger(__name__)

# Default offline buffer config
_DEFAULT_BUFFER_DIR = "/home/andrew/.viam/offline-buffer/truck"
_DEFAULT_BUFFER_MAX_MB = 50.0

# VIN cache — persists last successful VIN read across restarts
_VIN_CACHE_PATH = "/home/andrew/.viam/last-vin.json"

# J1939 source address → human suffix mapping for DTC and lamp namespacing.
# Pre-2013 Mack/Volvo trucks may only broadcast from SA 0x00 (engine) and
# SA 0x3D (aftertreatment). The code is tolerant of missing SAs — readings
# only get populated when frames actually arrive on the bus.
_SA_SUFFIX = {
    0x00: "engine",
    0x03: "trans",
    0x0B: "abs",
    0x17: "inst",
    0x21: "body",
    0x3D: "acm",
}


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


# Default proprietary PGN capture config
_DEFAULT_PROP_LOG_DIR = "/home/andrew/.viam/proprietary-pgns"
_DEFAULT_PROP_LOG_MAX_MB = 100.0
_PROP_SAMPLE_INTERVAL = 10.0  # seconds between logging same PGN (avoid flooding)


class ProprietaryPGNTracker:
    """Tracks proprietary J1939 PGN traffic for reverse engineering.

    Records statistics and raw payloads for PGNs in the proprietary ranges
    (Proprietary A: 0xEF00, Proprietary B: 0xFF00-0xFFFF) that the standard
    decoder cannot interpret. Writes raw captures to JSONL files for offline
    analysis with SavvyCAN or CAN_Reverse_Engineering tools.
    """

    def __init__(self, log_dir: str = _DEFAULT_PROP_LOG_DIR,
                 max_mb: float = _DEFAULT_PROP_LOG_MAX_MB):
        self._stats: dict[int, dict] = {}  # pgn -> stats dict
        self._log_dir = log_dir
        self._max_bytes = int(max_mb * 1024 * 1024)
        self._last_log_time: dict[int, float] = {}  # pgn -> last log timestamp
        os.makedirs(self._log_dir, exist_ok=True)
        LOGGER.info("ProprietaryPGNTracker: log_dir=%s max_mb=%.0f", log_dir, max_mb)

    def record(self, pgn: int, sa: int, data: bytes, can_id: int) -> None:
        """Record a proprietary PGN frame."""
        now = time.time()
        data_hex = data.hex()
        pgn_type = classify_pgn(pgn)

        # Update in-memory stats
        if pgn not in self._stats:
            self._stats[pgn] = {
                "pgn": pgn,
                "pgn_hex": f"0x{pgn:04X}",
                "type": pgn_type,
                "count": 0,
                "source_addresses": set(),
                "first_seen": now,
                "last_seen": now,
                "last_data": data_hex,
                "data_length": len(data),
                "unique_payloads": 0,
                "_seen_payloads": set(),
            }

        s = self._stats[pgn]
        s["count"] += 1
        s["source_addresses"].add(sa)
        s["last_seen"] = now
        s["last_data"] = data_hex
        if data_hex not in s["_seen_payloads"]:
            s["_seen_payloads"].add(data_hex)
            s["unique_payloads"] = len(s["_seen_payloads"])

        # Rate-limited JSONL logging for offline analysis
        last = self._last_log_time.get(pgn, 0)
        if now - last >= _PROP_SAMPLE_INTERVAL:
            self._last_log_time[pgn] = now
            self._write_log(pgn, sa, can_id, data_hex, now)

    def _write_log(self, pgn: int, sa: int, can_id: int,
                   data_hex: str, ts: float) -> None:
        """Append a raw capture line to the date-stamped JSONL log."""
        date_str = time.strftime("%Y%m%d")
        path = os.path.join(self._log_dir, f"prop_pgns_{date_str}.jsonl")
        record = json.dumps({
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(ts)),
            "epoch": round(ts, 3),
            "can_id": f"0x{can_id:08X}",
            "pgn": pgn,
            "pgn_hex": f"0x{pgn:04X}",
            "sa": sa,
            "sa_hex": f"0x{sa:02X}",
            "data": data_hex,
            "dlc": len(data_hex) // 2,
        }, separators=(",", ":"))
        try:
            with open(path, "a") as f:
                f.write(record + "\n")
        except Exception as exc:
            LOGGER.warning("Proprietary log write failed: %s", exc)
            return
        self._maybe_prune()

    def _maybe_prune(self) -> None:
        """Remove oldest log files if total size exceeds cap."""
        try:
            files = sorted(
                (os.path.join(self._log_dir, f)
                 for f in os.listdir(self._log_dir) if f.endswith(".jsonl")),
                key=os.path.getmtime,
            )
            total = sum(os.path.getsize(f) for f in files)
            while total > self._max_bytes and len(files) > 1:
                oldest = files.pop(0)
                size = os.path.getsize(oldest)
                os.remove(oldest)
                total -= size
                LOGGER.info("Proprietary log pruned %s (%.1f KB)", oldest, size / 1024)
        except Exception:
            LOGGER.debug("Failed to prune proprietary log files")

    def get_summary(self) -> dict[str, Any]:
        """Return summary stats for get_readings() — lightweight."""
        prop_a = sum(1 for s in self._stats.values() if s["type"] == "proprietary_a")
        prop_b = sum(1 for s in self._stats.values() if s["type"] == "proprietary_b")
        total_frames = sum(s["count"] for s in self._stats.values())
        return {
            "proprietary_pgn_count": len(self._stats),
            "proprietary_a_count": prop_a,
            "proprietary_b_count": prop_b,
            "proprietary_total_frames": total_frames,
        }

    def get_detailed(self) -> list[dict]:
        """Return detailed per-PGN stats for do_command — full info."""
        result = []
        for pgn in sorted(self._stats.keys()):
            s = self._stats[pgn]
            result.append({
                "pgn": s["pgn"],
                "pgn_hex": s["pgn_hex"],
                "type": s["type"],
                "count": s["count"],
                "source_addresses": sorted(s["source_addresses"]),
                "unique_payloads": s["unique_payloads"],
                "data_length": s["data_length"],
                "last_data": s["last_data"],
                "first_seen": time.strftime(
                    "%Y-%m-%dT%H:%M:%SZ", time.gmtime(s["first_seen"])),
                "last_seen": time.strftime(
                    "%Y-%m-%dT%H:%M:%SZ", time.gmtime(s["last_seen"])),
                "rate_per_min": round(
                    s["count"] / max(1, (s["last_seen"] - s["first_seen"]) / 60), 1),
            })
        return result

    def reset(self) -> None:
        """Clear all in-memory stats (logs on disk are preserved)."""
        self._stats.clear()
        self._last_log_time.clear()


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
        self._config_protocol = "j1939"  # raw config value before auto-detect
        # Protocol re-detection state (auto mode only)
        self._redetect_extended = 0
        self._redetect_standard = 0
        self._redetect_mismatch_count = 0
        self._last_redetect_check = 0.0
        self._pending_protocol_switch: str | None = None
        # Bitrate auto-negotiation state
        self._current_bitrate = 500000
        self._configured_bitrate = 500000
        self._auto_bitrate = False
        self._bitrate_candidates: list[int] = [500000, 250000, 125000]
        self._pending_bitrate_negotiation = False
        self._last_negotiation_time = 0.0
        self._last_any_frame_time: float = 0
        self._obd2_bus_lost_time: float = 0
        self._offline_buffer: OfflineBuffer | None = None
        # VIN tracking
        self._vehicle_vin: str = "UNKNOWN"
        self._vin_thread: threading.Thread | None = None
        # Vehicle profile (populated after VIN read)
        self._vehicle_profile: VehicleProfile | None = None
        self._discovery_status: str = ""  # "", "cached", "running", "complete"
        self._profile_applied = False  # True once profile fields emitted
        # Proprietary PGN capture
        self._prop_tracker: ProprietaryPGNTracker | None = None
        self._capture_proprietary = True
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
            valid_bitrates = [125000, 250000, 500000, 1000000]
            if br not in valid_bitrates:
                raise ValueError(
                    f"bitrate must be one of {valid_bitrates}, got {br}"
                )
        protocol = fields.get("protocol")
        if protocol and protocol.string_value:
            if protocol.string_value not in ("j1939", "obd2", "auto"):
                raise ValueError(
                    f"protocol must be 'j1939', 'obd2', or 'auto', got '{protocol.string_value}'"
                )
        return [], []

    def reconfigure(self, config: ComponentConfig,
                    dependencies: Mapping[ResourceName, ResourceBase]) -> None:
        # Stop existing listener / poller if running
        self._stop_listener()
        if self._obd2_poller:
            self._obd2_poller.stop()
            self._obd2_poller = None
        self._vehicle_vin = "UNKNOWN"
        self._vin_thread = None
        self._vehicle_profile = None
        self._discovery_status = ""
        self._profile_applied = False

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

        # Save raw config protocol and reset re-detection state
        self._config_protocol = self._protocol
        self._redetect_extended = 0
        self._redetect_standard = 0
        self._redetect_mismatch_count = 0
        self._last_redetect_check = time.time()
        self._pending_protocol_switch = None

        # Bitrate auto-negotiation config
        self._configured_bitrate = self._bitrate
        self._current_bitrate = self._bitrate
        if "auto_bitrate" in fields:
            self._auto_bitrate = bool(fields["auto_bitrate"].bool_value)
        else:
            # Default: auto-bitrate ON when protocol is "auto", OFF otherwise
            self._auto_bitrate = self._config_protocol == "auto"
        if "bitrate_candidates" in fields and fields["bitrate_candidates"].list_value:
            self._bitrate_candidates = [
                int(v.number_value)
                for v in fields["bitrate_candidates"].list_value.values
            ]
        else:
            self._bitrate_candidates = [500000, 250000, 125000]
        self._pending_bitrate_negotiation = False
        self._last_negotiation_time = 0.0
        self._last_any_frame_time = 0
        self._obd2_bus_lost_time = 0

        # Offline buffer — local JSONL backup for when cloud sync fails
        buf_dir = _DEFAULT_BUFFER_DIR
        buf_max_mb = _DEFAULT_BUFFER_MAX_MB
        if "offline_buffer_dir" in fields and fields["offline_buffer_dir"].string_value:
            buf_dir = fields["offline_buffer_dir"].string_value
        if "offline_buffer_max_mb" in fields and fields["offline_buffer_max_mb"].number_value:
            buf_max_mb = fields["offline_buffer_max_mb"].number_value
        self._offline_buffer = OfflineBuffer(buf_dir, buf_max_mb)

        # Proprietary PGN capture — logs raw proprietary traffic for RE
        self._capture_proprietary = True
        if "capture_proprietary" in fields:
            self._capture_proprietary = bool(fields["capture_proprietary"].bool_value)
        if self._capture_proprietary:
            prop_dir = _DEFAULT_PROP_LOG_DIR
            prop_max = _DEFAULT_PROP_LOG_MAX_MB
            if "proprietary_log_dir" in fields and fields["proprietary_log_dir"].string_value:
                prop_dir = fields["proprietary_log_dir"].string_value
            if "proprietary_log_max_mb" in fields and fields["proprietary_log_max_mb"].number_value:
                prop_max = fields["proprietary_log_max_mb"].number_value
            self._prop_tracker = ProprietaryPGNTracker(prop_dir, prop_max)
        else:
            self._prop_tracker = None

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
            self._dtc_by_source = {}  # SA -> list of DTC dicts, for per-ECU tracking
            self._frame_count = 0

        # Bitrate auto-negotiation on startup
        if self._auto_bitrate:
            LOGGER.info(
                "Auto-bitrate enabled — probing for CAN traffic on %s...",
                self._can_interface,
            )
            found = self._negotiate_bitrate()
            if found:
                LOGGER.info(
                    "Startup bitrate negotiation: traffic found at %d bps",
                    self._current_bitrate,
                )
            else:
                LOGGER.warning(
                    "Startup bitrate negotiation: no traffic found — "
                    "using configured %d bps",
                    self._configured_bitrate,
                )

        # Start the appropriate protocol handler
        if self._protocol == "auto":
            # Auto-detect: listen passively for 3 seconds to determine protocol
            LOGGER.info("Auto-detecting protocol (listening for 3 seconds)...")
            detected = self._auto_detect_protocol()
            LOGGER.info(f"Auto-detected protocol: {detected}")
            self._protocol = detected

        if self._protocol == "obd2":
            LOGGER.warning(
                "OBD-II mode TRANSMITS on the CAN bus. "
                "DO NOT use on J1939 heavy-duty trucks — use 'j1939' protocol instead. "
                "OBD-II polling sends request frames that can cause DTCs on truck ECUs."
            )
            self._obd2_poller = OBD2Poller(
                can_interface=self._can_interface,
                bus_type=self._bus_type,
                bitrate=self._bitrate,
            )
            self._obd2_poller.start()
            LOGGER.info("Configured in OBD-II polling mode (ACTIVE — transmits on bus)")
            if self._config_protocol == "auto":
                self._start_listener()
                LOGGER.info("Passive CAN listener started for protocol re-detection")
        else:
            self._start_listener()
            LOGGER.info("Configured in J1939 passive listener mode (LISTEN-ONLY — no transmissions)")

        # Read VIN in background (needs protocol handler running first)
        threading.Thread(
            target=self._start_vin_reading,
            daemon=True,
            name="vin-init",
        ).start()

    def _auto_detect_protocol(self) -> str:
        """
        Listen passively on the CAN bus for 3 seconds to determine protocol.

        J1939 uses 29-bit extended CAN IDs (is_extended_id=True).
        OBD-II passenger vehicles use 11-bit standard CAN IDs.

        Returns "j1939" or "obd2" based on what's seen on the bus.
        Falls back to "j1939" (safe, listen-only) if no traffic detected.
        """
        try:
            import can
            bus = can.Bus(
                channel=self._can_interface,
                interface=self._bus_type,
                bitrate=self._bitrate,
                receive_own_messages=False,
            )
            extended_count = 0
            standard_count = 0
            deadline = time.time() + 3.0

            while time.time() < deadline:
                msg = bus.recv(timeout=0.5)
                if msg is None:
                    continue
                if msg.is_extended_id:
                    extended_count += 1
                else:
                    standard_count += 1

            bus.shutdown()

            total = extended_count + standard_count
            if total == 0:
                LOGGER.warning("No CAN traffic detected during auto-detect. Defaulting to j1939 (safe).")
                return "j1939"

            # J1939 = predominantly extended IDs, OBD2 = predominantly standard IDs
            if extended_count > standard_count:
                LOGGER.info(f"Auto-detect: {extended_count} extended vs {standard_count} standard IDs → J1939")
                return "j1939"
            else:
                LOGGER.info(f"Auto-detect: {standard_count} standard vs {extended_count} extended IDs → OBD-II")
                return "obd2"

        except Exception as e:
            LOGGER.warning(f"Auto-detect failed ({e}). Defaulting to j1939 (safe).")
            return "j1939"

    # ---------------------------------------------------------------
    # CAN Bitrate Auto-Negotiation
    # ---------------------------------------------------------------

    def _set_can_bitrate(self, interface: str, bitrate: int):
        """Cycle CAN interface down/configure/up to change bitrate.

        Requires root (viam-server runs as root).
        Invalidates all existing CAN sockets on this interface.
        """
        LOGGER.debug("Setting %s bitrate to %d", interface, bitrate)
        subprocess.run(
            ["ip", "link", "set", interface, "down"], check=True,
        )
        subprocess.run(
            ["ip", "link", "set", interface, "type", "can",
             "bitrate", str(bitrate)],
            check=True,
        )
        subprocess.run(
            ["ip", "link", "set", interface, "up"], check=True,
        )

    def _negotiate_bitrate(self) -> bool:
        """Cycle through candidate bitrates to find one producing CAN traffic.

        Tries the current bitrate first (10-second window), then each
        candidate from the configured list.  Returns True if a working
        bitrate was found, False if all candidates were exhausted.

        On failure, restores the configured bitrate and sets a cooldown
        so the next attempt is delayed by 60 seconds.
        """
        # Build deduplicated candidate list: current first, then configured list
        candidates = [self._current_bitrate]
        for b in self._bitrate_candidates:
            if b not in candidates:
                candidates.append(b)

        for bitrate in candidates:
            LOGGER.info(
                "Bitrate negotiation: trying %d bps on %s",
                bitrate, self._can_interface,
            )
            try:
                self._set_can_bitrate(self._can_interface, bitrate)
            except Exception as e:
                LOGGER.error(
                    "Failed to set CAN bitrate %d on %s: %s",
                    bitrate, self._can_interface, e,
                    exc_info=True,
                )
                continue

            # Probe for traffic — 10-second window
            found = False
            bus = None
            try:
                import can
                bus = can.Bus(
                    channel=self._can_interface,
                    interface=self._bus_type,
                    receive_own_messages=False,
                )
                deadline = time.time() + 10.0
                while time.time() < deadline:
                    msg = bus.recv(timeout=1.0)
                    if msg is not None:
                        found = True
                        break
            except Exception as e:
                LOGGER.error(
                    "Error probing CAN at %d bps: %s", bitrate, e,
                    exc_info=True,
                )
            finally:
                if bus:
                    try:
                        bus.shutdown()
                    except Exception:
                        LOGGER.debug("Failed to shutdown CAN bus after bitrate probe")

            if found:
                old = self._current_bitrate
                self._current_bitrate = bitrate
                self._bitrate = bitrate
                if old != bitrate:
                    LOGGER.info(
                        "CAN bitrate changed: %d → %d on %s",
                        old, bitrate, self._can_interface,
                    )
                else:
                    LOGGER.info(
                        "CAN bitrate confirmed: %d bps on %s",
                        bitrate, self._can_interface,
                    )
                self._last_negotiation_time = time.time()
                return True

        # All candidates exhausted — restore configured bitrate
        LOGGER.warning(
            "All bitrate candidates failed on %s. "
            "Restoring configured bitrate %d. Will retry in 60 seconds.",
            self._can_interface, self._configured_bitrate,
        )
        try:
            self._set_can_bitrate(self._can_interface, self._configured_bitrate)
        except Exception as e:
            LOGGER.error("Failed to restore configured bitrate: %s", e, exc_info=True)
        self._current_bitrate = self._configured_bitrate
        self._bitrate = self._configured_bitrate
        self._last_negotiation_time = time.time()
        return False

    def _maybe_trigger_bitrate_negotiation(self):
        """Check if bus silence warrants bitrate negotiation.

        Called from _listen_loop on recv timeout (~1-second intervals).
        Sets _pending_bitrate_negotiation which is executed from
        get_readings() on the next 1 Hz tick.
        """
        if not self._auto_bitrate:
            return
        if self._pending_bitrate_negotiation:
            return

        now = time.time()

        # Cooldown: don't renegotiate within 60 seconds of last attempt
        if now - self._last_negotiation_time < 60:
            return

        # Check silence based on last received frame (any type)
        if self._last_any_frame_time > 0:
            silence = now - self._last_any_frame_time
            if silence > 30:
                LOGGER.warning(
                    "No CAN traffic for %.0f seconds on %s — "
                    "triggering bitrate negotiation",
                    silence, self._can_interface,
                )
                self._pending_bitrate_negotiation = True
        elif self._last_negotiation_time > 0 and now - self._last_negotiation_time > 60:
            # Never received any frames since last negotiation attempt
            LOGGER.warning(
                "No CAN traffic received on %s — "
                "triggering bitrate renegotiation",
                self._can_interface,
            )
            self._pending_bitrate_negotiation = True

    def _execute_bitrate_negotiation(self):
        """Execute pending bitrate negotiation.

        Stops all CAN handlers, cycles through bitrates, re-detects
        protocol if in auto mode, and restarts the appropriate handler.
        Called from get_readings().
        """
        LOGGER.info("Executing bitrate negotiation on %s", self._can_interface)

        # Stop all handlers BEFORE cycling the interface
        if self._obd2_poller:
            self._obd2_poller.stop()
            self._obd2_poller = None
        self._stop_listener()

        # Run negotiation
        found = self._negotiate_bitrate()

        if not found:
            LOGGER.warning(
                "Bitrate negotiation failed — restarting with %d bps, "
                "will retry in 60 seconds",
                self._configured_bitrate,
            )
            if self._config_protocol == "auto":
                self._protocol = "j1939"  # safe default
            self._start_listener()
            return

        # Bitrate found — re-detect protocol if in auto mode
        if self._config_protocol == "auto":
            detected = self._auto_detect_protocol()
            if detected != self._protocol:
                LOGGER.info(
                    "Protocol changed after bitrate negotiation: %s → %s",
                    self._protocol, detected,
                )
            self._protocol = detected

            # Reset re-detection counters
            self._redetect_mismatch_count = 0
            self._redetect_extended = 0
            self._redetect_standard = 0
            self._last_redetect_check = time.time()

        # Reset readings for clean start
        with self._readings_lock:
            self._readings = {}
            self._dtc_by_source = {}
            self._frame_count = 0
        self._last_any_frame_time = 0
        self._obd2_bus_lost_time = 0

        # Start appropriate handler
        if self._protocol == "obd2":
            LOGGER.warning(
                "OBD-II mode TRANSMITS on the CAN bus. "
                "DO NOT use on J1939 heavy-duty trucks."
            )
            self._obd2_poller = OBD2Poller(
                can_interface=self._can_interface,
                bus_type=self._bus_type,
                bitrate=self._current_bitrate,
            )
            self._obd2_poller.start()
            if self._config_protocol == "auto":
                self._start_listener()
                LOGGER.info(
                    "Passive CAN listener started for protocol re-detection"
                )
        else:
            self._start_listener()

        LOGGER.info(
            "Bitrate negotiation complete: %d bps, protocol %s on %s",
            self._current_bitrate, self._protocol, self._can_interface,
        )

        # Re-read VIN for the (potentially different) vehicle
        self._vehicle_vin = "UNKNOWN"
        threading.Thread(
            target=self._start_vin_reading,
            daemon=True,
            name="vin-renegotiate",
        ).start()

    # ---------------------------------------------------------------
    # VIN Reading & Caching
    # ---------------------------------------------------------------

    def _start_vin_reading(self):
        """Attempt to read VIN on startup. Retries 3 times, falls back to cache."""
        # Give the protocol handler a moment to initialize
        time.sleep(3)

        for attempt in range(3):
            vin = self._read_vin()
            if vin and len(vin) >= 10:
                self._vehicle_vin = vin
                self._save_vin_cache()
                LOGGER.info(f"VIN read successfully: {vin}")
                self._load_vehicle_profile(vin)
                return
            if attempt < 2:
                time.sleep(2)

        # All retries failed — try loading from cache
        cached = self._load_vin_cache()
        if cached:
            self._vehicle_vin = cached
            LOGGER.warning(f"Using cached VIN: {cached} (live read failed)")
            self._load_vehicle_profile(cached)
            return

        LOGGER.warning("Could not read VIN — data will not be vehicle-tagged")

        # Continue retrying every 60 seconds in background
        self._vin_thread = threading.Thread(
            target=self._vin_retry_loop,
            daemon=True,
            name="vin-retry",
        )
        self._vin_thread.start()

    def _vin_retry_loop(self):
        """Background: retry VIN read every 60 seconds until successful."""
        while self._running:
            end = time.monotonic() + 60
            while self._running and time.monotonic() < end:
                time.sleep(min(1.0, end - time.monotonic()))
            if not self._running:
                break
            vin = self._read_vin()
            if vin and len(vin) >= 10:
                self._vehicle_vin = vin
                self._save_vin_cache()
                LOGGER.info(f"VIN read successfully (background retry): {vin}")
                self._load_vehicle_profile(vin)
                return

    def _read_vin(self) -> str:
        """Read VIN using the current protocol."""
        if self._protocol == "obd2" and self._obd2_poller:
            return self._obd2_poller.get_vin()
        elif self._protocol == "j1939":
            return self._read_vin_j1939()
        return ""

    def _read_vin_j1939(self) -> str:
        """Request VIN via J1939 PGN 65260 (Vehicle Identification)."""
        # First check if VIN was already decoded from passive listening
        with self._readings_lock:
            vin = self._readings.get("vin", "")
        if vin and len(vin) >= 10:
            return vin

        # Actively request PGN 65260
        if not self._bus:
            return ""
        try:
            import can
            pgn_bytes = struct.pack("<I", 65260)[:3]
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
            LOGGER.debug("Sent PGN 65260 request for VIN")

            # Wait up to 2 seconds for the TP response to be decoded by the listener
            for _ in range(20):
                time.sleep(0.1)
                with self._readings_lock:
                    vin = self._readings.get("vin", "")
                if vin and len(vin) >= 10:
                    return vin
        except Exception as e:
            LOGGER.debug(f"J1939 VIN request failed: {e}")
        return ""

    def _load_vin_cache(self) -> str | None:
        """Load cached VIN from disk. Returns VIN string or None."""
        try:
            with open(_VIN_CACHE_PATH, "r") as f:
                data = json.load(f)
                vin = data.get("vin", "")
                if vin and len(vin) >= 10:
                    return vin
        except (OSError, json.JSONDecodeError, ValueError):
            LOGGER.debug("Failed to load VIN cache from disk")
        return None

    def _save_vin_cache(self):
        """Save current VIN to disk cache."""
        try:
            os.makedirs(os.path.dirname(_VIN_CACHE_PATH), exist_ok=True)
            with open(_VIN_CACHE_PATH, "w") as f:
                json.dump({
                    "vin": self._vehicle_vin,
                    "protocol": self._protocol,
                    "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                }, f)
            LOGGER.debug(f"VIN cache saved: {self._vehicle_vin}")
        except OSError as e:
            LOGGER.warning(f"Failed to save VIN cache: {e}")

    # ---------------------------------------------------------------
    # Vehicle Profile & Discovery
    # ---------------------------------------------------------------

    def _load_vehicle_profile(self, vin: str):
        """Load or create a vehicle profile, then run discovery if needed.

        Called from the VIN-reading thread once a valid VIN is available.
        """
        try:
            profile = get_or_create_profile(vin)
            profile.protocol = profile.protocol or self._protocol
            self._vehicle_profile = profile

            if not profile_needs_discovery(profile):
                LOGGER.info(
                    "Vehicle profile loaded from cache: %s %s %s (%s)",
                    profile.year or "?", profile.make or "?",
                    profile.model or "?", vin,
                )
                self._discovery_status = "cached"
                # Apply cached adaptive polling
                self._apply_profile(profile)
                return

            # Discovery needed — run it in this thread (already background)
            self._discovery_status = "running"
            LOGGER.info(
                "Running %s discovery for %s %s %s (%s)...",
                self._protocol.upper(),
                profile.year or "?", profile.make or "?",
                profile.model or "?", vin,
            )
            self._run_discovery(profile)

        except Exception as e:
            LOGGER.error("Vehicle profile error for %s: %s", vin, e, exc_info=True)

    def _run_discovery(self, profile: VehicleProfile):
        """Execute PID or PGN discovery and persist the result."""
        try:
            if self._protocol == "obd2" and self._obd2_poller:
                self._run_pid_discovery(profile)
            elif self._protocol == "j1939":
                self._run_pgn_discovery(profile)

            profile.discovered_at = time.strftime(
                "%Y-%m-%dT%H:%M:%SZ", time.gmtime(),
            )
            save_profile(profile)
            self._discovery_status = "complete"
            self._apply_profile(profile)
        except Exception as e:
            LOGGER.error("Discovery failed for %s: %s", profile.vin, e, exc_info=True)
            self._discovery_status = "complete"

    def _run_pid_discovery(self, profile: VehicleProfile):
        """Discover supported OBD-II PIDs using Mode 01 bitmask chain."""
        import can

        bus = None
        try:
            bus = can.Bus(
                channel=self._can_interface,
                interface=self._bus_type,
                receive_own_messages=False,
            )
            configured = (
                self._obd2_poller.get_configured_pids()
                if self._obd2_poller else []
            )
            supported, unsupported = discover_supported_pids(bus, configured)
            profile.supported_pids = supported
            profile.unsupported_pids = unsupported

            LOGGER.info(
                "Vehicle %s supports %d of %d configured PIDs",
                profile.vin, len(supported), len(configured),
            )
            if unsupported:
                LOGGER.info(
                    "Unsupported PIDs for %s: %s",
                    profile.vin,
                    [f"0x{p:02X}" for p in unsupported],
                )
        except Exception as e:
            LOGGER.error("PID discovery error: %s", e, exc_info=True)
        finally:
            if bus:
                try:
                    bus.shutdown()
                except Exception:
                    LOGGER.debug("Failed to shutdown CAN bus after PID discovery")

    def _run_pgn_discovery(self, profile: VehicleProfile):
        """Discover broadcast PGNs by listening passively for 60 seconds."""
        import can

        bus = None
        try:
            bus = can.Bus(
                channel=self._can_interface,
                interface=self._bus_type,
                receive_own_messages=False,
            )
            expected = sorted(get_supported_pgns().keys())
            discovered, missing = discover_broadcast_pgns(
                bus, duration=60.0, expected_pgns=expected,
            )
            profile.supported_pgns = discovered
            profile.unsupported_pgns = missing

            LOGGER.info(
                "Vehicle %s broadcasts %d PGNs, %d expected PGNs missing",
                profile.vin, len(discovered), len(missing),
            )
            if missing:
                pgn_names = get_supported_pgns()
                missing_desc = [
                    f"{p} ({pgn_names.get(p, '?')})" for p in missing
                ]
                LOGGER.info(
                    "Missing PGNs for %s: %s", profile.vin, missing_desc,
                )
        except Exception as e:
            LOGGER.error("PGN discovery error: %s", e, exc_info=True)
        finally:
            if bus:
                try:
                    bus.shutdown()
                except Exception:
                    LOGGER.debug("Failed to shutdown CAN bus after PGN discovery")

    def _apply_profile(self, profile: VehicleProfile):
        """Apply discovered capabilities to the running protocol handler."""
        # OBD-II: restrict polling to supported PIDs
        if (self._protocol == "obd2" and self._obd2_poller
                and profile.supported_pids):
            self._obd2_poller.set_supported_pids(profile.supported_pids)
            LOGGER.info(
                "Adaptive polling active: %d PIDs for %s",
                len(profile.supported_pids), profile.vin,
            )

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
            LOGGER.error(f"Failed to start CAN listener: {e}", exc_info=True)
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
                LOGGER.debug("Failed to shutdown CAN bus in stop_listener")
            self._bus = None

    def _maybe_check_redetect(self):
        """Periodic check: does CAN traffic still match the active protocol?

        Called from _listen_loop on every recv. Short-circuits unless 30 seconds
        have elapsed since the last check. Counts extended (J1939) vs standard
        (OBD-II) frame IDs seen since the previous check.

        Safety: obd2->j1939 switches immediately on first mismatch (OBD-II
        transmissions can cause false DTCs on truck ECUs). j1939->obd2 requires
        3 consecutive agreeing checks (90 seconds).
        """
        if self._config_protocol != "auto":
            return
        if self._pending_protocol_switch:
            return  # switch already pending
        now = time.time()
        if now - self._last_redetect_check < 30.0:
            return
        self._last_redetect_check = now

        ext = self._redetect_extended
        std = self._redetect_standard
        self._redetect_extended = 0
        self._redetect_standard = 0

        total = ext + std
        LOGGER.info(
            "Protocol re-detect check: %d extended, %d standard frames (current: %s)",
            ext, std, self._protocol,
        )

        if total == 0:
            LOGGER.debug("No CAN traffic during re-detect window — keeping current protocol")
            self._redetect_mismatch_count = 0
            return

        detected = "j1939" if ext > std else "obd2"

        if detected == self._protocol:
            self._redetect_mismatch_count = 0
            return

        self._redetect_mismatch_count += 1

        # CRITICAL SAFETY: obd2 -> j1939 — stop OBD-II immediately
        # OBD-II transmits request frames that can cause false DTCs on truck ECUs
        if self._protocol == "obd2" and detected == "j1939":
            LOGGER.warning(
                "SAFETY: J1939 traffic detected while in OBD-II mode — "
                "stopping OBD-II polling IMMEDIATELY to prevent false DTCs"
            )
            if self._obd2_poller:
                self._obd2_poller.stop()
            self._pending_protocol_switch = detected
            return

        # j1939 -> obd2: require 3 consecutive agreeing checks (90 seconds)
        LOGGER.warning(
            "Protocol mismatch: current=%s, traffic suggests=%s (%d/3)",
            self._protocol, detected, self._redetect_mismatch_count,
        )
        if self._redetect_mismatch_count >= 3:
            self._pending_protocol_switch = detected

    def _execute_protocol_switch(self, new_protocol: str):
        """Switch the active protocol after re-detection confirmed a mismatch.

        Stops current handler, re-confirms with _auto_detect_protocol(), then
        starts the appropriate new handler.
        """
        old = self._protocol
        LOGGER.warning("Protocol switch detected: %s → %s, reinitializing", old, new_protocol)

        # Stop current handlers
        if self._obd2_poller:
            self._obd2_poller.stop()
            self._obd2_poller = None
        self._stop_listener()

        # Re-confirm with existing auto-detect method
        confirmed = self._auto_detect_protocol()
        LOGGER.info("Re-detect confirmation: %s", confirmed)
        self._protocol = confirmed

        # Reset re-detection state
        self._redetect_mismatch_count = 0
        self._redetect_extended = 0
        self._redetect_standard = 0
        self._last_redetect_check = time.time()

        # Reset readings for clean protocol start
        with self._readings_lock:
            self._readings = {}
            self._dtc_by_source = {}
            self._frame_count = 0

        # Start new protocol handler
        if self._protocol == "obd2":
            LOGGER.warning(
                "OBD-II mode TRANSMITS on the CAN bus. "
                "DO NOT use on J1939 heavy-duty trucks."
            )
            self._obd2_poller = OBD2Poller(
                can_interface=self._can_interface,
                bus_type=self._bus_type,
                bitrate=self._bitrate,
            )
            self._obd2_poller.start()
            # Continue monitoring for future switches
            self._start_listener()
            LOGGER.info("Passive CAN listener started for protocol re-detection")
        else:
            self._start_listener()

        LOGGER.info("Protocol switch complete: now running %s", self._protocol)

    def _listen_loop(self):
        """Background thread: read CAN frames and decode J1939 PGNs."""
        # J1939 Transport Protocol (TP) reassembly state
        # Key = (source_address, target_pgn), Value = {total_bytes, packets, data}
        tp_sessions: dict[tuple[int, int], dict] = {}

        while self._running and self._bus:
            try:
                msg = self._bus.recv(timeout=1.0)
                if msg is None:
                    self._maybe_check_redetect()
                    self._maybe_trigger_bitrate_negotiation()
                    continue

                # Track frame reception for bitrate negotiation
                self._last_any_frame_time = time.time()

                # Count frame types for protocol re-detection
                if msg.is_extended_id:
                    self._redetect_extended += 1
                else:
                    self._redetect_standard += 1
                self._maybe_check_redetect()

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

                # --- Proprietary PGN capture (runs even if not decoded) ---
                if not decoded and self._prop_tracker and is_proprietary_pgn(pgn):
                    self._prop_tracker.record(pgn, sa, msg.data, msg.arbitration_id)
                    # 0xFFCC: engine start counters (confirmed via RE)
                    if pgn == 0xFFCC and len(msg.data) >= 8:
                        with self._readings_lock:
                            self._readings["prop_start_counter_a"] = int.from_bytes(msg.data[0:4], "little")
                            self._readings["prop_start_counter_b"] = int.from_bytes(msg.data[4:8], "little")

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

                        # Per-ECU DM1 lamp and DTC tracking.
                        # Pre-2013 trucks may only broadcast from SA 0x00
                        # and SA 0x3D; other SAs are silently ignored if absent.
                        if pgn == 65226:
                            lamps = decode_dm1_lamps(msg.data)
                            suffix = _SA_SUFFIX.get(sa)
                            if suffix:
                                self._readings[f"protect_lamp_{suffix}"] = lamps.get("protect_lamp", 0)
                                self._readings[f"red_stop_lamp_{suffix}"] = lamps.get("red_stop_lamp", 0)
                                self._readings[f"amber_lamp_{suffix}"] = lamps.get("amber_warning_lamp", 0)
                                self._readings[f"mil_{suffix}"] = lamps.get("malfunction_lamp", 0)
                            # Single-frame DM1 DTCs are in `decoded`
                            # (from decode_can_frame → pgn_decoder).
                            # Namespace them per-source and recompute combined count.
                            self._apply_namespaced_dtcs(sa, decoded)

            except Exception as e:
                if self._running:
                    LOGGER.warning(f"CAN read error: {e}")
                    time.sleep(0.1)

    def _apply_namespaced_dtcs(self, sa: int, decoded: dict):
        """Write source-namespaced DTC keys and recompute combined count.

        Must be called while self._readings_lock is held.

        For each known source address (engine, trans, abs, etc.) we store
        dtc_{suffix}_count, dtc_{suffix}_N_spn/fmi/occurrence. The flat
        dtc_0_* keys are kept for backward compat, populated from the
        engine ECU (SA 0x00) as primary, falling back to whichever source
        has DTCs.
        """
        # Extract DTC list from decoded dict
        dtc_count = decoded.get("active_dtc_count", 0)
        dtcs = []
        for i in range(min(dtc_count, 10)):
            spn = decoded.get(f"dtc_{i}_spn")
            if spn is None:
                break
            dtcs.append({
                "spn": spn,
                "fmi": decoded.get(f"dtc_{i}_fmi", 0),
                "occurrence": decoded.get(f"dtc_{i}_occurrence", 0),
            })

        # Store per-source DTC list
        self._dtc_by_source[sa] = dtcs

        # Write source-namespaced keys
        suffix = _SA_SUFFIX.get(sa, f"sa{sa:02x}")
        self._readings[f"dtc_{suffix}_count"] = len(dtcs)
        for i, dtc in enumerate(dtcs[:10]):
            self._readings[f"dtc_{suffix}_{i}_spn"] = dtc["spn"]
            self._readings[f"dtc_{suffix}_{i}_fmi"] = dtc["fmi"]
            self._readings[f"dtc_{suffix}_{i}_occurrence"] = dtc["occurrence"]

        # Recompute combined active_dtc_count across all sources
        total = sum(len(d) for d in self._dtc_by_source.values())
        self._readings["active_dtc_count"] = total

        # Backward-compat flat dtc_0_* keys: prefer engine (SA 0x00),
        # fall back to first source that has DTCs
        primary_dtcs = self._dtc_by_source.get(0x00, [])
        if not primary_dtcs:
            for src_dtcs in self._dtc_by_source.values():
                if src_dtcs:
                    primary_dtcs = src_dtcs
                    break
        for i, dtc in enumerate(primary_dtcs[:10]):
            self._readings[f"dtc_{i}_spn"] = dtc["spn"]
            self._readings[f"dtc_{i}_fmi"] = dtc["fmi"]
            self._readings[f"dtc_{i}_occurrence"] = dtc["occurrence"]

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

        elif pgn == 65226:  # DM1 — multi-frame (>2 active DTCs)
            from .pgn_decoder import decode_dm1, decode_dm1_lamps
            lamps = decode_dm1_lamps(data)
            dtcs = decode_dm1(data)
            decoded.update(lamps)
            # Build flat dtc_N_* keys for decoded (will be namespaced below)
            decoded["active_dtc_count"] = len(dtcs)
            for i, dtc in enumerate(dtcs[:10]):
                decoded[f"dtc_{i}_spn"] = dtc["spn"]
                decoded[f"dtc_{i}_fmi"] = dtc["fmi"]
                decoded[f"dtc_{i}_occurrence"] = dtc["occurrence"]
            # Per-ECU lamp tracking (all known SAs)
            suffix = _SA_SUFFIX.get(sa)
            if suffix:
                decoded[f"protect_lamp_{suffix}"] = lamps.get("protect_lamp", 0)
                decoded[f"red_stop_lamp_{suffix}"] = lamps.get("red_stop_lamp", 0)
                decoded[f"amber_lamp_{suffix}"] = lamps.get("amber_warning_lamp", 0)
                decoded[f"mil_{suffix}"] = lamps.get("malfunction_lamp", 0)
            LOGGER.info("DM1 multi-frame from SA 0x%02X: %d DTCs, lamps=%s",
                        sa, len(dtcs), lamps)

        elif pgn == 65227:  # DM2 — multi-frame previously active DTCs
            from .pgn_decoder import decode_dm1, decode_dm1_lamps
            dtcs = decode_dm1(data)
            decoded["prev_dtc_count"] = len(dtcs)
            for i, dtc in enumerate(dtcs[:10]):
                decoded[f"prev_dtc_{i}_spn"] = dtc["spn"]
                decoded[f"prev_dtc_{i}_fmi"] = dtc["fmi"]
                decoded[f"prev_dtc_{i}_occurrence"] = dtc["occurrence"]
            LOGGER.info("DM2 multi-frame from SA 0x%02X: %d previously active DTCs", sa, len(dtcs))

        if decoded:
            with self._readings_lock:
                self._readings.update(decoded)
                self._frame_count += 1
                self._last_frame_time = time.time()
                # Namespace DM1 DTCs per source so multiple ECUs don't overwrite
                if pgn == 65226:
                    self._apply_namespaced_dtcs(sa, decoded)

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
        # Execute pending bitrate negotiation (priority over protocol switch)
        if self._pending_bitrate_negotiation:
            self._pending_bitrate_negotiation = False
            self._pending_protocol_switch = None  # negotiation includes protocol detection
            self._execute_bitrate_negotiation()

        # Execute pending protocol switch from re-detection
        if self._pending_protocol_switch:
            new_proto = self._pending_protocol_switch
            self._pending_protocol_switch = None
            self._execute_protocol_switch(new_proto)

        if self._protocol == "obd2" and self._obd2_poller:
            readings = self._obd2_poller.get_readings()
            readings["_can_interface"] = self._can_interface
            readings["_protocol"] = "obd2"
            readings["_bus_connected"] = self._obd2_poller.bus_connected
            readings["can_bitrate"] = self._current_bitrate
            # Provide frame metadata so vehicle state detection works for OBD2
            # Without these, defaults (0 / -1) always trigger "Truck Off"
            readings["_frame_count"] = self._obd2_poller._poll_count
            last_resp = self._obd2_poller._last_response_time
            if last_resp > 0:
                readings["_seconds_since_last_frame"] = round(
                    time.time() - last_resp, 2
                )
            else:
                readings["_seconds_since_last_frame"] = -1
        else:
            with self._readings_lock:
                readings = dict(self._readings)

            readings["_can_interface"] = self._can_interface
            readings["_protocol"] = "j1939"
            readings["_frame_count"] = self._frame_count
            readings["_bus_connected"] = self._bus is not None and self._running
            readings["can_bitrate"] = self._current_bitrate

            if self._last_frame_time > 0:
                readings["_seconds_since_last_frame"] = round(
                    time.time() - self._last_frame_time, 2
                )
            else:
                readings["_seconds_since_last_frame"] = -1

        # Track OBD-II bus loss for bitrate negotiation (non-auto protocol mode)
        if (self._auto_bitrate and self._protocol == "obd2"
                and self._obd2_poller and self._config_protocol != "auto"):
            if not self._obd2_poller.bus_connected:
                if self._obd2_bus_lost_time == 0:
                    self._obd2_bus_lost_time = time.time()
                elif (time.time() - self._obd2_bus_lost_time > 30
                      and time.time() - self._last_negotiation_time > 60):
                    LOGGER.warning(
                        "OBD-II bus disconnected for >30s — "
                        "triggering bitrate negotiation"
                    )
                    self._pending_bitrate_negotiation = True
            else:
                self._obd2_bus_lost_time = 0

        # VIN and protocol tagging — in EVERY reading for Viam Data API filtering
        readings["vehicle_vin"] = self._vehicle_vin
        readings["vehicle_protocol"] = self._protocol

        # Vehicle profile fields — in EVERY reading for dashboard display
        profile = self._vehicle_profile
        if profile:
            readings["vehicle_make"] = profile.make
            readings["vehicle_model"] = profile.model
            readings["vehicle_year"] = profile.year
            # Emit discovery metadata once (first reading after profile loaded)
            if not self._profile_applied:
                self._profile_applied = True
                readings["discovery_status"] = self._discovery_status
                if self._protocol == "obd2" and profile.supported_pids:
                    readings["supported_pid_count"] = len(profile.supported_pids)
                    readings["missing_parameters"] = [
                        f"0x{p:02X}" for p in profile.unsupported_pids
                    ]
                elif self._protocol == "j1939" and profile.supported_pgns:
                    readings["discovered_pgn_count"] = len(profile.supported_pgns)
                    pgn_names = get_supported_pgns()
                    readings["missing_parameters"] = [
                        f"{p} ({pgn_names.get(p, '?')})"
                        for p in profile.unsupported_pgns
                    ]

        # Proprietary PGN summary — lightweight stats in every reading
        if self._prop_tracker:
            readings.update(self._prop_tracker.get_summary())

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

        # Vehicle-off detection for data capture optimization
        # If vehicle is off (no CAN traffic) for >30 seconds, flag it
        bus_connected = readings.get("_bus_connected", False)
        vehicle_off = (
            readings["vehicle_state"] == "Truck Off"
            or (not bus_connected and (secs_since > 30 or secs_since == -1))
        )
        readings["_vehicle_off"] = vehicle_off

        if readings.get("_vehicle_off", False):
            # When vehicle is off, return minimal readings to save cloud storage
            # Viam data_manager still captures at 1Hz but the payloads are tiny
            minimal = {
                "_vehicle_off": True,
                "_protocol": readings.get("_protocol", "j1939"),
                "_bus_connected": bus_connected,
                "_can_interface": readings.get("_can_interface", "can0"),
                "can_bitrate": self._current_bitrate,
                "vehicle_state": readings["vehicle_state"],
                "battery_voltage_v": readings.get("battery_voltage_v", 0),
                "vehicle_vin": self._vehicle_vin,
                "vehicle_protocol": self._protocol,
            }
            if self._vehicle_profile:
                minimal["vehicle_make"] = self._vehicle_profile.make
                minimal["vehicle_model"] = self._vehicle_profile.model
                minimal["vehicle_year"] = self._vehicle_profile.year
            # Always include Pi system health — dashboard needs it even when vehicle is off
            try:
                minimal.update(get_system_health())
            except Exception:
                LOGGER.debug("Failed to collect system health for minimal readings")
            return minimal

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

        # Idle fuel percentage (of total lifetime fuel burned at idle)
        if idle_fuel is not None and total_fuel is not None and total_fuel > 0:
            readings["idle_fuel_pct"] = round((idle_fuel / total_fuel) * 100, 1)

        # DEF level alert
        def_level = readings.get("def_level_pct", None)
        if def_level is not None:
            readings["def_low"] = def_level < 15

        # SCR health indicator
        scr_eff = readings.get("scr_efficiency_pct", None)
        if scr_eff is not None:
            if scr_eff < 50:
                readings["scr_health"] = "CRITICAL"
            elif scr_eff < 80:
                readings["scr_health"] = "WARNING"
            else:
                readings["scr_health"] = "OK"

        # DEF dosing status
        dose_rate = readings.get("def_dose_rate_gs", None)
        dose_cmd = readings.get("def_dose_commanded_gs", None)
        if dose_rate is not None or dose_cmd is not None:
            readings["def_dosing_active"] = (
                (dose_rate is not None and dose_rate > 0)
                or (dose_cmd is not None and dose_cmd > 0)
            )

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
            LOGGER.debug("Failed to collect system health for readings")

        # Ensure core fields exist for both protocols (dashboard expects these)
        core_fields = [
            "engine_rpm", "coolant_temp_f", "vehicle_speed_mph",
            "battery_voltage_v", "fuel_level_pct", "_protocol",
            "_bus_connected", "_vehicle_off", "vehicle_state",
            "active_dtc_count"
        ]
        for field in core_fields:
            if field not in readings:
                readings[field] = 0

        # Persist to local offline buffer (survives reboots + cloud outages)
        # Skip buffer write when vehicle is off — no point buffering zero data
        if self._offline_buffer and not readings.get("_vehicle_off", False):
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

            {"command": "get_proprietary_pgns"}
                Return detailed stats on all proprietary PGNs seen on the bus.
                Includes PGN type, frame count, source addresses, unique payloads,
                and last raw data for each proprietary PGN.

            {"command": "reset_proprietary_pgns"}
                Clear in-memory proprietary PGN stats (disk logs preserved).

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
        elif cmd == "get_proprietary_pgns":
            if not self._prop_tracker:
                return {"error": "Proprietary PGN capture is disabled"}
            return {
                "success": True,
                "summary": self._prop_tracker.get_summary(),
                "pgns": self._prop_tracker.get_detailed(),
            }
        elif cmd == "reset_proprietary_pgns":
            if not self._prop_tracker:
                return {"error": "Proprietary PGN capture is disabled"}
            self._prop_tracker.reset()
            return {"success": True, "message": "Proprietary PGN stats reset"}
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
                                  "get_bus_stats", "get_proprietary_pgns",
                                  "reset_proprietary_pgns", "send_raw"]}

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

            # Clear locally cached DTC readings (flat + namespaced)
            with self._readings_lock:
                keys_to_remove = [k for k in self._readings
                                  if k.startswith("dtc_") or k == "active_dtc_count"
                                  or k.endswith("_lamp")]
                for k in keys_to_remove:
                    del self._readings[k]
                self._dtc_by_source.clear()

            return {"success": True, "message": "DM11 clear DTCs sent"}
        except Exception as e:
            LOGGER.error(f"Failed to send DM11: {e}", exc_info=True)
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
            LOGGER.error(f"Failed to request PGN {pgn}: {e}", exc_info=True)
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
            "configured_bitrate": self._configured_bitrate,
            "auto_bitrate": self._auto_bitrate,
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
                                LOGGER.debug("Failed to parse offline buffer JSON line")
                except OSError:
                    LOGGER.debug("Failed to read offline buffer file: %s", path)

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
        if self._vin_thread and self._vin_thread.is_alive():
            self._vin_thread.join(timeout=2.0)
        if self._obd2_poller:
            self._obd2_poller.stop()
            self._obd2_poller = None
