"""
J1939 PGN (Parameter Group Number) decoder for heavy-duty truck diagnostics.

Decodes raw CAN frames into human-readable engine and vehicle parameters
per SAE J1939 standard. Focused on parameters available via OBD-II
diagnostic port on 2013+ Mack/Volvo trucks.

Reference: SAE J1939-71 (Vehicle Application Layer)
"""

from dataclasses import dataclass
from typing import Any, Callable, Optional


# J1939 "not available" sentinel values per data size
NOT_AVAILABLE_BYTE = 0xFF
NOT_AVAILABLE_WORD = 0xFFFF
NOT_AVAILABLE_DWORD = 0xFFFFFFFF

# J1939 "error" sentinel values
ERROR_BYTE = 0xFE
ERROR_WORD = 0xFFFE


@dataclass
class SPNDefinition:
    """Suspect Parameter Number definition."""
    spn: int
    name: str
    key: str  # short key for get_readings() output
    start_byte: int
    length_bits: int  # 8 = 1 byte, 16 = 2 bytes
    resolution: float
    offset: float
    unit: str
    decode_fn: Optional[Callable[[bytes], Any]] = None


@dataclass
class PGNDefinition:
    """Parameter Group Number definition with its SPNs."""
    pgn: int
    name: str
    spns: list  # list of SPNDefinition


def _get_byte(data: bytes, index: int) -> Optional[int]:
    """Extract a single byte, returning None if not available or error."""
    if index >= len(data):
        return None
    val = data[index]
    if val in (NOT_AVAILABLE_BYTE, ERROR_BYTE):
        return None
    return val


def _get_word_le(data: bytes, low_index: int) -> Optional[int]:
    """Extract a 16-bit little-endian word, returning None if not available."""
    if low_index + 1 >= len(data):
        return None
    val = data[low_index] | (data[low_index + 1] << 8)
    if val in (NOT_AVAILABLE_WORD, ERROR_WORD):
        return None
    return val


def _get_dword_le(data: bytes, start_index: int) -> Optional[int]:
    """Extract a 32-bit little-endian dword, returning None if not available."""
    if start_index + 3 >= len(data):
        return None
    val = (data[start_index]
           | (data[start_index + 1] << 8)
           | (data[start_index + 2] << 16)
           | (data[start_index + 3] << 24))
    if val == NOT_AVAILABLE_DWORD:
        return None
    return val


def _decode_scaled(data: bytes, start_byte: int, length_bits: int,
                   resolution: float, offset: float) -> Optional[float]:
    """Generic decoder: extract value and apply resolution + offset."""
    if length_bits == 8:
        raw = _get_byte(data, start_byte)
    elif length_bits == 16:
        raw = _get_word_le(data, start_byte)
    elif length_bits == 32:
        raw = _get_dword_le(data, start_byte)
    else:
        return None
    if raw is None:
        return None
    return round(raw * resolution + offset, 4)


def extract_pgn_from_can_id(can_id: int) -> int:
    """
    Extract the PGN from a 29-bit extended CAN ID.

    J1939 CAN ID format (29 bits):
      Priority(3) | Reserved(1) | Data Page(1) | PDU Format(8) | PDU Specific(8) | Source Address(8)

    If PDU Format < 240 (peer-to-peer), PGN = PDU Format << 8
    If PDU Format >= 240 (broadcast), PGN = (PDU Format << 8) | PDU Specific
    """
    pdu_format = (can_id >> 16) & 0xFF
    pdu_specific = (can_id >> 8) & 0xFF
    data_page = (can_id >> 24) & 0x01
    reserved = (can_id >> 25) & 0x01

    if pdu_format < 240:
        pgn = (reserved << 17) | (data_page << 16) | (pdu_format << 8)
    else:
        pgn = (reserved << 17) | (data_page << 16) | (pdu_format << 8) | pdu_specific

    return pgn


def extract_source_address(can_id: int) -> int:
    """Extract the source address (SA) from a 29-bit CAN ID."""
    return can_id & 0xFF


# ---------------------------------------------------------------------------
# PGN Definitions — SAE J1939-71
# ---------------------------------------------------------------------------

def _decode_engine_rpm(data: bytes) -> Optional[float]:
    """SPN 190: Engine Speed — bytes 3-4, 0.125 RPM/bit."""
    return _decode_scaled(data, 3, 16, 0.125, 0)


def _decode_driver_demand_torque(data: bytes) -> Optional[float]:
    """SPN 512: Driver's Demand Engine Torque — byte 1, 1%/bit, offset -125."""
    return _decode_scaled(data, 0, 8, 1.0, -125.0)


def _decode_actual_engine_torque(data: bytes) -> Optional[float]:
    """SPN 513: Actual Engine Torque — byte 2, 1%/bit, offset -125."""
    return _decode_scaled(data, 1, 8, 1.0, -125.0)


PGN_61444 = PGNDefinition(
    pgn=61444,
    name="Electronic Engine Controller 1 (EEC1)",
    spns=[
        SPNDefinition(512, "Driver Demand Torque", "driver_demand_torque_pct",
                      0, 8, 1.0, -125.0, "%"),
        SPNDefinition(513, "Actual Engine Torque", "actual_engine_torque_pct",
                      1, 8, 1.0, -125.0, "%"),
        SPNDefinition(190, "Engine Speed", "engine_rpm",
                      3, 16, 0.125, 0.0, "rpm"),
    ]
)

PGN_61443 = PGNDefinition(
    pgn=61443,
    name="Electronic Engine Controller 2 (EEC2)",
    spns=[
        SPNDefinition(91, "Accelerator Pedal Position", "accel_pedal_pos_pct",
                      1, 8, 0.4, 0.0, "%"),
        SPNDefinition(92, "Engine Percent Load at Current Speed", "engine_load_pct",
                      2, 8, 1.0, 0.0, "%"),
    ]
)

PGN_65262 = PGNDefinition(
    pgn=65262,
    name="Engine Temperature 1 (ET1)",
    spns=[
        SPNDefinition(110, "Engine Coolant Temperature", "coolant_temp_c",
                      0, 8, 1.0, -40.0, "C"),
        SPNDefinition(174, "Fuel Temperature", "fuel_temp_c",
                      1, 8, 1.0, -40.0, "C"),
        SPNDefinition(175, "Engine Oil Temperature", "oil_temp_c",
                      2, 16, 0.03125, -273.0, "C"),
    ]
)

PGN_65263 = PGNDefinition(
    pgn=65263,
    name="Engine Fluid Level/Pressure (EFL/P)",
    spns=[
        SPNDefinition(94, "Engine Fuel Delivery Pressure", "fuel_pressure_kpa",
                      0, 8, 4.0, 0.0, "kPa"),
        SPNDefinition(22, "Engine Extended Crankcase Blow-by Pressure", "crankcase_pressure_kpa",
                      1, 8, 0.05, 0.0, "kPa"),
        SPNDefinition(98, "Engine Oil Level", "oil_level_pct",
                      2, 8, 0.4, 0.0, "%"),
        SPNDefinition(100, "Engine Oil Pressure", "oil_pressure_kpa",
                      3, 8, 4.0, 0.0, "kPa"),
    ]
)

PGN_65265 = PGNDefinition(
    pgn=65265,
    name="Cruise Control/Vehicle Speed (CCVS)",
    spns=[
        SPNDefinition(84, "Wheel-Based Vehicle Speed", "vehicle_speed_kmh",
                      1, 16, 0.00390625, 0.0, "km/h"),  # 1/256 km/h per bit
        SPNDefinition(597, "Brake Switch", "brake_switch",
                      3, 8, 1.0, 0.0, ""),
    ]
)

PGN_65266 = PGNDefinition(
    pgn=65266,
    name="Fuel Economy (LFE)",
    spns=[
        SPNDefinition(183, "Engine Fuel Rate", "fuel_rate_lph",
                      0, 16, 0.05, 0.0, "L/h"),
        SPNDefinition(184, "Instantaneous Fuel Economy", "fuel_economy_km_l",
                      2, 16, 0.001953125, 0.0, "km/L"),  # 1/512 km/L per bit
    ]
)

PGN_65269 = PGNDefinition(
    pgn=65269,
    name="Ambient Conditions (AMB)",
    spns=[
        SPNDefinition(108, "Barometric Pressure", "barometric_pressure_kpa",
                      0, 8, 0.5, 0.0, "kPa"),
        SPNDefinition(171, "Ambient Air Temperature", "ambient_temp_c",
                      3, 16, 0.03125, -273.0, "C"),
    ]
)

PGN_65271 = PGNDefinition(
    pgn=65271,
    name="Vehicle Electrical Power (VEP)",
    spns=[
        SPNDefinition(158, "Battery Potential / Power Input", "battery_voltage_v",
                      4, 16, 0.05, 0.0, "V"),
    ]
)

PGN_65253 = PGNDefinition(
    pgn=65253,
    name="Engine Hours, Revolutions (HOURS)",
    spns=[
        SPNDefinition(247, "Total Engine Hours", "engine_hours",
                      0, 32, 0.05, 0.0, "hr"),
    ]
)

PGN_65257 = PGNDefinition(
    pgn=65257,
    name="Fuel Consumption (LFC)",
    spns=[
        SPNDefinition(250, "Total Fuel Used", "total_fuel_used_l",
                      4, 32, 0.5, 0.0, "L"),
    ]
)

PGN_65270 = PGNDefinition(
    pgn=65270,
    name="Inlet/Exhaust Conditions 1 (IC1)",
    spns=[
        SPNDefinition(105, "Intake Manifold Temperature", "intake_manifold_temp_c",
                      2, 8, 1.0, -40.0, "C"),
        SPNDefinition(102, "Boost Pressure", "boost_pressure_kpa",
                      1, 8, 2.0, 0.0, "kPa"),
    ]
)

PGN_65276 = PGNDefinition(
    pgn=65276,
    name="Dash Display (DD)",
    spns=[
        SPNDefinition(96, "Fuel Level", "fuel_level_pct",
                      1, 8, 0.4, 0.0, "%"),
    ]
)

PGN_65272 = PGNDefinition(
    pgn=65272,
    name="Transmission Fluids (TF)",
    spns=[
        SPNDefinition(126, "Transmission Oil Temperature", "trans_oil_temp_c",
                      4, 16, 0.03125, -273.0, "C"),
    ]
)

PGN_61445 = PGNDefinition(
    pgn=61445,
    name="Electronic Transmission Controller 2 (ETC2)",
    spns=[
        SPNDefinition(523, "Transmission Current Gear", "current_gear",
                      3, 8, 1.0, -125.0, ""),
        SPNDefinition(524, "Transmission Selected Gear", "selected_gear",
                      0, 8, 1.0, -125.0, ""),
    ]
)


# ---------------------------------------------------------------------------
# DM1 — Active Diagnostic Trouble Codes (PGN 65226)
# ---------------------------------------------------------------------------

def decode_dm1(data: bytes) -> list[dict]:
    """
    Decode DM1 active diagnostic trouble codes.

    Returns a list of DTCs, each with SPN, FMI, and occurrence count.
    DM1 format: bytes 0-1 are lamp status, bytes 2+ are DTC entries (4 bytes each).
    """
    dtcs = []
    if len(data) < 2:
        return dtcs

    # Lamp status
    # byte 0 bits 7-6: Malfunction Indicator Lamp
    # byte 0 bits 5-4: Red Stop Lamp
    # byte 0 bits 3-2: Amber Warning Lamp
    # byte 0 bits 1-0: Protect Lamp

    # Each DTC is 4 bytes starting at byte 2
    i = 2
    while i + 3 < len(data):
        b0 = data[i]
        b1 = data[i + 1]
        b2 = data[i + 2]
        b3 = data[i + 3]

        # SPN is 19 bits: bits 7-0 of b0, bits 7-0 of b1, bits 7-5 of b2
        spn = b0 | (b1 << 8) | ((b2 >> 5) << 16)
        # FMI is 5 bits: bits 4-0 of b2
        fmi = b2 & 0x1F
        # Occurrence count is 7 bits: bits 6-0 of b3
        occurrence = b3 & 0x7F

        if spn != 0x7FFFF and fmi != 0x1F:  # skip "not available"
            dtcs.append({
                "spn": spn,
                "fmi": fmi,
                "occurrence": occurrence,
            })
        i += 4

    return dtcs


def decode_dm1_lamps(data: bytes) -> dict:
    """Decode DM1 lamp status from first 2 bytes."""
    if len(data) < 2:
        return {}
    lamp_byte = data[0]
    return {
        "malfunction_lamp": (lamp_byte >> 6) & 0x03,
        "red_stop_lamp": (lamp_byte >> 4) & 0x03,
        "amber_warning_lamp": (lamp_byte >> 2) & 0x03,
        "protect_lamp": lamp_byte & 0x03,
    }


PGN_65226 = PGNDefinition(
    pgn=65226,
    name="DM1 - Active Diagnostic Trouble Codes",
    spns=[]  # handled specially by decode_dm1
)


# ---------------------------------------------------------------------------
# PGN Registry
# ---------------------------------------------------------------------------

PGN_REGISTRY: dict[int, PGNDefinition] = {
    61443: PGN_61443,
    61444: PGN_61444,
    61445: PGN_61445,
    65226: PGN_65226,
    65253: PGN_65253,
    65257: PGN_65257,
    65262: PGN_65262,
    65263: PGN_65263,
    65265: PGN_65265,
    65266: PGN_65266,
    65269: PGN_65269,
    65270: PGN_65270,
    65271: PGN_65271,
    65272: PGN_65272,
    65276: PGN_65276,
}


def decode_pgn(pgn: int, data: bytes) -> dict[str, Any]:
    """
    Decode a J1939 PGN's data bytes into a dict of named readings.

    Args:
        pgn: The Parameter Group Number
        data: Raw CAN data bytes (typically 8 bytes)

    Returns:
        Dict mapping parameter keys to decoded values.
        Values are None if the parameter is "not available" in the data.
        Unknown PGNs return an empty dict.
    """
    defn = PGN_REGISTRY.get(pgn)
    if defn is None:
        return {}

    # DM1 is special
    if pgn == 65226:
        lamps = decode_dm1_lamps(data)
        dtcs = decode_dm1(data)
        result = {}
        result.update(lamps)
        if dtcs:
            result["active_dtc_count"] = len(dtcs)
            # Flatten first 5 DTCs into individual readings for Viam data capture
            for i, dtc in enumerate(dtcs[:5]):
                result[f"dtc_{i}_spn"] = dtc["spn"]
                result[f"dtc_{i}_fmi"] = dtc["fmi"]
                result[f"dtc_{i}_occurrence"] = dtc["occurrence"]
        else:
            result["active_dtc_count"] = 0
        return result

    # Standard PGN decoding via SPN definitions
    readings = {}
    for spn_def in defn.spns:
        if spn_def.decode_fn:
            value = spn_def.decode_fn(data)
        else:
            value = _decode_scaled(data, spn_def.start_byte,
                                   spn_def.length_bits,
                                   spn_def.resolution, spn_def.offset)
        if value is not None:
            readings[spn_def.key] = value

    return readings


def decode_can_frame(can_id: int, data: bytes) -> tuple[int, dict[str, Any]]:
    """
    Decode a raw CAN frame (ID + data) into J1939 readings.

    Args:
        can_id: 29-bit extended CAN identifier
        data: CAN frame data bytes

    Returns:
        Tuple of (pgn, decoded_readings_dict)
    """
    pgn = extract_pgn_from_can_id(can_id)
    readings = decode_pgn(pgn, data)
    return pgn, readings


def get_supported_pgns() -> dict[int, str]:
    """Return a dict of supported PGN numbers to their names."""
    return {pgn: defn.name for pgn, defn in PGN_REGISTRY.items()}
