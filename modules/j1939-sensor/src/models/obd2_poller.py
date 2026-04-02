"""
OBD-II PID poller for standard (11-bit) CAN bus diagnostics.

Actively polls OBD-II PIDs on a 1-second loop using python-can.
Requests are sent on CAN ID 0x7DF (broadcast), responses read from 0x7E8.
This is completely separate from the J1939 passive listener.

All temperature readings are in Fahrenheit, pressures in PSI, speed in mph.
"""

import threading
import time
from typing import Any

from viam.logging import getLogger

LOGGER = getLogger(__name__)

# OBD-II CAN IDs
OBD2_REQUEST_ID = 0x7DF
OBD2_RESPONSE_ID = 0x7E8

# OBD-II service 01 (show current data)
OBD2_SERVICE_CURRENT = 0x01
OBD2_RESPONSE_SERVICE = 0x41

# Helper conversions
_C_TO_F = lambda c: c * 9.0 / 5.0 + 32
_KPA_TO_PSI = lambda kpa: kpa * 0.145038
_KPH_TO_MPH = lambda kph: kph * 0.621371
_KM_TO_MI = lambda km: km * 0.621371

# PID definitions: pid -> (name, field_key, decode_func)
# decode_func takes the data bytes (A, B, ...) after the PID byte
OBD2_PIDS: dict[int, tuple[str, str, callable]] = {
    0x01: (
        "Monitor Status",
        "monitor_status_raw",
        lambda a, b, c, d: a,  # byte A has MIL bit and DTC count
    ),
    0x03: (
        "Fuel System Status",
        "fuel_system_status",
        lambda a: a,
    ),
    0x04: (
        "Engine Load",
        "engine_load_pct",
        lambda a: a * 100 / 255.0,
    ),
    0x05: (
        "Coolant Temperature",
        "coolant_temp_f",
        lambda a: _C_TO_F(a - 40),
    ),
    0x06: (
        "Short Term Fuel Trim B1",
        "short_fuel_trim_b1_pct",
        lambda a: (a - 128) * 100 / 128.0,
    ),
    0x07: (
        "Long Term Fuel Trim B1",
        "long_fuel_trim_b1_pct",
        lambda a: (a - 128) * 100 / 128.0,
    ),
    0x0A: (
        "Fuel Pressure",
        "fuel_pump_pressure_psi",
        lambda a: _KPA_TO_PSI(a * 3),
    ),
    0x0B: (
        "Intake Manifold Pressure",
        "boost_pressure_psi",
        lambda a: _KPA_TO_PSI(a),
    ),
    0x0C: (
        "Engine RPM",
        "engine_rpm",
        lambda a, b: ((a * 256) + b) / 4.0,
    ),
    0x0D: (
        "Vehicle Speed",
        "vehicle_speed_mph",
        lambda a: _KPH_TO_MPH(a),
    ),
    0x0E: (
        "Timing Advance",
        "timing_advance_deg",
        lambda a: (a - 128) / 2.0,
    ),
    0x0F: (
        "Intake Air Temperature",
        "intake_air_temp_f",
        lambda a: _C_TO_F(a - 40),
    ),
    0x10: (
        "MAF Air Flow Rate",
        "maf_flow_gps",
        lambda a, b: ((a * 256) + b) / 100.0,
    ),
    0x11: (
        "Throttle Position",
        "throttle_position_pct",
        lambda a: a * 100 / 255.0,
    ),
    0x12: (
        "Commanded Secondary Air Status",
        "secondary_air_status",
        lambda a: a,
    ),
    0x14: (
        "O2 Sensor Voltage B1S1",
        "o2_voltage_b1s1_v",
        lambda a: a / 200.0,
    ),
    0x1C: (
        "OBD Standard",
        "obd_standard",
        lambda a: a,
    ),
    0x1F: (
        "Runtime Since Engine Start",
        "runtime_seconds",
        lambda a, b: (a * 256) + b,
    ),
    0x21: (
        "Distance with MIL On",
        "distance_with_mil_mi",
        lambda a, b: _KM_TO_MI((a * 256) + b),
    ),
    0x23: (
        "Fuel Rail Gauge Pressure",
        "fuel_pressure_psi",
        lambda a, b: _KPA_TO_PSI(((a * 256) + b) * 10),
    ),
    0x2E: (
        "EVAP System Vapor Pressure",
        "evap_pressure_pa",
        lambda a, b: ((a * 256) + b) / 4.0 - 8192,
    ),
    0x2F: (
        "Fuel Level",
        "fuel_level_pct",
        lambda a: a * 100 / 255.0,
    ),
    0x30: (
        "Warmup Cycles Since Clear",
        "warmup_cycles_since_clear",
        lambda a: a,
    ),
    0x31: (
        "Distance Since Codes Cleared",
        "distance_since_clear_mi",
        lambda a, b: _KM_TO_MI((a * 256) + b),
    ),
    0x33: (
        "Barometric Pressure",
        "barometric_pressure_psi",
        lambda a: _KPA_TO_PSI(a),
    ),
    0x3C: (
        "Catalyst Temp B1S1",
        "catalyst_temp_b1s1_f",
        lambda a, b: _C_TO_F(((a * 256) + b) / 10.0 - 40),
    ),
    0x42: (
        "Control Module Voltage",
        "battery_voltage_v",
        lambda a, b: ((a * 256) + b) / 1000.0,
    ),
    0x43: (
        "Absolute Load",
        "absolute_load_pct",
        lambda a, b: ((a * 256) + b) * 100 / 255.0,
    ),
    0x44: (
        "Commanded Equiv Ratio",
        "commanded_equiv_ratio",
        lambda a, b: ((a * 256) + b) / 32768.0,
    ),
    0x45: (
        "Relative Throttle Position",
        "relative_throttle_pct",
        lambda a: a * 100 / 255.0,
    ),
    0x46: (
        "Ambient Air Temperature",
        "ambient_temp_f",
        lambda a: _C_TO_F(a - 40),
    ),
    0x49: (
        "Accelerator Pedal Position D",
        "accel_pedal_pos_pct",
        lambda a: a * 100 / 255.0,
    ),
    0x4C: (
        "Commanded Throttle Actuator",
        "commanded_throttle_pct",
        lambda a: a * 100 / 255.0,
    ),
    0x4D: (
        "Runtime with MIL On",
        "runtime_with_mil_min",
        lambda a, b: (a * 256) + b,
    ),
    0x4E: (
        "Time Since Codes Cleared",
        "time_since_clear_min",
        lambda a, b: (a * 256) + b,
    ),
    0x52: (
        "Ethanol Fuel %",
        "ethanol_fuel_pct",
        lambda a: a * 100 / 255.0,
    ),
    0x55: (
        "Short Term Fuel Trim B2",
        "short_fuel_trim_b2_pct",
        lambda a: (a - 128) * 100 / 128.0,
    ),
    0x57: (
        "Long Term Fuel Trim B2",
        "long_fuel_trim_b2_pct",
        lambda a: (a - 128) * 100 / 128.0,
    ),
    0x5C: (
        "Oil Temperature",
        "oil_temp_f",
        lambda a: _C_TO_F(a - 40),
    ),
    0x5E: (
        "Engine Fuel Rate",
        "fuel_rate_gph",
        lambda a, b: ((a * 256) + b) / 20.0 * 0.264172,
    ),
}

# Timeout per PID request
PID_TIMEOUT_S = 0.3

# Consecutive zero-response cycles before declaring bus disconnected
DISCONNECT_THRESHOLD = 5


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


class OBD2Poller:
    """
    Polls OBD-II PIDs on a 1-second cycle via python-can.

    Thread-safe: readings are stored behind a lock and retrieved via
    get_readings(). The poller runs in a daemon thread.
    """

    def __init__(self, can_interface: str, bus_type: str, bitrate: int):
        self._can_interface = can_interface
        self._bus_type = bus_type
        self._bitrate = bitrate
        self._bus = None
        self._thread: threading.Thread | None = None
        self._running = False
        self._readings: dict[str, Any] = {}
        self._readings_lock = threading.Lock()
        self._bus_connected = False
        self._consecutive_empty_cycles = 0
        self._poll_count = 0
        self._rpm_history: list[float] = []
        self._dtc_reader = None
        self._advanced_diag = None
        self._dtcs: list[dict] = []
        # Adaptive polling: if set, only poll these PIDs
        self._supported_pids: set[int] | None = None

    @property
    def bus_connected(self) -> bool:
        return self._bus_connected

    def set_supported_pids(self, pids: list[int]) -> None:
        """Restrict polling to only the given PIDs.

        Called after PID discovery completes.  Passing an empty list
        disables adaptive filtering (polls all configured PIDs).
        """
        if pids:
            self._supported_pids = set(pids)
            LOGGER.info(
                "Adaptive polling: restricted to %d supported PIDs", len(pids),
            )
        else:
            self._supported_pids = None
            LOGGER.info("Adaptive polling: disabled, polling all PIDs")

    def get_configured_pids(self) -> list[int]:
        """Return the full list of PID numbers this poller is configured to poll."""
        return sorted(OBD2_PIDS.keys())

    def start(self):
        """Open CAN bus and start the polling thread."""
        try:
            import can
            self._bus = can.Bus(
                channel=self._can_interface,
                interface=self._bus_type,
                bitrate=self._bitrate,
                receive_own_messages=False,
            )
            self._running = True
            self._thread = threading.Thread(
                target=self._poll_loop,
                daemon=True,
                name=f"obd2-poller-{self._can_interface}",
            )
            self._dtc_reader = OBD2DTCReader(self._bus)
            self._advanced_diag = OBD2AdvancedDiag(self._bus)
            self._thread.start()
            LOGGER.info(
                f"OBD-II poller started on {self._can_interface} "
                f"at {self._bitrate} bps"
            )
        except Exception as e:
            LOGGER.error(f"Failed to start OBD-II poller: {e}")
            self._bus = None
            self._running = False

    def clear_dtcs(self) -> dict:
        """Clear OBD-II DTCs via Mode 04."""
        if self._dtc_reader:
            success = self._dtc_reader.clear_dtcs()
            if success:
                self._dtcs = []
            return {"success": success, "message": "OBD-II DTCs cleared" if success else "Clear failed"}
        return {"success": False, "error": "No DTC reader available"}

    def get_vin(self) -> str:
        """Return the vehicle VIN, reading it once and caching the result."""
        if not hasattr(self, '_cached_vin'):
            self._cached_vin = ""
        if self._cached_vin:
            return self._cached_vin
        if self._advanced_diag:
            vin = self._advanced_diag.get_vin()
            if vin and len(vin) >= 10:
                self._cached_vin = vin
            return vin
        return ""

    def stop(self):
        """Stop the polling thread and shut down the CAN bus."""
        self._running = False
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=3.0)
        if self._bus:
            try:
                self._bus.shutdown()
            except Exception:
                pass
            self._bus = None

    def get_readings(self) -> dict[str, Any]:
        """Return a copy of the latest OBD-II readings."""
        with self._readings_lock:
            readings = dict(self._readings)
            # Add DTC info
            readings["active_dtc_count"] = len(self._dtcs)
            for i, dtc in enumerate(self._dtcs[:5]):
                readings[f"obd2_dtc_{i}"] = dtc["code"]

            # --- Calculated values ---
            # Total fuel trim (short + long combined)
            short_trim = readings.get("short_fuel_trim_b1_pct", 0)
            long_trim = readings.get("long_fuel_trim_b1_pct", 0)
            if isinstance(short_trim, (int, float)) and isinstance(long_trim, (int, float)):
                readings["total_fuel_trim_b1_pct"] = round(short_trim + long_trim, 2)

            # Estimated MPG (from MAF, speed, and stoichiometric ratio)
            maf = readings.get("maf_flow_gps")
            speed = readings.get("vehicle_speed_mph")
            if isinstance(maf, (int, float)) and isinstance(speed, (int, float)) and maf > 0 and speed > 0:
                # fuel rate in gal/hr = MAF (g/s) * 3600 / (14.7 * 6.17 * 454)
                # 14.7 = stoich ratio, 6.17 lb/gal gasoline density, 454 g/lb
                fuel_rate_gph_calc = maf * 3600 / (14.7 * 6.17 * 454)
                if fuel_rate_gph_calc > 0:
                    readings["estimated_mpg"] = round(speed / fuel_rate_gph_calc, 1)
                    readings["calc_fuel_rate_gph"] = round(fuel_rate_gph_calc, 3)

            # RPM stability (variance over recent readings for misfire detection)
            rpm = readings.get("engine_rpm")
            if isinstance(rpm, (int, float)):
                if not hasattr(self, '_rpm_history'):
                    self._rpm_history = []
                self._rpm_history.append(rpm)
                if len(self._rpm_history) > 30:
                    self._rpm_history = self._rpm_history[-30:]
                if len(self._rpm_history) >= 5:
                    avg_rpm = sum(self._rpm_history) / len(self._rpm_history)
                    variance = sum((r - avg_rpm) ** 2 for r in self._rpm_history) / len(self._rpm_history)
                    readings["rpm_stability_pct"] = round(100 - min(100, (variance ** 0.5) / max(avg_rpm, 1) * 100), 1)

            # MIL status from monitor_status_raw
            monitor_raw = readings.get("monitor_status_raw")
            if isinstance(monitor_raw, (int, float)):
                readings["mil_on"] = bool(int(monitor_raw) & 0x80)
                readings["dtc_count_ecu"] = int(monitor_raw) & 0x7F

            # Volumetric efficiency (assumes 2.5L engine for Altima, configurable later)
            # VE% = (MAF * 2 * 60) / (RPM * displacement_L * air_density_g_per_L)
            # air_density at sea level ~1.184 g/L
            if isinstance(maf, (int, float)) and isinstance(rpm, (int, float)) and rpm > 0 and maf > 0:
                displacement_L = 2.5  # Altima QR25DE
                air_density = 1.184
                ve = (maf * 2 * 60) / (rpm * displacement_L * air_density) * 100
                readings["volumetric_efficiency_pct"] = round(min(ve, 120), 1)  # cap at 120% (forced induction)

            return readings

    def _poll_loop(self):
        """Background thread: poll all PIDs once per second."""
        while self._running and self._bus:
            cycle_start = time.monotonic()
            responses_this_cycle = 0

            for pid in OBD2_PIDS:
                if not self._running:
                    break
                # Adaptive polling: skip PIDs the vehicle doesn't support
                if self._supported_pids is not None and pid not in self._supported_pids:
                    continue
                result = self._request_pid(pid)
                if result is not None:
                    field_key = OBD2_PIDS[pid][1]
                    with self._readings_lock:
                        self._readings[field_key] = result
                    responses_this_cycle += 1

            # Update bus connection status
            if responses_this_cycle > 0:
                self._bus_connected = True
                self._consecutive_empty_cycles = 0
            else:
                self._consecutive_empty_cycles += 1
                if self._consecutive_empty_cycles >= DISCONNECT_THRESHOLD:
                    self._bus_connected = False

            self._poll_count += 1

            # Read DTCs every 10 cycles (~10 seconds)
            if self._poll_count % 10 == 1 and self._dtc_reader:
                self._dtcs = self._dtc_reader.read_dtcs()

            # Sleep remainder of the 1-second cycle
            elapsed = time.monotonic() - cycle_start
            sleep_time = max(0, 1.0 - elapsed)
            if sleep_time > 0 and self._running:
                # Sleep in small increments so we can stop promptly
                end = time.monotonic() + sleep_time
                while self._running and time.monotonic() < end:
                    time.sleep(min(0.1, end - time.monotonic()))

    def _request_pid(self, pid: int) -> Any | None:
        """
        Send an OBD-II request for a single PID and decode the response.

        Returns the decoded value, or None if no response within timeout.
        """
        if not self._bus:
            return None

        try:
            import can

            # OBD-II request: [num_bytes, service, pid, 0x55 padding...]
            data = [0x02, OBD2_SERVICE_CURRENT, pid, 0x55, 0x55, 0x55, 0x55, 0x55]
            msg = can.Message(
                arbitration_id=OBD2_REQUEST_ID,
                data=data,
                is_extended_id=False,
            )
            self._bus.send(msg)

            # Read responses until timeout
            deadline = time.monotonic() + PID_TIMEOUT_S
            while time.monotonic() < deadline:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    break
                resp = self._bus.recv(timeout=remaining)
                if resp is None:
                    break
                if resp.arbitration_id != OBD2_RESPONSE_ID:
                    continue
                if len(resp.data) < 3:
                    continue
                if resp.data[1] != OBD2_RESPONSE_SERVICE:
                    continue
                if resp.data[2] != pid:
                    continue

                # Found our response — decode it
                return self._decode_pid(pid, resp.data)

        except Exception as e:
            LOGGER.debug(f"OBD-II PID 0x{pid:02X} request failed: {e}")

        return None

    def _decode_pid(self, pid: int, data: bytes) -> Any | None:
        """Decode a PID response using the registered formula."""
        entry = OBD2_PIDS.get(pid)
        if entry is None:
            return None

        _, _, decode_fn = entry

        try:
            # Data bytes start at index 3 (after length, service+0x40, pid)
            data_bytes = data[3:]
            # Inspect how many args the decode function expects
            code = decode_fn.__code__
            n_args = code.co_argcount
            args = list(data_bytes[:n_args])
            if len(args) < n_args:
                return None
            return round(decode_fn(*args), 2)
        except Exception as e:
            LOGGER.debug(f"OBD-II PID 0x{pid:02X} decode error: {e}")
            return None


class OBD2DTCReader:
    """Reads and clears OBD-II diagnostic trouble codes via Mode 03/04."""

    def __init__(self, bus):
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
            dtcs = []

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


class OBD2AdvancedDiag:
    """Advanced OBD-II diagnostic queries — freeze frame, readiness, VIN, pending DTCs."""

    def __init__(self, bus):
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

            responses = []
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

    def get_readiness_monitors(self) -> dict:
        """Query Mode 01 PID 0x41 — readiness monitors status."""
        responses = self._send_and_receive(0x01, 0x41)
        result = {"supported": [], "complete": [], "incomplete": []}

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

    def get_freeze_frame(self) -> dict:
        """Query Mode 02 — freeze frame data captured when DTC was set."""
        freeze = {}
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
        """Query Mode 07 — pending DTCs (codes forming but MIL not on yet)."""
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

            dtcs = []
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
        """Query Mode 0A — permanent DTCs (cannot be cleared with scan tool)."""
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

            dtcs = []
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
        """Query Mode 09 PID 02 — Vehicle Identification Number."""
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
