"""Readings assembly helpers for the PLC sensor module.

Builds the disconnected-readings template and the connected-readings dict
from raw Modbus values.  Extracted from plc_sensor.py to reduce its size.
"""

from typing import Any, Dict, List


def build_disconnected_readings(
    *,
    truck_id: str,
    session_id: str,
    uptime_seconds: int,
    total_reads: int,
    total_errors: int,
) -> Dict[str, Any]:
    """Return a full readings dict with connected=False and all values zeroed.

    Must match the same keys returned by get_readings() so the dashboard
    always receives a consistent schema.
    """
    readings: Dict[str, Any] = {
        # Identity & session
        "truck_id": truck_id,
        "session_id": session_id,
        # System health
        "connected": False,
        "fault": True,
        "system_state": "disconnected",
        "last_fault": "",  # caller sets this
        "uptime_seconds": uptime_seconds,
        "shift_hours": round(uptime_seconds / 3600.0, 2),
        "total_reads": total_reads,
        "total_errors": total_errors,
        # Encoder & Track Distance
        "encoder_count": 0,
        "dd1_frozen": True,
        "ds10_frozen": True,
        "encoder_direction": "forward",
        "encoder_distance_ft": 0.0,
        "encoder_speed_ftpm": 0.0,
        "encoder_revolutions": 0.0,
        # TPS Machine Status
        "tps_power_loop": False,
        "camera_signal": False,
        "encoder_enabled": False,
        "floating_zero": False,
        "encoder_reset": False,
        # TPS Eject System
        "eject_tps_1": False,
        "eject_left_tps_2": False,
        "eject_right_tps_2": False,
        "air_eagle_1_feedback": False,
        "air_eagle_2_feedback": False,
        "air_eagle_3_enable": False,
        # TPS Production
        "plate_drop_count": 0,
        # Discrete inputs (raw)
        "x1": False,
        "x2": False,
        "x8": False,
    }
    # DS Holding Registers -- all 25 zeroed
    for i in range(1, 26):
        readings[f"ds{i}"] = 0
    # Operating Mode defaults
    readings["operating_mode"] = "None"
    readings["mode_tps1_single"] = False
    readings["mode_tps1_double"] = False
    readings["mode_tps2_both"] = False
    readings["mode_tps2_left"] = False
    readings["mode_tps2_right"] = False
    readings["mode_tie_team"] = False
    readings["mode_2nd_pass"] = False
    # Drop Pipeline defaults
    readings["drop_enable"] = False
    readings["drop_enable_latch"] = False
    readings["drop_software_eject"] = False
    readings["drop_detector_eject"] = False
    readings["drop_encoder_eject"] = False
    readings["first_tie_detected"] = False
    # Detection defaults
    readings["encoder_mode"] = False
    readings["camera_positive"] = False
    readings["backup_alarm"] = False
    readings["lay_ties_set"] = False
    readings["drop_ties"] = False
    # TD Timer defaults
    readings["td5_seconds_laying"] = 0
    readings["td6_tie_travel"] = 0
    # Drop spacing defaults
    readings["last_drop_spacing_in"] = 0.0
    readings["avg_drop_spacing_in"] = 0.0
    readings["min_drop_spacing_in"] = 0.0
    readings["max_drop_spacing_in"] = 0.0
    readings["distance_since_last_drop_in"] = 0.0
    readings["drop_count_in_window"] = 0
    # Signal metrics defaults
    readings["camera_detections_per_min"] = 0
    readings["camera_rate_trend"] = "stable"
    readings["camera_signal_duration_s"] = 0.0
    readings["eject_rate_per_min"] = 0
    readings["detector_eject_rate_per_min"] = 0
    readings["encoder_noise"] = 0
    readings["encoder_reversals_per_min"] = 0
    readings["modbus_response_time_ms"] = 0.0
    readings["tps_power_duration_s"] = 0.0
    # Diagnostics defaults
    readings["diagnostics"] = []
    readings["diagnostics_count"] = 0
    readings["diagnostics_critical"] = 0
    readings["diagnostics_warning"] = 0
    return readings


def build_connected_readings(
    *,
    truck_id: str,
    session_id: str,
    uptime_seconds: int,
    total_reads: int,
    total_errors: int,
    system_state: str,
    # Encoder
    encoder_count: int,
    dd1_frozen: bool,
    ds10_frozen: bool,
    encoder_direction: int,
    encoder_distance_ft: float,
    encoder_speed_ftpm: float,
    encoder_revolutions: float,
    # Discrete inputs
    tps_power_loop: bool,
    camera_signal: bool,
    encoder_enabled: bool,
    floating_zero: bool,
    encoder_reset: bool,
    discrete_bits: List[bool],
    # Output coils
    eject_tps_1: bool,
    eject_left_tps_2: bool,
    eject_right_tps_2: bool,
    air_eagle_1_feedback: bool,
    air_eagle_2_feedback: bool,
    air_eagle_3_enable: bool,
    # Production
    plate_drop_count: int,
    # DS registers (list of 25)
    ds: list,
    # C-bits
    c_app_bits: List[bool],
    operating_mode: str,
    # TD timers
    td5_laying: int,
    td6_travel: int,
) -> Dict[str, Any]:
    """Assemble the connected-readings dict from parsed Modbus values."""
    readings: Dict[str, Any] = {
        # Identity & session -- critical for fleet queries
        "truck_id": truck_id,
        "session_id": session_id,
        # System health
        "connected": True,
        "fault": False,
        "system_state": system_state,
        "last_fault": "none",
        "uptime_seconds": uptime_seconds,
        "shift_hours": round(uptime_seconds / 3600.0, 2),
        "total_reads": total_reads,
        "total_errors": total_errors,
        # Encoder & Track Distance (DD1 + derived)
        "encoder_count": encoder_count,
        "dd1_frozen": dd1_frozen,
        "ds10_frozen": ds10_frozen,
        "encoder_direction": "forward" if encoder_direction == 0 else "reverse",
        "encoder_distance_ft": round(encoder_distance_ft, 2),
        "encoder_speed_ftpm": round(encoder_speed_ftpm, 1),
        "encoder_revolutions": round(encoder_revolutions, 2),
        # TPS Machine Status (discrete inputs + internal coils)
        "tps_power_loop": tps_power_loop,
        "camera_signal": camera_signal,
        "encoder_enabled": encoder_enabled,
        "floating_zero": floating_zero,
        "encoder_reset": encoder_reset,
        # TPS Eject System (output coils + air eagle feedback)
        "eject_tps_1": eject_tps_1,
        "eject_left_tps_2": eject_left_tps_2,
        "eject_right_tps_2": eject_right_tps_2,
        "air_eagle_1_feedback": air_eagle_1_feedback,
        "air_eagle_2_feedback": air_eagle_2_feedback,
        "air_eagle_3_enable": air_eagle_3_enable,
        # TPS Production (derived from coil transitions)
        "plate_drop_count": plate_drop_count,
        # Discrete inputs X1-X8 (raw, for completeness)
        "x1": bool(discrete_bits[0]),
        "x2": bool(discrete_bits[1]),
        "x8": bool(discrete_bits[7]),
        # Operating Mode (mutually exclusive C-bits)
        "operating_mode": operating_mode,
        "mode_tps1_single": bool(c_app_bits[19]),    # C20
        "mode_tps1_double": bool(c_app_bits[20]),    # C21
        "mode_tps2_both": bool(c_app_bits[21]),      # C22
        "mode_tps2_left": bool(c_app_bits[22]),      # C23
        "mode_tps2_right": bool(c_app_bits[23]),     # C24
        "mode_tie_team": bool(c_app_bits[26]),       # C27
        "mode_2nd_pass": bool(c_app_bits[30]),       # C31
        # Drop Pipeline
        "drop_enable": bool(c_app_bits[15]),         # C16
        "drop_enable_latch": bool(c_app_bits[16]),   # C17
        "drop_software_eject": bool(c_app_bits[28]), # C29
        "drop_detector_eject": bool(c_app_bits[29]), # C30
        "drop_encoder_eject": bool(c_app_bits[31]),  # C32
        "first_tie_detected": bool(c_app_bits[33]),  # C34
        # Detection
        "encoder_mode": bool(c_app_bits[2]),         # C3
        "camera_positive": bool(c_app_bits[11]),     # C12
        "backup_alarm": bool(c_app_bits[6]),         # C7
        "lay_ties_set": bool(c_app_bits[12]),        # C13
        "drop_ties": bool(c_app_bits[13]),           # C14
        # TD Timers
        "td5_seconds_laying": td5_laying,
        "td6_tie_travel": td6_travel,
    }
    # DS Holding Registers -- all 25 from Click PLC ladder logic
    for i in range(25):
        readings[f"ds{i + 1}"] = ds[i]

    return readings
