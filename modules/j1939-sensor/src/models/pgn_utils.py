"""
J1939 PGN utility functions and data structures.

Provides byte extraction helpers, scaling/conversion utilities, and the
SPNDefinition / PGNDefinition dataclasses used throughout the PGN decoder.

These are low-level building blocks with no dependency on specific PGN
definitions or the PGN registry.
"""

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

# J1939 "not available" sentinel values per data size
NOT_AVAILABLE_BYTE = 0xFF
NOT_AVAILABLE_WORD = 0xFFFF
NOT_AVAILABLE_DWORD = 0xFFFFFFFF

# J1939 "error" sentinel values
ERROR_BYTE = 0xFE
ERROR_WORD = 0xFFFE
ERROR_DWORD = 0xFFFFFFFE


@dataclass
class SPNDefinition:
    """Suspect Parameter Number definition."""
    spn: int
    name: str
    key: str  # short key for get_readings() output
    start_byte: int
    length_bits: int  # 8 = 1 byte, 16 = 2 bytes
    resolution: float
    offset: float
    unit: str
    decode_fn: Callable[[bytes], Any] | None = None


@dataclass
class PGNDefinition:
    """Parameter Group Number definition with its SPNs."""
    pgn: int
    name: str
    spns: list  # list of SPNDefinition


def _get_byte(data: bytes, index: int) -> int | None:
    """Extract a single byte, returning None if not available or error."""
    if index >= len(data):
        return None
    val = data[index]
    if val in (NOT_AVAILABLE_BYTE, ERROR_BYTE):
        return None
    return val


def _get_word_le(data: bytes, low_index: int) -> int | None:
    """Extract a 16-bit little-endian word, returning None if not available."""
    if low_index + 1 >= len(data):
        return None
    val = data[low_index] | (data[low_index + 1] << 8)
    if val in (NOT_AVAILABLE_WORD, ERROR_WORD):
        return None
    return val


def _get_dword_le(data: bytes, start_index: int) -> int | None:
    """Extract a 32-bit little-endian dword, returning None if not available."""
    if start_index + 3 >= len(data):
        return None
    val = (data[start_index]
           | (data[start_index + 1] << 8)
           | (data[start_index + 2] << 16)
           | (data[start_index + 3] << 24))
    if val in (NOT_AVAILABLE_DWORD, ERROR_DWORD):
        return None
    return val


def _decode_scaled(data: bytes, start_byte: int, length_bits: int,
                   resolution: float, offset: float) -> float | None:
    """Generic decoder: extract value and apply resolution + offset."""
    if length_bits == 8:
        raw = _get_byte(data, start_byte)
    elif length_bits == 16:
        raw = _get_word_le(data, start_byte)
    elif length_bits == 32:
        raw = _get_dword_le(data, start_byte)
    else:
        return None
    if raw is None:
        return None
    return round(raw * resolution + offset, 4)


def _decode_2bit_status(data: bytes, byte_idx: int, bit_offset: int) -> bool | None:
    """Decode a J1939 2-bit status field. 00=off, 01=on, 10=error, 11=N/A."""
    val = _get_byte(data, byte_idx)
    if val is None:
        return None
    bits = (val >> bit_offset) & 0x03
    if bits == 3:
        return None  # not available
    return bits == 1  # 1 = active/on


def extract_pgn_from_can_id(can_id: int) -> int:
    """
    Extract the PGN from a 29-bit extended CAN ID.

    J1939 CAN ID format (29 bits):
      Priority(3) | Reserved(1) | Data Page(1) | PDU Format(8) | PDU Specific(8) | Source Address(8)

    If PDU Format < 240 (peer-to-peer), PGN = PDU Format << 8
    If PDU Format >= 240 (broadcast), PGN = (PDU Format << 8) | PDU Specific
    """
    pdu_format = (can_id >> 16) & 0xFF
    pdu_specific = (can_id >> 8) & 0xFF
    data_page = (can_id >> 24) & 0x01
    reserved = (can_id >> 25) & 0x01

    if pdu_format < 240:
        pgn = (reserved << 17) | (data_page << 16) | (pdu_format << 8)
    else:
        pgn = (reserved << 17) | (data_page << 16) | (pdu_format << 8) | pdu_specific

    return pgn


def extract_source_address(can_id: int) -> int:
    """Extract the source address (SA) from a 29-bit CAN ID."""
    return can_id & 0xFF


def _decode_temp_f(data: bytes, start_byte: int, length_bits: int,
                   resolution: float, offset_c: float) -> float | None:
    """Decode a temperature value and convert from Celsius to Fahrenheit."""
    celsius = _decode_scaled(data, start_byte, length_bits, resolution, offset_c)
    if celsius is None:
        return None
    return round(celsius * 9.0 / 5.0 + 32, 2)


def _decode_pressure_psi(data: bytes, start_byte: int, length_bits: int,
                         resolution: float, offset: float) -> float | None:
    """Decode a pressure value and convert from kPa to PSI."""
    kpa = _decode_scaled(data, start_byte, length_bits, resolution, offset)
    if kpa is None:
        return None
    return round(kpa * 0.145038, 2)
