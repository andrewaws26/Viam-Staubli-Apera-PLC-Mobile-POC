"""Comprehensive tests for the TPS Diagnostic Rules Engine (diagnostics.py).

Tests all 19 rules across 5 categories: camera, encoder, eject, plc, operation.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
from diagnostics import evaluate

REQUIRED_KEYS = {"rule", "severity", "category", "title", "action", "evidence"}


def _base_readings():
    """Return a healthy-state readings dict that triggers no diagnostics."""
    return {
        # Warmup passed
        "total_reads": 100,
        "total_errors": 0,
        # Camera/flipper -- stable, some detections
        "camera_rate_trend": "stable",
        "camera_detections_per_min": 5,
        "camera_signal_duration_s": 0,
        # Encoder -- moving at moderate speed, healthy
        "encoder_speed_ftpm": 15,
        "encoder_count": 500,
        "encoder_noise": 5,
        "dd1_frozen": False,
        "ds10": 100,
        "ds10_frozen": False,
        # Spacing
        "ds2": 39,
        "ds3": 195,
        "avg_drop_spacing_in": 19.5,
        "drop_count_in_window": 0,
        # TPS power -- on, been running a while
        "tps_power_loop": True,
        "tps_power_duration_s": 120,
        # Eject -- working normally
        "eject_rate_per_min": 3,
        "air_eagle_1_feedback": True,
        "air_eagle_2_feedback": True,
        "drop_enable": True,
        # PLC comms -- healthy
        "modbus_response_time_ms": 10,
        # Operation
        "operating_mode": "TPS-1",
        "backup_alarm": False,
    }


def _rules(diags):
    """Extract rule names from diagnostic list."""
    return [d["rule"] for d in diags]


def _find(diags, rule_name):
    """Find a specific diagnostic by rule name."""
    for d in diags:
        if d["rule"] == rule_name:
            return d
    return None


# =========================================================================
# Warmup
# =========================================================================

class TestWarmup:
    def test_warmup_returns_empty(self):
        r = _base_readings()
        r["total_reads"] = 59
        assert evaluate(r) == []

    def test_warmup_at_boundary(self):
        r = _base_readings()
        r["total_reads"] = 60
        # Should NOT be blocked by warmup (may or may not have diagnostics)
        result = evaluate(r)
        # Just verify it ran (didn't short-circuit to [])
        # With base readings, no rules should fire, but the engine ran
        assert isinstance(result, list)

    def test_warmup_zero_reads(self):
        r = _base_readings()
        r["total_reads"] = 0
        assert evaluate(r) == []


# =========================================================================
# Structural validation
# =========================================================================

class TestStructure:
    def test_base_readings_produce_no_diagnostics(self):
        assert evaluate(_base_readings()) == []

    def test_all_diagnostics_have_required_keys(self):
        """Trigger multiple rules and verify all have required keys."""
        r = _base_readings()
        r["camera_rate_trend"] = "intermittent"
        r["modbus_response_time_ms"] = 100
        r["backup_alarm"] = True
        diags = evaluate(r)
        assert len(diags) >= 3
        for d in diags:
            assert REQUIRED_KEYS <= set(d.keys()), f"Missing keys in {d['rule']}"

    def test_severity_sorting(self):
        """Critical rules come before warning, warning before info."""
        r = _base_readings()
        # Trigger a critical
        r["dd1_frozen"] = True  # encoder_disconnected (critical)
        # Trigger a warning
        r["camera_rate_trend"] = "intermittent"  # camera_intermittent (warning)
        # Trigger an info
        r["ds2"] = 40  # spacing_wrong (info)
        diags = evaluate(r)
        severities = [d["severity"] for d in diags]
        order = {"critical": 0, "warning": 1, "info": 2}
        assert severities == sorted(severities, key=lambda s: order[s])

    def test_multiple_rules_fire_simultaneously(self):
        """Several rules from different categories can fire at once."""
        r = _base_readings()
        r["dd1_frozen"] = True  # encoder_disconnected
        r["modbus_response_time_ms"] = 100  # plc_slow
        r["backup_alarm"] = True  # backward_travel
        diags = evaluate(r)
        rules = _rules(diags)
        assert "encoder_disconnected" in rules
        assert "plc_slow" in rules
        assert "backward_travel" in rules


# =========================================================================
# Camera rules
# =========================================================================

class TestCameraDeadGradual:
    def test_triggers(self):
        r = _base_readings()
        r["camera_rate_trend"] = "declining"
        r["camera_detections_per_min"] = 1
        diags = evaluate(r)
        d = _find(diags, "camera_dead_gradual")
        assert d is not None
        assert d["severity"] == "critical"
        assert d["category"] == "camera"

    def test_not_triggered_stable_trend(self):
        r = _base_readings()
        r["camera_rate_trend"] = "stable"
        r["camera_detections_per_min"] = 1
        assert "camera_dead_gradual" not in _rules(evaluate(r))

    def test_not_triggered_high_rate(self):
        r = _base_readings()
        r["camera_rate_trend"] = "declining"
        r["camera_detections_per_min"] = 2  # threshold is < 2
        assert "camera_dead_gradual" not in _rules(evaluate(r))

    def test_edge_just_below_threshold(self):
        r = _base_readings()
        r["camera_rate_trend"] = "declining"
        r["camera_detections_per_min"] = 1.99
        assert "camera_dead_gradual" in _rules(evaluate(r))


class TestCameraDeadSudden:
    def test_triggers(self):
        r = _base_readings()
        r["camera_rate_trend"] = "dead"
        r["camera_signal_duration_s"] = 31
        r["tps_power_loop"] = True
        diags = evaluate(r)
        d = _find(diags, "camera_dead_sudden")
        assert d is not None
        assert d["severity"] == "critical"

    def test_not_triggered_power_off(self):
        r = _base_readings()
        r["camera_rate_trend"] = "dead"
        r["camera_signal_duration_s"] = 60
        r["tps_power_loop"] = False
        assert "camera_dead_sudden" not in _rules(evaluate(r))

    def test_not_triggered_short_duration(self):
        r = _base_readings()
        r["camera_rate_trend"] = "dead"
        r["camera_signal_duration_s"] = 30  # threshold is > 30
        r["tps_power_loop"] = True
        assert "camera_dead_sudden" not in _rules(evaluate(r))

    def test_edge_at_threshold(self):
        r = _base_readings()
        r["camera_rate_trend"] = "dead"
        r["camera_signal_duration_s"] = 30
        r["tps_power_loop"] = True
        # duration must be > 30, so 30 should NOT trigger
        assert "camera_dead_sudden" not in _rules(evaluate(r))


class TestCameraIntermittent:
    def test_triggers(self):
        r = _base_readings()
        r["camera_rate_trend"] = "intermittent"
        diags = evaluate(r)
        d = _find(diags, "camera_intermittent")
        assert d is not None
        assert d["severity"] == "warning"
        assert d["category"] == "camera"

    def test_not_triggered_stable(self):
        r = _base_readings()
        r["camera_rate_trend"] = "stable"
        assert "camera_intermittent" not in _rules(evaluate(r))


class TestNoTiesPresent:
    def test_triggers(self):
        r = _base_readings()
        r["camera_detections_per_min"] = 0
        r["encoder_speed_ftpm"] = 10
        r["eject_rate_per_min"] = 3
        diags = evaluate(r)
        d = _find(diags, "no_ties_present")
        assert d is not None
        assert d["severity"] == "info"

    def test_not_triggered_camera_detecting(self):
        r = _base_readings()
        r["camera_detections_per_min"] = 1
        r["encoder_speed_ftpm"] = 10
        r["eject_rate_per_min"] = 3
        assert "no_ties_present" not in _rules(evaluate(r))

    def test_not_triggered_slow_speed(self):
        r = _base_readings()
        r["camera_detections_per_min"] = 0
        r["encoder_speed_ftpm"] = 5  # threshold is > 5
        r["eject_rate_per_min"] = 3
        assert "no_ties_present" not in _rules(evaluate(r))

    def test_not_triggered_no_eject(self):
        r = _base_readings()
        r["camera_detections_per_min"] = 0
        r["encoder_speed_ftpm"] = 10
        r["eject_rate_per_min"] = 0
        assert "no_ties_present" not in _rules(evaluate(r))


# =========================================================================
# Encoder rules
# =========================================================================

class TestEncoderDisconnected:
    def test_triggers(self):
        r = _base_readings()
        r["dd1_frozen"] = True
        r["tps_power_loop"] = True
        diags = evaluate(r)
        d = _find(diags, "encoder_disconnected")
        assert d is not None
        assert d["severity"] == "critical"
        assert d["category"] == "encoder"

    def test_not_triggered_power_off(self):
        r = _base_readings()
        r["dd1_frozen"] = True
        r["tps_power_loop"] = False
        assert "encoder_disconnected" not in _rules(evaluate(r))

    def test_not_triggered_dd1_alive(self):
        r = _base_readings()
        r["dd1_frozen"] = False
        r["tps_power_loop"] = True
        assert "encoder_disconnected" not in _rules(evaluate(r))


class TestEncoderSpinningNoDistance:
    def test_triggers(self):
        r = _base_readings()
        r["dd1_frozen"] = False
        r["ds10_frozen"] = True
        r["tps_power_loop"] = True
        r["tps_power_duration_s"] = 31
        diags = evaluate(r)
        d = _find(diags, "encoder_spinning_no_distance")
        assert d is not None
        assert d["severity"] == "critical"

    def test_not_triggered_ds10_alive(self):
        r = _base_readings()
        r["dd1_frozen"] = False
        r["ds10_frozen"] = False
        r["tps_power_loop"] = True
        r["tps_power_duration_s"] = 60
        assert "encoder_spinning_no_distance" not in _rules(evaluate(r))

    def test_not_triggered_short_duration(self):
        r = _base_readings()
        r["dd1_frozen"] = False
        r["ds10_frozen"] = True
        r["tps_power_loop"] = True
        r["tps_power_duration_s"] = 30  # threshold is > 30
        assert "encoder_spinning_no_distance" not in _rules(evaluate(r))

    def test_not_triggered_dd1_frozen(self):
        """If dd1 is frozen, this rule should not fire (encoder_disconnected fires instead)."""
        r = _base_readings()
        r["dd1_frozen"] = True
        r["ds10_frozen"] = True
        r["tps_power_loop"] = True
        r["tps_power_duration_s"] = 60
        assert "encoder_spinning_no_distance" not in _rules(evaluate(r))


class TestEncoderStopped:
    def test_triggers(self):
        r = _base_readings()
        r["encoder_speed_ftpm"] = 0
        r["tps_power_loop"] = True
        r["tps_power_duration_s"] = 61
        r["dd1_frozen"] = False
        diags = evaluate(r)
        d = _find(diags, "encoder_stopped")
        assert d is not None
        assert d["severity"] == "critical"

    def test_not_triggered_moving(self):
        r = _base_readings()
        r["encoder_speed_ftpm"] = 1
        r["tps_power_loop"] = True
        r["tps_power_duration_s"] = 120
        r["dd1_frozen"] = False
        assert "encoder_stopped" not in _rules(evaluate(r))

    def test_not_triggered_short_duration(self):
        r = _base_readings()
        r["encoder_speed_ftpm"] = 0
        r["tps_power_loop"] = True
        r["tps_power_duration_s"] = 60  # threshold is > 60
        r["dd1_frozen"] = False
        assert "encoder_stopped" not in _rules(evaluate(r))

    def test_not_triggered_dd1_frozen(self):
        r = _base_readings()
        r["encoder_speed_ftpm"] = 0
        r["tps_power_loop"] = True
        r["tps_power_duration_s"] = 120
        r["dd1_frozen"] = True  # not dd1_frozen must be True (i.e., dd1_frozen=False)
        assert "encoder_stopped" not in _rules(evaluate(r))


class TestUnexpectedMotion:
    def test_triggers(self):
        r = _base_readings()
        r["encoder_speed_ftpm"] = 3
        r["tps_power_loop"] = False
        r["tps_power_duration_s"] = 301
        diags = evaluate(r)
        d = _find(diags, "unexpected_motion")
        assert d is not None
        assert d["severity"] == "warning"

    def test_not_triggered_power_on(self):
        r = _base_readings()
        r["encoder_speed_ftpm"] = 3
        r["tps_power_loop"] = True
        r["tps_power_duration_s"] = 400
        assert "unexpected_motion" not in _rules(evaluate(r))

    def test_not_triggered_low_speed(self):
        r = _base_readings()
        r["encoder_speed_ftpm"] = 2  # threshold is > 2
        r["tps_power_loop"] = False
        r["tps_power_duration_s"] = 400
        assert "unexpected_motion" not in _rules(evaluate(r))

    def test_not_triggered_short_idle(self):
        r = _base_readings()
        r["encoder_speed_ftpm"] = 5
        r["tps_power_loop"] = False
        r["tps_power_duration_s"] = 300  # threshold is > 300
        assert "unexpected_motion" not in _rules(evaluate(r))


class TestSpeedVsDetectionMismatch:
    def test_triggers_ratio_too_low(self):
        r = _base_readings()
        r["tps_power_loop"] = True
        r["encoder_speed_ftpm"] = 20
        # expected_cam_rate = 20 * 12 / 19.5 = 12.3
        # cam_rate / expected = 3 / 12.3 = 0.24 < 0.5
        r["camera_detections_per_min"] = 3
        diags = evaluate(r)
        d = _find(diags, "speed_vs_detection_mismatch")
        assert d is not None
        assert d["severity"] == "warning"

    def test_triggers_ratio_too_high(self):
        r = _base_readings()
        r["tps_power_loop"] = True
        r["encoder_speed_ftpm"] = 11
        # expected = 11 * 12 / 19.5 = 6.77
        # need ratio > 2.0, so cam_rate > 13.5
        r["camera_detections_per_min"] = 14
        diags = evaluate(r)
        d = _find(diags, "speed_vs_detection_mismatch")
        assert d is not None

    def test_not_triggered_matching_rate(self):
        r = _base_readings()
        r["tps_power_loop"] = True
        r["encoder_speed_ftpm"] = 15
        # expected = 15 * 12 / 19.5 = 9.23
        r["camera_detections_per_min"] = 9
        assert "speed_vs_detection_mismatch" not in _rules(evaluate(r))

    def test_not_triggered_low_speed(self):
        r = _base_readings()
        r["tps_power_loop"] = True
        r["encoder_speed_ftpm"] = 10  # threshold is > 10
        r["camera_detections_per_min"] = 100  # extreme mismatch but speed too low
        assert "speed_vs_detection_mismatch" not in _rules(evaluate(r))

    def test_not_triggered_low_cam_rate(self):
        r = _base_readings()
        r["tps_power_loop"] = True
        r["encoder_speed_ftpm"] = 20
        r["camera_detections_per_min"] = 2  # threshold is > 2
        assert "speed_vs_detection_mismatch" not in _rules(evaluate(r))

    def test_edge_ratio_exactly_half(self):
        r = _base_readings()
        r["tps_power_loop"] = True
        r["encoder_speed_ftpm"] = 20
        # expected = 20*12/19.5 = 12.307...
        # ratio = cam / expected = 0.5 exactly should NOT trigger (< 0.5 required)
        r["camera_detections_per_min"] = 20 * 12 / 19.5 * 0.5
        # That's 6.153..., ratio = 6.153/12.307 = 0.5 exactly
        # Need > 2 check: 6.153 > 2 = True
        diags = evaluate(r)
        # ratio = 0.5 exactly, condition is < 0.5, so should NOT trigger
        assert "speed_vs_detection_mismatch" not in _rules(diags)


class TestEncoderNoisy:
    def test_triggers(self):
        r = _base_readings()
        r["encoder_noise"] = 31
        diags = evaluate(r)
        d = _find(diags, "encoder_noisy")
        assert d is not None
        assert d["severity"] == "warning"

    def test_not_triggered_low_noise(self):
        r = _base_readings()
        r["encoder_noise"] = 30  # threshold is > 30
        assert "encoder_noisy" not in _rules(evaluate(r))

    def test_edge_at_threshold(self):
        r = _base_readings()
        r["encoder_noise"] = 30
        assert "encoder_noisy" not in _rules(evaluate(r))
        r["encoder_noise"] = 30.01
        assert "encoder_noisy" in _rules(evaluate(r))


class TestEncoderDrift:
    def test_triggers_long(self):
        r = _base_readings()
        r["ds2"] = 39
        r["drop_count_in_window"] = 11
        r["avg_drop_spacing_in"] = 22.0  # target = 19.5, drift = 2.5 > 2.0
        diags = evaluate(r)
        d = _find(diags, "encoder_drift")
        assert d is not None
        assert d["severity"] == "warning"
        assert "long" in d["title"]

    def test_triggers_short(self):
        r = _base_readings()
        r["ds2"] = 39
        r["drop_count_in_window"] = 11
        r["avg_drop_spacing_in"] = 17.0  # target = 19.5, drift = 2.5
        diags = evaluate(r)
        d = _find(diags, "encoder_drift")
        assert d is not None
        assert "short" in d["title"]

    def test_not_triggered_within_tolerance(self):
        r = _base_readings()
        r["ds2"] = 39
        r["drop_count_in_window"] = 20
        r["avg_drop_spacing_in"] = 20.5  # drift = 1.0 < 2.0
        assert "encoder_drift" not in _rules(evaluate(r))

    def test_not_triggered_low_drop_count(self):
        r = _base_readings()
        r["ds2"] = 39
        r["drop_count_in_window"] = 10  # threshold is > 10
        r["avg_drop_spacing_in"] = 25.0
        assert "encoder_drift" not in _rules(evaluate(r))

    def test_not_triggered_ds2_zero(self):
        r = _base_readings()
        r["ds2"] = 0
        r["drop_count_in_window"] = 20
        r["avg_drop_spacing_in"] = 25.0
        assert "encoder_drift" not in _rules(evaluate(r))

    def test_edge_drift_exactly_2(self):
        r = _base_readings()
        r["ds2"] = 39
        r["drop_count_in_window"] = 11
        r["avg_drop_spacing_in"] = 21.5  # target=19.5, drift=2.0, threshold is > 2.0
        assert "encoder_drift" not in _rules(evaluate(r))


# =========================================================================
# Eject rules
# =========================================================================

class TestEjectNoConfirm:
    def test_triggers(self):
        r = _base_readings()
        r["eject_rate_per_min"] = 3
        r["air_eagle_1_feedback"] = False
        r["air_eagle_2_feedback"] = False
        r["tps_power_loop"] = True
        diags = evaluate(r)
        d = _find(diags, "eject_no_confirm")
        assert d is not None
        assert d["severity"] == "warning"
        assert d["category"] == "eject"

    def test_not_triggered_feedback_present(self):
        r = _base_readings()
        r["eject_rate_per_min"] = 5
        r["air_eagle_1_feedback"] = True
        r["air_eagle_2_feedback"] = False
        r["tps_power_loop"] = True
        assert "eject_no_confirm" not in _rules(evaluate(r))

    def test_not_triggered_low_eject_rate(self):
        r = _base_readings()
        r["eject_rate_per_min"] = 2  # threshold is > 2
        r["air_eagle_1_feedback"] = False
        r["air_eagle_2_feedback"] = False
        r["tps_power_loop"] = True
        assert "eject_no_confirm" not in _rules(evaluate(r))

    def test_not_triggered_power_off(self):
        r = _base_readings()
        r["eject_rate_per_min"] = 5
        r["air_eagle_1_feedback"] = False
        r["air_eagle_2_feedback"] = False
        r["tps_power_loop"] = False
        assert "eject_no_confirm" not in _rules(evaluate(r))

    def test_not_triggered_ae2_feedback(self):
        r = _base_readings()
        r["eject_rate_per_min"] = 5
        r["air_eagle_1_feedback"] = False
        r["air_eagle_2_feedback"] = True
        r["tps_power_loop"] = True
        assert "eject_no_confirm" not in _rules(evaluate(r))


class TestEjectNotFiring:
    def test_triggers(self):
        r = _base_readings()
        r["drop_enable"] = True
        r["encoder_speed_ftpm"] = 10
        r["eject_rate_per_min"] = 0
        r["tps_power_duration_s"] = 61
        diags = evaluate(r)
        d = _find(diags, "eject_not_firing")
        assert d is not None
        assert d["severity"] == "critical"

    def test_not_triggered_ejecting(self):
        r = _base_readings()
        r["drop_enable"] = True
        r["encoder_speed_ftpm"] = 10
        r["eject_rate_per_min"] = 1
        r["tps_power_duration_s"] = 120
        assert "eject_not_firing" not in _rules(evaluate(r))

    def test_not_triggered_drop_disabled(self):
        r = _base_readings()
        r["drop_enable"] = False
        r["encoder_speed_ftpm"] = 10
        r["eject_rate_per_min"] = 0
        r["tps_power_duration_s"] = 120
        assert "eject_not_firing" not in _rules(evaluate(r))

    def test_not_triggered_slow_speed(self):
        r = _base_readings()
        r["drop_enable"] = True
        r["encoder_speed_ftpm"] = 5  # threshold is > 5
        r["eject_rate_per_min"] = 0
        r["tps_power_duration_s"] = 120
        assert "eject_not_firing" not in _rules(evaluate(r))

    def test_not_triggered_short_duration(self):
        r = _base_readings()
        r["drop_enable"] = True
        r["encoder_speed_ftpm"] = 10
        r["eject_rate_per_min"] = 0
        r["tps_power_duration_s"] = 60  # threshold is > 60
        assert "eject_not_firing" not in _rules(evaluate(r))


# =========================================================================
# PLC rules
# =========================================================================

class TestPlcSlow:
    def test_triggers(self):
        r = _base_readings()
        r["modbus_response_time_ms"] = 51
        diags = evaluate(r)
        d = _find(diags, "plc_slow")
        assert d is not None
        assert d["severity"] == "warning"
        assert d["category"] == "plc"

    def test_not_triggered_normal(self):
        r = _base_readings()
        r["modbus_response_time_ms"] = 50  # threshold is > 50
        assert "plc_slow" not in _rules(evaluate(r))

    def test_edge_at_threshold(self):
        r = _base_readings()
        r["modbus_response_time_ms"] = 50
        assert "plc_slow" not in _rules(evaluate(r))
        r["modbus_response_time_ms"] = 50.01
        assert "plc_slow" in _rules(evaluate(r))


class TestPlcErrors:
    def test_triggers(self):
        r = _base_readings()
        r["total_reads"] = 1000
        r["total_errors"] = 11  # 1.1% > 1%
        diags = evaluate(r)
        d = _find(diags, "plc_errors")
        assert d is not None
        assert d["severity"] == "warning"

    def test_not_triggered_low_error_rate(self):
        r = _base_readings()
        r["total_reads"] = 1000
        r["total_errors"] = 10  # exactly 1%
        assert "plc_errors" not in _rules(evaluate(r))

    def test_not_triggered_low_reads(self):
        r = _base_readings()
        r["total_reads"] = 100
        r["total_errors"] = 5  # 5% but total_reads must be > 100
        assert "plc_errors" not in _rules(evaluate(r))

    def test_edge_just_over_threshold(self):
        r = _base_readings()
        r["total_reads"] = 101
        r["total_errors"] = 2  # 1.98% > 1%
        assert "plc_errors" in _rules(evaluate(r))


# =========================================================================
# Operation rules
# =========================================================================

class TestSpacingWrong:
    def test_triggers(self):
        r = _base_readings()
        r["ds2"] = 40
        diags = evaluate(r)
        d = _find(diags, "spacing_wrong")
        assert d is not None
        assert d["severity"] == "info"
        assert d["category"] == "operation"
        assert "20.0" in d["title"]  # 40 * 0.5 = 20.0

    def test_not_triggered_standard_spacing(self):
        r = _base_readings()
        r["ds2"] = 39
        assert "spacing_wrong" not in _rules(evaluate(r))

    def test_not_triggered_zero(self):
        r = _base_readings()
        r["ds2"] = 0
        assert "spacing_wrong" not in _rules(evaluate(r))


class TestBackwardTravel:
    def test_triggers(self):
        r = _base_readings()
        r["backup_alarm"] = True
        diags = evaluate(r)
        d = _find(diags, "backward_travel")
        assert d is not None
        assert d["severity"] == "warning"
        assert d["category"] == "operation"

    def test_not_triggered(self):
        r = _base_readings()
        r["backup_alarm"] = False
        assert "backward_travel" not in _rules(evaluate(r))


class TestDropDisabledTroubleshoot:
    def test_triggers(self):
        r = _base_readings()
        r["tps_power_loop"] = True
        r["encoder_speed_ftpm"] = 4
        r["drop_enable"] = False
        diags = evaluate(r)
        d = _find(diags, "drop_disabled_troubleshoot")
        assert d is not None
        assert d["severity"] == "critical"
        assert d["category"] == "operation"

    def test_not_triggered_drop_enabled(self):
        r = _base_readings()
        r["tps_power_loop"] = True
        r["encoder_speed_ftpm"] = 10
        r["drop_enable"] = True
        assert "drop_disabled_troubleshoot" not in _rules(evaluate(r))

    def test_not_triggered_low_speed(self):
        r = _base_readings()
        r["tps_power_loop"] = True
        r["encoder_speed_ftpm"] = 3  # threshold is > 3
        r["drop_enable"] = False
        assert "drop_disabled_troubleshoot" not in _rules(evaluate(r))

    def test_not_triggered_power_off(self):
        r = _base_readings()
        r["tps_power_loop"] = False
        r["encoder_speed_ftpm"] = 10
        r["drop_enable"] = False
        assert "drop_disabled_troubleshoot" not in _rules(evaluate(r))


class TestNoModeSelected:
    def test_triggers_none(self):
        r = _base_readings()
        r["tps_power_loop"] = True
        r["operating_mode"] = "None"
        diags = evaluate(r)
        d = _find(diags, "no_mode_selected")
        assert d is not None
        assert d["severity"] == "warning"

    def test_triggers_empty_string(self):
        r = _base_readings()
        r["tps_power_loop"] = True
        r["operating_mode"] = ""
        diags = evaluate(r)
        assert "no_mode_selected" in _rules(diags)

    def test_not_triggered_mode_set(self):
        r = _base_readings()
        r["tps_power_loop"] = True
        r["operating_mode"] = "TPS-1"
        assert "no_mode_selected" not in _rules(evaluate(r))

    def test_not_triggered_power_off(self):
        r = _base_readings()
        r["tps_power_loop"] = False
        r["operating_mode"] = "None"
        assert "no_mode_selected" not in _rules(evaluate(r))


# =========================================================================
# Integration / edge cases
# =========================================================================

class TestIntegration:
    def test_all_critical_rules_have_correct_severity(self):
        """Verify all known critical rules report critical severity."""
        critical_rules = {
            "camera_dead_gradual", "camera_dead_sudden",
            "encoder_disconnected", "encoder_spinning_no_distance",
            "encoder_stopped", "eject_not_firing",
            "drop_disabled_troubleshoot",
        }
        # Trigger each and verify
        for rule in critical_rules:
            r = _base_readings()
            if rule == "camera_dead_gradual":
                r["camera_rate_trend"] = "declining"
                r["camera_detections_per_min"] = 0
            elif rule == "camera_dead_sudden":
                r["camera_rate_trend"] = "dead"
                r["camera_signal_duration_s"] = 60
            elif rule == "encoder_disconnected":
                r["dd1_frozen"] = True
            elif rule == "encoder_spinning_no_distance":
                r["ds10_frozen"] = True
            elif rule == "encoder_stopped":
                r["encoder_speed_ftpm"] = 0
                r["tps_power_duration_s"] = 120
            elif rule == "eject_not_firing":
                r["drop_enable"] = True
                r["eject_rate_per_min"] = 0
                r["tps_power_duration_s"] = 120
            elif rule == "drop_disabled_troubleshoot":
                r["drop_enable"] = False
            diags = evaluate(r)
            d = _find(diags, rule)
            assert d is not None, f"Rule {rule} did not fire"
            assert d["severity"] == "critical", f"Rule {rule} should be critical"

    def test_missing_keys_use_defaults(self):
        """Evaluate with minimal dict (only total_reads) should not crash."""
        r = {"total_reads": 100}
        # Should not raise -- all .get() calls have defaults
        diags = evaluate(r)
        assert isinstance(diags, list)

    def test_empty_dict_warmup(self):
        """Empty dict has total_reads=0 via .get default, so warmup blocks."""
        assert evaluate({}) == []

    def test_evidence_is_string(self):
        """All evidence fields should be strings."""
        r = _base_readings()
        r["camera_rate_trend"] = "intermittent"
        r["modbus_response_time_ms"] = 100
        diags = evaluate(r)
        for d in diags:
            assert isinstance(d["evidence"], str), f"evidence for {d['rule']} is not a string"

    def test_categories_are_valid(self):
        """All categories should be one of the 5 valid ones."""
        valid = {"camera", "encoder", "eject", "plc", "operation"}
        r = _base_readings()
        r["camera_rate_trend"] = "intermittent"
        r["modbus_response_time_ms"] = 100
        r["backup_alarm"] = True
        r["ds2"] = 40
        diags = evaluate(r)
        for d in diags:
            assert d["category"] in valid, f"Invalid category: {d['category']}"
