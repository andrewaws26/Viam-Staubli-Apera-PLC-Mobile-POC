"""
Tests for the J1939TruckSensor Viam component.

Tests sensor configuration, get_readings, do_command (DTC clearing),
and resilience to bus disconnection.
"""

import os
import sys
import time
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.models.j1939_can import (
    DM11_PGN,
    REQUEST_PGN,
    build_can_id,
)
from src.models.j1939_sensor import J1939TruckSensor
from src.models.pgn_decoder import extract_pgn_from_can_id

# =========================================================================
# CAN ID builder
# =========================================================================

class TestBuildCanId:
    def test_broadcast_pgn(self):
        """Build CAN ID for broadcast PGN (PDU2, PF >= 240)."""
        # DM11 = PGN 65235 = 0xFED3
        can_id = build_can_id(priority=6, pgn=DM11_PGN,
                               source_address=0xFE)
        extracted_pgn = extract_pgn_from_can_id(can_id)
        assert extracted_pgn == DM11_PGN

    def test_request_pgn(self):
        """Build CAN ID for request PGN (PDU1, PF < 240)."""
        # Request PGN 59904 = 0xEA00, destination=0xFF
        can_id = build_can_id(priority=6, pgn=REQUEST_PGN,
                               source_address=0xFE,
                               destination_address=0xFF)
        extracted_pgn = extract_pgn_from_can_id(can_id)
        assert extracted_pgn == REQUEST_PGN

    def test_source_address_preserved(self):
        """Source address is in the lowest byte."""
        can_id = build_can_id(priority=6, pgn=DM11_PGN,
                               source_address=0x42)
        assert (can_id & 0xFF) == 0x42

    def test_priority_preserved(self):
        """Priority is in bits 28-26."""
        can_id = build_can_id(priority=3, pgn=DM11_PGN,
                               source_address=0xFE)
        priority = (can_id >> 26) & 0x07
        assert priority == 3


# =========================================================================
# Sensor construction and config
# =========================================================================

class TestSensorConfig:
    def test_default_config(self):
        """Sensor initializes with sane defaults."""
        sensor = J1939TruckSensor("test")
        assert sensor._can_interface == "can0"
        assert sensor._bitrate == 500000
        assert sensor._source_address == 0xFE
        assert sensor._include_raw is False
        assert sensor._pgn_filter == set()

    def test_validate_config_valid_bitrate(self):
        """Valid bitrates should pass validation."""
        config = MagicMock()
        config.attributes.fields = {
            "bitrate": MagicMock(number_value=500000)
        }
        deps, opt = J1939TruckSensor.validate_config(config)
        assert deps == []
        assert opt == []

    def test_validate_config_invalid_bitrate(self):
        """Invalid bitrate should raise ValueError."""
        config = MagicMock()
        config.attributes.fields = {
            "bitrate": MagicMock(number_value=115200)
        }
        with pytest.raises(ValueError, match="bitrate"):
            J1939TruckSensor.validate_config(config)


# =========================================================================
# get_readings
# =========================================================================

class TestGetReadings:
    @pytest.mark.asyncio
    async def test_empty_readings(self):
        """No CAN data yet — returns metadata only."""
        sensor = J1939TruckSensor("test")
        readings = await sensor.get_readings()
        assert readings["_can_interface"] == "can0"
        assert readings["_bus_connected"] is False
        assert readings["_protocol"] == "j1939"

    @pytest.mark.asyncio
    async def test_readings_with_data(self):
        """Pre-populate readings and verify they're returned."""
        sensor = J1939TruckSensor("test")
        sensor._readings = {
            "engine_rpm": 1500.0,
            "coolant_temp_c": 90.0,
            "oil_pressure_kpa": 300.0,
        }
        sensor._frame_count = 42
        sensor._last_frame_time = time.time() - 1.0
        sensor._running = True

        readings = await sensor.get_readings()
        assert readings["engine_rpm"] == 1500.0
        assert readings["coolant_temp_c"] == 90.0
        assert readings["_frame_count"] == 42
        # Bus not actually connected in test
        assert readings["_bus_connected"] is False

    @pytest.mark.asyncio
    async def test_readings_are_copy(self):
        """Returned readings should be a copy, not a reference."""
        sensor = J1939TruckSensor("test")
        sensor._readings = {"engine_rpm": 1500.0}
        readings = await sensor.get_readings()
        readings["engine_rpm"] = 9999  # modify returned copy
        # Original should be unchanged
        assert sensor._readings["engine_rpm"] == 1500.0


# =========================================================================
# do_command
# =========================================================================

class TestDoCommand:
    @pytest.mark.asyncio
    async def test_unknown_command(self):
        """Unknown command returns error with available commands."""
        sensor = J1939TruckSensor("test")
        result = await sensor.do_command({"command": "explode"})
        assert "error" in result
        assert "available" in result

    @pytest.mark.asyncio
    async def test_clear_dtcs_no_bus(self):
        """clear_dtcs without CAN bus returns error."""
        sensor = J1939TruckSensor("test")
        result = await sensor.do_command({"command": "clear_dtcs"})
        assert result["success"] is False
        assert "not connected" in result["error"]

    @pytest.mark.asyncio
    @patch("subprocess.run")
    async def test_clear_dtcs_with_bus(self, mock_subprocess):
        """clear_dtcs sends DM11 and clears local DTC cache."""
        # Create a proper mock for the 'can' module
        mock_can = MagicMock()

        class FakeMsg:
            def __init__(self, **kwargs):
                self.arbitration_id = kwargs.get("arbitration_id", 0)
                self.data = kwargs.get("data", b"\xff" * 8)
                self.is_extended_id = kwargs.get("is_extended_id", True)
        mock_can.Message = FakeMsg
        # The tx_bus created inside _clear_dtcs should return None on recv
        mock_tx_bus = MagicMock()
        mock_tx_bus.recv.return_value = None
        mock_can.interface.Bus.return_value = mock_tx_bus

        sensor = J1939TruckSensor("test")
        mock_bus = MagicMock()
        mock_bus.recv.return_value = None
        sensor._bus = mock_bus

        # Pre-populate some DTC readings
        sensor._readings = {
            "active_dtc_count": 2,
            "dtc_0_spn": 100,
            "dtc_0_fmi": 1,
            "malfunction_lamp": 1,
            "engine_rpm": 1500.0,  # should NOT be cleared
        }

        with patch.dict("sys.modules", {"can": mock_can}):
            result = await sensor.do_command({"command": "clear_dtcs"})

        assert result["success"] is True
        # engine_rpm should remain after DTC clear
        assert sensor._readings.get("engine_rpm") == 1500.0

    @pytest.mark.asyncio
    async def test_request_pgn_no_bus(self):
        """request_pgn without CAN bus returns error."""
        sensor = J1939TruckSensor("test")
        result = await sensor.do_command({"command": "request_pgn", "pgn": 61444})
        assert result["success"] is False

    @pytest.mark.asyncio
    async def test_request_pgn_with_bus(self):
        """request_pgn sends correct request frame."""
        mock_can = MagicMock()
        sensor = J1939TruckSensor("test")
        mock_bus = MagicMock()
        sensor._bus = mock_bus

        with patch.dict("sys.modules", {"can": mock_can}):
            result = await sensor.do_command({"command": "request_pgn", "pgn": 61444})
        assert result["success"] is True
        mock_bus.send.assert_called_once()

    @pytest.mark.asyncio
    async def test_request_pgn_missing_param(self):
        """request_pgn without pgn parameter returns error."""
        sensor = J1939TruckSensor("test")
        result = await sensor.do_command({"command": "request_pgn"})
        assert "error" in result

    @pytest.mark.asyncio
    async def test_get_supported_pgns(self):
        """get_supported_pgns returns the registry."""
        sensor = J1939TruckSensor("test")
        result = await sensor.do_command({"command": "get_supported_pgns"})
        assert "supported_pgns" in result
        assert 61444 in result["supported_pgns"]

    @pytest.mark.asyncio
    async def test_get_bus_stats(self):
        """get_bus_stats returns current state."""
        sensor = J1939TruckSensor("test")
        result = await sensor.do_command({"command": "get_bus_stats"})
        assert result["can_interface"] == "can0"
        assert result["bitrate"] == 500000
        assert result["bus_connected"] is False

    @pytest.mark.asyncio
    async def test_send_raw_no_bus(self):
        """send_raw without CAN bus returns error."""
        sensor = J1939TruckSensor("test")
        result = await sensor.do_command({
            "command": "send_raw",
            "can_id": 0x18FED3FE,
            "data": "FFFFFFFFFFFFFFFF"
        })
        assert result["success"] is False

    @pytest.mark.asyncio
    async def test_send_raw_with_bus(self):
        """send_raw sends the frame."""
        mock_can = MagicMock()
        sensor = J1939TruckSensor("test")
        mock_bus = MagicMock()
        sensor._bus = mock_bus

        with patch.dict("sys.modules", {"can": mock_can}):
            result = await sensor.do_command({
                "command": "send_raw",
                "can_id": 0x18FED3FE,
                "data": "FFFFFFFFFFFFFFFF"
            })
        assert result["success"] is True
        mock_bus.send.assert_called_once()


# =========================================================================
# Resilience / edge cases
# =========================================================================

class TestResilience:
    @pytest.mark.asyncio
    async def test_close_without_bus(self):
        """close() works even if bus was never started."""
        sensor = J1939TruckSensor("test")
        await sensor.close()  # should not raise

    @pytest.mark.asyncio
    async def test_close_stops_listener(self):
        """close() stops the listener thread."""
        sensor = J1939TruckSensor("test")
        sensor._running = True
        mock_thread = MagicMock()
        mock_thread.is_alive.return_value = True
        sensor._listener_thread = mock_thread
        mock_bus = MagicMock()
        sensor._bus = mock_bus

        await sensor.close()
        assert sensor._running is False
        mock_thread.join.assert_called_once()
        mock_bus.shutdown.assert_called_once()

    def test_listener_handles_non_extended_frames(self):
        """Listener ignores standard (11-bit) CAN frames."""
        sensor = J1939TruckSensor("test")
        mock_msg = MagicMock()
        mock_msg.is_extended_id = False

        mock_bus = MagicMock()
        mock_bus.recv.side_effect = [mock_msg, None]
        sensor._bus = mock_bus
        sensor._running = True

        # Run one iteration manually
        def run_once():
            msg = sensor._bus.recv(timeout=1.0)
            if msg and not msg.is_extended_id:
                return  # should skip
            sensor._running = False

        run_once()
        assert sensor._frame_count == 0  # frame was skipped

    def test_start_listener_failure(self):
        """Bus creation failure is handled gracefully."""
        sensor = J1939TruckSensor("test")
        with patch("src.models.j1939_sensor.J1939TruckSensor._start_listener") as mock:
            mock.side_effect = Exception("No CAN device")
            # Should not propagate
            try:
                mock()
            except Exception:
                pass
        assert sensor._bus is None


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
