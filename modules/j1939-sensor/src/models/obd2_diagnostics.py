"""
OBD-II advanced diagnostic queries.

Freeze frame data (Mode 02), readiness monitors (Mode 01 PID 0x41),
VIN (Mode 09 PID 02), pending DTCs (Mode 07), and permanent DTCs (Mode 0A).

All temperature readings are in Fahrenheit, speeds in mph (US imperial).
"""

import time
from typing import Any

from viam.logging import getLogger

from .obd2_pids import OBD2_REQUEST_ID, OBD2_RESPONSE_ID
from .obd2_dtc import decode_obd2_dtc

LOGGER = getLogger(__name__)


class OBD2AdvancedDiag:
    """Advanced OBD-II diagnostic queries -- freeze frame, readiness, VIN, pending DTCs."""

    def __init__(self, bus: Any) -> None:
        self._bus = bus

    def _send_and_receive(self, service: int, pid: int, timeout: float = 1.0) -> list[bytes]:
        """Send OBD-II request and collect all response frames."""
        if not self._bus:
            return []
        try:
            import can
            data = [0x02, service, pid, 0x55, 0x55, 0x55, 0x55, 0x55]
            msg = can.Message(arbitration_id=OBD2_REQUEST_ID, data=data, is_extended_id=False)
            self._bus.send(msg)

            responses: list[bytes] = []
            deadline = time.monotonic() + timeout
            while time.monotonic() < deadline:
                resp = self._bus.recv(timeout=deadline - time.monotonic())
                if resp is None:
                    break
                if resp.arbitration_id in (OBD2_RESPONSE_ID, 0x7E9, 0x7EA, 0x7EB):
                    responses.append(resp.data)
            return responses
        except Exception as e:
            LOGGER.debug(f"OBD-II advanced query failed: {e}")
            return []

    def get_readiness_monitors(self) -> dict[str, Any]:
        """Query Mode 01 PID 0x41 -- readiness monitors status."""
        responses = self._send_and_receive(0x01, 0x41)
        result: dict[str, Any] = {"supported": [], "complete": [], "incomplete": []}

        for resp in responses:
            if len(resp) < 6 or resp[1] != 0x41 or resp[2] != 0x41:
                continue
            b3, b4, b5 = resp[3], resp[4], resp[5]

            monitors = [
                ("Misfire", b3 & 0x01, b3 & 0x10),
                ("Fuel System", b3 & 0x02, b3 & 0x20),
                ("Components", b3 & 0x04, b3 & 0x40),
                ("Catalyst", b4 & 0x01, b5 & 0x01),
                ("Heated Catalyst", b4 & 0x02, b5 & 0x02),
                ("EVAP System", b4 & 0x04, b5 & 0x04),
                ("Secondary Air", b4 & 0x08, b5 & 0x08),
                ("A/C Refrigerant", b4 & 0x10, b5 & 0x10),
                ("O2 Sensor", b4 & 0x20, b5 & 0x20),
                ("O2 Heater", b4 & 0x40, b5 & 0x40),
                ("EGR/VVT", b4 & 0x80, b5 & 0x80),
            ]

            for name, supported, complete in monitors:
                if supported:
                    result["supported"].append(name)
                    if complete:
                        result["incomplete"].append(name)
                    else:
                        result["complete"].append(name)
            break

        result["ready_for_inspection"] = len(result["incomplete"]) <= 1
        result["total_supported"] = len(result["supported"])
        result["total_complete"] = len(result["complete"])
        result["total_incomplete"] = len(result["incomplete"])
        return result

    def get_freeze_frame(self) -> dict[str, Any]:
        """Query Mode 02 -- freeze frame data captured when DTC was set."""
        freeze: dict[str, Any] = {}
        pids_to_query = [
            (0x02, "dtc_that_triggered"),
            (0x04, "engine_load_pct"),
            (0x05, "coolant_temp_f"),
            (0x06, "short_fuel_trim_pct"),
            (0x07, "long_fuel_trim_pct"),
            (0x0C, "engine_rpm"),
            (0x0D, "vehicle_speed_mph"),
            (0x0E, "timing_advance_deg"),
            (0x0F, "intake_air_temp_f"),
            (0x11, "throttle_pct"),
        ]

        for pid, key in pids_to_query:
            responses = self._send_and_receive(0x02, pid, timeout=0.5)
            for resp in responses:
                if len(resp) < 4 or resp[1] != 0x42:
                    continue
                if resp[2] != pid:
                    continue

                if key == "dtc_that_triggered" and len(resp) >= 6:
                    b1, b2 = resp[4], resp[5]
                    if b1 != 0 or b2 != 0:
                        freeze[key] = decode_obd2_dtc(b1, b2)
                elif key == "engine_rpm" and len(resp) >= 6:
                    freeze[key] = round(((resp[4] * 256) + resp[5]) / 4.0, 1)
                elif key == "vehicle_speed_mph" and len(resp) >= 5:
                    freeze[key] = round(resp[4] * 0.621371, 1)
                elif key == "coolant_temp_f" and len(resp) >= 5:
                    freeze[key] = round((resp[4] - 40) * 9.0 / 5.0 + 32, 1)
                elif key == "intake_air_temp_f" and len(resp) >= 5:
                    freeze[key] = round((resp[4] - 40) * 9.0 / 5.0 + 32, 1)
                elif key == "engine_load_pct" and len(resp) >= 5:
                    freeze[key] = round(resp[4] * 100 / 255.0, 1)
                elif key == "throttle_pct" and len(resp) >= 5:
                    freeze[key] = round(resp[4] * 100 / 255.0, 1)
                elif key == "timing_advance_deg" and len(resp) >= 5:
                    freeze[key] = round((resp[4] - 128) / 2.0, 1)
                elif key in ("short_fuel_trim_pct", "long_fuel_trim_pct") and len(resp) >= 5:
                    freeze[key] = round((resp[4] - 128) * 100 / 128.0, 1)
                break

        return freeze

    def get_pending_dtcs(self) -> list[dict]:
        """Query Mode 07 -- pending DTCs (codes forming but MIL not on yet)."""
        if not self._bus:
            return []
        try:
            import can
            msg = can.Message(
                arbitration_id=OBD2_REQUEST_ID,
                data=[0x01, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
                is_extended_id=False,
            )
            self._bus.send(msg)

            dtcs: list[dict] = []
            deadline = time.monotonic() + 0.5
            while time.monotonic() < deadline:
                resp = self._bus.recv(timeout=deadline - time.monotonic())
                if resp is None:
                    break
                if resp.arbitration_id not in (OBD2_RESPONSE_ID, 0x7E9, 0x7EA, 0x7EB):
                    continue
                if len(resp.data) < 2 or resp.data[1] != 0x47:
                    continue
                i = 3
                while i + 1 < len(resp.data):
                    b1, b2 = resp.data[i], resp.data[i + 1]
                    if b1 == 0 and b2 == 0:
                        i += 2
                        continue
                    dtcs.append({"code": decode_obd2_dtc(b1, b2), "status": "pending"})
                    i += 2
            return dtcs
        except Exception as e:
            LOGGER.debug(f"Pending DTC query failed: {e}")
            return []

    def get_permanent_dtcs(self) -> list[dict]:
        """Query Mode 0A -- permanent DTCs (cannot be cleared with scan tool)."""
        if not self._bus:
            return []
        try:
            import can
            msg = can.Message(
                arbitration_id=OBD2_REQUEST_ID,
                data=[0x01, 0x0A, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
                is_extended_id=False,
            )
            self._bus.send(msg)

            dtcs: list[dict] = []
            deadline = time.monotonic() + 0.5
            while time.monotonic() < deadline:
                resp = self._bus.recv(timeout=deadline - time.monotonic())
                if resp is None:
                    break
                if resp.arbitration_id not in (OBD2_RESPONSE_ID, 0x7E9, 0x7EA, 0x7EB):
                    continue
                if len(resp.data) < 2 or resp.data[1] != 0x4A:
                    continue
                i = 3
                while i + 1 < len(resp.data):
                    b1, b2 = resp.data[i], resp.data[i + 1]
                    if b1 == 0 and b2 == 0:
                        i += 2
                        continue
                    dtcs.append({"code": decode_obd2_dtc(b1, b2), "status": "permanent"})
                    i += 2
            return dtcs
        except Exception as e:
            LOGGER.debug(f"Permanent DTC query failed: {e}")
            return []

    def get_vin(self) -> str:
        """Query Mode 09 PID 02 -- Vehicle Identification Number."""
        if not self._bus:
            return ""
        try:
            import can
            msg = can.Message(
                arbitration_id=OBD2_REQUEST_ID,
                data=[0x02, 0x09, 0x02, 0x55, 0x55, 0x55, 0x55, 0x55],
                is_extended_id=False,
            )
            self._bus.send(msg)

            vin_bytes = bytearray()
            deadline = time.monotonic() + 2.0
            while time.monotonic() < deadline:
                resp = self._bus.recv(timeout=deadline - time.monotonic())
                if resp is None:
                    break
                if resp.arbitration_id not in (OBD2_RESPONSE_ID, 0x7E9):
                    continue
                if resp.data[0] & 0xF0 == 0x10:  # First frame
                    vin_bytes.extend(resp.data[5:])
                    fc = can.Message(arbitration_id=0x7E0, data=[0x30, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00], is_extended_id=False)
                    self._bus.send(fc)
                elif resp.data[0] & 0xF0 == 0x20:  # Consecutive frame
                    vin_bytes.extend(resp.data[1:])
                elif resp.data[1] == 0x49 and resp.data[2] == 0x02:  # Single frame
                    vin_bytes.extend(resp.data[4:])

            vin = vin_bytes.decode("ascii", errors="replace").strip().replace("\x00", "")
            return vin[:17] if len(vin) >= 17 else vin
        except Exception as e:
            LOGGER.debug(f"VIN query failed: {e}")
            return ""
