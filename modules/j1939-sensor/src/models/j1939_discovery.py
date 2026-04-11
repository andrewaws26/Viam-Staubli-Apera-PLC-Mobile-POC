"""
Vehicle profile discovery and protocol detection for J1939 truck sensor.

Handles: auto-detection of vehicle type (J1939 vs OBD-II), PGN/PID support
probing, VIN reading and caching, vehicle profile management, and runtime
protocol re-detection.
"""

import json
import os
import struct
import threading
import time
from pathlib import Path

from viam.logging import getLogger

from .j1939_can import J1939_GLOBAL_ADDRESS, REQUEST_PGN, build_can_id
from .pgn_decoder import get_supported_pgns
from .vehicle_profiles import (
    VehicleProfile,
    discover_broadcast_pgns,
    discover_supported_pids,
    get_or_create_profile,
    profile_needs_discovery,
    save_profile,
)

LOGGER = getLogger(__name__)

# VIN cache -- persists last successful VIN read across restarts
VIN_CACHE_PATH = str(Path.home() / ".viam/last-vin.json")


def auto_detect_protocol(can_interface: str, bus_type: str, bitrate: int) -> str:
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
            channel=can_interface,
            interface=bus_type,
            bitrate=bitrate,
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
            LOGGER.info(f"Auto-detect: {extended_count} extended vs {standard_count} standard IDs -> J1939")
            return "j1939"
        else:
            LOGGER.info(f"Auto-detect: {standard_count} standard vs {extended_count} extended IDs -> OBD-II")
            return "obd2"

    except Exception as e:
        LOGGER.warning(f"Auto-detect failed ({e}). Defaulting to j1939 (safe).")
        return "j1939"


def maybe_check_redetect(sensor) -> None:
    """Periodic check: does CAN traffic still match the active protocol?

    Called from listen_loop on every recv. Short-circuits unless 30 seconds
    have elapsed since the last check. Counts extended (J1939) vs standard
    (OBD-II) frame IDs seen since the previous check.

    Safety: obd2->j1939 switches immediately on first mismatch (OBD-II
    transmissions can cause false DTCs on truck ECUs). j1939->obd2 requires
    3 consecutive agreeing checks (90 seconds).
    """
    if sensor._config_protocol != "auto":
        return
    if sensor._pending_protocol_switch:
        return  # switch already pending
    now = time.time()
    if now - sensor._last_redetect_check < 30.0:
        return
    sensor._last_redetect_check = now

    ext = sensor._redetect_extended
    std = sensor._redetect_standard
    sensor._redetect_extended = 0
    sensor._redetect_standard = 0

    total = ext + std
    LOGGER.info(
        "Protocol re-detect check: %d extended, %d standard frames (current: %s)",
        ext, std, sensor._protocol,
    )

    if total == 0:
        LOGGER.debug("No CAN traffic during re-detect window -- keeping current protocol")
        sensor._redetect_mismatch_count = 0
        return

    detected = "j1939" if ext > std else "obd2"

    if detected == sensor._protocol:
        sensor._redetect_mismatch_count = 0
        return

    sensor._redetect_mismatch_count += 1

    # CRITICAL SAFETY: obd2 -> j1939 -- stop OBD-II immediately
    # OBD-II transmits request frames that can cause false DTCs on truck ECUs
    if sensor._protocol == "obd2" and detected == "j1939":
        LOGGER.warning(
            "SAFETY: J1939 traffic detected while in OBD-II mode -- "
            "stopping OBD-II polling IMMEDIATELY to prevent false DTCs"
        )
        if sensor._obd2_poller:
            sensor._obd2_poller.stop()
        sensor._pending_protocol_switch = detected
        return

    # j1939 -> obd2: require 3 consecutive agreeing checks (90 seconds)
    LOGGER.warning(
        "Protocol mismatch: current=%s, traffic suggests=%s (%d/3)",
        sensor._protocol, detected, sensor._redetect_mismatch_count,
    )
    if sensor._redetect_mismatch_count >= 3:
        sensor._pending_protocol_switch = detected


def execute_protocol_switch(sensor, new_protocol: str) -> None:
    """Switch the active protocol after re-detection confirmed a mismatch.

    Stops current handler, re-confirms with auto_detect_protocol(), then
    starts the appropriate new handler.
    """
    from .obd2_poller import OBD2Poller

    old = sensor._protocol
    LOGGER.warning("Protocol switch detected: %s -> %s, reinitializing", old, new_protocol)

    # Stop current handlers
    if sensor._obd2_poller:
        sensor._obd2_poller.stop()
        sensor._obd2_poller = None
    sensor._stop_listener()

    # Re-confirm with existing auto-detect method
    confirmed = auto_detect_protocol(
        sensor._can_interface, sensor._bus_type, sensor._bitrate
    )
    LOGGER.info("Re-detect confirmation: %s", confirmed)
    sensor._protocol = confirmed

    # Reset re-detection state
    sensor._redetect_mismatch_count = 0
    sensor._redetect_extended = 0
    sensor._redetect_standard = 0
    sensor._last_redetect_check = time.time()

    # Reset readings for clean protocol start
    with sensor._readings_lock:
        sensor._readings = {}
        sensor._dtc_by_source = {}
        sensor._frame_count = 0

    # Start new protocol handler
    if sensor._protocol == "obd2":
        LOGGER.warning(
            "OBD-II mode TRANSMITS on the CAN bus. "
            "DO NOT use on J1939 heavy-duty trucks."
        )
        sensor._obd2_poller = OBD2Poller(
            can_interface=sensor._can_interface,
            bus_type=sensor._bus_type,
            bitrate=sensor._bitrate,
        )
        sensor._obd2_poller.start()
        # Continue monitoring for future switches
        sensor._start_listener()
        LOGGER.info("Passive CAN listener started for protocol re-detection")
    else:
        sensor._start_listener()

    LOGGER.info("Protocol switch complete: now running %s", sensor._protocol)


# ---------------------------------------------------------------
# VIN Reading & Caching
# ---------------------------------------------------------------

def start_vin_reading(sensor) -> None:
    """Attempt to read VIN on startup. Retries 3 times, falls back to cache."""
    # Give the protocol handler a moment to initialize
    time.sleep(3)

    for attempt in range(3):
        vin = read_vin(sensor)
        if vin and len(vin) >= 10:
            sensor._vehicle_vin = vin
            save_vin_cache(sensor)
            LOGGER.info(f"VIN read successfully: {vin}")
            load_vehicle_profile(sensor, vin)
            return
        if attempt < 2:
            time.sleep(2)

    # All retries failed -- try loading from cache
    cached = load_vin_cache()
    if cached:
        sensor._vehicle_vin = cached
        LOGGER.warning(f"Using cached VIN: {cached} (live read failed)")
        load_vehicle_profile(sensor, cached)
        return

    LOGGER.warning("Could not read VIN -- data will not be vehicle-tagged")

    # Continue retrying every 60 seconds in background
    sensor._vin_thread = threading.Thread(
        target=vin_retry_loop,
        args=(sensor,),
        daemon=True,
        name="vin-retry",
    )
    sensor._vin_thread.start()


def vin_retry_loop(sensor) -> None:
    """Background: retry VIN read every 60 seconds until successful."""
    while sensor._running:
        end = time.monotonic() + 60
        while sensor._running and time.monotonic() < end:
            time.sleep(min(1.0, end - time.monotonic()))
        if not sensor._running:
            break
        vin = read_vin(sensor)
        if vin and len(vin) >= 10:
            sensor._vehicle_vin = vin
            save_vin_cache(sensor)
            LOGGER.info(f"VIN read successfully (background retry): {vin}")
            load_vehicle_profile(sensor, vin)
            return


def read_vin(sensor) -> str:
    """Read VIN using the current protocol."""
    if sensor._protocol == "obd2" and sensor._obd2_poller:
        return sensor._obd2_poller.get_vin()
    elif sensor._protocol == "j1939":
        return read_vin_j1939(sensor)
    return ""


def read_vin_j1939(sensor) -> str:
    """Request VIN via J1939 PGN 65260 (Vehicle Identification)."""
    # First check if VIN was already decoded from passive listening
    with sensor._readings_lock:
        vin = sensor._readings.get("vin", "")
    if vin and len(vin) >= 10:
        return vin

    # Actively request PGN 65260
    if not sensor._bus:
        return ""
    try:
        import can
        pgn_bytes = struct.pack("<I", 65260)[:3]
        data = pgn_bytes + bytes([0xFF] * 5)
        can_id = build_can_id(
            priority=6,
            pgn=REQUEST_PGN,
            source_address=sensor._source_address,
            destination_address=J1939_GLOBAL_ADDRESS,
        )
        msg = can.Message(
            arbitration_id=can_id,
            data=data,
            is_extended_id=True,
        )
        sensor._bus.send(msg)
        LOGGER.debug("Sent PGN 65260 request for VIN")

        # Wait up to 2 seconds for the TP response to be decoded by the listener
        for _ in range(20):
            time.sleep(0.1)
            with sensor._readings_lock:
                vin = sensor._readings.get("vin", "")
            if vin and len(vin) >= 10:
                return vin
    except Exception as e:
        LOGGER.debug(f"J1939 VIN request failed: {e}")
    return ""


def load_vin_cache() -> str | None:
    """Load cached VIN from disk. Returns VIN string or None."""
    try:
        with open(VIN_CACHE_PATH) as f:
            data = json.load(f)
            vin = data.get("vin", "")
            if vin and len(vin) >= 10:
                return vin
    except (OSError, json.JSONDecodeError, ValueError):
        LOGGER.debug("Failed to load VIN cache from disk")
    return None


def save_vin_cache(sensor) -> None:
    """Save current VIN to disk cache."""
    try:
        os.makedirs(os.path.dirname(VIN_CACHE_PATH), exist_ok=True)
        with open(VIN_CACHE_PATH, "w") as f:
            json.dump({
                "vin": sensor._vehicle_vin,
                "protocol": sensor._protocol,
                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }, f)
        LOGGER.debug(f"VIN cache saved: {sensor._vehicle_vin}")
    except OSError as e:
        LOGGER.warning(f"Failed to save VIN cache: {e}")


# ---------------------------------------------------------------
# Vehicle Profile & Discovery
# ---------------------------------------------------------------

def load_vehicle_profile(sensor, vin: str) -> None:
    """Load or create a vehicle profile, then run discovery if needed.

    Called from the VIN-reading thread once a valid VIN is available.
    """
    try:
        profile = get_or_create_profile(vin)
        profile.protocol = profile.protocol or sensor._protocol
        sensor._vehicle_profile = profile

        if not profile_needs_discovery(profile):
            LOGGER.info(
                "Vehicle profile loaded from cache: %s %s %s (%s)",
                profile.year or "?", profile.make or "?",
                profile.model or "?", vin,
            )
            sensor._discovery_status = "cached"
            # Apply cached adaptive polling
            apply_profile(sensor, profile)
            return

        # Discovery needed -- run it in this thread (already background)
        sensor._discovery_status = "running"
        LOGGER.info(
            "Running %s discovery for %s %s %s (%s)...",
            sensor._protocol.upper(),
            profile.year or "?", profile.make or "?",
            profile.model or "?", vin,
        )
        run_discovery(sensor, profile)

    except Exception as e:
        LOGGER.error("Vehicle profile error for %s: %s", vin, e, exc_info=True)


def run_discovery(sensor, profile: VehicleProfile) -> None:
    """Execute PID or PGN discovery and persist the result."""
    try:
        if sensor._protocol == "obd2" and sensor._obd2_poller:
            run_pid_discovery(sensor, profile)
        elif sensor._protocol == "j1939":
            run_pgn_discovery(sensor, profile)

        profile.discovered_at = time.strftime(
            "%Y-%m-%dT%H:%M:%SZ", time.gmtime(),
        )
        save_profile(profile)
        sensor._discovery_status = "complete"
        apply_profile(sensor, profile)
    except Exception as e:
        LOGGER.error("Discovery failed for %s: %s", profile.vin, e, exc_info=True)
        sensor._discovery_status = "complete"


def run_pid_discovery(sensor, profile: VehicleProfile) -> None:
    """Discover supported OBD-II PIDs using Mode 01 bitmask chain."""
    import can

    bus = None
    try:
        bus = can.Bus(
            channel=sensor._can_interface,
            interface=sensor._bus_type,
            receive_own_messages=False,
        )
        configured = (
            sensor._obd2_poller.get_configured_pids()
            if sensor._obd2_poller else []
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


def run_pgn_discovery(sensor, profile: VehicleProfile) -> None:
    """Discover broadcast PGNs by listening passively for 60 seconds."""
    import can

    bus = None
    try:
        bus = can.Bus(
            channel=sensor._can_interface,
            interface=sensor._bus_type,
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


def apply_profile(sensor, profile: VehicleProfile) -> None:
    """Apply discovered capabilities to the running protocol handler."""
    # OBD-II: restrict polling to supported PIDs
    if (sensor._protocol == "obd2" and sensor._obd2_poller
            and profile.supported_pids):
        sensor._obd2_poller.set_supported_pids(profile.supported_pids)
        LOGGER.info(
            "Adaptive polling active: %d PIDs for %s",
            len(profile.supported_pids), profile.vin,
        )
