"""Readings assembly helpers for the PLC sensor module.

Builds the disconnected-readings template, the connected-readings dict
from raw Modbus values, Modbus I/O helpers, and diagnostic log tracking.
Extracted from plc_sensor.py to reduce its size.
"""

from typing import Any

from viam.logging import getLogger

LOGGER = getLogger(__name__)


def build_disconnected_readings(
    *,
    truck_id: str,
    session_id: str,
    uptime_seconds: int,
    total_reads: int,
    total_errors: int,
) -> dict[str, Any]:
    """Return a full readings dict with connected=False and all values zeroed.

    Must match the same keys returned by get_readings() so the dashboard
    always receives a consistent schema.
    """
    readings: dict[str, Any] = {
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
    discrete_bits: list[bool],
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
    c_app_bits: list[bool],
    operating_mode: str,
    # TD timers
    td5_laying: int,
    td6_travel: int,
) -> dict[str, Any]:
    """Assemble the connected-readings dict from parsed Modbus values."""
    readings: dict[str, Any] = {
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


def read_modbus_io(client, uint16_fn) -> dict[str, Any]:
    """Read all Modbus registers/coils from the PLC in one pass.

    Returns a dict with keys: ds, encoder_count, discrete_bits,
    output_coils, internal_coils, c_app_bits, td5_laying, td6_travel,
    operating_mode, modbus_elapsed_ms.

    Raises IOError on DS register read error (caller should handle).
    """
    import time
    _modbus_start = time.time()
    _read_failures: list[str] = []

    # -- DS holding registers (0-24) -- all 25 TPS registers
    ds_result = client.read_holding_registers(address=0, count=25)
    if ds_result.isError():
        raise OSError(f"DS register read error: {ds_result}")
    ds = [uint16_fn(v) for v in ds_result.registers]

    # -- Encoder count from DD1 (Modbus address 16384, 2 registers) --
    enc_lo, enc_hi = 0, 0
    try:
        enc_result = client.read_holding_registers(address=16384, count=2)
        if not enc_result.isError():
            enc_lo = uint16_fn(enc_result.registers[0])
            enc_hi = uint16_fn(enc_result.registers[1])
    except Exception:
        _read_failures.append("encoder_dd1")
    encoder_count = (enc_hi << 16) | enc_lo
    if encoder_count > 0x7FFFFFFF:
        encoder_count -= 0x100000000

    # -- Discrete inputs (X1-X8) --
    discrete_bits = [False] * 8
    try:
        di_result = client.read_discrete_inputs(address=0, count=8)
        if not di_result.isError():
            discrete_bits = list(di_result.bits[:8])
    except Exception as exc:
        LOGGER.warning("Error reading discrete inputs: %s", exc, exc_info=True)
        _read_failures.append("discrete_inputs")

    # -- Output coils (Y1-Y3) --
    output_coils = [False] * 3
    try:
        oc_result = client.read_coils(address=8192, count=3)
        if not oc_result.isError():
            output_coils = list(oc_result.bits[:3])
    except Exception as exc:
        LOGGER.warning("Error reading output coils: %s", exc, exc_info=True)
        _read_failures.append("output_coils")

    # -- Internal coils (C1999, C2000) --
    internal_coils = [False] * 2
    try:
        ic_result = client.read_coils(address=1998, count=2)
        if not ic_result.isError():
            internal_coils = list(ic_result.bits[:2])
    except Exception as exc:
        LOGGER.warning("Error reading internal coils: %s", exc, exc_info=True)
        _read_failures.append("internal_coils")

    # -- C-bits C1-C34 for operating mode, drop pipeline, detection --
    c_app_bits = [False] * 34
    try:
        cb_result = client.read_coils(address=0, count=34)
        if not cb_result.isError():
            c_app_bits = list(cb_result.bits[:34])
    except Exception:
        _read_failures.append("c_bits")

    # Derived operating mode name
    _mode_map = [
        (c_app_bits[19], "TPS-1 Single"), (c_app_bits[20], "TPS-1 Double"),
        (c_app_bits[21], "TPS-2 Both"), (c_app_bits[26], "Tie Team"),
        (c_app_bits[30], "2nd Pass"),
    ]
    _mode = next((name for active, name in _mode_map if active), "None")
    if c_app_bits[22]:
        _mode += " L"
    if c_app_bits[23]:
        _mode += " R"

    # -- TD timers --
    td5_laying = 0
    td6_travel = 0
    try:
        td_result = client.read_holding_registers(address=24576, count=12)
        if not td_result.isError():
            td5_laying = (td_result.registers[9] << 16) | td_result.registers[8]
            td6_travel = (td_result.registers[11] << 16) | td_result.registers[10]
    except Exception:
        _read_failures.append("td_timers")

    _modbus_elapsed_ms = (time.time() - _modbus_start) * 1000

    return {
        "ds": ds,
        "encoder_count": encoder_count,
        "discrete_bits": discrete_bits,
        "output_coils": output_coils,
        "internal_coils": internal_coils,
        "c_app_bits": c_app_bits,
        "operating_mode": _mode,
        "td5_laying": td5_laying,
        "td6_travel": td6_travel,
        "modbus_elapsed_ms": _modbus_elapsed_ms,
        "_read_status": "partial" if _read_failures else "ok",
        "_read_failures": _read_failures,
    }


def evaluate_and_log_diagnostics(
    readings: dict[str, Any],
    prev_diag_rules: set[str],
) -> tuple[set[str], str]:
    """Run the diagnostic engine and log state transitions.

    Returns (current_rules_set, diagnostic_log_string).
    Also mutates readings in-place to add diagnostics keys.
    """
    from diagnostics import evaluate as evaluate_diagnostics
    diagnostics = evaluate_diagnostics(readings)
    readings["diagnostics"] = diagnostics
    readings["diagnostics_count"] = len(diagnostics)
    readings["diagnostics_critical"] = sum(
        1 for d in diagnostics if d["severity"] == "critical"
    )
    readings["diagnostics_warning"] = sum(
        1 for d in diagnostics if d["severity"] == "warning"
    )

    current_rules = {d["rule"] for d in diagnostics}
    fired = current_rules - prev_diag_rules
    cleared = prev_diag_rules - current_rules
    diag_log = ""
    if fired or cleared:
        log_parts = []
        for rule in fired:
            diag = next((d for d in diagnostics if d["rule"] == rule), None)
            evidence = diag.get("evidence", "") if diag else ""
            severity = diag.get("severity", "?") if diag else "?"
            log_parts.append(f"+{rule}({severity}): {evidence}")
            LOGGER.info("DIAG FIRED: %s [%s] %s", rule, severity, evidence)
        for rule in cleared:
            log_parts.append(f"-{rule}")
            LOGGER.info("DIAG CLEARED: %s", rule)
        diag_log = " | ".join(log_parts)

    readings["diagnostic_log"] = diag_log

    # Key metrics snapshot for threshold tuning
    readings["diag_metrics"] = (
        f"cam_rate={readings.get('camera_detections_per_min', 0):.1f} "
        f"cam_trend={readings.get('camera_rate_trend', '?')} "
        f"eject_rate={readings.get('eject_rate_per_min', 0):.1f} "
        f"enc_noise={readings.get('encoder_noise', 0)} "
        f"modbus_ms={readings.get('modbus_response_time_ms', 0):.1f} "
        f"speed={readings.get('encoder_speed_ftpm', 0):.1f}"
    )

    return current_rules, diag_log
