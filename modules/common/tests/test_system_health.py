"""
Tests for system_health.py — system metrics collection.

Tests the get_system_health() function that collects CPU, memory, disk,
WiFi, Tailscale, and sync status. This runs on both Pi 5 and Pi Zero,
so all system calls must be mocked since tests run on dev machines.

Every code path must handle exceptions gracefully (return None, not crash)
since this runs inside the sensor read loop.

Run: python3 -m pytest modules/common/tests/test_system_health.py -v
"""

import os
import sys
from unittest.mock import mock_open, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from system_health import get_system_health


class TestGetSystemHealth:
    """Tests for the system health collector."""

    @patch("os.statvfs")
    @patch("subprocess.run")
    @patch("builtins.open", mock_open(read_data=""))
    def test_returns_dict(self, mock_run, mock_statvfs):
        """Should always return a dict, never raise."""
        mock_run.side_effect = Exception("not on a Pi")
        mock_statvfs.side_effect = Exception("not on a Pi")
        result = get_system_health()
        assert isinstance(result, dict)

    @patch("builtins.open", mock_open(read_data="50000\n"))
    def test_cpu_temp_parsing(self):
        """CPU temp from /sys/class/thermal/thermal_zone0/temp (millidegrees)."""
        with patch("subprocess.run", side_effect=Exception("no")):
            with patch("os.statvfs", side_effect=Exception("no")):
                result = get_system_health()
        assert result["cpu_temp_c"] == 50.0

    @patch("builtins.open")
    def test_memory_parsing(self, mock_file):
        """Parse /proc/meminfo for memory stats."""
        meminfo = (
            "MemTotal:        1024000 kB\n"
            "MemFree:          200000 kB\n"
            "MemAvailable:     512000 kB\n"
        )
        # Return different content depending on which file is opened
        def open_side_effect(path, *args, **kwargs):
            if "thermal" in str(path):
                return mock_open(read_data="45000\n")()
            if "meminfo" in str(path):
                return mock_open(read_data=meminfo)()
            if "loadavg" in str(path):
                return mock_open(read_data="0.5 0.3 0.2 1/200 1234\n")()
            if "uptime" in str(path):
                return mock_open(read_data="3600.0 7200.0\n")()
            return mock_open(read_data="")()

        mock_file.side_effect = open_side_effect

        with patch("subprocess.run", side_effect=Exception("no")):
            with patch("os.statvfs", side_effect=Exception("no")):
                result = get_system_health()

        assert result["memory_total_mb"] == round(1024000 / 1024, 0)
        used_kb = 1024000 - 512000
        assert result["memory_used_mb"] == round(used_kb / 1024, 0)

    def test_all_failures_return_none_not_crash(self):
        """When everything fails (not on Pi), values should be None, not crash."""
        with patch("builtins.open", side_effect=Exception("no Pi")):
            with patch("subprocess.run", side_effect=Exception("no Pi")):
                with patch("os.statvfs", side_effect=Exception("no Pi")):
                    with patch("os.cpu_count", return_value=4):
                        result = get_system_health()

        # These should all be None when sys calls fail
        assert result["cpu_temp_c"] is None
        assert result["memory_total_mb"] is None
        assert result["disk_used_pct"] is None
        assert result["wifi_ssid"] is None
        assert result["tailscale_ip"] is None
        assert result["internet"] is False  # Default False, not None

    def test_expected_keys_present(self):
        """Verify all expected keys exist in output."""
        with patch("builtins.open", side_effect=Exception("no")):
            with patch("subprocess.run", side_effect=Exception("no")):
                with patch("os.statvfs", side_effect=Exception("no")):
                    with patch("os.cpu_count", return_value=4):
                        result = get_system_health()

        expected = [
            "cpu_temp_c", "cpu_usage_pct", "load_1m", "load_5m",
            "memory_total_mb", "memory_used_mb", "memory_used_pct",
            "disk_used_pct", "disk_free_gb",
            "wifi_ssid",
            "tailscale_ip", "tailscale_online",
            "internet",
            "uptime_seconds",
        ]
        for key in expected:
            assert key in result, f"Missing key: {key}"
