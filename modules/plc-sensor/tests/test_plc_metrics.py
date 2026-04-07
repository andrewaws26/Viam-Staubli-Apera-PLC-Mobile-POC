"""
Tests for plc_metrics.py — Signal monitoring for TPS diagnostics.

Tests the SignalMetrics rolling window and ConnectionQualityMonitor
state machine. These feed into the diagnostic engine that detects
camera failures, encoder noise, and cable degradation.

Run: python3 -m pytest modules/plc-sensor/tests/test_plc_metrics.py -v
"""

import os
import sys
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from plc_metrics import ConnectionQualityMonitor, SignalMetrics


class TestSignalMetrics:
    """Tests for the rolling window signal analysis."""

    def test_initial_state(self):
        """Fresh metrics should return zeros."""
        sm = SignalMetrics()
        result = sm.update(
            x3=False, y1=False, c30=False,
            encoder_dir=0, modbus_ms=10.0, now=1000.0
        )
        assert result["camera_detections_per_min"] == 0
        assert result["eject_rate_per_min"] == 0
        assert result["encoder_noise"] == 0
        assert result["camera_rate_trend"] == "stable"

    def test_rising_edge_detection(self):
        """Detect camera (X3) rising edges."""
        sm = SignalMetrics()
        base_time = 1000.0

        # First call: x3=False → no edge
        sm.update(x3=False, y1=False, c30=False,
                  encoder_dir=0, modbus_ms=10.0, now=base_time)

        # Second call: x3=True → rising edge detected
        sm.update(x3=True, y1=False, c30=False,
                  encoder_dir=0, modbus_ms=10.0, now=base_time + 1)

        # Third call: x3=True → no new edge (still high)
        result = sm.update(x3=True, y1=False, c30=False,
                           encoder_dir=0, modbus_ms=10.0, now=base_time + 2)

        assert result["camera_detections_per_min"] == 1

    def test_multiple_edges_in_window(self):
        """Count multiple camera detections within the 60s window."""
        sm = SignalMetrics()
        base = 1000.0

        for i in range(10):
            # Toggle x3: False → True → False → True...
            # Each False→True is a rising edge
            sm.update(x3=False, y1=False, c30=False,
                      encoder_dir=0, modbus_ms=10.0, now=base + i * 2)
            sm.update(x3=True, y1=False, c30=False,
                      encoder_dir=0, modbus_ms=10.0, now=base + i * 2 + 1)

        result = sm.update(x3=False, y1=False, c30=False,
                           encoder_dir=0, modbus_ms=10.0, now=base + 21)
        assert result["camera_detections_per_min"] == 10

    def test_edges_expire_after_window(self):
        """Edges older than 60s should not be counted."""
        sm = SignalMetrics()
        base = 1000.0

        # Create edge at t=1000
        sm.update(x3=False, y1=False, c30=False,
                  encoder_dir=0, modbus_ms=10.0, now=base)
        sm.update(x3=True, y1=False, c30=False,
                  encoder_dir=0, modbus_ms=10.0, now=base + 1)

        # Query at t=1062 (edge is 61s old, outside 60s window)
        result = sm.update(x3=False, y1=False, c30=False,
                           encoder_dir=0, modbus_ms=10.0, now=base + 62)
        assert result["camera_detections_per_min"] == 0

    def test_eject_edge_counting(self):
        """Y1 edges count as eject events."""
        sm = SignalMetrics()
        base = 1000.0

        sm.update(x3=False, y1=False, c30=False,
                  encoder_dir=0, modbus_ms=10.0, now=base)
        sm.update(x3=False, y1=True, c30=False,
                  encoder_dir=0, modbus_ms=10.0, now=base + 1)
        result = sm.update(x3=False, y1=False, c30=False,
                           encoder_dir=0, modbus_ms=10.0, now=base + 2)

        assert result["eject_rate_per_min"] == 1

    def test_encoder_reversal_counting(self):
        """Encoder direction changes count as reversals."""
        sm = SignalMetrics()
        base = 1000.0

        sm.update(x3=False, y1=False, c30=False,
                  encoder_dir=1, modbus_ms=10.0, now=base)
        sm.update(x3=False, y1=False, c30=False,
                  encoder_dir=-1, modbus_ms=10.0, now=base + 1)  # reversal
        result = sm.update(x3=False, y1=False, c30=False,
                           encoder_dir=1, modbus_ms=10.0, now=base + 2)  # reversal

        assert result["encoder_reversals_per_min"] == 2
        assert result["encoder_noise"] == 2

    def test_encoder_reversal_from_forward_zero(self):
        """Fix 9: Forward direction (0) to reverse must also count as reversal."""
        sm = SignalMetrics()
        base = 1000.0

        # First call establishes direction as 0 (forward)
        sm.update(x3=False, y1=False, c30=False,
                  encoder_dir=0, modbus_ms=10.0, now=base)
        # Change to 1 (reverse) — this should count as a reversal
        sm.update(x3=False, y1=False, c30=False,
                  encoder_dir=1, modbus_ms=10.0, now=base + 1)
        # Change back to 0 (forward) — another reversal
        result = sm.update(x3=False, y1=False, c30=False,
                           encoder_dir=0, modbus_ms=10.0, now=base + 2)

        assert result["encoder_reversals_per_min"] == 2
        assert result["encoder_noise"] == 2

    def test_modbus_response_time_average(self):
        """Modbus response time is averaged over recent calls."""
        sm = SignalMetrics()
        base = 1000.0

        for i in range(5):
            sm.update(x3=False, y1=False, c30=False,
                      encoder_dir=0, modbus_ms=10.0 + i * 2,
                      now=base + i)

        result = sm.update(x3=False, y1=False, c30=False,
                           encoder_dir=0, modbus_ms=20.0, now=base + 5)
        # Average of [10, 12, 14, 16, 18, 20] = 15.0
        assert result["modbus_response_time_ms"] == 15.0

    def test_track_power_returns_duration(self):
        """track_power returns seconds in current power state."""
        sm = SignalMetrics()
        dur = sm.track_power(True, now=1000.0)
        assert dur == 0.0  # Just started

        dur = sm.track_power(True, now=1060.0)
        assert dur == 60.0  # 60s in same state

    def test_track_power_resets_on_change(self):
        """Power state change resets duration."""
        sm = SignalMetrics()
        sm.track_power(True, now=1000.0)
        sm.track_power(True, now=1060.0)
        dur = sm.track_power(False, now=1061.0)  # state change
        assert dur == 0.0

    def test_camera_trend_dead(self):
        """Camera trend is 'dead' when rate is 0 for >30 consecutive readings.

        The _classify_camera_trend method checks the rate history within
        TREND_SEC (300s). We need: (1) 10+ data points in the window for
        the function to classify at all, and (2) 30+ consecutive zero-rate
        entries at the end to detect 'dead'.
        """
        sm = SignalMetrics()
        base = 1000.0

        # Feed 50 readings at 1/sec (all within 300s window, all zero rate)
        for i in range(50):
            sm.update(x3=False, y1=False, c30=False,
                      encoder_dir=0, modbus_ms=10.0,
                      now=base + i)

        result = sm.update(x3=False, y1=False, c30=False,
                           encoder_dir=0, modbus_ms=10.0, now=base + 50)
        assert result["camera_rate_trend"] == "dead"

    def test_camera_trend_stable_with_activity(self):
        """Camera trend is 'stable' when rate is consistent."""
        sm = SignalMetrics()
        base = 1000.0

        # Generate consistent camera activity
        for i in range(20):
            sm.update(x3=False, y1=False, c30=False,
                      encoder_dir=0, modbus_ms=10.0, now=base + i * 2)
            sm.update(x3=True, y1=False, c30=False,
                      encoder_dir=0, modbus_ms=10.0, now=base + i * 2 + 1)

        result = sm.update(x3=False, y1=False, c30=False,
                           encoder_dir=0, modbus_ms=10.0, now=base + 41)
        assert result["camera_rate_trend"] == "stable"


class TestConnectionQualityMonitor:
    """Tests for Ethernet link quality classification.

    These mock /sys/class/net/ reads and ethtool subprocess calls.
    """

    def test_initial_state(self):
        cqm = ConnectionQualityMonitor("eth0")
        assert cqm.status == "unknown"
        assert cqm.error_rate == 0.0

    @patch.object(ConnectionQualityMonitor, "_read_carrier", return_value=True)
    @patch.object(ConnectionQualityMonitor, "_read_ethtool_stats", return_value={})
    @patch.object(ConnectionQualityMonitor, "_read_link_speed", return_value="100Mbps")
    def test_healthy_link(self, mock_speed, mock_stats, mock_carrier):
        """Healthy link: carrier up, no errors."""
        cqm = ConnectionQualityMonitor("eth0")
        result = cqm.check()
        assert result["eth0_status"] == "healthy"
        assert "no errors" in result["eth0_diagnosis"].lower()

    @patch.object(ConnectionQualityMonitor, "_read_carrier", return_value=False)
    def test_link_down(self, mock_carrier):
        """Link down: no carrier detected."""
        cqm = ConnectionQualityMonitor("eth0")
        result = cqm.check()
        assert result["eth0_status"] == "down"
        assert "no carrier" in result["eth0_diagnosis"].lower() or "disconnected" in result["eth0_diagnosis"].lower()

    def test_current_state_keys(self):
        """Verify all expected keys are in the output dict."""
        cqm = ConnectionQualityMonitor("eth0")
        state = cqm._current_state()
        expected_keys = [
            "eth0_status", "eth0_diagnosis", "eth0_error_rate",
            "eth0_link_speed_mbps", "eth0_link_uptime_seconds",
            "eth0_crc_errors", "eth0_link_flaps",
        ]
        for key in expected_keys:
            assert key in state, f"Missing key: {key}"
