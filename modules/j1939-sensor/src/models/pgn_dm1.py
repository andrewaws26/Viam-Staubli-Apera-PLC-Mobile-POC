"""
J1939 DM1/DM2 Diagnostic Trouble Code (DTC) decoding.

Handles parsing of Active Diagnostic Trouble Codes (DM1, PGN 65226) and
Previously Active Diagnostic Trouble Codes (DM2, PGN 65227) per SAE J1939-73.

Each DTC contains a Suspect Parameter Number (SPN), Failure Mode Identifier
(FMI), and occurrence count.
"""



def decode_dm1(data: bytes) -> list[dict]:
    """
    Decode DM1 active diagnostic trouble codes.

    Returns a list of DTCs, each with SPN, FMI, and occurrence count.
    DM1 format: bytes 0-1 are lamp status, bytes 2+ are DTC entries (4 bytes each).
    """
    dtcs = []
    if len(data) < 2:
        return dtcs

    # Lamp status (SAE J1939-73 Table A1)
    # byte 0 bits 7-6: Protect Lamp
    # byte 0 bits 5-4: Amber Warning Lamp
    # byte 0 bits 3-2: Red Stop Lamp
    # byte 0 bits 1-0: Malfunction Indicator Lamp (MIL)

    # Each DTC is 4 bytes starting at byte 2
    i = 2
    while i + 3 < len(data):
        b0 = data[i]
        b1 = data[i + 1]
        b2 = data[i + 2]
        b3 = data[i + 3]

        # SPN is 19 bits: bits 7-0 of b0, bits 7-0 of b1, bits 7-5 of b2
        spn = b0 | (b1 << 8) | ((b2 >> 5) << 16)
        # FMI is 5 bits: bits 4-0 of b2
        fmi = b2 & 0x1F
        # Occurrence count is 7 bits: bits 6-0 of b3
        occurrence = b3 & 0x7F

        if spn != 0x7FFFF and fmi != 0x1F:  # skip "not available"
            dtcs.append({
                "spn": spn,
                "fmi": fmi,
                "occurrence": occurrence,
            })
        i += 4

    return dtcs


def decode_dm1_lamps(data: bytes) -> dict:
    """Decode DM1 lamp status from first 2 bytes (SAE J1939-73 Table A1)."""
    if len(data) < 2:
        return {}
    lamp_byte = data[0]
    return {
        "protect_lamp": (lamp_byte >> 6) & 0x03,
        "amber_warning_lamp": (lamp_byte >> 4) & 0x03,
        "red_stop_lamp": (lamp_byte >> 2) & 0x03,
        "malfunction_lamp": lamp_byte & 0x03,
    }
