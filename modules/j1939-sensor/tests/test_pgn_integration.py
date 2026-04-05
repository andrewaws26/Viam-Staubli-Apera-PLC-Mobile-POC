"""Integration tests for the full PGN decode pipeline.

Tests decode realistic CAN frames end-to-end: raw bytes -> CAN ID parsing
-> PGN decoding -> final readings dict.  Validates correct field names,
units, and edge case handling.

These tests use the current imperial-unit field names from pgn_decoder.py
(e.g., coolant_temp_f, vehicle_speed_mph, oil_pressure_psi).
"""

import pytest
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.models.pgn_decoder import (
    decode_can_frame,
    decode_dm1,
    decode_dm1_lamps,
    decode_pgn,
    extract_pgn_from_can_id,
    extract_source_address,
)


# =========================================================================
# DM1 decoding — full pipeline
# =========================================================================

class TestDM1IntegrationDecode:
    """Test DM1 decoding through decode_pgn and decode_can_frame."""

    def test_dm1_single_dtc_fields(self, sample_dm1_engine_frame):
        """DM1 from engine produces correct DTC fields via decode_pgn."""
        pgn = extract_pgn_from_can_id(sample_dm1_engine_frame.arbitration_id)
        assert pgn == 65226

        result = decode_pgn(pgn, sample_dm1_engine_frame.data)
        assert result["active_dtc_count"] == 1
        assert result["dtc_0_spn"] == 110
        assert result["dtc_0_fmi"] == 0
        assert result["dtc_0_occurrence"] == 3

    def test_dm1_engine_frame_via_decode_can_frame(self, sample_dm1_engine_frame):
        """Full pipeline: CAN frame -> PGN extraction -> DTC decoding."""
        pgn, readings = decode_can_frame(
            sample_dm1_engine_frame.arbitration_id,
            sample_dm1_engine_frame.data,
        )
        assert pgn == 65226
        assert readings["active_dtc_count"] == 1
        assert readings["dtc_0_spn"] == 110

    def test_dm1_trans_frame_dtc(self, sample_dm1_trans_frame):
        """DM1 from transmission (SA 0x03) decodes correctly."""
        sa = extract_source_address(sample_dm1_trans_frame.arbitration_id)
        assert sa == 0x03

        pgn, readings = decode_can_frame(
            sample_dm1_trans_frame.arbitration_id,
            sample_dm1_trans_frame.data,
        )
        assert pgn == 65226
        assert readings["active_dtc_count"] == 1
        assert readings["dtc_0_spn"] == 524
        assert readings["dtc_0_fmi"] == 2
        assert readings["dtc_0_occurrence"] == 1

    def test_dm1_no_active_dtcs(self):
        """DM1 with all-FF padding means no active DTCs."""
        data = bytes([0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF])
        result = decode_pgn(65226, data)
        assert result["active_dtc_count"] == 0

    def test_dm1_multiple_dtcs(self):
        """DM1 with two DTCs flattened into readings."""
        data = bytes([
            0x00, 0xFF,             # lamps off
            0x64, 0x00, 0x01, 0x05, # SPN 100, FMI 1, OC 5
            0x6E, 0x00, 0x03, 0x02, # SPN 110, FMI 3, OC 2
        ])
        result = decode_pgn(65226, data)
        assert result["active_dtc_count"] == 2
        assert result["dtc_0_spn"] == 100
        assert result["dtc_0_fmi"] == 1
        assert result["dtc_0_occurrence"] == 5
        assert result["dtc_1_spn"] == 110
        assert result["dtc_1_fmi"] == 3
        assert result["dtc_1_occurrence"] == 2


# =========================================================================
# DM1 lamp extraction
# =========================================================================

class TestDM1LampIntegration:
    """Test DM1 lamp decoding through both direct and decode_pgn paths."""

    def test_mil_on_via_decode_pgn(self):
        """MIL lamp ON produces malfunction_lamp field."""
        # MIL = bits 1-0 of byte 0 = 01, rest off
        # 0b00_00_00_01 = 0x01
        data = bytes([0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF])
        result = decode_pgn(65226, data)
        assert result["malfunction_lamp"] == 1
        assert result["red_stop_lamp"] == 0
        assert result["amber_warning_lamp"] == 0
        assert result["protect_lamp"] == 0

    def test_all_lamps_on(self):
        """All four lamps ON."""
        # 0b01_01_01_01 = 0x55
        data = bytes([0x55, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF])
        result = decode_pgn(65226, data)
        assert result["malfunction_lamp"] == 1
        assert result["red_stop_lamp"] == 1
        assert result["amber_warning_lamp"] == 1
        assert result["protect_lamp"] == 1

    def test_lamps_in_dm1_with_dtc(self, sample_dm1_engine_frame):
        """Lamp status preserved alongside DTC data."""
        pgn, readings = decode_can_frame(
            sample_dm1_engine_frame.arbitration_id,
            sample_dm1_engine_frame.data,
        )
        # The fixture has lamp byte 0x04 = 0b00_00_01_00 -> red_stop_lamp=1
        assert readings["red_stop_lamp"] == 1
        assert readings["active_dtc_count"] == 1

    def test_empty_data_lamps(self):
        """Empty data returns empty lamp dict."""
        lamps = decode_dm1_lamps(bytes())
        assert lamps == {}

    def test_short_data_lamps(self):
        """Single byte is too short for lamps."""
        lamps = decode_dm1_lamps(bytes([0x55]))
        assert lamps == {}


# =========================================================================
# Engine RPM (PGN 61444 — EEC1)
# =========================================================================

class TestEngineRPMIntegration:
    """Test engine RPM decoding through full pipeline."""

    def test_rpm_1500_via_fixture(self, sample_eec1_frame):
        """Fixture frame decodes to 1500 RPM."""
        pgn, readings = decode_can_frame(
            sample_eec1_frame.arbitration_id,
            sample_eec1_frame.data,
        )
        assert pgn == 61444
        assert readings["engine_rpm"] == 1500.0

    def test_rpm_with_torque(self, sample_eec1_frame):
        """Fixture also includes driver demand and actual torque."""
        _, readings = decode_can_frame(
            sample_eec1_frame.arbitration_id,
            sample_eec1_frame.data,
        )
        assert readings["driver_demand_torque_pct"] == 80.0
        assert readings["actual_engine_torque_pct"] == 78.0

    def test_rpm_idle_800(self, mock_can_message):
        """800 RPM: 800 / 0.125 = 6400 = 0x1900 LE: [0x00, 0x19]."""
        msg = mock_can_message(
            pgn=61444, sa=0x00,
            data=bytes([0xFF, 0xFF, 0xFF, 0x00, 0x19, 0xFF, 0xFF, 0xFF]),
        )
        _, readings = decode_can_frame(msg.arbitration_id, msg.data)
        assert readings["engine_rpm"] == 800.0

    def test_rpm_not_available(self, mock_can_message):
        """All-FF data means RPM not available."""
        msg = mock_can_message(
            pgn=61444, sa=0x00,
            data=bytes([0xFF] * 8),
        )
        _, readings = decode_can_frame(msg.arbitration_id, msg.data)
        assert "engine_rpm" not in readings


# =========================================================================
# Vehicle Speed (PGN 65265 — CCVS)
# =========================================================================

class TestVehicleSpeedIntegration:
    """Test vehicle speed decoding (now in mph)."""

    def test_speed_from_fixture(self, sample_ccvs_frame):
        """CCVS fixture decodes to a speed value."""
        pgn, readings = decode_can_frame(
            sample_ccvs_frame.arbitration_id,
            sample_ccvs_frame.data,
        )
        assert pgn == 65265
        assert "vehicle_speed_mph" in readings
        # 25600 * 0.00390625 * 0.621371 = ~62.14 mph
        assert abs(readings["vehicle_speed_mph"] - 62.14) < 0.5

    def test_speed_zero(self, mock_can_message):
        """Zero speed."""
        msg = mock_can_message(
            pgn=65265, sa=0x00,
            data=bytes([0xFF, 0x00, 0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF]),
        )
        _, readings = decode_can_frame(msg.arbitration_id, msg.data)
        assert readings["vehicle_speed_mph"] == 0.0

    def test_speed_not_available(self, mock_can_message):
        """All-FF means speed not available."""
        msg = mock_can_message(
            pgn=65265, sa=0x00,
            data=bytes([0xFF] * 8),
        )
        _, readings = decode_can_frame(msg.arbitration_id, msg.data)
        assert "vehicle_speed_mph" not in readings


# =========================================================================
# Coolant Temperature (PGN 65262 — ET1)
# =========================================================================

class TestCoolantTempIntegration:
    """Test coolant temperature decoding (now in Fahrenheit)."""

    def test_coolant_from_fixture(self, sample_et1_frame):
        """ET1 fixture: 90C coolant = 194F."""
        pgn, readings = decode_can_frame(
            sample_et1_frame.arbitration_id,
            sample_et1_frame.data,
        )
        assert pgn == 65262
        assert "coolant_temp_f" in readings
        # 90C = 194F
        assert abs(readings["coolant_temp_f"] - 194.0) < 0.5

    def test_fuel_temp_from_fixture(self, sample_et1_frame):
        """ET1 fixture: 45C fuel temp = 113F."""
        _, readings = decode_can_frame(
            sample_et1_frame.arbitration_id,
            sample_et1_frame.data,
        )
        assert "fuel_temp_f" in readings
        # 45C = 113F
        assert abs(readings["fuel_temp_f"] - 113.0) < 0.5

    def test_coolant_cold_start(self, mock_can_message):
        """Cold engine: 10C coolant = 50F. Raw: 10 + 40 = 50 = 0x32."""
        msg = mock_can_message(
            pgn=65262, sa=0x00,
            data=bytes([0x32, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF]),
        )
        _, readings = decode_can_frame(msg.arbitration_id, msg.data)
        assert "coolant_temp_f" in readings
        # 10C = 50F
        assert abs(readings["coolant_temp_f"] - 50.0) < 0.5


# =========================================================================
# Unknown PGN
# =========================================================================

class TestUnknownPGNIntegration:

    def test_unknown_pgn_returns_empty(self, mock_can_message):
        """Unknown/proprietary PGN returns empty dict."""
        msg = mock_can_message(
            pgn=65280, sa=0x00,  # Proprietary B range
            data=bytes([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]),
        )
        _, readings = decode_can_frame(msg.arbitration_id, msg.data)
        assert readings == {}

    def test_standard_unsupported_pgn(self):
        """PGN not in registry returns empty dict via decode_pgn."""
        result = decode_pgn(12345, bytes([0x00] * 8))
        assert result == {}


# =========================================================================
# Malformed / edge-case data
# =========================================================================

class TestMalformedDataIntegration:

    def test_empty_data_eec1(self):
        """Empty data for EEC1 doesn't crash, returns empty dict."""
        result = decode_pgn(61444, bytes())
        assert result == {}

    def test_short_data_et1(self):
        """Short data for ET1: only coolant byte present."""
        data = bytes([0x82])  # only 1 byte
        result = decode_pgn(65262, data)
        # coolant_temp_f should decode (byte 0)
        assert "coolant_temp_f" in result
        # fuel_temp_f at byte 1 should be missing
        assert "fuel_temp_f" not in result

    def test_single_byte_dm1(self):
        """DM1 with only 1 byte doesn't crash."""
        result = decode_pgn(65226, bytes([0x44]))
        # Need at least 2 bytes for lamps
        assert result["active_dtc_count"] == 0

    def test_truncated_dtc_data(self):
        """DM1 with lamp bytes but truncated DTC (only 3 of 4 bytes)."""
        data = bytes([0x00, 0xFF, 0x64, 0x00, 0x01])  # 5 bytes: 2 lamp + 3 DTC
        result = decode_pgn(65226, data)
        # DTC needs 4 bytes (indices 2-5), only 3 available -> no DTC decoded
        assert result["active_dtc_count"] == 0

    def test_all_error_bytes_eec1(self):
        """All 0xFE (error indicator) bytes return empty."""
        data = bytes([0xFE] * 8)
        result = decode_pgn(61444, data)
        # 0xFE for single bytes = error = None, 0xFFFE for words = error
        assert result == {}

    def test_none_data_type(self):
        """Passing zero-length bytes is handled gracefully."""
        result = decode_pgn(65262, b"")
        assert isinstance(result, dict)

    def test_oversized_data(self):
        """Data longer than 8 bytes is handled (extra bytes ignored)."""
        data = bytes([0x82, 0x55, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
                      0xAA, 0xBB, 0xCC])  # 11 bytes
        result = decode_pgn(65262, data)
        assert "coolant_temp_f" in result
        assert "fuel_temp_f" in result


# =========================================================================
# Multi-frame realistic scenario
# =========================================================================

class TestRealisticScenario:
    """Simulate receiving multiple frames from a running truck."""

    def test_accumulate_readings_from_multiple_pgns(self, mock_can_message):
        """Decode several PGNs and merge readings as the sensor would."""
        all_readings = {}

        # EEC1: RPM 1200
        eec1 = mock_can_message(
            pgn=61444, sa=0x00,
            data=bytes([0xFF, 0xFF, 0xFF, 0x80, 0x25, 0xFF, 0xFF, 0xFF]),
        )
        # 1200 / 0.125 = 9600 = 0x2580 LE: [0x80, 0x25]
        _, r = decode_can_frame(eec1.arbitration_id, eec1.data)
        all_readings.update(r)

        # ET1: coolant 85C = 185F
        et1 = mock_can_message(
            pgn=65262, sa=0x00,
            data=bytes([0x7D, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF]),
        )
        # 85 + 40 = 125 = 0x7D
        _, r = decode_can_frame(et1.arbitration_id, et1.data)
        all_readings.update(r)

        # VEP: battery 13.8V
        vep = mock_can_message(
            pgn=65271, sa=0x00,
            data=bytes([0xFF, 0xFF, 0xFF, 0xFF, 0x14, 0x01, 0xFF, 0xFF]),
        )
        _, r = decode_can_frame(vep.arbitration_id, vep.data)
        all_readings.update(r)

        # Verify we accumulated all readings
        assert all_readings["engine_rpm"] == 1200.0
        assert "coolant_temp_f" in all_readings
        assert all_readings["battery_voltage_v"] == 13.8

    def test_dm1_followed_by_normal_frames(self, mock_can_message):
        """DM1 with DTCs followed by engine data -- both decoded correctly."""
        all_readings = {}

        # DM1: 1 DTC
        dm1 = mock_can_message(
            pgn=65226, sa=0x00,
            data=bytes([0x01, 0xFF, 0x64, 0x00, 0x01, 0x05, 0xFF, 0xFF]),
        )
        _, r = decode_can_frame(dm1.arbitration_id, dm1.data)
        all_readings.update(r)

        # EEC1: RPM 800
        eec1 = mock_can_message(
            pgn=61444, sa=0x00,
            data=bytes([0xFF, 0xFF, 0xFF, 0x00, 0x19, 0xFF, 0xFF, 0xFF]),
        )
        _, r = decode_can_frame(eec1.arbitration_id, eec1.data)
        all_readings.update(r)

        assert all_readings["active_dtc_count"] == 1
        assert all_readings["dtc_0_spn"] == 100
        assert all_readings["engine_rpm"] == 800.0


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
