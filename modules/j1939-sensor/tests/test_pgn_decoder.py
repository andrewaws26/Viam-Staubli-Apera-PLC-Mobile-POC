"""
Comprehensive tests for the J1939 PGN decoder.

Tests use known byte patterns from the SAE J1939 standard to verify
correct decoding of engine parameters, vehicle data, and DTCs.
"""

import os
import sys

import pytest

# Add parent dir to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.models.pgn_decoder import (
    _get_byte,
    _get_dword_le,
    _get_word_le,
    decode_can_frame,
    decode_dm1,
    decode_dm1_lamps,
    decode_pgn,
    extract_pgn_from_can_id,
    extract_source_address,
    get_supported_pgns,
)

# =========================================================================
# CAN ID parsing
# =========================================================================

class TestExtractPGN:
    """Test PGN extraction from 29-bit CAN IDs."""

    def test_eec1_pgn_61444(self):
        """PGN 61444 (0xF004) — EEC1 from ECU at SA=0x00."""
        # Priority=6, PGN=0xF004, SA=0x00
        # CAN ID: 0x18F00400 (typical for engine controller)
        # 0001 1000 1111 0000 0000 0100 0000 0000
        # P=6 R=0 DP=0 PF=0xF0 PS=0x04 SA=0x00
        can_id = 0x0CF00400
        assert extract_pgn_from_can_id(can_id) == 61444

    def test_eec2_pgn_61443(self):
        """PGN 61443 (0xF003) — EEC2."""
        can_id = 0x0CF00300
        assert extract_pgn_from_can_id(can_id) == 61443

    def test_ccvs_pgn_65265(self):
        """PGN 65265 (0xFEF1) — Vehicle speed."""
        can_id = 0x18FEF100
        assert extract_pgn_from_can_id(can_id) == 65265

    def test_et1_pgn_65262(self):
        """PGN 65262 (0xFEEE) — Engine temperatures."""
        can_id = 0x18FEEE00
        assert extract_pgn_from_can_id(can_id) == 65262

    def test_dm1_pgn_65226(self):
        """PGN 65226 (0xFECA) — DM1 active DTCs."""
        can_id = 0x18FECA00
        assert extract_pgn_from_can_id(can_id) == 65226

    def test_peer_to_peer_pgn(self):
        """PDU1 format (PF < 240): PS is destination, not part of PGN."""
        # Request PGN 59904 (0xEA00): PF=0xEA, PS=destination
        # CAN ID with PF=0xEA, PS=0xFF (broadcast), SA=0xFE
        can_id = 0x18EAFF_FE
        # PDU1: PGN = PF << 8 only = 0xEA00 = 59904
        assert extract_pgn_from_can_id(can_id) == 59904

    def test_different_source_addresses(self):
        """Same PGN from different source addresses."""
        can_id_sa00 = 0x0CF00400  # SA=0x00
        can_id_sa01 = 0x0CF00401  # SA=0x01
        assert extract_pgn_from_can_id(can_id_sa00) == 61444
        assert extract_pgn_from_can_id(can_id_sa01) == 61444


class TestExtractSourceAddress:
    def test_sa_zero(self):
        assert extract_source_address(0x0CF00400) == 0x00

    def test_sa_nonzero(self):
        assert extract_source_address(0x0CF0040B) == 0x0B

    def test_sa_max(self):
        assert extract_source_address(0x18FEEE_FF) == 0xFF


# =========================================================================
# Low-level byte extraction
# =========================================================================

class TestByteExtraction:
    def test_get_byte_valid(self):
        assert _get_byte(bytes([0x50, 0x60]), 0) == 0x50
        assert _get_byte(bytes([0x50, 0x60]), 1) == 0x60

    def test_get_byte_not_available(self):
        assert _get_byte(bytes([0xFF]), 0) is None

    def test_get_byte_error(self):
        assert _get_byte(bytes([0xFE]), 0) is None

    def test_get_byte_out_of_range(self):
        assert _get_byte(bytes([0x50]), 5) is None

    def test_get_word_le(self):
        # 0x0FA0 little-endian = [0xA0, 0x0F] = 4000
        assert _get_word_le(bytes([0xA0, 0x0F]), 0) == 4000

    def test_get_word_not_available(self):
        assert _get_word_le(bytes([0xFF, 0xFF]), 0) is None

    def test_get_word_error(self):
        assert _get_word_le(bytes([0xFE, 0xFF]), 0) is None

    def test_get_dword_le(self):
        # 100000 in LE = [0xA0, 0x86, 0x01, 0x00]
        assert _get_dword_le(bytes([0xA0, 0x86, 0x01, 0x00]), 0) == 100000

    def test_get_dword_not_available(self):
        assert _get_dword_le(bytes([0xFF, 0xFF, 0xFF, 0xFF]), 0) is None


# =========================================================================
# PGN 61444 — Electronic Engine Controller 1 (EEC1)
# =========================================================================

class TestPGN61444_EEC1:
    """Test decoding of EEC1: engine RPM, torque values."""

    def test_engine_rpm_idle(self):
        """~800 RPM: 800 / 0.125 = 6400 = 0x1900 LE: [0x00, 0x19]"""
        data = bytes([0xFF, 0xFF, 0xFF, 0x00, 0x19, 0xFF, 0xFF, 0xFF])
        result = decode_pgn(61444, data)
        assert result["engine_rpm"] == 800.0

    def test_engine_rpm_highway(self):
        """~1800 RPM: 1800 / 0.125 = 14400 = 0x3840 LE: [0x40, 0x38]"""
        data = bytes([0xFF, 0xFF, 0xFF, 0x40, 0x38, 0xFF, 0xFF, 0xFF])
        result = decode_pgn(61444, data)
        assert result["engine_rpm"] == 1800.0

    def test_engine_rpm_max(self):
        """~2400 RPM: 2400 / 0.125 = 19200 = 0x4B00 LE: [0x00, 0x4B]"""
        data = bytes([0xFF, 0xFF, 0xFF, 0x00, 0x4B, 0xFF, 0xFF, 0xFF])
        result = decode_pgn(61444, data)
        assert result["engine_rpm"] == 2400.0

    def test_engine_rpm_not_available(self):
        """RPM bytes = 0xFFFF means not available."""
        data = bytes([0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF])
        result = decode_pgn(61444, data)
        assert "engine_rpm" not in result

    def test_driver_demand_torque(self):
        """50% torque: (50 + 125) = 175 = 0xAF"""
        data = bytes([0xAF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF])
        result = decode_pgn(61444, data)
        assert result["driver_demand_torque_pct"] == 50.0

    def test_actual_engine_torque(self):
        """75% torque: (75 + 125) = 200 = 0xC8"""
        data = bytes([0xFF, 0xC8, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF])
        result = decode_pgn(61444, data)
        assert result["actual_engine_torque_pct"] == 75.0

    def test_negative_torque(self):
        """Engine braking -10%: (-10 + 125) = 115 = 0x73"""
        data = bytes([0xFF, 0x73, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF])
        result = decode_pgn(61444, data)
        assert result["actual_engine_torque_pct"] == -10.0

    def test_full_eec1_frame(self):
        """Decode a complete EEC1 frame with all values."""
        # Driver demand = 80% (205=0xCD), Actual = 78% (203=0xCB),
        # RPM = 1500 (12000=0x2EE0 LE: [0xE0, 0x2E])
        data = bytes([0xCD, 0xCB, 0xFF, 0xE0, 0x2E, 0xFF, 0xFF, 0xFF])
        result = decode_pgn(61444, data)
        assert result["driver_demand_torque_pct"] == 80.0
        assert result["actual_engine_torque_pct"] == 78.0
        assert result["engine_rpm"] == 1500.0


# =========================================================================
# PGN 61443 — Electronic Engine Controller 2 (EEC2)
# =========================================================================

class TestPGN61443_EEC2:
    def test_accelerator_pedal(self):
        """50% pedal: 50 / 0.4 = 125 = 0x7D"""
        data = bytes([0xFF, 0x7D, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF])
        result = decode_pgn(61443, data)
        assert abs(result["accel_pedal_pos_pct"] - 50.0) < 0.5

    def test_engine_load(self):
        """85% load: 85 = 0x55"""
        data = bytes([0xFF, 0xFF, 0x55, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF])
        result = decode_pgn(61443, data)
        assert result["engine_load_pct"] == 85.0


# =========================================================================
# PGN 65262 — Engine Temperature 1 (ET1)
# =========================================================================

class TestPGN65262_ET1:
    def test_coolant_temp_normal(self):
        """90C coolant = 194F: 90 + 40 = 130 = 0x82"""
        data = bytes([0x82, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF])
        result = decode_pgn(65262, data)
        assert result["coolant_temp_f"] == 194.0

    def test_coolant_temp_cold(self):
        """10C coolant = 50F: 10 + 40 = 50 = 0x32"""
        data = bytes([0x32, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF])
        result = decode_pgn(65262, data)
        assert result["coolant_temp_f"] == 50.0

    def test_coolant_temp_below_zero(self):
        """-20C coolant = -4F: -20 + 40 = 20 = 0x14"""
        data = bytes([0x14, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF])
        result = decode_pgn(65262, data)
        assert result["coolant_temp_f"] == -4.0

    def test_fuel_temp(self):
        """45C fuel = 113F: 45 + 40 = 85 = 0x55"""
        data = bytes([0xFF, 0x55, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF])
        result = decode_pgn(65262, data)
        assert result["fuel_temp_f"] == 113.0

    def test_oil_temp(self):
        """100C oil = 212F: (100 + 273) / 0.03125 = 11936 = 0x2EA0 LE: [0xA0, 0x2E]"""
        data = bytes([0xFF, 0xFF, 0xA0, 0x2E, 0xFF, 0xFF, 0xFF, 0xFF])
        result = decode_pgn(65262, data)
        assert abs(result["oil_temp_f"] - 212.0) < 0.5


# =========================================================================
# PGN 65263 — Engine Fluid Level/Pressure (EFL/P)
# =========================================================================

class TestPGN65263_EFLP:
    def test_oil_pressure_normal(self):
        """300 kPa = 43.51 PSI oil: 300 / 4 = 75 = 0x4B"""
        data = bytes([0xFF, 0xFF, 0xFF, 0x4B, 0xFF, 0xFF, 0xFF, 0xFF])
        result = decode_pgn(65263, data)
        assert abs(result["oil_pressure_psi"] - 43.51) < 0.1

    def test_oil_pressure_low(self):
        """100 kPa = 14.5 PSI oil: 100 / 4 = 25 = 0x19"""
        data = bytes([0xFF, 0xFF, 0xFF, 0x19, 0xFF, 0xFF, 0xFF, 0xFF])
        result = decode_pgn(65263, data)
        assert abs(result["oil_pressure_psi"] - 14.5) < 0.1

    def test_fuel_pressure(self):
        """400 kPa = 58.02 PSI fuel: 400 / 4 = 100 = 0x64"""
        data = bytes([0x64, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF])
        result = decode_pgn(65263, data)
        assert abs(result["fuel_pressure_psi"] - 58.02) < 0.1

    def test_oil_level(self):
        """80% oil level: 80 / 0.4 = 200 = 0xC8"""
        data = bytes([0xFF, 0xFF, 0xC8, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF])
        result = decode_pgn(65263, data)
        assert abs(result["oil_level_pct"] - 80.0) < 0.5


# =========================================================================
# PGN 65265 — Vehicle Speed (CCVS)
# =========================================================================

class TestPGN65265_CCVS:
    def test_vehicle_speed_highway(self):
        """100 km/h = 62.14 mph: 100 / (1/256) = 25600 = 0x6400 LE: [0x00, 0x64]"""
        data = bytes([0xFF, 0x00, 0x64, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF])
        result = decode_pgn(65265, data)
        assert abs(result["vehicle_speed_mph"] - 62.14) < 0.1

    def test_vehicle_speed_city(self):
        """50 km/h = 31.07 mph: 50 / (1/256) = 12800 = 0x3200 LE: [0x00, 0x32]"""
        data = bytes([0xFF, 0x00, 0x32, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF])
        result = decode_pgn(65265, data)
        assert abs(result["vehicle_speed_mph"] - 31.07) < 0.1

    def test_vehicle_speed_stopped(self):
        """0 mph"""
        data = bytes([0xFF, 0x00, 0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF])
        result = decode_pgn(65265, data)
        assert result["vehicle_speed_mph"] == 0.0


# =========================================================================
# PGN 65266 — Fuel Economy (LFE)
# =========================================================================

class TestPGN65266_LFE:
    def test_fuel_rate(self):
        """25 L/h = 6.60 gal/h: 25 / 0.05 = 500 = 0x01F4 LE: [0xF4, 0x01]"""
        data = bytes([0xF4, 0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF])
        result = decode_pgn(65266, data)
        assert abs(result["fuel_rate_gph"] - 6.60) < 0.1

    def test_fuel_economy(self):
        """3 km/L = 7.06 mpg: 3 / (1/512) = 1536 = 0x0600 LE: [0x00, 0x06]"""
        data = bytes([0xFF, 0xFF, 0x00, 0x06, 0xFF, 0xFF, 0xFF, 0xFF])
        result = decode_pgn(65266, data)
        assert abs(result["fuel_economy_mpg"] - 7.06) < 0.1


# =========================================================================
# PGN 65271 — Battery Voltage (VEP)
# =========================================================================

class TestPGN65271_VEP:
    def test_battery_voltage_normal(self):
        """13.8V: 13.8 / 0.05 = 276 = 0x0114 LE: [0x14, 0x01]"""
        data = bytes([0xFF, 0xFF, 0xFF, 0xFF, 0x14, 0x01, 0xFF, 0xFF])
        result = decode_pgn(65271, data)
        assert result["battery_voltage_v"] == 13.8

    def test_battery_voltage_low(self):
        """11.5V: 11.5 / 0.05 = 230 = 0x00E6 LE: [0xE6, 0x00]"""
        data = bytes([0xFF, 0xFF, 0xFF, 0xFF, 0xE6, 0x00, 0xFF, 0xFF])
        result = decode_pgn(65271, data)
        assert result["battery_voltage_v"] == 11.5


# =========================================================================
# PGN 65253 — Engine Hours
# =========================================================================

class TestPGN65253_Hours:
    def test_engine_hours(self):
        """5000 hours: 5000 / 0.05 = 100000 = 0x000186A0 LE"""
        data = bytes([0xA0, 0x86, 0x01, 0x00, 0xFF, 0xFF, 0xFF, 0xFF])
        result = decode_pgn(65253, data)
        assert result["engine_hours"] == 5000.0

    def test_engine_hours_new(self):
        """10 hours: 10 / 0.05 = 200 = 0x000000C8 LE"""
        data = bytes([0xC8, 0x00, 0x00, 0x00, 0xFF, 0xFF, 0xFF, 0xFF])
        result = decode_pgn(65253, data)
        assert result["engine_hours"] == 10.0


# =========================================================================
# PGN 65269 — Ambient Conditions
# =========================================================================

class TestPGN65269_AMB:
    def test_barometric_pressure(self):
        """101.5 kPa = 14.72 PSI: 101.5 / 0.5 = 203 = 0xCB"""
        data = bytes([0xCB, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF])
        result = decode_pgn(65269, data)
        assert abs(result["barometric_pressure_psi"] - 14.72) < 0.1

    def test_ambient_temp(self):
        """25C = 77F: (25 + 273) / 0.03125 = 9536 = 0x2540 LE: [0x40, 0x25]"""
        data = bytes([0xFF, 0xFF, 0xFF, 0x40, 0x25, 0xFF, 0xFF, 0xFF])
        result = decode_pgn(65269, data)
        assert abs(result["ambient_temp_f"] - 77.0) < 0.5


# =========================================================================
# PGN 65276 — Fuel Level
# =========================================================================

class TestPGN65276_DD:
    def test_fuel_level_half(self):
        """50%: 50 / 0.4 = 125 = 0x7D"""
        data = bytes([0xFF, 0x7D, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF])
        result = decode_pgn(65276, data)
        assert abs(result["fuel_level_pct"] - 50.0) < 0.5

    def test_fuel_level_full(self):
        """100%: 100 / 0.4 = 250 = 0xFA"""
        data = bytes([0xFF, 0xFA, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF])
        result = decode_pgn(65276, data)
        assert abs(result["fuel_level_pct"] - 100.0) < 0.5


# =========================================================================
# PGN 61445 — Transmission
# =========================================================================

class TestPGN61445_ETC2:
    def test_current_gear(self):
        """Gear 6: 6 + 125 = 131 = 0x83"""
        data = bytes([0xFF, 0xFF, 0xFF, 0x83, 0xFF, 0xFF, 0xFF, 0xFF])
        result = decode_pgn(61445, data)
        assert result["current_gear"] == 6.0

    def test_neutral(self):
        """Neutral (0): 0 + 125 = 125 = 0x7D"""
        data = bytes([0xFF, 0xFF, 0xFF, 0x7D, 0xFF, 0xFF, 0xFF, 0xFF])
        result = decode_pgn(61445, data)
        assert result["current_gear"] == 0.0

    def test_reverse(self):
        """Reverse (-1): -1 + 125 = 124 = 0x7C"""
        data = bytes([0xFF, 0xFF, 0xFF, 0x7C, 0xFF, 0xFF, 0xFF, 0xFF])
        result = decode_pgn(61445, data)
        assert result["current_gear"] == -1.0


# =========================================================================
# DM1 — Diagnostic Trouble Codes
# =========================================================================

class TestDM1:
    def test_no_dtcs(self):
        """No active DTCs — just lamp status bytes."""
        data = bytes([0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF])
        dtcs = decode_dm1(data)
        assert dtcs == []

    def test_single_dtc(self):
        """One DTC: SPN=100 (oil pressure), FMI=1 (above normal)."""
        # SPN 100 = 0x64, split across 3 bytes:
        # b0 = SPN[7:0] = 0x64
        # b1 = SPN[15:8] = 0x00
        # b2 = SPN[18:16] in bits 7-5 = 0x00, FMI in bits 4-0 = 0x01
        # b3 = occurrence = 5
        data = bytes([0x00, 0xFF,  # lamp status
                      0x64, 0x00, 0x01, 0x05,  # DTC
                      0xFF, 0xFF])  # padding
        dtcs = decode_dm1(data)
        assert len(dtcs) == 1
        assert dtcs[0]["spn"] == 100
        assert dtcs[0]["fmi"] == 1
        assert dtcs[0]["occurrence"] == 5

    def test_multiple_dtcs(self):
        """Two DTCs."""
        data = bytes([0x00, 0xFF,
                      0x64, 0x00, 0x01, 0x05,  # SPN 100, FMI 1, occ 5
                      0x6E, 0x00, 0x03, 0x02])  # SPN 110, FMI 3, occ 2
        dtcs = decode_dm1(data)
        assert len(dtcs) == 2
        assert dtcs[0]["spn"] == 100
        assert dtcs[1]["spn"] == 110
        assert dtcs[1]["fmi"] == 3

    def test_lamp_status(self):
        """Test DM1 lamp decoding."""
        # byte 0: 0x44 = 0b01_00_01_00
        # J1939 DM1 byte 0 bit layout (2 bits per lamp):
        # bits 7-6: protect, bits 5-4: amber, bits 3-2: red, bits 1-0: MIL
        data = bytes([0x44, 0xFF])
        lamps = decode_dm1_lamps(data)
        assert lamps["protect_lamp"] == 1
        assert lamps["amber_warning_lamp"] == 0
        assert lamps["red_stop_lamp"] == 1
        assert lamps["malfunction_lamp"] == 0

    def test_all_lamps_on(self):
        """All lamps on (value = 01 each)."""
        # 0b01_01_01_01 = 0x55
        data = bytes([0x55, 0xFF])
        lamps = decode_dm1_lamps(data)
        assert lamps["malfunction_lamp"] == 1
        assert lamps["red_stop_lamp"] == 1
        assert lamps["amber_warning_lamp"] == 1
        assert lamps["protect_lamp"] == 1


class TestDM1ViaDecode:
    """Test DM1 decoding through the standard decode_pgn interface."""

    def test_dm1_with_dtcs(self):
        data = bytes([0x44, 0xFF,
                      0x64, 0x00, 0x01, 0x05,
                      0x6E, 0x00, 0x03, 0x02])
        result = decode_pgn(65226, data)
        assert result["active_dtc_count"] == 2
        assert result["dtc_0_spn"] == 100
        assert result["dtc_0_fmi"] == 1
        assert result["dtc_1_spn"] == 110
        assert result["protect_lamp"] == 1

    def test_dm1_no_dtcs(self):
        data = bytes([0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF])
        result = decode_pgn(65226, data)
        assert result["active_dtc_count"] == 0


# =========================================================================
# decode_can_frame — end-to-end
# =========================================================================

class TestDecodeCanFrame:
    def test_eec1_full_decode(self):
        """Full CAN frame decode: EEC1 with RPM 1500."""
        can_id = 0x0CF00400  # PGN 61444, SA=0
        data = bytes([0xCD, 0xCB, 0xFF, 0xE0, 0x2E, 0xFF, 0xFF, 0xFF])
        pgn, readings = decode_can_frame(can_id, data)
        assert pgn == 61444
        assert readings["engine_rpm"] == 1500.0

    def test_unknown_pgn(self):
        """Unknown PGN returns empty dict."""
        can_id = 0x18FF0000  # PGN 65280, not in registry
        data = bytes([0x00] * 8)
        pgn, readings = decode_can_frame(can_id, data)
        assert readings == {}


# =========================================================================
# Edge cases
# =========================================================================

class TestEdgeCases:
    def test_short_data(self):
        """Handle data shorter than 8 bytes gracefully."""
        data = bytes([0x82, 0x55])  # only 2 bytes
        result = decode_pgn(65262, data)
        assert result["coolant_temp_f"] == 194.0
        assert result["fuel_temp_f"] == 113.0
        # oil_temp needs bytes 2-3, which are missing
        assert "oil_temp_f" not in result

    def test_empty_data(self):
        """Handle empty data."""
        result = decode_pgn(65262, b"")
        assert result == {}

    def test_all_not_available(self):
        """All bytes 0xFF = no data available."""
        data = bytes([0xFF] * 8)
        result = decode_pgn(61444, data)
        assert result == {}

    def test_get_supported_pgns(self):
        """Verify supported PGN list."""
        pgns = get_supported_pgns()
        assert 61444 in pgns
        assert 65262 in pgns
        assert 65226 in pgns
        assert "EEC1" in pgns[61444]


# =========================================================================
# PGN 65270 — Intake/Exhaust
# =========================================================================

class TestPGN65270_IC1:
    def test_boost_pressure(self):
        """200 kPa = 29.01 PSI boost: 200 / 2 = 100 = 0x64"""
        data = bytes([0xFF, 0x64, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF])
        result = decode_pgn(65270, data)
        assert abs(result["boost_pressure_psi"] - 29.01) < 0.1

    def test_intake_manifold_temp(self):
        """60C = 140F intake: 60 + 40 = 100 = 0x64"""
        data = bytes([0xFF, 0xFF, 0x64, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF])
        result = decode_pgn(65270, data)
        assert abs(result["intake_manifold_temp_f"] - 140.0) < 0.5


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
