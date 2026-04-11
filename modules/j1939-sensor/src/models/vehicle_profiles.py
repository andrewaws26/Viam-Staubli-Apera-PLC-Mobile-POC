"""
Vehicle profile management for IronSight fleet diagnostics.

Stores per-vehicle metadata (make, model, year, engine) and discovered
PID/PGN support lists.  Profiles persist to disk as JSON so discovery
only runs once per vehicle (refreshed every 30 days).
"""

import json
import os
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from viam.logging import getLogger

LOGGER = getLogger(__name__)

PROFILE_DIR = str(Path.home() / ".viam/vehicle-profiles")
PROFILE_MAX_AGE_DAYS = 30

# OBD-II CAN IDs (standard 11-bit)
_OBD2_REQUEST_ID = 0x7DF
_OBD2_RESPONSE_ID = 0x7E8


# ---------------------------------------------------------------
# Data model
# ---------------------------------------------------------------

@dataclass
class VehicleProfile:
    """Per-vehicle capability profile."""

    vin: str
    make: str = ""
    model: str = ""
    year: int = 0
    engine: str = ""
    protocol: str = ""          # "j1939" or "obd2"
    default_bitrate: int = 0
    supported_pids: list[int] = field(default_factory=list)
    supported_pgns: list[int] = field(default_factory=list)
    unsupported_pids: list[int] = field(default_factory=list)
    unsupported_pgns: list[int] = field(default_factory=list)
    discovered_at: str = ""     # ISO timestamp of last discovery run
    gvwr_lb: int | None = None
    notes: str = ""


# ---------------------------------------------------------------
# Seed data for known fleet vehicles
# ---------------------------------------------------------------

KNOWN_VEHICLES: dict[str, dict[str, Any]] = {
    "1M2GR4GC7RM039830": {
        "make": "Mack",
        "model": "Granite",
        "year": 2024,
        "engine": "MP7",
        "protocol": "j1939",
        "default_bitrate": 250000,
        "gvwr_lb": 19920,
        "notes": "TPS railroad truck, day cab",
    },
    "1N4AL3AP3DC279575": {
        "make": "Nissan",
        "model": "Altima 2.5",
        "year": 2013,
        "engine": "QR25DE 2.5L I4",
        "protocol": "obd2",
        "default_bitrate": 500000,
        "gvwr_lb": None,
        "notes": "Test vehicle, sedan",
    },
}


# ---------------------------------------------------------------
# Persistence helpers
# ---------------------------------------------------------------

def _profile_path(vin: str) -> str:
    return os.path.join(PROFILE_DIR, f"{vin}.json")


def load_profile(vin: str) -> VehicleProfile | None:
    """Load a saved profile from disk.  Returns None if missing or corrupt."""
    path = _profile_path(vin)
    try:
        with open(path) as f:
            data = json.load(f)
        # Only pass fields the dataclass knows about
        valid = {
            k: v for k, v in data.items()
            if k in VehicleProfile.__dataclass_fields__
        }
        return VehicleProfile(**valid)
    except (OSError, json.JSONDecodeError, TypeError) as e:
        LOGGER.debug("No profile on disk for %s: %s", vin, e)
        return None


def save_profile(profile: VehicleProfile) -> None:
    """Persist a profile to disk as pretty-printed JSON."""
    os.makedirs(PROFILE_DIR, exist_ok=True)
    path = _profile_path(profile.vin)
    try:
        with open(path, "w") as f:
            json.dump(asdict(profile), f, indent=2)
        LOGGER.info("Vehicle profile saved: %s -> %s", profile.vin, path)
    except OSError as e:
        LOGGER.error("Failed to save profile for %s: %s", profile.vin, e)


def profile_needs_discovery(profile: VehicleProfile) -> bool:
    """True if the profile has never been discovered or is stale (>30 days)."""
    if not profile.discovered_at:
        return True
    try:
        discovered = time.mktime(
            time.strptime(profile.discovered_at, "%Y-%m-%dT%H:%M:%SZ")
        )
        age_days = (time.time() - discovered) / 86400
        return age_days > PROFILE_MAX_AGE_DAYS
    except (ValueError, OverflowError):
        return True


def get_or_create_profile(vin: str) -> VehicleProfile:
    """Load an existing profile from disk, or create a blank one from seed data."""
    profile = load_profile(vin)
    if profile is not None:
        return profile

    seed = KNOWN_VEHICLES.get(vin, {})
    return VehicleProfile(
        vin=vin,
        make=seed.get("make", ""),
        model=seed.get("model", ""),
        year=seed.get("year", 0),
        engine=seed.get("engine", ""),
        protocol=seed.get("protocol", ""),
        default_bitrate=seed.get("default_bitrate", 0),
        gvwr_lb=seed.get("gvwr_lb"),
        notes=seed.get("notes", ""),
    )


# ---------------------------------------------------------------
# OBD-II PID discovery (active — sends on the bus)
# ---------------------------------------------------------------

def discover_supported_pids(bus, configured_pids: list[int] | None = None) -> tuple[list[int], list[int]]:
    """Discover which OBD-II PIDs the vehicle supports.

    Uses the Mode 01 PID 00/20/40/60/80/A0/C0 bitmask chain.  Each
    response is a 4-byte bitmask indicating support for the next 32 PIDs.

    Args:
        bus: python-can Bus object with an active CAN connection.
        configured_pids: The PID list the poller is configured to poll.
            Used to compute the ``unsupported`` return value.

    Returns:
        (supported, unsupported) — sorted PID lists relative to
        *configured_pids*.  ``supported`` contains every PID the vehicle
        reports; ``unsupported`` lists configured PIDs that are absent.
    """
    import can

    all_supported: list[int] = []
    query_pids = [0x00, 0x20, 0x40, 0x60, 0x80, 0xA0, 0xC0]

    for query_pid in query_pids:
        data = [0x02, 0x01, query_pid, 0x55, 0x55, 0x55, 0x55, 0x55]
        msg = can.Message(
            arbitration_id=_OBD2_REQUEST_ID,
            data=data,
            is_extended_id=False,
        )
        try:
            bus.send(msg)
        except Exception as e:
            LOGGER.debug("PID discovery send failed at 0x%02X: %s", query_pid, e)
            break

        # Wait for response (up to 1 s)
        response_data = None
        deadline = time.time() + 1.0
        while time.time() < deadline:
            remaining = deadline - time.time()
            if remaining <= 0:
                break
            resp = bus.recv(timeout=remaining)
            if resp is None:
                break
            if (resp.arbitration_id == _OBD2_RESPONSE_ID
                    and len(resp.data) >= 6
                    and resp.data[1] == 0x41
                    and resp.data[2] == query_pid):
                response_data = resp.data[3:7]
                break

        if response_data is None:
            LOGGER.debug("No response for PID discovery at 0x%02X", query_pid)
            break

        # Decode 32-bit bitmask → individual PID numbers
        base_pid = query_pid + 1
        for byte_idx in range(4):
            byte_val = response_data[byte_idx]
            for bit_idx in range(8):
                if byte_val & (0x80 >> bit_idx):
                    all_supported.append(base_pid + byte_idx * 8 + bit_idx)

        # If the last PID in this block (query_pid + 0x20) is NOT supported,
        # there is no next block — stop the chain.
        if (query_pid + 0x20) not in all_supported:
            break

    all_supported.sort()

    # Compute unsupported list relative to the poller's configured PIDs
    unsupported: list[int] = []
    if configured_pids is not None:
        supported_set = set(all_supported)
        unsupported = sorted(p for p in configured_pids if p not in supported_set)

    LOGGER.info(
        "PID discovery complete: %d supported, %d configured PIDs unsupported",
        len(all_supported), len(unsupported),
    )
    return all_supported, unsupported


# ---------------------------------------------------------------
# J1939 PGN discovery (passive — listen only)
# ---------------------------------------------------------------

def discover_broadcast_pgns(
    bus,
    duration: float = 60.0,
    expected_pgns: list[int] | None = None,
) -> tuple[list[int], list[int]]:
    """Listen passively and catalog every unique PGN broadcast on the bus.

    Args:
        bus: python-can Bus object.
        duration: Seconds to listen.  Default 60.
        expected_pgns: PGN list the decoder is configured for.
            Used to compute the ``missing`` return value.

    Returns:
        (discovered, missing) — ``discovered`` is every PGN seen;
        ``missing`` lists expected PGNs that were never broadcast.
    """
    from .pgn_decoder import extract_pgn_from_can_id

    seen: set[int] = set()
    deadline = time.time() + duration

    while time.time() < deadline:
        remaining = deadline - time.time()
        if remaining <= 0:
            break
        msg = bus.recv(timeout=min(1.0, remaining))
        if msg is None:
            continue
        if not msg.is_extended_id:
            continue
        pgn = extract_pgn_from_can_id(msg.arbitration_id)
        seen.add(pgn)

    discovered = sorted(seen)

    missing: list[int] = []
    if expected_pgns is not None:
        discovered_set = set(discovered)
        missing = sorted(p for p in expected_pgns if p not in discovered_set)

    LOGGER.info(
        "PGN discovery complete: %d unique PGNs in %.0fs, %d expected PGNs missing",
        len(discovered), duration, len(missing),
    )
    return discovered, missing
