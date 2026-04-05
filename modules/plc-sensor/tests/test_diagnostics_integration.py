"""Integration tests for the TPS Diagnostic Rules Engine.

Tests full diagnostic scenarios with realistic reading dictionaries,
verifying that combinations of faults fire the correct rules and
that healthy states produce no diagnostics.

Uses the base_healthy_readings fixture from conftest.py.
"""

import sys
import os

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
from diagnostics import evaluate


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
# Healthy system
# =========================================================================

class TestHealthySystem:
    """Verify that a fully healthy system produces zero diagnostics."""

    def test_healthy_produces_no_diagnostics(self, base_healthy_readings):
        diags = evaluate(base_healthy_readings)
        assert diags == []

    def test_healthy_with_high_plate_count(self, base_healthy_readings):
        """System running well with high production -- no alerts."""
        r = base_healthy_readings
        r["ds7"] = 5000           # 5000 plates laid
        r["ds8"] = 15             # 15 plates/min
        r["eject_rate_per_min"] = 8
        r["camera_detections_per_min"] = 9
        r["total_reads"] = 10000
        assert evaluate(r) == []

    def test_healthy_different_mode(self, base_healthy_readings):
        """Different operating mode is still healthy."""
        r = base_healthy_readings
        r["operating_mode"] = "TPS-2"
        assert evaluate(r) == []


# =========================================================================
# Camera dead scenario
# =========================================================================

class TestCameraDeadScenario:

    def test_camera_dead_sudden_triggers(self, base_healthy_readings):
        """Camera signal drops to dead with power on -> camera_dead_sudden."""
        r = base_healthy_readings
        r["camera_rate_trend"] = "dead"
        r["camera_signal_duration_s"] = 60
        r["camera_detections_per_min"] = 0
        diags = evaluate(r)
        rules = _rules(diags)
        assert "camera_dead_sudden" in rules

    def test_camera_dead_gradual_triggers(self, base_healthy_readings):
        """Declining camera rate near zero -> camera_dead_gradual."""
        r = base_healthy_readings
        r["camera_rate_trend"] = "declining"
        r["camera_detections_per_min"] = 1
        diags = evaluate(r)
        rules = _rules(diags)
        assert "camera_dead_gradual" in rules

    def test_camera_dead_gradual_is_critical(self, base_healthy_readings):
        r = base_healthy_readings
        r["camera_rate_trend"] = "declining"
        r["camera_detections_per_min"] = 0
        diags = evaluate(r)
        d = _find(diags, "camera_dead_gradual")
        assert d is not None
        assert d["severity"] == "critical"
        assert d["category"] == "camera"

    def test_camera_dead_does_not_fire_without_power(self, base_healthy_readings):
        """Camera dead sudden requires TPS power on."""
        r = base_healthy_readings
        r["camera_rate_trend"] = "dead"
        r["camera_signal_duration_s"] = 120
        r["tps_power_loop"] = False
        diags = evaluate(r)
        assert "camera_dead_sudden" not in _rules(diags)


# =========================================================================
# Encoder stopped scenario
# =========================================================================

class TestEncoderStoppedScenario:

    def test_encoder_stopped_triggers(self, base_healthy_readings):
        """Encoder alive (dd1 not frozen) but speed=0 for > 60s -> encoder_stopped."""
        r = base_healthy_readings
        r["encoder_speed_ftpm"] = 0
        r["dd1_frozen"] = False
        r["tps_power_loop"] = True
        r["tps_power_duration_s"] = 120
        diags = evaluate(r)
        d = _find(diags, "encoder_stopped")
        assert d is not None
        assert d["severity"] == "critical"
        assert d["category"] == "encoder"

    def test_encoder_stopped_not_triggered_if_moving(self, base_healthy_readings):
        r = base_healthy_readings
        r["encoder_speed_ftpm"] = 1  # even slow movement
        r["dd1_frozen"] = False
        r["tps_power_loop"] = True
        r["tps_power_duration_s"] = 120
        assert "encoder_stopped" not in _rules(evaluate(r))

    def test_encoder_disconnected_vs_stopped(self, base_healthy_readings):
        """dd1_frozen=True fires encoder_disconnected, NOT encoder_stopped."""
        r = base_healthy_readings
        r["encoder_speed_ftpm"] = 0
        r["dd1_frozen"] = True
        r["tps_power_loop"] = True
        r["tps_power_duration_s"] = 120
        diags = evaluate(r)
        rules = _rules(diags)
        assert "encoder_disconnected" in rules
        assert "encoder_stopped" not in rules


# =========================================================================
# Multiple simultaneous faults
# =========================================================================

class TestMultipleFaults:

    def test_camera_and_encoder_faults_together(self, base_healthy_readings):
        """Camera intermittent + encoder disconnected fires both rules."""
        r = base_healthy_readings
        r["camera_rate_trend"] = "intermittent"
        r["dd1_frozen"] = True
        diags = evaluate(r)
        rules = _rules(diags)
        assert "camera_intermittent" in rules
        assert "encoder_disconnected" in rules

    def test_plc_slow_and_backward_travel(self, base_healthy_readings):
        """PLC communication issue + backward travel fires both."""
        r = base_healthy_readings
        r["modbus_response_time_ms"] = 100
        r["backup_alarm"] = True
        diags = evaluate(r)
        rules = _rules(diags)
        assert "plc_slow" in rules
        assert "backward_travel" in rules

    def test_three_categories_fire(self, base_healthy_readings):
        """Faults from camera, encoder, and PLC categories simultaneously."""
        r = base_healthy_readings
        r["camera_rate_trend"] = "intermittent"    # camera
        r["dd1_frozen"] = True                      # encoder
        r["modbus_response_time_ms"] = 80           # plc
        diags = evaluate(r)
        rules = _rules(diags)
        assert "camera_intermittent" in rules
        assert "encoder_disconnected" in rules
        assert "plc_slow" in rules

    def test_severity_ordering_in_multi_fault(self, base_healthy_readings):
        """Critical rules appear before warnings in output."""
        r = base_healthy_readings
        r["dd1_frozen"] = True                      # critical
        r["camera_rate_trend"] = "intermittent"     # warning
        r["ds2"] = 40                               # info
        diags = evaluate(r)
        severities = [d["severity"] for d in diags]
        order = {"critical": 0, "warning": 1, "info": 2}
        assert severities == sorted(severities, key=lambda s: order[s])

    def test_eject_and_camera_fault(self, base_healthy_readings):
        """Eject not firing + camera dead gradual."""
        r = base_healthy_readings
        r["camera_rate_trend"] = "declining"
        r["camera_detections_per_min"] = 0
        r["drop_enable"] = True
        r["eject_rate_per_min"] = 0
        r["tps_power_duration_s"] = 120
        diags = evaluate(r)
        rules = _rules(diags)
        assert "camera_dead_gradual" in rules
        assert "eject_not_firing" in rules

    def test_all_critical_faults_at_once(self, base_healthy_readings):
        """Trigger as many critical rules as possible simultaneously."""
        r = base_healthy_readings
        r["camera_rate_trend"] = "declining"
        r["camera_detections_per_min"] = 0
        # encoder_disconnected
        r["dd1_frozen"] = True
        # drop_disabled_troubleshoot
        r["drop_enable"] = False
        r["encoder_speed_ftpm"] = 10
        diags = evaluate(r)
        rules = _rules(diags)
        assert "camera_dead_gradual" in rules
        assert "encoder_disconnected" in rules
        assert "drop_disabled_troubleshoot" in rules
        # All should be critical
        for d in diags:
            if d["rule"] in ("camera_dead_gradual", "encoder_disconnected",
                            "drop_disabled_troubleshoot"):
                assert d["severity"] == "critical"


# =========================================================================
# Warmup period
# =========================================================================

class TestWarmupPeriod:

    def test_no_rules_fire_during_warmup(self, base_healthy_readings):
        """No diagnostics during first 60 readings regardless of state."""
        r = base_healthy_readings
        r["total_reads"] = 59
        # Set fault conditions that would normally trigger
        r["dd1_frozen"] = True
        r["camera_rate_trend"] = "dead"
        r["camera_signal_duration_s"] = 120
        diags = evaluate(r)
        assert diags == []

    def test_rules_fire_after_warmup(self, base_healthy_readings):
        """Same faults fire once warmup completes (total_reads >= 60)."""
        r = base_healthy_readings
        r["total_reads"] = 60
        r["dd1_frozen"] = True
        diags = evaluate(r)
        assert len(diags) > 0
        assert "encoder_disconnected" in _rules(diags)

    def test_warmup_at_zero(self, base_healthy_readings):
        """Zero reads means warmup -- no diagnostics."""
        r = base_healthy_readings
        r["total_reads"] = 0
        r["dd1_frozen"] = True
        assert evaluate(r) == []

    def test_warmup_with_missing_total_reads(self):
        """Missing total_reads defaults to 0 -> warmup blocks."""
        r = {"dd1_frozen": True, "tps_power_loop": True}
        assert evaluate(r) == []


# =========================================================================
# Realistic production scenarios
# =========================================================================

class TestProductionScenarios:

    def test_truck_starting_up(self, base_healthy_readings):
        """Truck just turned on, TPS warming up -- nothing should fire yet."""
        r = base_healthy_readings
        r["total_reads"] = 30  # < 60 warmup
        r["tps_power_duration_s"] = 30
        r["encoder_speed_ftpm"] = 0
        r["camera_detections_per_min"] = 0
        assert evaluate(r) == []

    def test_truck_running_normal_with_spacing_alert(self, base_healthy_readings):
        """Normal operation but non-standard tie spacing -> info only."""
        r = base_healthy_readings
        r["ds2"] = 36  # 18" spacing instead of 19.5"
        diags = evaluate(r)
        assert len(diags) == 1
        d = diags[0]
        assert d["rule"] == "spacing_wrong"
        assert d["severity"] == "info"

    def test_power_off_idle(self, base_healthy_readings):
        """TPS off, truck idle -- no encoder/camera faults should fire."""
        r = base_healthy_readings
        r["tps_power_loop"] = False
        r["tps_power_duration_s"] = 600
        r["encoder_speed_ftpm"] = 0
        r["camera_detections_per_min"] = 0
        r["eject_rate_per_min"] = 0
        r["dd1_frozen"] = False
        diags = evaluate(r)
        # Should be quiet -- power is off so most rules skip
        for d in diags:
            # None of the power-dependent rules should fire
            assert d["rule"] not in (
                "encoder_disconnected", "encoder_stopped",
                "camera_dead_sudden", "eject_not_firing",
                "drop_disabled_troubleshoot", "no_mode_selected",
            )

    def test_high_error_rate_scenario(self, base_healthy_readings):
        """Degraded Ethernet connection causing Modbus errors."""
        r = base_healthy_readings
        r["total_reads"] = 5000
        r["total_errors"] = 100  # 2% error rate
        r["modbus_response_time_ms"] = 75
        diags = evaluate(r)
        rules = _rules(diags)
        assert "plc_errors" in rules
        assert "plc_slow" in rules


# =========================================================================
# Diagnostic output structure
# =========================================================================

class TestDiagnosticStructure:

    def test_all_fields_present(self, base_healthy_readings):
        """Every diagnostic has all required fields."""
        required = {"rule", "severity", "category", "title", "action", "evidence"}
        r = base_healthy_readings
        r["camera_rate_trend"] = "intermittent"
        r["modbus_response_time_ms"] = 60
        r["backup_alarm"] = True
        diags = evaluate(r)
        assert len(diags) >= 3
        for d in diags:
            assert required <= set(d.keys()), f"Missing keys in {d['rule']}"

    def test_evidence_contains_values(self, base_healthy_readings):
        """Evidence field references actual sensor values."""
        r = base_healthy_readings
        r["dd1_frozen"] = True
        diags = evaluate(r)
        d = _find(diags, "encoder_disconnected")
        assert d is not None
        assert "DD1" in d["evidence"] or "frozen" in d["evidence"]

    def test_categories_are_valid(self, base_healthy_readings):
        """All categories are one of the 5 valid types."""
        valid = {"camera", "encoder", "eject", "plc", "operation"}
        r = base_healthy_readings
        r["camera_rate_trend"] = "intermittent"
        r["modbus_response_time_ms"] = 60
        r["backup_alarm"] = True
        r["ds2"] = 40
        diags = evaluate(r)
        for d in diags:
            assert d["category"] in valid


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
