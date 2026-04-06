"""
Tests for pgn_utils.py — J1939 byte extraction and CAN ID parsing.

These are the lowest-level building blocks of the PGN decoder. Every
PGN definition depends on _get_byte, _get_word_le, _decode_scaled, etc.
If these break, ALL decoded sensor readings will be wrong.

Run: python3 -m pytest modules/j1939-sensor/tests/test_pgn_utils.py -v
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.models.pgn_utils import (
    PGNDefinition,
    SPNDefinition,
    _decode_2bit_status,
    _decode_pressure_psi,
    _decode_scaled,
    _decode_temp_f,
    _get_byte,
    _get_dword_le,
    _get_word_le,
    extract_pgn_from_can_id,
    extract_source_address,
)

# ── Byte Extraction ───────────────────────────────────────────────


class TestGetByte:
    """Tests for _get_byte — single byte extraction with sentinel handling."""

    def test_normal_value(self):
        assert _get_byte(bytes([42]), 0) == 42

    def test_zero_is_valid(self):
        assert _get_byte(bytes([0]), 0) == 0

    def test_max_valid_byte(self):
        # 0xFD (253) is the highest valid byte value
        assert _get_byte(bytes([0xFD]), 0) == 0xFD

    def test_not_available_returns_none(self):
        assert _get_byte(bytes([0xFF]), 0) is None

    def test_error_returns_none(self):
        assert _get_byte(bytes([0xFE]), 0) is None

    def test_index_out_of_range(self):
        assert _get_byte(bytes([42]), 1) is None

    def test_empty_data(self):
        assert _get_byte(b"", 0) is None

    def test_middle_byte(self):
        data = bytes([10, 20, 30, 40])
        assert _get_byte(data, 2) == 30


class TestGetWordLE:
    """Tests for _get_word_le — 16-bit little-endian extraction."""

    def test_normal_value(self):
        # 0x1234 little-endian: low=0x34, high=0x12
        assert _get_word_le(bytes([0x34, 0x12]), 0) == 0x1234

    def test_zero_is_valid(self):
        assert _get_word_le(bytes([0x00, 0x00]), 0) == 0

    def test_not_available_returns_none(self):
        assert _get_word_le(bytes([0xFF, 0xFF]), 0) is None

    def test_error_returns_none(self):
        assert _get_word_le(bytes([0xFE, 0xFF]), 0) is None

    def test_index_too_high(self):
        assert _get_word_le(bytes([0x34]), 0) is None

    def test_offset_extraction(self):
        data = bytes([0xAA, 0x34, 0x12, 0xBB])
        assert _get_word_le(data, 1) == 0x1234

    def test_rpm_encoding(self):
        """1500 RPM = 1500 / 0.125 = 12000 = 0x2EE0 LE: [0xE0, 0x2E]"""
        raw = _get_word_le(bytes([0xFF, 0xFF, 0xFF, 0xE0, 0x2E, 0xFF, 0xFF, 0xFF]), 3)
        assert raw == 0x2EE0  # 12000
        # After applying RPM resolution: 12000 * 0.125 = 1500
        assert raw * 0.125 == 1500.0


class TestGetDwordLE:
    """Tests for _get_dword_le — 32-bit little-endian extraction."""

    def test_normal_value(self):
        data = bytes([0x78, 0x56, 0x34, 0x12])
        assert _get_dword_le(data, 0) == 0x12345678

    def test_not_available_returns_none(self):
        data = bytes([0xFF, 0xFF, 0xFF, 0xFF])
        assert _get_dword_le(data, 0) is None

    def test_short_data(self):
        assert _get_dword_le(bytes([0x01, 0x02, 0x03]), 0) is None


# ── Scaled Decoding ───────────────────────────────────────────────


class TestDecodeScaled:
    """Tests for _decode_scaled — generic value * resolution + offset."""

    def test_rpm_8bit(self):
        """8-bit RPM: raw=200, resolution=40, offset=0 → 8000 RPM"""
        result = _decode_scaled(bytes([200]), 0, 8, 40.0, 0)
        assert result == 8000.0

    def test_rpm_16bit(self):
        """16-bit RPM: raw=12000 (0x2EE0), resolution=0.125 → 1500 RPM"""
        data = bytes([0xE0, 0x2E])
        result = _decode_scaled(data, 0, 16, 0.125, 0)
        assert result == 1500.0

    def test_with_offset(self):
        """Torque: raw=203, resolution=1, offset=-125 → 78%"""
        result = _decode_scaled(bytes([203]), 0, 8, 1.0, -125.0)
        assert result == 78.0

    def test_none_for_not_available(self):
        result = _decode_scaled(bytes([0xFF]), 0, 8, 1.0, 0)
        assert result is None

    def test_unsupported_bit_length(self):
        result = _decode_scaled(bytes([0x42, 0x42, 0x42]), 0, 24, 1.0, 0)
        assert result is None


# ── 2-Bit Status Decoding ─────────────────────────────────────────


class TestDecode2BitStatus:
    """Tests for _decode_2bit_status — J1939 2-bit on/off/error/NA."""

    def test_off(self):
        """Bits 00 = off/false"""
        assert _decode_2bit_status(bytes([0b00000000]), 0, 0) is False

    def test_on(self):
        """Bits 01 = on/true"""
        assert _decode_2bit_status(bytes([0b00000001]), 0, 0) is True

    def test_error(self):
        """Bits 10 = error → treated as False"""
        assert _decode_2bit_status(bytes([0b00000010]), 0, 0) is False

    def test_not_available(self):
        """Bits 11 = not available → None"""
        assert _decode_2bit_status(bytes([0b00000011]), 0, 0) is None

    def test_higher_bit_offset(self):
        """Test extracting bits from bit_offset=4 (bits 5-4)"""
        # byte = 0b00010000 → bits 5-4 = 01 = on
        assert _decode_2bit_status(bytes([0b00010000]), 0, 4) is True

    def test_lamp_byte(self):
        """DM1 lamp byte: protect=01, amber=00, red=00, MIL=01"""
        lamp = 0b01000001  # protect(01) amber(00) red(00) MIL(01)
        assert _decode_2bit_status(bytes([lamp]), 0, 6) is True   # protect
        assert _decode_2bit_status(bytes([lamp]), 0, 4) is False  # amber
        assert _decode_2bit_status(bytes([lamp]), 0, 2) is False  # red
        assert _decode_2bit_status(bytes([lamp]), 0, 0) is True   # MIL


# ── Temperature Conversion ────────────────────────────────────────


class TestDecodeTempF:
    """Tests for _decode_temp_f — Celsius to Fahrenheit conversion."""

    def test_coolant_temp_90c(self):
        """Coolant 90°C: raw=130 (90+40 offset), res=1, offset_c=-40 → 194°F"""
        result = _decode_temp_f(bytes([130]), 0, 8, 1.0, -40.0)
        assert result == 194.0

    def test_freezing(self):
        """0°C = 32°F: raw=40 (0+40), res=1, offset_c=-40"""
        result = _decode_temp_f(bytes([40]), 0, 8, 1.0, -40.0)
        assert result == 32.0

    def test_not_available(self):
        result = _decode_temp_f(bytes([0xFF]), 0, 8, 1.0, -40.0)
        assert result is None


# ── Pressure Conversion ───────────────────────────────────────────


class TestDecodePressurePsi:
    """Tests for _decode_pressure_psi — kPa to PSI conversion."""

    def test_known_conversion(self):
        """100 kPa ≈ 14.50 PSI"""
        # raw=100, res=1, offset=0 → 100 kPa → ~14.50 PSI
        result = _decode_pressure_psi(bytes([100]), 0, 8, 1.0, 0)
        assert abs(result - 14.50) < 0.1

    def test_not_available(self):
        result = _decode_pressure_psi(bytes([0xFF]), 0, 8, 1.0, 0)
        assert result is None


# ── CAN ID Parsing ────────────────────────────────────────────────


class TestExtractPGN:
    """Tests for extract_pgn_from_can_id — 29-bit CAN ID → PGN."""

    def test_eec1_pgn_61444(self):
        """EEC1: priority=6, PGN=61444 (0xF004), SA=0x00
        CAN ID = 0x18F00400 = (6<<26) | (0xF0<<16) | (0x04<<8) | 0x00
        PGN = (0xF0 << 8) | 0x04 = 61444 (PDU2, PF >= 240)
        """
        can_id = 0x18F00400
        assert extract_pgn_from_can_id(can_id) == 61444

    def test_dm1_pgn_65226(self):
        """DM1: PGN 65226 (0xFECA), SA=0x00
        CAN ID = 0x18FECA00
        """
        can_id = 0x18FECA00
        assert extract_pgn_from_can_id(can_id) == 65226

    def test_ccvs_pgn_65265(self):
        """CCVS: PGN 65265 (0xFEF1), SA=0x00"""
        can_id = 0x18FEF100
        assert extract_pgn_from_can_id(can_id) == 65265

    def test_pdu1_peer_to_peer(self):
        """PDU1 (PF < 240): destination is in PS, not part of PGN.
        PGN = PF << 8 only.
        Request PGN 59904 (0xEA00): PF=0xEA, CAN ID with dest=0xFF
        """
        # Priority=6, PF=0xEA (234), dest=0xFF, SA=0xF9
        can_id = (6 << 26) | (0xEA << 16) | (0xFF << 8) | 0xF9
        pgn = extract_pgn_from_can_id(can_id)
        assert pgn == 59904  # 0xEA00

    def test_dm11_pgn_65235(self):
        """DM11 clear DTCs: PGN 65235 (0xFED3)"""
        can_id = 0x18FED3F9  # SA=0xF9 (service tool)
        assert extract_pgn_from_can_id(can_id) == 65235

    def test_aftertreatment_acm_source(self):
        """DM1 from ACM (SA 0x3D): same PGN, different source"""
        can_id = 0x18FECA3D  # PGN 65226, SA=0x3D
        assert extract_pgn_from_can_id(can_id) == 65226


class TestExtractSourceAddress:
    """Tests for extract_source_address — lower 8 bits of CAN ID."""

    def test_engine_sa(self):
        assert extract_source_address(0x18F00400) == 0x00

    def test_acm_sa(self):
        assert extract_source_address(0x18FECA3D) == 0x3D

    def test_trans_sa(self):
        assert extract_source_address(0x18FECA03) == 0x03

    def test_service_tool_sa(self):
        assert extract_source_address(0x18FED3F9) == 0xF9


# ── Dataclass Sanity ──────────────────────────────────────────────


class TestDataclasses:
    def test_spn_definition_creation(self):
        spn = SPNDefinition(
            spn=190, name="Engine Speed", key="engine_rpm",
            start_byte=3, length_bits=16, resolution=0.125,
            offset=0, unit="rpm"
        )
        assert spn.spn == 190
        assert spn.key == "engine_rpm"
        assert spn.decode_fn is None

    def test_pgn_definition_creation(self):
        pgn = PGNDefinition(pgn=61444, name="EEC1", spns=[])
        assert pgn.pgn == 61444
        assert pgn.name == "EEC1"
