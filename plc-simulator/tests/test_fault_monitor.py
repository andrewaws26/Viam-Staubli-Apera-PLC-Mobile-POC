"""Tests for the fault detection logic."""

import pytest

from src.fault_monitor import FaultMonitor
from src.modbus_server import (
    FAULT_NONE,
    FAULT_PRESSURE,
    FAULT_TEMPERATURE,
    FAULT_VIBRATION,
)


@pytest.fixture
def config():
    return {
        "thresholds": {
            "vibration_magnitude_max": 15.0,
            "temperature_max_f": 120.0,
            "pressure_min": 100,
        }
    }


@pytest.fixture
def monitor(config):
    return FaultMonitor(config)


def _normal_accel():
    """Acceleration at rest (gravity only) — well within threshold."""
    return {"accel_x": 0.1, "accel_y": -0.05, "accel_z": 9.81}


class TestFaultMonitor:
    def test_no_fault_when_all_normal(self, monitor):
        result = monitor.check(_normal_accel(), 72.0, 512, 0.0, 0.0)
        assert result == FAULT_NONE
        assert not monitor.is_faulted

    def test_vibration_fault_triggers(self, monitor):
        # Magnitude = sqrt(10^2 + 10^2 + 10^2) ≈ 17.3 > 15.0
        high_vibration = {"accel_x": 10.0, "accel_y": 10.0, "accel_z": 10.0}
        result = monitor.check(high_vibration, 72.0, 512, 0.0, 0.0)
        assert result == FAULT_VIBRATION
        assert monitor.is_faulted
        assert monitor.active_fault == FAULT_VIBRATION

    def test_vibration_just_below_threshold(self, monitor):
        # Magnitude = sqrt(0^2 + 0^2 + 14.9^2) = 14.9 < 15.0
        borderline = {"accel_x": 0.0, "accel_y": 0.0, "accel_z": 14.9}
        result = monitor.check(borderline, 72.0, 512, 0.0, 0.0)
        assert result == FAULT_NONE

    def test_temperature_fault_triggers(self, monitor):
        result = monitor.check(_normal_accel(), 125.0, 512, 0.0, 0.0)
        assert result == FAULT_TEMPERATURE
        assert monitor.active_fault == FAULT_TEMPERATURE

    def test_temperature_at_threshold(self, monitor):
        # At exactly the threshold — should not trigger (> not >=)
        result = monitor.check(_normal_accel(), 120.0, 512, 0.0, 0.0)
        assert result == FAULT_NONE

    def test_pressure_fault_triggers(self, monitor):
        result = monitor.check(_normal_accel(), 72.0, 50, 0.0, 0.0)
        assert result == FAULT_PRESSURE

    def test_pressure_at_threshold(self, monitor):
        # At exactly the threshold — should not trigger (< not <=)
        result = monitor.check(_normal_accel(), 72.0, 100, 0.0, 0.0)
        assert result == FAULT_NONE

    def test_vibration_has_priority_over_temperature(self, monitor):
        """When multiple faults exist, vibration is checked first."""
        high_vibration = {"accel_x": 10.0, "accel_y": 10.0, "accel_z": 10.0}
        result = monitor.check(high_vibration, 130.0, 50, 0.0, 0.0)
        assert result == FAULT_VIBRATION

    def test_fault_clears_when_values_return_to_normal(self, monitor):
        # Trigger a fault
        monitor.check(_normal_accel(), 130.0, 512, 0.0, 0.0)
        assert monitor.is_faulted

        # Values return to normal
        result = monitor.check(_normal_accel(), 72.0, 512, 0.0, 0.0)
        assert result == FAULT_NONE
        assert not monitor.is_faulted

    def test_manual_clear(self, monitor):
        monitor.check(_normal_accel(), 130.0, 512, 0.0, 0.0)
        assert monitor.is_faulted
        monitor.clear_fault()
        assert not monitor.is_faulted
        assert monitor.active_fault == FAULT_NONE
