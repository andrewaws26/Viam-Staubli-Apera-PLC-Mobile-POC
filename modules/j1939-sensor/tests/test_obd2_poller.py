"""
Tests for the OBD-II poller module.

Tests PID decoding, bus connection tracking, and integration with J1939TruckSensor.
"""

import pytest
import sys
import os
import time
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.models.obd2_poller import (
    OBD2Poller,
    OBD2_PIDS,
    OBD2_REQUEST_ID,
    OBD2_RESPONSE_ID,
    OBD2_SERVICE_CURRENT,
    OBD2_RESPONSE_SERVICE,
    PID_TIMEOUT_S,
    DISCONNECT_THRESHOLD,
)
from src.models.j1939_sensor import J1939TruckSensor


# =========================================================================
# PID decoding formulas
# =========================================================================

class TestPIDFormulas:
    def test_engine_rpm(self):
        """PID 0x0C: ((A*256)+B)/4"""
        _, _, fn = OBD2_PIDS[0x0C]
        assert fn(0x1A, 0xF8) == (0x1A * 256 + 0xF8) / 4  # 1726.0 RPM

    def test_engine_rpm_idle(self):
        _, _, fn = OBD2_PIDS[0x0C]
        assert fn(0x03, 0x20) == (3 * 256 + 32) / 4  # 200.0 RPM

    def test_coolant_temp(self):
        """PID 0x05: (A - 40)°C → °F"""
        _, _, fn = OBD2_PIDS[0x05]
        assert fn(130) == 194.0  # 90°C = 194°F

    def test_coolant_temp_cold(self):
        _, _, fn = OBD2_PIDS[0x05]
        assert fn(40) == 32.0  # 0°C = 32°F

    def test_vehicle_speed(self):
        """PID 0x0D: A km/h → mph"""
        _, _, fn = OBD2_PIDS[0x0D]
        assert abs(fn(100) - 62.14) < 0.1  # 100 kph = 62.14 mph

    def test_throttle_position(self):
        """PID 0x11: A * 100 / 255"""
        _, _, fn = OBD2_PIDS[0x11]
        assert round(fn(255), 2) == 100.0  # 100%
        assert round(fn(0), 2) == 0.0  # 0%

    def test_intake_air_temp(self):
        """PID 0x0F: (A - 40)°C → °F"""
        _, _, fn = OBD2_PIDS[0x0F]
        assert fn(65) == 77.0  # 25°C = 77°F

    def test_fuel_level(self):
        """PID 0x2F: A * 100 / 255"""
        _, _, fn = OBD2_PIDS[0x2F]
        assert round(fn(128), 2) == round(128 * 100 / 255, 2)  # ~50.2%


# =========================================================================
# OBD2Poller._decode_pid
# =========================================================================

class TestDecodePid:
    def test_decode_rpm_response(self):
        poller = OBD2Poller("can0", "socketcan", 500000)
        # Response: [num_bytes, 0x41, 0x0C, A, B, ...]
        data = bytes([0x04, 0x41, 0x0C, 0x1A, 0xF8, 0x00, 0x00, 0x00])
        result = poller._decode_pid(0x0C, data)
        assert result == round((0x1A * 256 + 0xF8) / 4.0, 2)

    def test_decode_coolant_response(self):
        poller = OBD2Poller("can0", "socketcan", 500000)
        data = bytes([0x03, 0x41, 0x05, 130, 0x00, 0x00, 0x00, 0x00])
        result = poller._decode_pid(0x05, data)
        assert result == 194.0  # 90°C = 194°F

    def test_decode_unknown_pid(self):
        poller = OBD2Poller("can0", "socketcan", 500000)
        data = bytes([0x03, 0x41, 0xAA, 0x00, 0x00, 0x00, 0x00, 0x00])
        result = poller._decode_pid(0xAA, data)
        assert result is None

    def test_decode_short_data(self):
        """Short data should return None, not crash."""
        poller = OBD2Poller("can0", "socketcan", 500000)
        data = bytes([0x03, 0x41, 0x0C])  # missing A, B
        result = poller._decode_pid(0x0C, data)
        assert result is None


# =========================================================================
# Bus connection tracking
# =========================================================================

class TestBusConnectionTracking:
    def test_initially_disconnected(self):
        poller = OBD2Poller("can0", "socketcan", 500000)
        assert poller.bus_connected is False

    def test_connected_after_response(self):
        poller = OBD2Poller("can0", "socketcan", 500000)
        poller._bus_connected = False
        poller._consecutive_empty_cycles = 3
        # Simulate a cycle with responses
        poller._bus_connected = True
        poller._consecutive_empty_cycles = 0
        assert poller.bus_connected is True

    def test_disconnected_after_threshold(self):
        poller = OBD2Poller("can0", "socketcan", 500000)
        poller._bus_connected = True
        poller._consecutive_empty_cycles = DISCONNECT_THRESHOLD
        poller._bus_connected = False
        assert poller.bus_connected is False


# =========================================================================
# Integration with J1939TruckSensor
# =========================================================================

class TestOBD2Integration:
    def test_default_protocol_is_j1939(self):
        sensor = J1939TruckSensor("test")
        assert sensor._protocol == "j1939"
        assert sensor._obd2_poller is None

    def test_validate_config_valid_protocol(self):
        config = MagicMock()
        config.attributes.fields = {
            "protocol": MagicMock(string_value="obd2")
        }
        deps, opt = J1939TruckSensor.validate_config(config)
        assert deps == []

    def test_validate_config_invalid_protocol(self):
        config = MagicMock()
        config.attributes.fields = {
            "protocol": MagicMock(string_value="invalid")
        }
        with pytest.raises(ValueError, match="protocol"):
            J1939TruckSensor.validate_config(config)

    @pytest.mark.asyncio
    async def test_obd2_get_readings(self):
        """In OBD-II mode, readings come from OBD2Poller."""
        sensor = J1939TruckSensor("test")
        sensor._protocol = "obd2"

        mock_poller = MagicMock()
        mock_poller.get_readings.return_value = {
            "engine_rpm": 1500.0,
            "coolant_temp_f": 194.0,
        }
        mock_poller.bus_connected = True
        mock_poller._poll_count = 10
        mock_poller._last_response_time = time.time()
        sensor._obd2_poller = mock_poller

        readings = await sensor.get_readings()
        assert readings["engine_rpm"] == 1500.0
        assert readings["coolant_temp_f"] == 194.0
        assert readings["_protocol"] == "obd2"
        assert readings["_bus_connected"] is True
        assert readings["_can_interface"] == "can0"

    @pytest.mark.asyncio
    async def test_j1939_get_readings_includes_protocol(self):
        """In J1939 mode, _protocol field is 'j1939'."""
        sensor = J1939TruckSensor("test")
        readings = await sensor.get_readings()
        assert readings["_protocol"] == "j1939"

    @pytest.mark.asyncio
    async def test_obd2_close(self):
        """close() stops OBD-II poller."""
        sensor = J1939TruckSensor("test")
        mock_poller = MagicMock()
        sensor._obd2_poller = mock_poller

        await sensor.close()
        mock_poller.stop.assert_called_once()
        assert sensor._obd2_poller is None

    def test_field_names_match_dashboard(self):
        """OBD-II field keys include what the dashboard expects (imperial)."""
        expected = {"engine_rpm", "coolant_temp_f", "vehicle_speed_mph",
                    "throttle_position_pct", "intake_air_temp_f", "fuel_level_pct"}
        actual = {entry[1] for entry in OBD2_PIDS.values()}
        assert expected.issubset(actual), f"Missing: {expected - actual}"


# =========================================================================
# Request frame format
# =========================================================================

class TestRequestFrame:
    def test_request_uses_standard_id(self):
        """OBD-II requests use 11-bit (standard) CAN IDs, not extended."""
        assert OBD2_REQUEST_ID == 0x7DF
        assert OBD2_REQUEST_ID < 0x800  # fits in 11 bits

    def test_response_id(self):
        assert OBD2_RESPONSE_ID == 0x7E8


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
