"""
DTC (Diagnostic Trouble Code) handling for J1939 truck sensor.

Handles: DM1/DM2 processing, namespaced DTCs per ECU, DTC clearing via DM11,
lamp tracking, and the source address suffix mapping.
"""

import subprocess
import time
from typing import Any

from viam.logging import getLogger

LOGGER = getLogger(__name__)

# J1939 source address -> human suffix mapping for DTC and lamp namespacing.
# Pre-2013 Mack/Volvo trucks may only broadcast from SA 0x00 (engine) and
# SA 0x3D (aftertreatment). The code is tolerant of missing SAs -- readings
# only get populated when frames actually arrive on the bus.
SA_SUFFIX = {
    0x00: "engine",
    0x03: "trans",
    0x0B: "abs",
    0x17: "inst",
    0x21: "body",
    0x3D: "acm",
}


def apply_namespaced_dtcs(readings: dict, dtc_by_source: dict,
                          sa: int, decoded: dict) -> None:
    """Write source-namespaced DTC keys and recompute combined count.

    Must be called while readings_lock is held.

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
    dtc_by_source[sa] = dtcs

    # Write source-namespaced keys
    suffix = SA_SUFFIX.get(sa, f"sa{sa:02x}")
    readings[f"dtc_{suffix}_count"] = len(dtcs)
    for i, dtc in enumerate(dtcs[:10]):
        readings[f"dtc_{suffix}_{i}_spn"] = dtc["spn"]
        readings[f"dtc_{suffix}_{i}_fmi"] = dtc["fmi"]
        readings[f"dtc_{suffix}_{i}_occurrence"] = dtc["occurrence"]

    # Recompute combined active_dtc_count across all sources
    total = sum(len(d) for d in dtc_by_source.values())
    readings["active_dtc_count"] = total

    # Backward-compat flat dtc_0_* keys: prefer engine (SA 0x00),
    # fall back to first source that has DTCs
    primary_dtcs = dtc_by_source.get(0x00, [])
    if not primary_dtcs:
        for src_dtcs in dtc_by_source.values():
            if src_dtcs:
                primary_dtcs = src_dtcs
                break
    for i, dtc in enumerate(primary_dtcs[:10]):
        readings[f"dtc_{i}_spn"] = dtc["spn"]
        readings[f"dtc_{i}_fmi"] = dtc["fmi"]
        readings[f"dtc_{i}_occurrence"] = dtc["occurrence"]


async def clear_dtcs(sensor) -> dict[str, Any]:
    """
    Send DM11 (PGN 65235) to clear active diagnostic trouble codes.

    DM11 is sent as a broadcast with 8 bytes of 0xFF (per J1939-73).
    The ECU should respond with DM12 (PGN 65236) confirming the clear.

    Because the CAN interface runs in listen-only mode (cannot transmit),
    this method temporarily switches to normal mode to send the frame,
    then restores listen-only mode in a finally block to guarantee safety.
    """
    if not sensor._bus:
        return {"success": False, "error": "CAN bus not connected"}

    # Log active DTCs before clearing (audit trail)
    with sensor._readings_lock:
        active_dtcs = dict(sensor._dtc_by_source)
    LOGGER.info(f"DTC clear requested. Active DTCs before clear: {active_dtcs}")

    DM12_PGN = 65236
    dm12_received = False
    iface = sensor._can_interface
    bitrate = str(sensor._bitrate)

    try:
        import can

        # --- Tear down existing bus and switch to normal mode ---
        # Close the current listen-only bus so we can reconfigure the interface
        if sensor._bus:
            sensor._bus.shutdown()
            sensor._bus = None

        # Bring interface down, then back up in normal mode (no listen-only)
        subprocess.run(
            ["ip", "link", "set", iface, "down"], check=True
        )
        subprocess.run(
            ["ip", "link", "set", iface, "up", "type", "can",
             "bitrate", bitrate],
            check=True,
        )
        LOGGER.info(f"CAN interface {iface} switched to normal mode for DTC clear")

        # Open a temporary bus in normal mode for transmitting
        tx_bus = can.interface.Bus(
            channel=iface, bustype=sensor._bus_type
        )

        try:
            # Build and send DM11 frame with service tool SA 0xF9
            msg = can.Message(
                arbitration_id=0x18FED3F9,  # Priority 6, PGN 65235 (DM11), SA 0xF9
                data=[0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF],
                is_extended_id=True,
            )
            tx_bus.send(msg)
            LOGGER.info("DM11 clear DTCs command sent (SA=0xF9, normal mode)")

            # Listen for DM12 confirmation (PGN 65236) for up to 2 seconds
            deadline = time.time() + 2.0
            while time.time() < deadline:
                rx_msg = tx_bus.recv(timeout=0.5)
                if rx_msg and rx_msg.is_extended_id:
                    # Extract PGN from the 29-bit CAN ID
                    rx_pgn = (rx_msg.arbitration_id >> 8) & 0x3FFFF
                    pdu_format = (rx_pgn >> 8) & 0xFF
                    if pdu_format >= 240:
                        rx_pgn_final = rx_pgn
                    else:
                        rx_pgn_final = rx_pgn & 0xFF00
                    if rx_pgn_final == DM12_PGN:
                        dm12_received = True
                        LOGGER.info(
                            "DM12 confirmation received from SA=0x%02X",
                            rx_msg.arbitration_id & 0xFF,
                        )
                        break

            if not dm12_received:
                LOGGER.warning(
                    "No DM12 confirmation received within 2s (clear may still have succeeded)"
                )
        finally:
            tx_bus.shutdown()

    except Exception as e:
        LOGGER.error(f"Failed to send DM11: {e}", exc_info=True)
        return {"success": False, "error": str(e)}
    finally:
        # ALWAYS restore listen-only mode -- this is safety-critical
        try:
            import can as _can_restore  # re-import in case outer import failed
            subprocess.run(
                ["ip", "link", "set", iface, "down"], check=True
            )
            subprocess.run(
                ["ip", "link", "set", iface, "up", "type", "can",
                 "bitrate", bitrate, "listen-only", "on"],
                check=True,
            )
            LOGGER.info(f"CAN interface {iface} restored to listen-only mode")

            # Re-open the bus in listen-only mode for continued monitoring
            sensor._bus = _can_restore.interface.Bus(
                channel=iface, bustype=sensor._bus_type
            )
        except Exception as restore_err:
            LOGGER.critical(
                f"FAILED to restore listen-only mode on {iface}: {restore_err}. "
                "CAN bus may be in normal mode -- manual intervention required!",
                exc_info=True,
            )

    # Clear locally cached DTC readings (flat + namespaced)
    with sensor._readings_lock:
        keys_to_remove = [k for k in sensor._readings
                          if k.startswith("dtc_") or k == "active_dtc_count"
                          or k.endswith("_lamp")]
        for k in keys_to_remove:
            del sensor._readings[k]
        sensor._dtc_by_source.clear()

    return {
        "success": True,
        "message": "DM11 clear DTCs sent",
        "dm12_confirmed": dm12_received,
        "dtcs_before_clear": {
            str(sa): len(dtcs) for sa, dtcs in active_dtcs.items()
        },
    }
