"""TPS Diagnostic Rules Engine.

Analyzes rolling sensor metrics and produces operator-friendly
diagnostic messages with severity, plain-English title, and
step-by-step actions.

Standalone module — no PLC, Viam, or network dependencies.
Testable with mock data: evaluate({"camera_detections_per_min": 0, ...})
"""

from typing import Any, Dict, List

Diagnostic = Dict[str, Any]


def evaluate(readings: Dict[str, Any]) -> List[Diagnostic]:
    """Run all diagnostic rules. Returns list sorted by severity."""
    # Skip during warmup (first 60 seconds)
    if readings.get("total_reads", 0) < 60:
        return []

    results = []
    results.extend(_check_camera(readings))
    results.extend(_check_encoder(readings))
    results.extend(_check_eject(readings))
    results.extend(_check_plc(readings))
    results.extend(_check_operation(readings))

    SEVERITY_ORDER = {"critical": 0, "warning": 1, "info": 2}
    results.sort(key=lambda d: SEVERITY_ORDER.get(d["severity"], 9))
    return results


# ── Camera rules ────────────────────────────────────────────────────

def _check_camera(r: Dict[str, Any]) -> List[Diagnostic]:
    out: List[Diagnostic] = []

    trend = r.get("camera_rate_trend", "stable")
    cam_rate = r.get("camera_detections_per_min", 0)
    cam_dur = r.get("camera_signal_duration_s", 0)
    tps_power = r.get("tps_power_loop", False)
    speed = r.get("encoder_speed_ftpm", 0)
    eject_rate = r.get("eject_rate_per_min", 0)

    # camera_dead_gradual: rate declining and nearly zero
    if trend == "declining" and cam_rate < 2:
        out.append({
            "rule": "camera_dead_gradual",
            "severity": "critical",
            "title": "Camera detection degrading \u2014 clean lens",
            "action": (
                "1. Stop the truck safely. "
                "2. Clean the camera lens with a dry cloth. "
                "3. Check the camera mounting \u2014 vibration may have shifted it. "
                "4. Resume and verify detections return."
            ),
        })

    # camera_dead_sudden: signal dead with power on
    if trend == "dead" and cam_dur > 30 and tps_power:
        out.append({
            "rule": "camera_dead_sudden",
            "severity": "critical",
            "title": "Camera lost \u2014 check power and cable",
            "action": (
                "1. Check camera power cable at the junction box. "
                "2. Check the signal cable at PLC terminal X3. "
                "3. Look for a damaged or pinched cable along the run. "
                "4. If no fix found, switch to Encoder Mode at the HMI "
                "to continue dropping by distance."
            ),
        })

    # camera_intermittent
    if trend == "intermittent":
        out.append({
            "rule": "camera_intermittent",
            "severity": "warning",
            "title": "Camera connection intermittent",
            "action": (
                "1. Check cable connector at the camera \u2014 push in firmly. "
                "2. Check terminal X3 at the PLC \u2014 tighten the screw. "
                "3. Look for a cable that may be getting pinched when "
                "the truck moves."
            ),
        })

    # no_ties_present: camera sees nothing but truck is moving and ejecting
    if cam_rate == 0 and speed > 5 and eject_rate > 0:
        out.append({
            "rule": "no_ties_present",
            "severity": "info",
            "title": "No ties detected \u2014 may be normal",
            "action": (
                "If the truck is on a crossing, switch, or bare track "
                "section, this is expected. The system is dropping by "
                "encoder distance. Camera detection will resume when "
                "ties are present."
            ),
        })

    return out


# ── Encoder rules ───────────────────────────────────────────────────

def _check_encoder(r: Dict[str, Any]) -> List[Diagnostic]:
    out: List[Diagnostic] = []

    speed = r.get("encoder_speed_ftpm", 0)
    tps_power = r.get("tps_power_loop", False)
    tps_dur = r.get("tps_power_duration_s", 0)
    noise = r.get("encoder_noise", 0)
    avg_spacing = r.get("avg_drop_spacing_in", 0)
    ds2 = r.get("ds2", 0)
    drop_count = r.get("drop_count_in_window", 0)

    # encoder_stopped: power on, nothing moving
    if speed == 0 and tps_power and tps_dur > 30:
        out.append({
            "rule": "encoder_stopped",
            "severity": "critical",
            "title": "Encoder not reading \u2014 check wheel and cable",
            "action": (
                "1. Check that the track wheel is in contact with the "
                "rail and turning. "
                "2. Check the encoder cable for damage. "
                "3. Check the cable connections at PLC terminals X1 and X2. "
                "4. If the cable looks good, the encoder may have failed."
            ),
        })

    # encoder_noisy
    if noise > 10:
        out.append({
            "rule": "encoder_noisy",
            "severity": "warning",
            "title": "Encoder signal noisy \u2014 check cable routing",
            "action": (
                "1. Route the encoder cable away from power cables and motors. "
                "2. Check cable shielding \u2014 make sure the shield is "
                "grounded at one end. "
                "3. Check for loose connectors."
            ),
        })

    # encoder_drift: actual spacing differs from target
    if ds2 > 0 and drop_count > 10:
        target_in = ds2 * 0.5
        if abs(avg_spacing - target_in) > 2.0:
            out.append({
                "rule": "encoder_drift",
                "severity": "warning",
                "title": "Plate spacing drifting from target",
                "action": (
                    "1. Check that the track wheel is tight on the rail "
                    "\u2014 a loose wheel slips and gives wrong distance. "
                    "2. Check for debris on the wheel. "
                    "3. Verify DS2 spacing setting matches the job spec."
                ),
            })

    return out


# ── Eject system rules ──────────────────────────────────────────────

def _check_eject(r: Dict[str, Any]) -> List[Diagnostic]:
    out: List[Diagnostic] = []

    eject_rate = r.get("eject_rate_per_min", 0)
    ae1 = r.get("air_eagle_1_feedback", False)
    ae2 = r.get("air_eagle_2_feedback", False)
    drop_en = r.get("drop_enable", False)
    speed = r.get("encoder_speed_ftpm", 0)
    tps_dur = r.get("tps_power_duration_s", 0)

    # eject_no_confirm: firing but no Air Eagle feedback
    if eject_rate > 0 and not ae1 and not ae2:
        out.append({
            "rule": "eject_no_confirm",
            "severity": "warning",
            "title": "Eject firing but no Air Eagle confirmation",
            "action": (
                "1. Check air pressure gauge \u2014 should be above 80 PSI. "
                "2. Check Air Eagle wireless relay batteries. "
                "3. Check that Air Eagle units are within range and powered on. "
                "4. Inspect the solenoid valve for sticking."
            ),
        })

    # eject_not_firing: everything enabled but nothing happening
    if drop_en and speed > 5 and eject_rate == 0 and tps_dur > 60:
        out.append({
            "rule": "eject_not_firing",
            "severity": "critical",
            "title": "No plates dropping \u2014 check drop system",
            "action": (
                "1. Check Operating Mode \u2014 is a mode selected? "
                "2. Check Drop Enable at the HMI. "
                "3. Check that the first tie has been detected (1st Tie Found). "
                "4. Check air pressure. "
                "5. If all look good, restart TPS power at the main switch."
            ),
        })

    return out


# ── PLC communication rules ─────────────────────────────────────────

def _check_plc(r: Dict[str, Any]) -> List[Diagnostic]:
    out: List[Diagnostic] = []

    modbus_ms = r.get("modbus_response_time_ms", 0)
    total_reads = r.get("total_reads", 0)
    total_errors = r.get("total_errors", 0)

    # plc_slow
    if modbus_ms > 5:
        out.append({
            "rule": "plc_slow",
            "severity": "warning",
            "title": "PLC communication slowing \u2014 check Ethernet cable",
            "action": (
                "1. Check the Ethernet cable between the Pi and PLC for damage. "
                "2. Make sure connectors are pushed in fully at both ends. "
                "3. Route cable away from power lines."
            ),
        })

    # plc_errors: >1% error rate
    if total_reads > 100 and (total_errors / total_reads) > 0.01:
        out.append({
            "rule": "plc_errors",
            "severity": "warning",
            "title": "Frequent communication errors",
            "action": (
                "1. Check Ethernet cable and connectors. "
                "2. Check that the cable is not near high-voltage lines. "
                "3. Try swapping the Ethernet cable."
            ),
        })

    return out


# ── Operational rules ────────────────────────────────────────────────

def _check_operation(r: Dict[str, Any]) -> List[Diagnostic]:
    out: List[Diagnostic] = []

    ds2 = r.get("ds2", 0)
    backup = r.get("backup_alarm", False)
    tps_power = r.get("tps_power_loop", False)
    speed = r.get("encoder_speed_ftpm", 0)
    drop_en = r.get("drop_enable", False)
    mode = r.get("operating_mode", "None")

    # spacing_wrong: DS2 not at standard 39 (19.5 in)
    if ds2 > 0 and ds2 != 39:
        spacing_in = ds2 * 0.5
        out.append({
            "rule": "spacing_wrong",
            "severity": "info",
            "title": (
                "Tie spacing set to {:.1f}\" \u2014 verify this is correct"
                .format(spacing_in)
            ),
            "action": (
                "The PLC tie spacing is set to {:.1f} inches. Standard is "
                "19.5 inches (DS2=39). If this is intentional for this job, "
                "no action needed."
                .format(spacing_in)
            ),
        })

    # backward_travel
    if backup:
        out.append({
            "rule": "backward_travel",
            "severity": "warning",
            "title": "Truck moving backward \u2014 plates will not drop",
            "action": (
                "Move the truck forward to resume plate dropping. "
                "The system does not drop plates in reverse."
            ),
        })

    # drop_disabled_troubleshoot: power on, moving, but drops disabled
    if tps_power and speed > 3 and not drop_en:
        out.append({
            "rule": "drop_disabled_troubleshoot",
            "severity": "critical",
            "title": "TPS powered but drops disabled",
            "action": (
                "1. Select an operating mode at the HMI. "
                "2. Press Enable Drop on the HMI. "
                "3. Make sure the first tie has been detected \u2014 "
                "you may need to move forward over some ties first."
            ),
        })

    # no_mode_selected: power on but no mode
    if tps_power and mode in ("None", ""):
        out.append({
            "rule": "no_mode_selected",
            "severity": "warning",
            "title": "No operating mode selected",
            "action": (
                "Select a mode at the HMI (TPS-1 Single, TPS-2, Tie Team, "
                "etc.) before plates will drop."
            ),
        })

    return out
