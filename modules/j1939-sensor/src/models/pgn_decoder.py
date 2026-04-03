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


def _decode_2bit_status(data: bytes, byte_idx: int, bit_offset: int) -> Optional[bool]:
    """Decode a J1939 2-bit status field. 00=off, 01=on, 10=error, 11=N/A."""
    val = _get_byte(data, byte_idx)
    if val is None:
        return None
    bits = (val >> bit_offset) & 0x03
    if bits == 3:
        return None  # not available
    return bits == 1  # 1 = active/on


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

def _decode_temp_f(data: bytes, start_byte: int, length_bits: int,
                   resolution: float, offset_c: float) -> Optional[float]:
    """Decode a temperature value and convert from Celsius to Fahrenheit."""
    celsius = _decode_scaled(data, start_byte, length_bits, resolution, offset_c)
    if celsius is None:
        return None
    return round(celsius * 9.0 / 5.0 + 32, 2)


PGN_65262 = PGNDefinition(
    pgn=65262,
    name="Engine Temperature 1 (ET1)",
    spns=[
        SPNDefinition(110, "Engine Coolant Temperature", "coolant_temp_f",
                      0, 8, 1.0, -40.0, "F",
                      decode_fn=lambda data: _decode_temp_f(data, 0, 8, 1.0, -40.0)),
        SPNDefinition(174, "Fuel Temperature", "fuel_temp_f",
                      1, 8, 1.0, -40.0, "F",
                      decode_fn=lambda data: _decode_temp_f(data, 1, 8, 1.0, -40.0)),
        SPNDefinition(175, "Engine Oil Temperature", "oil_temp_f",
                      2, 16, 0.03125, -273.0, "F",
                      decode_fn=lambda data: _decode_temp_f(data, 2, 16, 0.03125, -273.0)),
    ]
)

def _decode_pressure_psi(data: bytes, start_byte: int, length_bits: int,
                        resolution: float, offset: float) -> Optional[float]:
    """Decode a pressure value and convert from kPa to PSI."""
    kpa = _decode_scaled(data, start_byte, length_bits, resolution, offset)
    if kpa is None:
        return None
    return round(kpa * 0.145038, 2)


PGN_65263 = PGNDefinition(
    pgn=65263,
    name="Engine Fluid Level/Pressure (EFL/P)",
    spns=[
        SPNDefinition(94, "Engine Fuel Delivery Pressure", "fuel_pressure_psi",
                      0, 8, 4.0, 0.0, "PSI",
                      decode_fn=lambda data: _decode_pressure_psi(data, 0, 8, 4.0, 0.0)),
        SPNDefinition(22, "Engine Extended Crankcase Blow-by Pressure", "crankcase_pressure_psi",
                      1, 8, 0.05, 0.0, "PSI",
                      decode_fn=lambda data: _decode_pressure_psi(data, 1, 8, 0.05, 0.0)),
        SPNDefinition(98, "Engine Oil Level", "oil_level_pct",
                      2, 8, 0.4, 0.0, "%"),
        SPNDefinition(100, "Engine Oil Pressure", "oil_pressure_psi",
                      3, 8, 4.0, 0.0, "PSI",
                      decode_fn=lambda data: _decode_pressure_psi(data, 3, 8, 4.0, 0.0)),
    ]
)

PGN_65265 = PGNDefinition(
    pgn=65265,
    name="Cruise Control/Vehicle Speed (CCVS)",
    spns=[
        SPNDefinition(84, "Wheel-Based Vehicle Speed", "vehicle_speed_mph",
                      1, 16, 0.00390625 * 0.621371, 0.0, "mph"),
        SPNDefinition(597, "Brake Switch", "brake_switch",
                      3, 8, 1.0, 0.0, ""),
    ]
)

PGN_65266 = PGNDefinition(
    pgn=65266,
    name="Fuel Economy (LFE)",
    spns=[
        SPNDefinition(183, "Engine Fuel Rate", "fuel_rate_gph",
                      0, 16, 0.05 * 0.264172, 0.0, "gal/h"),
        SPNDefinition(184, "Instantaneous Fuel Economy", "fuel_economy_mpg",
                      2, 16, 0.001953125 * 2.35215, 0.0, "mpg"),
    ]
)

PGN_65269 = PGNDefinition(
    pgn=65269,
    name="Ambient Conditions (AMB)",
    spns=[
        SPNDefinition(108, "Barometric Pressure", "barometric_pressure_psi",
                      0, 8, 0.5 * 0.145038, 0.0, "PSI"),
        SPNDefinition(171, "Ambient Air Temperature", "ambient_temp_f",
                      3, 16, 0.03125, -273.0, "F",
                      decode_fn=lambda data: _decode_temp_f(data, 3, 16, 0.03125, -273.0)),
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
        SPNDefinition(250, "Total Fuel Used", "total_fuel_used_gal",
                      4, 32, 0.5 * 0.264172, 0.0, "gal"),
    ]
)

PGN_65270 = PGNDefinition(
    pgn=65270,
    name="Inlet/Exhaust Conditions 1 (IC1)",
    spns=[
        SPNDefinition(105, "Intake Manifold Temperature", "intake_manifold_temp_f",
                      2, 8, 1.0, -40.0, "F",
                      decode_fn=lambda data: _decode_temp_f(data, 2, 8, 1.0, -40.0)),
        SPNDefinition(102, "Boost Pressure", "boost_pressure_psi",
                      1, 8, 2.0, 0.0, "PSI",
                      decode_fn=lambda data: _decode_pressure_psi(data, 1, 8, 2.0, 0.0)),
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
        SPNDefinition(126, "Transmission Oil Temperature", "trans_oil_temp_f",
                      4, 16, 0.03125, -273.0, "F",
                      decode_fn=lambda data: _decode_temp_f(data, 4, 16, 0.03125, -273.0)),
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

PGN_65260 = PGNDefinition(
    pgn=65260,
    name="Vehicle Identification (VI)",
    spns=[]  # VIN is multi-packet ASCII, decoded via Transport Protocol in j1939_sensor.py
)


# ---------------------------------------------------------------------------
# GPS / Navigation PGN Definitions
# ---------------------------------------------------------------------------

def _decode_latitude(data: bytes) -> Optional[float]:
    """PGN 65267 bytes 0-3: 32-bit LE, 1e-7 deg/bit, offset -210 deg."""
    raw = _get_dword_le(data, 0)
    if raw is None:
        return None
    return round(raw * 1e-7 - 210.0, 7)

def _decode_longitude(data: bytes) -> Optional[float]:
    """PGN 65267 bytes 4-7: 32-bit LE, 1e-7 deg/bit, offset -210 deg."""
    raw = _get_dword_le(data, 4)
    if raw is None:
        return None
    return round(raw * 1e-7 - 210.0, 7)

PGN_65267 = PGNDefinition(
    pgn=65267,
    name="Vehicle Position (VP)",
    spns=[
        SPNDefinition(584, "Latitude", "gps_latitude",
                      0, 32, 1e-7, -210.0, "deg",
                      decode_fn=_decode_latitude),
        SPNDefinition(585, "Longitude", "gps_longitude",
                      4, 32, 1e-7, -210.0, "deg",
                      decode_fn=_decode_longitude),
    ]
)

PGN_65256 = PGNDefinition(
    pgn=65256,
    name="Vehicle Direction/Speed (VDS)",
    spns=[
        SPNDefinition(580, "Compass Bearing", "compass_bearing_deg",
                      0, 16, 1.0/128.0, 0, "deg"),
        SPNDefinition(581, "Navigation-Based Vehicle Speed", "nav_speed_mph",
                      2, 16, 0.00390625 * 0.621371, 0, "mph"),
        SPNDefinition(582, "Pitch", "vehicle_pitch_deg",
                      4, 16, 1.0/128.0, -200.0, "deg"),
        SPNDefinition(583, "Altitude", "altitude_ft",
                      6, 16, 0.125 * 3.28084, -2500.0 * 3.28084, "ft"),
    ]
)

PGN_65254 = PGNDefinition(
    pgn=65254,
    name="Time/Date (TD)",
    spns=[
        SPNDefinition(959, "Seconds", "time_seconds",
                      0, 8, 0.25, 0, "s"),
        SPNDefinition(960, "Minutes", "time_minutes",
                      1, 8, 1.0, 0, ""),
        SPNDefinition(961, "Hours", "time_hours",
                      2, 8, 1.0, 0, ""),
        SPNDefinition(963, "Day", "time_day",
                      4, 8, 0.25, 0, ""),
        SPNDefinition(962, "Month", "time_month",
                      3, 8, 1.0, 0, ""),
        SPNDefinition(964, "Year", "time_year",
                      5, 8, 1.0, 1985.0, ""),
    ]
)


# ---------------------------------------------------------------------------
# Idle / Trip / Service PGN Definitions
# ---------------------------------------------------------------------------

PGN_65244 = PGNDefinition(
    pgn=65244,
    name="Idle Operation (IO)",
    spns=[
        SPNDefinition(235, "Idle Fuel Used", "idle_fuel_used_gal",
                      0, 32, 0.5 * 0.264172, 0, "gal"),
        SPNDefinition(236, "Idle Engine Hours", "idle_engine_hours",
                      4, 32, 0.05, 0, "hr"),
    ]
)

PGN_64777 = PGNDefinition(
    pgn=64777,
    name="Trip Fuel — Total Vehicle (TF_TV)",
    spns=[
        SPNDefinition(4154, "Trip Fuel", "trip_fuel_gal",
                      0, 32, 0.001 * 0.264172, 0, "gal"),
        SPNDefinition(4155, "Trip Fuel 2", "trip_fuel_2_gal",
                      4, 32, 0.001 * 0.264172, 0, "gal"),
    ]
)

PGN_65216 = PGNDefinition(
    pgn=65216,
    name="Service Information (SERV)",
    spns=[
        SPNDefinition(914, "Service Distance", "service_distance_mi",
                      0, 16, 5.0 * 0.621371, 0, "mi"),
        SPNDefinition(915, "Service Component ID", "service_component_id",
                      4, 8, 1.0, 0, ""),
    ]
)

PGN_65213 = PGNDefinition(
    pgn=65213,
    name="Fan Drive State (FD)",
    spns=[
        SPNDefinition(975, "Estimated Fan Speed Percent", "fan_speed_pct",
                      0, 8, 0.4, 0, "%"),
        SPNDefinition(976, "Fan Drive State", "fan_drive_state",
                      1, 8, 1.0, 0, ""),
    ]
)

# ---------------------------------------------------------------------------
# Wheel Speed / Air Supply PGN Definitions
# ---------------------------------------------------------------------------

PGN_65215 = PGNDefinition(
    pgn=65215,
    name="Wheel Speed Information (EBC2)",
    spns=[
        SPNDefinition(904, "Front Axle Speed", "front_axle_speed_mph",
                      0, 16, 0.00390625 * 0.621371, 0, "mph"),
        SPNDefinition(905, "Relative Speed Front Left", "rel_speed_front_left",
                      2, 8, 0.0625 * 0.621371, -7.8125 * 0.621371, "mph"),
        SPNDefinition(906, "Relative Speed Front Right", "rel_speed_front_right",
                      3, 8, 0.0625 * 0.621371, -7.8125 * 0.621371, "mph"),
        SPNDefinition(907, "Relative Speed Rear Left", "rel_speed_rear_left",
                      4, 8, 0.0625 * 0.621371, -7.8125 * 0.621371, "mph"),
        SPNDefinition(908, "Relative Speed Rear Right", "rel_speed_rear_right",
                      5, 8, 0.0625 * 0.621371, -7.8125 * 0.621371, "mph"),
    ]
)

PGN_65198 = PGNDefinition(
    pgn=65198,
    name="Air Supply Pressure (ASP)",
    spns=[
        SPNDefinition(46, "Pneumatic Supply Pressure", "air_supply_pressure_psi",
                      0, 8, 8.0, 0, "kPa",
                      decode_fn=lambda d: _decode_pressure_psi(d, 0, 8, 8.0, 0)),
        SPNDefinition(1086, "Air Supply Pressure Circuit 1", "air_pressure_circuit1_psi",
                      2, 8, 8.0, 0, "kPa",
                      decode_fn=lambda d: _decode_pressure_psi(d, 2, 8, 8.0, 0)),
        SPNDefinition(1087, "Air Supply Pressure Circuit 2", "air_pressure_circuit2_psi",
                      3, 8, 8.0, 0, "kPa",
                      decode_fn=lambda d: _decode_pressure_psi(d, 3, 8, 8.0, 0)),
    ]
)

# ---------------------------------------------------------------------------
# Turbo / EGR PGN Definitions
# ---------------------------------------------------------------------------

PGN_64972 = PGNDefinition(
    pgn=64972,
    name="Turbocharger Wastegate (TCW)",
    spns=[
        SPNDefinition(4177, "Turbo Wastegate Actuator", "turbo_wastegate_pct",
                      0, 8, 0.4, 0, "%"),
    ]
)


# ---------------------------------------------------------------------------
# Aftertreatment PGN Definitions
# ---------------------------------------------------------------------------

PGN_64947 = PGNDefinition(
    pgn=64947,
    name="Aftertreatment 1 Intake Gas 1 (AT1IG1)",
    spns=[
        SPNDefinition(4326, "Aftertreatment 1 Intake NOx", "nox_inlet_ppm",
                      0, 16, 0.05, -200.0, "ppm"),
        SPNDefinition(4327, "Aftertreatment 1 Intake O2", "at1_intake_o2_pct",
                      5, 16, 0.0025, -12.0, "%"),
    ]
)

PGN_64948 = PGNDefinition(
    pgn=64948,
    name="Aftertreatment 1 Outlet Gas 1 (AT1OG1)",
    spns=[
        SPNDefinition(4331, "Aftertreatment 1 Outlet NOx", "nox_outlet_ppm",
                      0, 16, 0.05, -200.0, "ppm"),
    ]
)

PGN_65110 = PGNDefinition(
    pgn=65110,
    name="Aftertreatment 1 Diesel Exhaust Fluid Info (AT1DEF)",
    spns=[
        SPNDefinition(1761, "DEF Tank Level", "def_level_pct",
                      0, 8, 0.4, 0, "%"),
        SPNDefinition(3031, "DEF Temperature", "def_temp_f",
                      1, 8, 1.0, -40, "F",
                      decode_fn=lambda d: _decode_temp_f(d, 1, 8, 1.0, -40)),
    ]
)

PGN_64891 = PGNDefinition(
    pgn=64891,
    name="Aftertreatment 1 DPF Conditions (AT1DPF)",
    spns=[
        SPNDefinition(3719, "DPF Soot Load Percent", "dpf_soot_load_pct",
                      0, 8, 1.0, 0, "%"),
        SPNDefinition(3251, "DPF Differential Pressure", "dpf_diff_pressure_psi",
                      1, 16, 0.01, 0, "kPa",
                      decode_fn=lambda d: _decode_pressure_psi(d, 1, 16, 0.01, 0)),
        SPNDefinition(3242, "DPF Inlet Temperature", "dpf_inlet_temp_f",
                      3, 16, 0.03125, -273, "F",
                      decode_fn=lambda d: _decode_temp_f(d, 3, 16, 0.03125, -273)),
        SPNDefinition(3246, "DPF Outlet Temperature", "dpf_outlet_temp_f",
                      5, 16, 0.03125, -273, "F",
                      decode_fn=lambda d: _decode_temp_f(d, 5, 16, 0.03125, -273)),
    ]
)

PGN_64892 = PGNDefinition(
    pgn=64892,
    name="Aftertreatment DPF Regen (AT1DPF2)",
    spns=[
        SPNDefinition(3695, "DPF Regen Status", "dpf_regen_status",
                      0, 8, 1.0, 0, "",
                      decode_fn=lambda d: {0: "Not Active", 1: "Active", 2: "Regen Needed", 3: "Not Available"}.get((_get_byte(d, 0) or 0) & 0x03, "Unknown")),
        SPNDefinition(3700, "DPF Regen Inhibit Status", "dpf_regen_inhibit",
                      1, 8, 1.0, 0, "",
                      decode_fn=lambda d: _decode_2bit_status(d, 1, 0)),
    ]
)

PGN_65252 = PGNDefinition(
    pgn=65252,
    name="Aftertreatment 1 SCR Catalyst (AT1SC)",
    spns=[
        SPNDefinition(4360, "SCR Conversion Efficiency", "scr_efficiency_pct",
                      0, 8, 0.4, 0, "%"),
        SPNDefinition(4363, "SCR Catalyst Temperature", "scr_catalyst_temp_f",
                      2, 16, 0.03125, -273, "F",
                      decode_fn=lambda d: _decode_temp_f(d, 2, 16, 0.03125, -273)),
    ]
)

# ---------------------------------------------------------------------------
# Brakes & Safety PGN Definitions
# ---------------------------------------------------------------------------

PGN_61441 = PGNDefinition(
    pgn=61441,
    name="Electronic Brake Controller 1 (EBC1)",
    spns=[
        SPNDefinition(521, "Brake Pedal Position", "brake_pedal_pos_pct",
                      1, 8, 0.4, 0, "%"),
        SPNDefinition(563, "ABS Active", "abs_active",
                      2, 8, 1.0, 0, "",
                      decode_fn=lambda d: _decode_2bit_status(d, 2, 0)),
        SPNDefinition(116, "Brake Application Pressure", "brake_air_pressure_psi",
                      3, 8, 4.0, 0, "psi",
                      decode_fn=lambda d: _decode_pressure_psi(d, 3, 8, 4.0, 0)),
    ]
)

# ---------------------------------------------------------------------------
# Extended Engine & Vehicle PGN Definitions
# ---------------------------------------------------------------------------

PGN_65247 = PGNDefinition(
    pgn=65247,
    name="Electronic Engine Controller 3 (EEC3)",
    spns=[
        SPNDefinition(514, "Nominal Friction Percent Torque", "friction_torque_pct",
                      0, 8, 1.0, -125, "%"),
        SPNDefinition(2978, "Estimated Engine Parasitic Losses", "parasitic_losses_pct",
                      1, 8, 0.4, 0, "%"),
        SPNDefinition(1636, "Exhaust Gas Pressure", "exhaust_gas_pressure_psi",
                      2, 16, 0.01, 0, "kPa",
                      decode_fn=lambda d: _decode_pressure_psi(d, 2, 16, 0.01, 0)),
    ]
)

PGN_65248 = PGNDefinition(
    pgn=65248,
    name="Vehicle Distance (VD)",
    spns=[
        SPNDefinition(245, "Total Vehicle Distance", "vehicle_distance_mi",
                      0, 32, 0.125 * 0.000621371, 0, "mi"),
    ]
)

PGN_65217 = PGNDefinition(
    pgn=65217,
    name="High Resolution Vehicle Distance (VDHR)",
    spns=[
        SPNDefinition(917, "High Resolution Total Vehicle Distance", "vehicle_distance_hr_mi",
                      0, 32, 0.005 * 0.000621371, 0, "mi"),
    ]
)

PGN_61442 = PGNDefinition(
    pgn=61442,
    name="Electronic Transmission Controller 1 (ETC1)",
    spns=[
        SPNDefinition(522, "Torque Converter Lockup Engaged", "tc_lockup_engaged",
                      0, 8, 1.0, 0, ""),
        SPNDefinition(525, "Transmission Output Shaft Speed", "trans_output_rpm",
                      3, 16, 0.125, 0, "rpm"),
        SPNDefinition(526, "Percent Clutch Slip", "clutch_slip_pct",
                      5, 8, 0.4, 0, "%"),
    ]
)

# Cruise control detailed — extend CCVS to also extract cruise status
PGN_65265_EXT = PGNDefinition(
    pgn=65265,
    name="Cruise Control/Vehicle Speed (CCVS) - Extended",
    spns=[
        SPNDefinition(84, "Wheel-Based Vehicle Speed", "vehicle_speed_mph",
                      1, 16, 0.00390625 * 0.621371, 0.0, "mph"),
        SPNDefinition(597, "Brake Switch", "brake_switch",
                      3, 8, 1.0, 0.0, ""),
        SPNDefinition(595, "Cruise Control Active", "cruise_control_active",
                      0, 8, 1.0, 0, "",
                      decode_fn=lambda d: _decode_2bit_status(d, 0, 0)),
    ]
)


# ---------------------------------------------------------------------------
# PTO / Hydraulic PGN Definitions
# ---------------------------------------------------------------------------

PGN_65091 = PGNDefinition(
    pgn=65091,
    name="PTO Drive Engagement (PTODE)",
    spns=[
        SPNDefinition(984, "PTO Engagement Status", "pto_engaged",
                      0, 8, 1.0, 0, "",
                      decode_fn=lambda d: _decode_scaled(d, 0, 2, 1.0, 0)),
        SPNDefinition(985, "PTO Speed", "pto_rpm",
                      1, 16, 0.125, 0, "rpm"),
        SPNDefinition(986, "PTO Set Speed", "pto_set_rpm",
                      3, 16, 0.125, 0, "rpm"),
    ]
)

PGN_65268 = PGNDefinition(
    pgn=65268,
    name="Auxiliary I/O (AUX)",
    spns=[
        SPNDefinition(1083, "PTO Switches", "pto_switches",
                      0, 8, 1.0, 0, ""),
        SPNDefinition(1084, "Aux IO 1", "aux_io_1",
                      1, 8, 1.0, 0, ""),
        SPNDefinition(1085, "Aux IO 2", "aux_io_2",
                      2, 8, 1.0, 0, ""),
    ]
)

PGN_65098 = PGNDefinition(
    pgn=65098,
    name="Vehicle Fluids (VF)",
    spns=[
        SPNDefinition(1636, "Hydraulic Oil Temp", "hydraulic_oil_temp_f",
                      0, 8, 1.0, -40, "F",
                      decode_fn=lambda d: _decode_temp_f(d, 0, 8, 1.0, -40)),
        SPNDefinition(1637, "Hydraulic Oil Level", "hydraulic_oil_level_pct",
                      1, 8, 0.4, 0, "%"),
        SPNDefinition(1638, "Hydraulic Oil Pressure", "hydraulic_oil_pressure_psi",
                      2, 8, 16.0, 0, "psi",
                      decode_fn=lambda d: _decode_pressure_psi(d, 2, 8, 16.0, 0)),
        SPNDefinition(1639, "Hydraulic Oil Filter Restriction", "hydraulic_filter_psi",
                      3, 8, 2.0, 0, "psi",
                      decode_fn=lambda d: _decode_pressure_psi(d, 3, 8, 2.0, 0)),
    ]
)

PGN_61440 = PGNDefinition(
    pgn=61440,
    name="Electronic Retarder Controller (ERC1)",
    spns=[
        SPNDefinition(520, "Retarder Torque Mode", "retarder_torque_mode",
                      0, 4, 1.0, 0, ""),
        SPNDefinition(571, "Retarder Enable", "retarder_enable",
                      0, 2, 1.0, 0, ""),
        SPNDefinition(521, "Actual Retarder Torque", "retarder_torque_pct",
                      1, 8, 1.0, -125, "%"),
    ]
)


# ---------------------------------------------------------------------------
# PGN Registry
# ---------------------------------------------------------------------------

PGN_REGISTRY: dict[int, PGNDefinition] = {
    # GPS / Navigation
    65267: PGN_65267,           # VP: latitude, longitude
    65256: PGN_65256,           # VDS: compass, nav speed, pitch, altitude
    65254: PGN_65254,           # TD: time/date
    # Idle / Trip / Service
    65244: PGN_65244,           # IO: idle fuel, idle hours
    64777: PGN_64777,           # TF_TV: trip fuel
    65216: PGN_65216,           # SI: service distance/time remaining
    65213: PGN_65213,           # FD: fan drive state
    # Wheel Speed / Air
    65215: PGN_65215,           # EBC2: wheel speeds
    65198: PGN_65198,           # ASP: air supply pressure
    # Turbo / EGR
    64972: PGN_64972,           # TCW: turbo wastegate
    # Engine
    61443: PGN_61443,           # EEC2: accel pedal, load
    61444: PGN_61444,           # EEC1: RPM, torque
    65247: PGN_65247,           # EEC3: exhaust pressure, friction
    # Transmission
    61442: PGN_61442,           # ETC1: output shaft, clutch slip
    61445: PGN_61445,           # ETC2: current/selected gear
    # Brakes
    61441: PGN_61441,           # EBC1: brake pedal, ABS, air pressure
    # Retarder
    61440: PGN_61440,           # ERC1: retarder torque
    # Temperatures
    65262: PGN_65262,           # ET1: coolant, fuel, oil temp
    # Pressures
    65263: PGN_65263,           # EFL/P: oil pressure, fuel pressure
    # Vehicle
    65265: PGN_65265_EXT,       # CCVS: speed, brake switch, cruise control
    65248: PGN_65248,           # VD: total vehicle distance (odometer)
    65217: PGN_65217,           # VDHR: high resolution distance
    # Fuel
    65266: PGN_65266,           # LFE: fuel rate, economy
    65257: PGN_65257,           # LFC: total fuel consumed
    65276: PGN_65276,           # DD: fuel level
    # Ambient / Inlet
    65269: PGN_65269,           # AMB: barometric, ambient temp
    65270: PGN_65270,           # IC1: intake temp, boost pressure
    # Electrical
    65271: PGN_65271,           # VEP: battery voltage
    # Transmission fluids
    65272: PGN_65272,           # TF: trans oil temp
    # Engine hours
    65253: PGN_65253,           # HOURS: engine hours
    # DTCs
    65226: PGN_65226,           # DM1: active diagnostic trouble codes
    # Vehicle Identification
    65260: PGN_65260,           # VI: Vehicle Identification Number (VIN)
    # Aftertreatment
    64891: PGN_64891,           # AT1DPF: soot load, diff pressure, temps
    64892: PGN_64892,           # AT1DPF2: regen status
    64947: PGN_64947,           # AT1IG1: NOx inlet
    64948: PGN_64948,           # AT1OG1: NOx outlet
    65110: PGN_65110,           # AT1DEF: DEF level, temp
    65252: PGN_65252,           # AT1SC: SCR efficiency, catalyst temp
    # PTO / Hydraulic
    65091: PGN_65091,           # PTODE: PTO engagement, speed
    65098: PGN_65098,           # VF: hydraulic oil temp, pressure, level
    65268: PGN_65268,           # AUX: PTO switches, aux IO
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


# ---------------------------------------------------------------------------
# Proprietary PGN Classification
# ---------------------------------------------------------------------------

# Proprietary A: PGN 0xEF00 (61184) — peer-to-peer, destination-specific
PROPRIETARY_A_PGN = 61184  # 0xEF00

# Proprietary B: PGN 0xFF00-0xFFFF (65280-65535) — broadcast
PROPRIETARY_B_START = 65280  # 0xFF00
PROPRIETARY_B_END = 65535    # 0xFFFF


def is_proprietary_pgn(pgn: int) -> bool:
    """Check if a PGN falls in the J1939 proprietary ranges."""
    if pgn == PROPRIETARY_A_PGN:
        return True
    if PROPRIETARY_B_START <= pgn <= PROPRIETARY_B_END:
        return True
    return False


def classify_pgn(pgn: int) -> str:
    """Classify a PGN: 'standard', 'proprietary_a', 'proprietary_b', or 'unknown'."""
    if pgn in PGN_REGISTRY:
        return "standard"
    if pgn == PROPRIETARY_A_PGN:
        return "proprietary_a"
    if PROPRIETARY_B_START <= pgn <= PROPRIETARY_B_END:
        return "proprietary_b"
    return "unknown"
