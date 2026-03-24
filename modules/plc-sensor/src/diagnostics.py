"""TPS Diagnostic Rules Engine.

Analyzes rolling sensor metrics and produces operator-friendly
diagnostic messages with severity, plain-English title, and
step-by-step actions.

Every diagnostic includes an 'evidence' field with the actual
sensor values that triggered the rule. This is critical for
field-tuning thresholds after the first production runs.

Standalone module — no PLC, Viam, or network dependencies.
Testable with mock data: evaluate({"camera_detections_per_min": 0, ...})

THRESHOLD NOTES (2026-03-23):
  All thresholds are initial estimates. None have been validated
  in production. After the first real truck deployment, review the
  diagnostic_log entries to tune thresholds based on actual data.

  Thresholds marked with # TUNE are the ones most likely to need
  adjustment after field testing.
"""

from typing import Any, Dict, List

Diagnostic = Dict[str, Any]


def evaluate(readings: Dict[str, Any]) -> List[Diagnostic]:
    """Run all diagnostic rules. Returns list sorted by severity.

    Each diagnostic includes:
      rule:     unique identifier
      severity: "critical" | "warning" | "info"
      title:    plain-English for operator
      action:   step-by-step what to do
      category: "camera" | "encoder" | "eject" | "plc" | "operation"
      evidence: actual sensor values that triggered the rule
    """
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


# ── Plate flipper rules ─────────────────────────────────────────────
# X3 is labeled "Camera" in the PLC project file but is actually a plate
# flipper — a needle on a bearing that detects plate orientation (whether
# a plate needs to be flipped before laying). Wired on blue/white wires
# of a 5-pin connector. Internal field names still use "camera_*" for
# Viam Cloud data compatibility.

def _check_camera(r: Dict[str, Any]) -> List[Diagnostic]:
    out: List[Diagnostic] = []

    trend = r.get("camera_rate_trend", "stable")
    cam_rate = r.get("camera_detections_per_min", 0)
    cam_dur = r.get("camera_signal_duration_s", 0)
    tps_power = r.get("tps_power_loop", False)
    speed = r.get("encoder_speed_ftpm", 0)
    eject_rate = r.get("eject_rate_per_min", 0)

    # camera_dead_gradual: rate declining and nearly zero
    if trend == "declining" and cam_rate < 2:  # TUNE: rate threshold
        out.append({
            "rule": "camera_dead_gradual",
            "severity": "critical",
            "category": "camera",
            "title": "Plate flipper detection degrading",
            "action": (
                "1. Stop the truck safely. "
                "2. Check the flipper needle moves freely on its bearing. "
                "3. Clear any debris around the flipper. "
                "4. Resume and verify detections return."
            ),
            "evidence": (
                f"camera_rate_trend={trend}, "
                f"camera_detections_per_min={cam_rate}, "
                f"speed={speed:.1f} ft/min"
            ),
        })

    # camera_dead_sudden: signal dead with power on
    if trend == "dead" and cam_dur > 30 and tps_power:  # TUNE: duration threshold
        out.append({
            "rule": "camera_dead_sudden",
            "severity": "critical",
            "category": "camera",
            "title": "Plate flipper lost \u2014 check wiring",
            "action": (
                "1. Check the flipper cable at the 5-pin connector (blue/white wires). "
                "2. Check the signal cable at PLC terminal X3. "
                "3. Look for a damaged or pinched cable along the run. "
                "4. If no fix found, switch to Encoder Mode at the HMI "
                "to continue dropping by distance."
            ),
            "evidence": (
                f"camera_rate_trend={trend}, "
                f"camera_signal_duration_s={cam_dur:.0f}, "
                f"tps_power_loop={tps_power}"
            ),
        })

    # camera_intermittent
    if trend == "intermittent":
        out.append({
            "rule": "camera_intermittent",
            "severity": "warning",
            "category": "camera",
            "title": "Plate flipper connection intermittent",
            "action": (
                "1. Check the 5-pin connector at the flipper \u2014 push in firmly. "
                "2. Check terminal X3 at the PLC \u2014 tighten the screw. "
                "3. Look for a cable that may be getting pinched when "
                "the truck moves."
            ),
            "evidence": (
                f"camera_rate_trend={trend}, "
                f"camera_detections_per_min={cam_rate}"
            ),
        })

    # no_ties_present: flipper sees nothing but truck is moving and ejecting
    if cam_rate == 0 and speed > 5 and eject_rate > 0:  # TUNE: speed threshold
        out.append({
            "rule": "no_ties_present",
            "severity": "info",
            "category": "camera",
            "title": "No ties detected \u2014 may be normal",
            "action": (
                "If the truck is on a crossing, switch, or bare track "
                "section, this is expected. The system is dropping by "
                "encoder distance. Flipper detection will resume when "
                "ties are present."
            ),
            "evidence": (
                f"camera_detections_per_min={cam_rate}, "
                f"speed={speed:.1f} ft/min, "
                f"eject_rate_per_min={eject_rate}"
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
    dd1_frozen = r.get("dd1_frozen", False)
    dd1_changing = not dd1_frozen
    cam_rate = r.get("camera_detections_per_min", 0)
    eject_rate = r.get("eject_rate_per_min", 0)
    ds10 = r.get("ds10", 0)
    ds10_frozen = r.get("ds10_frozen", False)

    # ── Hardware faults (work regardless of TPS power) ──

    # encoder_disconnected: DD1 frozen while TPS is on — no pulses from encoder
    if dd1_frozen and tps_power:
        out.append({
            "rule": "encoder_disconnected",
            "severity": "critical",
            "category": "encoder",
            "title": "Encoder disconnected \u2014 no signal",
            "action": (
                "1. Check the encoder cable \u2014 is it plugged in? "
                "2. Check the cable for damage or pinching. "
                "3. Check connections at PLC terminals X1 and X2. "
                "4. Check the encoder has power. "
                "5. If cable is good, the encoder itself may have failed."
            ),
            "evidence": (
                f"DD1 has not changed for 10+ seconds (frozen at {r.get('encoder_count', '?')}). "
                f"TPS is powered — encoder should be producing pulses."
            ),
        })

    # ── TPS-on faults (require production mode) ──

    # encoder_spinning_no_distance: DD1 alive but DS10 not counting down
    # Means encoder produces pulses but PLC isn't processing them into distance
    if dd1_changing and ds10_frozen and tps_power and tps_dur > 30:
        out.append({
            "rule": "encoder_spinning_no_distance",
            "severity": "critical",
            "category": "encoder",
            "title": "Encoder running but distance not counting",
            "action": (
                "1. The encoder is producing pulses but the PLC is not "
                "converting them to distance. "
                "2. Check PLC is in RUN mode (RUN LED green). "
                "3. Check for PLC faults on the HMI. "
                "4. Cycle TPS power off and on."
            ),
            "evidence": (
                f"DD1 is changing (encoder alive), "
                f"but DS10 is frozen at {ds10} (not counting down). "
                f"TPS power on for {tps_dur:.0f}s."
            ),
        })

    # encoder_stopped: TPS on, encoder alive, but no speed (wheel off rail)
    if speed == 0 and tps_power and tps_dur > 60 and not dd1_frozen:  # TUNE: 60s
        out.append({
            "rule": "encoder_stopped",
            "severity": "critical",
            "category": "encoder",
            "title": "Encoder not moving \u2014 check wheel contact",
            "action": (
                "1. Check that the track wheel is in contact with the "
                "rail and turning. "
                "2. The wheel may be lifted off the rail. "
                "3. Check for debris jamming the wheel. "
                "4. If the truck is actually stopped, this will clear "
                "when you start moving."
            ),
            "evidence": (
                f"encoder_speed_ftpm={speed}, "
                f"tps_power_loop={tps_power}, "
                f"tps_power_duration_s={tps_dur:.0f}, "
                f"dd1_frozen={dd1_frozen}"
            ),
        })

    # ── Motion anomalies ──

    # unexpected_motion: encoder shows movement when TPS is off and idle
    if speed > 2 and not tps_power and tps_dur > 300:  # TUNE: 2 ft/min, 5 min idle
        out.append({
            "rule": "unexpected_motion",
            "severity": "warning",
            "category": "encoder",
            "title": "Encoder showing movement while system is off",
            "action": (
                "1. Is the truck actually moving? If being repositioned, "
                "this is normal. "
                "2. If the truck is parked, check for encoder noise \u2014 "
                "vibration from nearby equipment may be causing false readings. "
                "3. Check the encoder mounting is tight."
            ),
            "evidence": (
                f"encoder_speed_ftpm={speed:.1f}, "
                f"tps_power_loop={tps_power}, "
                f"system idle for {tps_dur:.0f}s"
            ),
        })

    # speed_vs_detection_mismatch: camera sees ties but speed doesn't match
    # At 19.5" spacing, detection rate and speed should correlate:
    # expected_rate = speed_in_per_min / 19.5
    if tps_power and speed > 10 and cam_rate > 2:
        speed_in_per_min = speed * 12  # ft/min to in/min
        expected_cam_rate = speed_in_per_min / 19.5
        ratio = cam_rate / expected_cam_rate if expected_cam_rate > 0 else 1.0
        if ratio < 0.5 or ratio > 2.0:  # TUNE: 50% mismatch threshold
            out.append({
                "rule": "speed_vs_detection_mismatch",
                "severity": "warning",
                "category": "encoder",
                "title": "Encoder speed doesn't match tie detection rate",
                "action": (
                    "1. If speed is too high relative to camera: encoder wheel "
                    "may be slipping on rail (spinning faster than truck moves). "
                    "2. If speed is too low relative to camera: encoder may be "
                    "missing counts or wheel is dragging. "
                    "3. Check wheel contact with rail. "
                    "4. Check for debris on the wheel."
                ),
                "evidence": (
                    f"speed={speed:.1f} ft/min, camera_rate={cam_rate:.1f}/min, "
                    f"expected_camera_rate={expected_cam_rate:.1f}/min (at 19.5\" spacing), "
                    f"ratio={ratio:.2f} (should be ~1.0)"
                ),
            })

    # ── Signal quality ──

    # encoder_noisy: too many direction reversals
    if noise > 30:  # TUNE: was 10, raised for railroad vibration
        out.append({
            "rule": "encoder_noisy",
            "severity": "warning",
            "category": "encoder",
            "title": "Encoder signal noisy \u2014 check cable routing",
            "action": (
                "1. Route the encoder cable away from power cables and motors. "
                "2. Check cable shielding \u2014 make sure the shield is "
                "grounded at one end. "
                "3. Check for loose connectors."
            ),
            "evidence": (
                f"encoder_noise={noise} reversals/min (threshold: 30)"
            ),
        })

    # encoder_drift: actual plate spacing differs from target setting
    if ds2 > 0 and drop_count > 10:
        target_in = ds2 * 0.5
        drift = abs(avg_spacing - target_in)
        if drift > 2.0:  # TUNE: 2" deviation threshold
            direction = "long" if avg_spacing > target_in else "short"
            out.append({
                "rule": "encoder_drift",
                "severity": "warning",
                "category": "encoder",
                "title": f"Plates dropping {drift:.1f}\" {direction} of target",
                "action": (
                    "1. Check that the track wheel is tight on the rail "
                    "\u2014 a loose wheel slips and gives wrong distance. "
                    "2. Check for debris on the wheel. "
                    "3. Verify DS2 spacing setting matches the job spec. "
                    "4. If plates are consistently long, wheel may be worn "
                    "(smaller diameter = more counts per foot)."
                ),
                "evidence": (
                    f"avg_drop_spacing_in={avg_spacing:.1f}\", "
                    f"target={target_in:.1f}\" (DS2={ds2}), "
                    f"drift={drift:.1f}\" {direction}, "
                    f"drop_count={drop_count}"
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
    tps_power = r.get("tps_power_loop", False)

    # eject_no_confirm: firing but no Air Eagle feedback
    # NOTE: At 1Hz sampling, this is approximate. Y1 pulses are ~100ms
    # and Air Eagle feedback may not be captured in the same 1Hz read.
    # Only flag if eject rate is sustained AND air eagles are consistently off.
    if eject_rate > 2 and not ae1 and not ae2 and tps_power:  # TUNE: rate threshold raised to 2
        out.append({
            "rule": "eject_no_confirm",
            "severity": "warning",
            "category": "eject",
            "title": "Eject firing but no Air Eagle confirmation",
            "action": (
                "1. Check air pressure gauge \u2014 should be above 80 PSI. "
                "2. Check Air Eagle wireless relay batteries. "
                "3. Check that Air Eagle units are within range and powered on. "
                "4. Inspect the solenoid valve for sticking."
            ),
            "evidence": (
                f"eject_rate_per_min={eject_rate}, "
                f"air_eagle_1={ae1}, air_eagle_2={ae2}"
            ),
        })

    # eject_not_firing: everything enabled but nothing happening
    if drop_en and speed > 5 and eject_rate == 0 and tps_dur > 60:  # TUNE: duration
        out.append({
            "rule": "eject_not_firing",
            "severity": "critical",
            "category": "eject",
            "title": "No plates dropping \u2014 check drop system",
            "action": (
                "1. Check Operating Mode \u2014 is a mode selected? "
                "2. Check Drop Enable at the HMI. "
                "3. Check that the first tie has been detected (1st Tie Found). "
                "4. Check air pressure. "
                "5. If all look good, restart TPS power at the main switch."
            ),
            "evidence": (
                f"drop_enable={drop_en}, speed={speed:.1f} ft/min, "
                f"eject_rate_per_min={eject_rate}, "
                f"tps_power_duration_s={tps_dur:.0f}"
            ),
        })

    return out


# ── PLC communication rules ─────────────────────────────────────────

def _check_plc(r: Dict[str, Any]) -> List[Diagnostic]:
    out: List[Diagnostic] = []

    modbus_ms = r.get("modbus_response_time_ms", 0)
    total_reads = r.get("total_reads", 0)
    total_errors = r.get("total_errors", 0)

    # plc_slow: response time elevated
    # Normal over local ethernet: 5-15ms for multiple register reads
    # Flag only when significantly above baseline
    if modbus_ms > 50:  # TUNE: was 5ms (false alarm), raised to 50ms
        out.append({
            "rule": "plc_slow",
            "severity": "warning",
            "category": "plc",
            "title": "PLC communication slowing \u2014 check Ethernet cable",
            "action": (
                "1. Check the Ethernet cable between the Pi and PLC for damage. "
                "2. Make sure connectors are pushed in fully at both ends. "
                "3. Route cable away from power lines."
            ),
            "evidence": (
                f"modbus_response_time_ms={modbus_ms:.1f} (threshold: 50ms)"
            ),
        })

    # plc_errors: >1% error rate
    if total_reads > 100 and (total_errors / total_reads) > 0.01:
        error_pct = (total_errors / total_reads) * 100
        out.append({
            "rule": "plc_errors",
            "severity": "warning",
            "category": "plc",
            "title": "Frequent communication errors",
            "action": (
                "1. Check Ethernet cable and connectors. "
                "2. Check that the cable is not near high-voltage lines. "
                "3. Try swapping the Ethernet cable."
            ),
            "evidence": (
                f"total_errors={total_errors}, total_reads={total_reads}, "
                f"error_rate={error_pct:.1f}%"
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
            "category": "operation",
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
            "evidence": f"ds2={ds2} (standard: 39)",
        })

    # backward_travel
    if backup:
        out.append({
            "rule": "backward_travel",
            "severity": "warning",
            "category": "operation",
            "title": "Truck moving backward \u2014 plates will not drop",
            "action": (
                "Move the truck forward to resume plate dropping. "
                "The system does not drop plates in reverse."
            ),
            "evidence": f"backup_alarm={backup}",
        })

    # drop_disabled_troubleshoot: power on, moving, but drops disabled
    if tps_power and speed > 3 and not drop_en:  # TUNE: speed threshold
        out.append({
            "rule": "drop_disabled_troubleshoot",
            "severity": "critical",
            "category": "operation",
            "title": "TPS powered but drops disabled",
            "action": (
                "1. Select an operating mode at the HMI. "
                "2. Press Enable Drop on the HMI. "
                "3. Make sure the first tie has been detected \u2014 "
                "you may need to move forward over some ties first."
            ),
            "evidence": (
                f"tps_power_loop={tps_power}, speed={speed:.1f} ft/min, "
                f"drop_enable={drop_en}, operating_mode={mode}"
            ),
        })

    # no_mode_selected: power on but no mode
    if tps_power and mode in ("None", ""):
        out.append({
            "rule": "no_mode_selected",
            "severity": "warning",
            "category": "operation",
            "title": "No operating mode selected",
            "action": (
                "Select a mode at the HMI (TPS-1 Single, TPS-2, Tie Team, "
                "etc.) before plates will drop."
            ),
            "evidence": f"operating_mode={mode}, tps_power_loop={tps_power}",
        })

    return out
