"""Shared test fixtures for j1939-sensor tests.

These fixtures mock hardware dependencies (CAN bus, network interfaces)
so tests run without any physical hardware.
"""

import os
import sys
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

try:
    import can
except ImportError:
    can = None


@pytest.fixture
def mock_can_bus():
    """Mock python-can Bus that returns realistic J1939 frames."""
    bus = MagicMock()
    bus.recv.return_value = None  # Default: no frame
    bus.send.return_value = None
    bus.shutdown.return_value = None
    return bus


@pytest.fixture
def mock_can_message():
    """Factory for creating realistic CAN messages.

    Builds a 29-bit extended CAN ID from priority, PGN, and source address
    per J1939 encoding rules (PDU1 vs PDU2).
    """
    def _make(pgn, sa=0x00, data=None, priority=6, **kwargs):
        pf = (pgn >> 8) & 0xFF
        ps = pgn & 0xFF

        if pf < 240:
            # PDU1 (peer-to-peer): PS is destination, not part of PGN
            # Use 0xFF (broadcast) as default destination
            dest = kwargs.pop("destination", 0xFF)
            arbitration_id = (priority << 26) | (pf << 16) | (dest << 8) | sa
        else:
            # PDU2 (broadcast): PS is part of PGN
            arbitration_id = (priority << 26) | (pf << 16) | (ps << 8) | sa

        if can is not None:
            return can.Message(
                arbitration_id=arbitration_id,
                data=data or bytes(8),
                is_extended_id=True,
                **kwargs,
            )
        else:
            # Fallback mock if python-can is not installed
            msg = MagicMock()
            msg.arbitration_id = arbitration_id
            msg.data = data or bytes(8)
            msg.is_extended_id = True
            return msg

    return _make


@pytest.fixture
def sample_dm1_engine_frame(mock_can_message):
    """DM1 frame from engine (SA 0x00) with 1 active DTC: SPN 110, FMI 0.

    Byte layout:
      Byte 0-1: lamp status (MIL on = bit 0 of byte 0 set to 01)
      Byte 2-5: DTC (SPN 110, FMI 0, OC 3)
      Byte 6-7: padding (0xFF)
    """
    # SPN 110 = 0x6E
    # b0 = SPN[7:0]  = 0x6E
    # b1 = SPN[15:8]  = 0x00
    # b2 = SPN[18:16] in bits 7-5 = 0x00 | FMI in bits 4-0 = 0x00
    # b3 = occurrence = 3
    data = bytes([
        0x04, 0x00,             # MIL on (bits 1-0 of byte 0 = 01 not quite, 0x04 = protect lamp)
        0x6E, 0x00, 0x00, 0x03, # SPN 110, FMI 0, OC 3
        0xFF, 0xFF,             # padding
    ])
    return mock_can_message(pgn=65226, sa=0x00, data=data)


@pytest.fixture
def sample_dm1_trans_frame(mock_can_message):
    """DM1 frame from transmission (SA 0x03) with 1 active DTC.

    SPN 524, FMI 2, Occurrence 1.
    """
    # SPN 524 = 0x020C
    # b0 = SPN[7:0]  = 0x0C
    # b1 = SPN[15:8]  = 0x02
    # b2 = SPN[18:16] in bits 7-5 = 0 | FMI in bits 4-0 = 2 = 0x02
    # b3 = occurrence = 1
    data = bytes([
        0x00, 0x00,             # No lamps
        0x0C, 0x02, 0x02, 0x01, # SPN 524, FMI 2, OC 1
        0xFF, 0xFF,             # padding
    ])
    return mock_can_message(pgn=65226, sa=0x03, data=data)


@pytest.fixture
def sample_eec1_frame(mock_can_message):
    """EEC1 frame (PGN 61444) with RPM=1500, driver demand=80%, actual=78%.

    RPM 1500: 1500 / 0.125 = 12000 = 0x2EE0 LE: [0xE0, 0x2E]
    Driver demand 80%: 80 + 125 = 205 = 0xCD
    Actual torque 78%: 78 + 125 = 203 = 0xCB
    """
    data = bytes([0xCD, 0xCB, 0xFF, 0xE0, 0x2E, 0xFF, 0xFF, 0xFF])
    return mock_can_message(pgn=61444, sa=0x00, data=data)


@pytest.fixture
def sample_ccvs_frame(mock_can_message):
    """CCVS frame (PGN 65265) with vehicle speed ~100 km/h.

    Raw speed: 100 / 0.00390625 = 25600 = 0x6400 LE: [0x00, 0x64]
    (Note: actual field is vehicle_speed_mph, conversion applied by decoder.)
    """
    data = bytes([0xFF, 0x00, 0x64, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF])
    return mock_can_message(pgn=65265, sa=0x00, data=data)


@pytest.fixture
def sample_et1_frame(mock_can_message):
    """ET1 frame (PGN 65262) with coolant temp 90C, fuel temp 45C.

    Coolant: 90 + 40 = 130 = 0x82
    Fuel: 45 + 40 = 85 = 0x55
    """
    data = bytes([0x82, 0x55, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF])
    return mock_can_message(pgn=65262, sa=0x00, data=data)
