"""
CAN bus I/O utilities for J1939 truck sensor.

Handles: interface setup, frame reading/writing, bus stats, socketcan operations,
offline buffering, proprietary PGN tracking, and bitrate auto-negotiation.
"""

import json
import os
import struct
import subprocess
import time
from collections.abc import Mapping
from typing import Any

from viam.logging import getLogger

from .j1939_dtc import SA_SUFFIX, apply_namespaced_dtcs
from .pgn_decoder import (
    classify_pgn,
    decode_can_frame,
    decode_dm1_lamps,
    extract_pgn_from_can_id,
    extract_source_address,
    is_proprietary_pgn,
)

LOGGER = getLogger(__name__)

# Default offline buffer config — hardcoded to the Pi's deploy user home dir.
# Overridable via Viam machine config attributes "buffer_dir" and "buffer_max_mb".
DEFAULT_BUFFER_DIR = "/home/andrew/.viam/offline-buffer/truck"
DEFAULT_BUFFER_MAX_MB = 50.0

# Default proprietary PGN capture config — same deploy user convention.
# Overridable via config attribute "prop_log_dir".
DEFAULT_PROP_LOG_DIR = "/home/andrew/.viam/proprietary-pgns"
DEFAULT_PROP_LOG_MAX_MB = 100.0
_PROP_SAMPLE_INTERVAL = 10.0  # seconds between logging same PGN (avoid flooding)

# J1939 broadcast address
J1939_GLOBAL_ADDRESS = 0xFF

# DM11 -- Clear/Reset Active DTCs (PGN 65235 / 0xFED3)
DM11_PGN = 65235

# Request PGN (PGN 59904 / 0xEA00)
REQUEST_PGN = 59904


def serialise(value: Any) -> Any:
    """Make a value JSON-safe."""
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float, str)):
        return value
    return str(value)


def build_can_id(priority: int, pgn: int, source_address: int,
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


class OfflineBuffer:
    """Append-only JSONL buffer that persists readings to local disk.

    Each reading is written as a single JSON line to a date-stamped file.
    When the buffer directory exceeds max_mb, the oldest files are pruned.
    This ensures vehicle data survives cloud sync failures and reboots.
    """

    def __init__(self, buffer_dir: str, max_mb: float = DEFAULT_BUFFER_MAX_MB):
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
            **{k: serialise(v) for k, v in readings.items()},
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


class ProprietaryPGNTracker:
    """Tracks proprietary J1939 PGN traffic for reverse engineering.

    Records statistics and raw payloads for PGNs in the proprietary ranges
    (Proprietary A: 0xEF00, Proprietary B: 0xFF00-0xFFFF) that the standard
    decoder cannot interpret. Writes raw captures to JSONL files for offline
    analysis with SavvyCAN or CAN_Reverse_Engineering tools.
    """

    def __init__(self, log_dir: str = DEFAULT_PROP_LOG_DIR,
                 max_mb: float = DEFAULT_PROP_LOG_MAX_MB):
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
        """Return summary stats for get_readings() -- lightweight."""
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
        """Return detailed per-PGN stats for do_command -- full info."""
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


def set_can_bitrate(interface: str, bitrate: int) -> None:
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


def negotiate_bitrate(can_interface: str, bus_type: str,
                      current_bitrate: int, configured_bitrate: int,
                      bitrate_candidates: list[int]) -> tuple[bool, int]:
    """Cycle through candidate bitrates to find one producing CAN traffic.

    Tries the current bitrate first (10-second window), then each
    candidate from the configured list. Returns (found, bitrate).

    On failure, restores the configured bitrate.
    """
    # Build deduplicated candidate list: current first, then configured list
    candidates = [current_bitrate]
    for b in bitrate_candidates:
        if b not in candidates:
            candidates.append(b)

    for bitrate in candidates:
        LOGGER.info(
            "Bitrate negotiation: trying %d bps on %s",
            bitrate, can_interface,
        )
        try:
            set_can_bitrate(can_interface, bitrate)
        except Exception as e:
            LOGGER.error(
                "Failed to set CAN bitrate %d on %s: %s",
                bitrate, can_interface, e,
                exc_info=True,
            )
            continue

        # Probe for traffic -- 10-second window
        found = False
        bus = None
        try:
            import can
            bus = can.Bus(
                channel=can_interface,
                interface=bus_type,
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
            LOGGER.info(
                "CAN bitrate confirmed: %d bps on %s",
                bitrate, can_interface,
            )
            return True, bitrate

    # All candidates exhausted -- restore configured bitrate
    LOGGER.warning(
        "All bitrate candidates failed on %s. "
        "Restoring configured bitrate %d. Will retry in 60 seconds.",
        can_interface, configured_bitrate,
    )
    try:
        set_can_bitrate(can_interface, configured_bitrate)
    except Exception as e:
        LOGGER.error("Failed to restore configured bitrate: %s", e, exc_info=True)
    return False, configured_bitrate


def start_can_listener(can_interface: str, bus_type: str, bitrate: int):
    """Create and return a python-can Bus instance, or None on failure.

    IMPORTANT: Listen-only mode is enforced at the OS level, NOT here.
    The CAN interface must be brought up with ``listen-only on``::

        ip link set can0 up type can bitrate 250000 listen-only on

    python-can's Bus() does NOT set listen-only — it inherits whatever
    the OS configured.  If the interface is in normal mode, this code will
    ACK every frame on the truck bus, disrupting ECU communication and
    triggering dashboard warning lights.  See CLAUDE.md for details.
    """
    try:
        import can
        bus = can.Bus(
            channel=can_interface,
            interface=bus_type,
            bitrate=bitrate,
            receive_own_messages=False,
        )
        LOGGER.info(
            "CAN listener started on %s at %d bps",
            can_interface, bitrate,
        )
        return bus
    except Exception as e:
        LOGGER.error("Failed to start CAN listener: %s", e, exc_info=True)
        return None


def run_listen_loop(sensor) -> None:
    """Background thread: read CAN frames and decode J1939 PGNs.

    `sensor` is the J1939TruckSensor instance -- we access its attributes
    directly to avoid excessive parameter passing.
    """
    # J1939 Transport Protocol (TP) reassembly state
    # Key = (source_address, target_pgn), Value = {total_bytes, packets, data}
    tp_sessions: dict[tuple[int, int], dict] = {}

    while sensor._running and sensor._bus:
        try:
            msg = sensor._bus.recv(timeout=1.0)
            if msg is None:
                sensor._maybe_check_redetect()
                sensor._maybe_trigger_bitrate_negotiation()
                continue

            # Track frame reception for bitrate negotiation
            sensor._last_any_frame_time = time.time()

            # Count frame types for protocol re-detection
            if msg.is_extended_id:
                sensor._redetect_extended += 1
            else:
                sensor._redetect_standard += 1
            sensor._maybe_check_redetect()

            if not msg.is_extended_id:
                continue  # J1939 uses extended (29-bit) IDs only

            pgn = extract_pgn_from_can_id(msg.arbitration_id)
            sa = extract_source_address(msg.arbitration_id)

            # --- TP.CM (Connection Management) -- PGN 60416 (0xEC00) ---
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

            # --- TP.DT (Data Transfer) -- PGN 60160 (0xEB00) ---
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
                            decode_tp_message(sensor, target_pgn, sa, raw)
                            del tp_sessions[key]
                        break
                continue

            # --- Standard single-frame PGN decode ---
            _, decoded = decode_can_frame(msg.arbitration_id, msg.data)

            # --- Proprietary PGN capture (runs even if not decoded) ---
            if not decoded and sensor._prop_tracker and is_proprietary_pgn(pgn):
                sensor._prop_tracker.record(pgn, sa, msg.data, msg.arbitration_id)
                # 0xFFCC: engine start counters (confirmed via RE)
                if pgn == 0xFFCC and len(msg.data) >= 8:
                    with sensor._readings_lock:
                        sensor._readings["prop_start_counter_a"] = int.from_bytes(msg.data[0:4], "little")
                        sensor._readings["prop_start_counter_b"] = int.from_bytes(msg.data[4:8], "little")

            # Apply PGN filter
            if sensor._pgn_filter and pgn not in sensor._pgn_filter:
                continue

            if decoded:
                with sensor._readings_lock:
                    sensor._readings.update(decoded)
                    sensor._frame_count += 1
                    sensor._last_frame_time = time.time()

                    if sensor._include_raw:
                        pgn_hex = f"pgn_{pgn}_raw"
                        sensor._readings[pgn_hex] = msg.data.hex()

                    sensor._readings[f"pgn_{pgn}_source_addr"] = sa

                    # Per-ECU DM1 lamp and DTC tracking.
                    # Pre-2013 trucks may only broadcast from SA 0x00
                    # and SA 0x3D; other SAs are silently ignored if absent.
                    if pgn == 65226:
                        lamps = decode_dm1_lamps(msg.data)
                        suffix = SA_SUFFIX.get(sa)
                        if suffix:
                            sensor._readings[f"protect_lamp_{suffix}"] = lamps.get("protect_lamp", 0)
                            sensor._readings[f"red_stop_lamp_{suffix}"] = lamps.get("red_stop_lamp", 0)
                            sensor._readings[f"amber_lamp_{suffix}"] = lamps.get("amber_warning_lamp", 0)
                            sensor._readings[f"mil_{suffix}"] = lamps.get("malfunction_lamp", 0)

                        # Compute OR'd flat lamp keys across ALL ECUs.
                        # Without this, the last ECU to broadcast DM1 wins,
                        # so an engine "no lamps" frame overwrites an ACM
                        # emissions lamp — causing missed warnings on the dash.
                        for flat_key, per_ecu_prefix in (
                            ("malfunction_lamp", "mil_"),
                            ("amber_warning_lamp", "amber_lamp_"),
                            ("red_stop_lamp", "red_stop_lamp_"),
                            ("protect_lamp", "protect_lamp_"),
                        ):
                            worst = 0
                            for s in SA_SUFFIX.values():
                                val = sensor._readings.get(f"{per_ecu_prefix}{s}", 0)
                                if val and val > worst:
                                    worst = val
                            sensor._readings[flat_key] = worst

                        # Single-frame DM1 DTCs are in `decoded`
                        # (from decode_can_frame -> pgn_decoder).
                        # Namespace them per-source and recompute combined count.
                        apply_namespaced_dtcs(sensor._readings, sensor._dtc_by_source, sa, decoded)

        except Exception as e:
            if sensor._running:
                LOGGER.warning(f"CAN read error: {e}")
                time.sleep(0.1)


def decode_tp_message(sensor, pgn: int, sa: int, data: bytes) -> None:
    """Decode a reassembled multi-packet J1939 message."""
    decoded = {}

    if pgn == 65260:  # Vehicle Identification (VI) -- contains VIN
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

    elif pgn == 65226:  # DM1 -- multi-frame (>2 active DTCs)
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
        suffix = SA_SUFFIX.get(sa)
        if suffix:
            decoded[f"protect_lamp_{suffix}"] = lamps.get("protect_lamp", 0)
            decoded[f"red_stop_lamp_{suffix}"] = lamps.get("red_stop_lamp", 0)
            decoded[f"amber_lamp_{suffix}"] = lamps.get("amber_warning_lamp", 0)
            decoded[f"mil_{suffix}"] = lamps.get("malfunction_lamp", 0)
        LOGGER.info("DM1 multi-frame from SA 0x%02X: %d DTCs, lamps=%s",
                    sa, len(dtcs), lamps)

    elif pgn == 65227:  # DM2 -- multi-frame previously active DTCs
        from .pgn_decoder import decode_dm1, decode_dm1_lamps
        dtcs = decode_dm1(data)
        decoded["prev_dtc_count"] = len(dtcs)
        for i, dtc in enumerate(dtcs[:10]):
            decoded[f"prev_dtc_{i}_spn"] = dtc["spn"]
            decoded[f"prev_dtc_{i}_fmi"] = dtc["fmi"]
            decoded[f"prev_dtc_{i}_occurrence"] = dtc["occurrence"]
        LOGGER.info("DM2 multi-frame from SA 0x%02X: %d previously active DTCs", sa, len(dtcs))

    if decoded:
        with sensor._readings_lock:
            sensor._readings.update(decoded)
            sensor._frame_count += 1
            sensor._last_frame_time = time.time()
            # Namespace DM1 DTCs per source so multiple ECUs don't overwrite
            if pgn == 65226:
                apply_namespaced_dtcs(sensor._readings, sensor._dtc_by_source, sa, decoded)


async def request_pgn(bus, pgn: int, source_address: int) -> dict[str, Any]:
    """Send a PGN request (PGN 59904) to solicit data from the ECU.

    The request contains the 3-byte little-endian PGN number.
    """
    if not bus:
        return {"success": False, "error": "CAN bus not connected"}

    try:
        import can
        # Request PGN format: 3 bytes LE of the requested PGN + 5 padding
        pgn_bytes = struct.pack("<I", pgn)[:3]
        data = pgn_bytes + bytes([0xFF] * 5)

        can_id = build_can_id(
            priority=6,
            pgn=REQUEST_PGN,
            source_address=source_address,
            destination_address=J1939_GLOBAL_ADDRESS,
        )
        msg = can.Message(
            arbitration_id=can_id,
            data=data,
            is_extended_id=True,
        )
        bus.send(msg)
        LOGGER.info(f"PGN request sent for PGN {pgn}")
        return {"success": True, "message": f"Requested PGN {pgn}"}
    except Exception as e:
        LOGGER.error(f"Failed to request PGN {pgn}: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


async def send_raw(bus, can_id: int, data_hex: str) -> dict[str, Any]:
    """Send a raw CAN frame."""
    if not bus:
        return {"success": False, "error": "CAN bus not connected"}

    try:
        import can
        data = bytes.fromhex(data_hex)
        msg = can.Message(
            arbitration_id=can_id,
            data=data,
            is_extended_id=True,
        )
        bus.send(msg)
        return {"success": True,
                "message": f"Sent CAN ID 0x{can_id:08X} data={data_hex}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_bus_stats(sensor) -> dict[str, Any]:
    """Return CAN bus statistics."""
    return {
        "can_interface": sensor._can_interface,
        "bitrate": sensor._bitrate,
        "configured_bitrate": sensor._configured_bitrate,
        "auto_bitrate": sensor._auto_bitrate,
        "bus_type": sensor._bus_type,
        "bus_connected": sensor._bus is not None,
        "listener_running": sensor._running,
        "total_frames_decoded": sensor._frame_count,
        "last_frame_time": sensor._last_frame_time,
        "seconds_since_last_frame": (
            round(time.time() - sensor._last_frame_time, 2)
            if sensor._last_frame_time > 0 else -1
        ),
        "source_address": f"0x{sensor._source_address:02X}",
        "pgn_filter": list(sensor._pgn_filter) if sensor._pgn_filter else "all",
        "include_raw": sensor._include_raw,
        "unique_readings": len(sensor._readings),
    }
