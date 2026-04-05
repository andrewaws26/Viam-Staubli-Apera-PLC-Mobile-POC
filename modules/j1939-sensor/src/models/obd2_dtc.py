"""
OBD-II DTC (Diagnostic Trouble Code) reader and clearer.

Handles Mode 03 (read active DTCs) and Mode 04 (clear DTCs / reset MIL).
"""

import time
from typing import Any

from viam.logging import getLogger

from .obd2_pids import OBD2_REQUEST_ID, OBD2_RESPONSE_ID

LOGGER = getLogger(__name__)

# OBD-II DTC P-code lookup
OBD2_DTC_PREFIXES = {0: "P0", 1: "P1", 2: "P2", 3: "P3"}


def decode_obd2_dtc(b1: int, b2: int) -> str:
    """Decode two bytes into a standard P-code (e.g. P0420)."""
    prefix_idx = (b1 >> 6) & 0x03
    prefix = OBD2_DTC_PREFIXES.get(prefix_idx, "P?")
    digit2 = (b1 >> 4) & 0x03
    digit3 = b1 & 0x0F
    digit4 = (b2 >> 4) & 0x0F
    digit5 = b2 & 0x0F
    return f"{prefix}{digit2}{digit3:X}{digit4:X}{digit5:X}"


class OBD2DTCReader:
    """Reads and clears OBD-II diagnostic trouble codes via Mode 03/04."""

    def __init__(self, bus: Any) -> None:
        self._bus = bus

    def read_dtcs(self) -> list[dict]:
        """Send Mode 03 request and decode active DTCs."""
        if not self._bus:
            return []

        try:
            import can
            msg = can.Message(
                arbitration_id=OBD2_REQUEST_ID,
                data=[0x01, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
                is_extended_id=False,
            )
            self._bus.send(msg)

            deadline = time.monotonic() + 0.5
            dtcs: list[dict] = []

            while time.monotonic() < deadline:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    break
                resp = self._bus.recv(timeout=remaining)
                if resp is None:
                    break
                if resp.arbitration_id not in (OBD2_RESPONSE_ID, 0x7E9, 0x7EA, 0x7EB):
                    continue
                if len(resp.data) < 2:
                    continue
                if resp.data[1] != 0x43:
                    continue

                num_dtcs = resp.data[2] if len(resp.data) > 2 else 0
                i = 3
                while i + 1 < len(resp.data) and len(dtcs) < num_dtcs:
                    b1, b2 = resp.data[i], resp.data[i + 1]
                    if b1 == 0 and b2 == 0:
                        i += 2
                        continue
                    code = decode_obd2_dtc(b1, b2)
                    dtcs.append({"code": code, "raw": f"0x{b1:02X}{b2:02X}"})
                    i += 2

            return dtcs

        except Exception as e:
            LOGGER.debug(f"OBD-II DTC read failed: {e}")
            return []

    def clear_dtcs(self) -> bool:
        """Send Mode 04 to clear all DTCs and reset MIL."""
        if not self._bus:
            return False

        try:
            import can
            msg = can.Message(
                arbitration_id=OBD2_REQUEST_ID,
                data=[0x01, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
                is_extended_id=False,
            )
            self._bus.send(msg)

            deadline = time.monotonic() + 1.0
            while time.monotonic() < deadline:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    break
                resp = self._bus.recv(timeout=remaining)
                if resp is None:
                    break
                if resp.arbitration_id == OBD2_RESPONSE_ID and len(resp.data) >= 2:
                    if resp.data[1] == 0x44:
                        LOGGER.info("OBD-II DTCs cleared successfully")
                        return True

            LOGGER.info("OBD-II Mode 04 sent (no confirmation received)")
            return True

        except Exception as e:
            LOGGER.error(f"OBD-II DTC clear failed: {e}")
            return False
