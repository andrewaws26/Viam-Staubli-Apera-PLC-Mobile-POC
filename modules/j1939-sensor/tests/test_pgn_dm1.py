"""
Tests for pgn_dm1.py — DM1 diagnostic message decoding.

DM1 (PGN 65226) is the primary way ECUs report active trouble codes.
This decoder extracts SPN, FMI, occurrence count, and lamp status from
raw CAN frame data. If this breaks, the dashboard shows no DTCs.

Run: python3 -m pytest modules/j1939-sensor/tests/test_pgn_dm1.py -v
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.models.pgn_dm1 import decode_dm1, decode_dm1_lamps


class TestDecodeDM1:
    """Tests for decode_dm1 — DTC extraction from DM1 payload."""

    def test_single_dtc(self):
        """SPN 110 (Coolant Temp), FMI 0, occurrence 3."""
        # SPN 110 = 0x6E. b0=0x6E, b1=0x00, SPN[18:16]=0 in b2 bits 7-5
        # FMI=0 in b2 bits 4-0, occurrence=3 in b3 bits 6-0
        data = bytes([
            0x00, 0x00,             # lamp status (no lamps)
            0x6E, 0x00, 0x00, 0x03, # DTC: SPN=110, FMI=0, OC=3
        ])
        dtcs = decode_dm1(data)
        assert len(dtcs) == 1
        assert dtcs[0]["spn"] == 110
        assert dtcs[0]["fmi"] == 0
        assert dtcs[0]["occurrence"] == 3

    def test_multiple_dtcs(self):
        """Two DTCs in one DM1 frame."""
        data = bytes([
            0x00, 0x00,             # no lamps
            0x6E, 0x00, 0x00, 0x03, # DTC1: SPN=110, FMI=0, OC=3
            0x0C, 0x02, 0x02, 0x01, # DTC2: SPN=524, FMI=2, OC=1
        ])
        dtcs = decode_dm1(data)
        assert len(dtcs) == 2
        assert dtcs[0]["spn"] == 110
        assert dtcs[1]["spn"] == 524
        assert dtcs[1]["fmi"] == 2

    def test_aftertreatment_spn_3226(self):
        """SPN 3226 (DEF Tank Level), FMI 18 — the Mack Granite known issue.

        SPN 3226 = 0x0C9A
        b0 = SPN[7:0] = 0x9A
        b1 = SPN[15:8] = 0x0C
        b2 = SPN[18:16] (bits 7-5) = 0 | FMI (bits 4-0) = 18 = 0x12
        b3 = occurrence = 5
        """
        data = bytes([
            0x00, 0x00,
            0x9A, 0x0C, 0x12, 0x05,
        ])
        dtcs = decode_dm1(data)
        assert len(dtcs) == 1
        assert dtcs[0]["spn"] == 3226
        assert dtcs[0]["fmi"] == 18
        assert dtcs[0]["occurrence"] == 5

    def test_high_spn_uses_all_19_bits(self):
        """SPN with bits in the upper 3 bits (bits 18-16).

        SPN = 0x10064 (65636) — uses bit 16 of the SPN field.
        b0 = 0x64, b1 = 0x00, b2 high bits = 0b001 (bit 16 set), FMI=5
        So b2 = (1 << 5) | 5 = 0x25
        """
        data = bytes([
            0x00, 0x00,
            0x64, 0x00, 0x25, 0x01,
        ])
        dtcs = decode_dm1(data)
        assert len(dtcs) == 1
        assert dtcs[0]["spn"] == (0x64 | (0x00 << 8) | (1 << 16))
        assert dtcs[0]["fmi"] == 5

    def test_not_available_dtc_skipped(self):
        """SPN=0x7FFFF + FMI=0x1F means 'not available', should be skipped."""
        # This is the J1939 sentinel for "no DTC in this slot"
        data = bytes([
            0x00, 0x00,
            0xFF, 0xFF, 0xFF, 0x7F,  # SPN=0x7FFFF, FMI=0x1F
        ])
        dtcs = decode_dm1(data)
        assert len(dtcs) == 0

    def test_empty_dm1_no_dtcs(self):
        """DM1 with only lamp bytes and no DTC entries."""
        data = bytes([0x00, 0x00])
        dtcs = decode_dm1(data)
        assert len(dtcs) == 0

    def test_too_short_data(self):
        """Data shorter than 2 bytes returns empty list."""
        assert decode_dm1(bytes([0x00])) == []
        assert decode_dm1(b"") == []

    def test_partial_dtc_entry_ignored(self):
        """Incomplete DTC entry (< 4 bytes after lamp) is ignored."""
        data = bytes([
            0x00, 0x00,
            0x6E, 0x00, 0x00,  # Only 3 bytes — need 4 for a DTC
        ])
        dtcs = decode_dm1(data)
        assert len(dtcs) == 0


class TestDecodeDM1Lamps:
    """Tests for decode_dm1_lamps — lamp status from DM1 first 2 bytes.

    Byte 0 bit layout (SAE J1939-73 Table A1):
      Bits 7-6: Protect Lamp
      Bits 5-4: Amber Warning Lamp
      Bits 3-2: Red Stop Lamp
      Bits 1-0: Malfunction Indicator Lamp (MIL)

    Each 2-bit field: 0=off, 1=on, 2=error, 3=not available
    """

    def test_all_lamps_off(self):
        lamps = decode_dm1_lamps(bytes([0x00, 0x00]))
        assert lamps["protect_lamp"] == 0
        assert lamps["amber_warning_lamp"] == 0
        assert lamps["red_stop_lamp"] == 0
        assert lamps["malfunction_lamp"] == 0

    def test_mil_on(self):
        """MIL on: bits 1-0 = 01 → byte 0 = 0x01"""
        lamps = decode_dm1_lamps(bytes([0x01, 0x00]))
        assert lamps["malfunction_lamp"] == 1

    def test_protect_lamp_on(self):
        """Protect on: bits 7-6 = 01 → byte 0 = 0x40"""
        lamps = decode_dm1_lamps(bytes([0x40, 0x00]))
        assert lamps["protect_lamp"] == 1

    def test_amber_warning_on(self):
        """Amber on: bits 5-4 = 01 → byte 0 = 0x10"""
        lamps = decode_dm1_lamps(bytes([0x10, 0x00]))
        assert lamps["amber_warning_lamp"] == 1

    def test_red_stop_on(self):
        """Red stop on: bits 3-2 = 01 → byte 0 = 0x04"""
        lamps = decode_dm1_lamps(bytes([0x04, 0x00]))
        assert lamps["red_stop_lamp"] == 1

    def test_all_lamps_on(self):
        """All lamps on: 0b01010101 = 0x55"""
        lamps = decode_dm1_lamps(bytes([0x55, 0x00]))
        assert lamps["protect_lamp"] == 1
        assert lamps["amber_warning_lamp"] == 1
        assert lamps["red_stop_lamp"] == 1
        assert lamps["malfunction_lamp"] == 1

    def test_mack_granite_scenario(self):
        """Mack Granite SCR failure: Protect lamp ON from both ECUs.
        Protect=01, others off → byte = 0x40
        """
        lamps = decode_dm1_lamps(bytes([0x40, 0x00]))
        assert lamps["protect_lamp"] == 1
        assert lamps["malfunction_lamp"] == 0

    def test_too_short_returns_empty(self):
        assert decode_dm1_lamps(bytes([0x00])) == {}
        assert decode_dm1_lamps(b"") == {}
