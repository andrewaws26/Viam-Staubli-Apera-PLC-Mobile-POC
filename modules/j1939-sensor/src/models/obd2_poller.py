"""
OBD-II PID poller for standard (11-bit) CAN bus diagnostics.

Main orchestrator: actively polls OBD-II PIDs on a 1-second loop using
python-can. Requests are sent on CAN ID 0x7DF (broadcast), responses
read from 0x7E8. This is completely separate from the J1939 passive listener.

All temperature readings are in Fahrenheit, pressures in PSI, speed in mph.

Sub-modules:
- obd2_pids: PID definitions, decode lambdas, constants
- obd2_dtc: DTC reader/clearer (Mode 03/04)
- obd2_diagnostics: Advanced diagnostics (freeze frame, readiness, VIN, etc.)
"""

import threading
import time
from typing import Any

from viam.logging import getLogger

from .obd2_diagnostics import OBD2AdvancedDiag
from .obd2_dtc import OBD2_DTC_PREFIXES, OBD2DTCReader, decode_obd2_dtc

# Re-export everything that external code imports from this module
from .obd2_pids import (
    DISCONNECT_THRESHOLD,
    OBD2_PIDS,
    OBD2_REQUEST_ID,
    OBD2_RESPONSE_ID,
    OBD2_RESPONSE_SERVICE,
    OBD2_SERVICE_CURRENT,
    PID_TIMEOUT_S,
)

LOGGER = getLogger(__name__)

# Make all re-exported names visible to `from obd2_poller import *`
__all__ = [
    "OBD2Poller",
    "OBD2DTCReader",
    "OBD2AdvancedDiag",
    "OBD2_PIDS",
    "OBD2_REQUEST_ID",
    "OBD2_RESPONSE_ID",
    "OBD2_SERVICE_CURRENT",
    "OBD2_RESPONSE_SERVICE",
    "PID_TIMEOUT_S",
    "DISCONNECT_THRESHOLD",
    "OBD2_DTC_PREFIXES",
    "decode_obd2_dtc",
]


class OBD2Poller:
    """
    Polls OBD-II PIDs on a 1-second cycle via python-can.

    Thread-safe: readings are stored behind a lock and retrieved via
    get_readings(). The poller runs in a daemon thread.
    """

    def __init__(self, can_interface: str, bus_type: str, bitrate: int) -> None:
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
        self._last_response_time = 0.0  # time.time() of last successful PID response
        self._rpm_history: list[float] = []
        self._dtc_reader: OBD2DTCReader | None = None
        self._advanced_diag: OBD2AdvancedDiag | None = None
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

    def start(self) -> None:
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

    def clear_dtcs(self) -> dict[str, Any]:
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

    def stop(self) -> None:
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

    def _reconnect_bus(self) -> bool:
        """Attempt to reopen the CAN bus after the interface was cycled."""
        if self._bus:
            try:
                self._bus.shutdown()
            except Exception:
                pass
            self._bus = None

        try:
            import can
            self._bus = can.Bus(
                channel=self._can_interface,
                interface=self._bus_type,
                bitrate=self._bitrate,
                receive_own_messages=False,
            )
            self._dtc_reader = OBD2DTCReader(self._bus)
            self._advanced_diag = OBD2AdvancedDiag(self._bus)
            LOGGER.info("OBD-II bus reconnected on %s", self._can_interface)
            return True
        except Exception as e:
            LOGGER.debug("OBD-II bus reconnect failed: %s", e)
            return False

    def _poll_loop(self) -> None:
        """Background thread: poll all PIDs once per second."""
        reconnect_backoff = 0
        while self._running:
            if not self._bus:
                # Bus was lost -- wait and try to reconnect
                reconnect_backoff = min(reconnect_backoff + 5, 30)
                end = time.monotonic() + reconnect_backoff
                while self._running and time.monotonic() < end:
                    time.sleep(0.5)
                if self._running:
                    self._reconnect_bus()
                continue

            cycle_start = time.monotonic()
            responses_this_cycle = 0
            bus_error = False

            for pid in OBD2_PIDS:
                if not self._running:
                    break
                # Adaptive polling: skip PIDs the vehicle doesn't support
                if self._supported_pids is not None and pid not in self._supported_pids:
                    continue
                try:
                    result = self._request_pid(pid)
                except OSError:
                    # Socket died (can0 was cycled by watchdog or went down)
                    bus_error = True
                    break
                if result is not None:
                    field_key = OBD2_PIDS[pid][1]
                    with self._readings_lock:
                        self._readings[field_key] = result
                    responses_this_cycle += 1

            if bus_error:
                LOGGER.warning("CAN bus socket error -- will reconnect")
                self._bus_connected = False
                if self._bus:
                    try:
                        self._bus.shutdown()
                    except Exception:
                        pass
                    self._bus = None
                reconnect_backoff = 0
                continue

            # Update bus connection status
            if responses_this_cycle > 0:
                self._bus_connected = True
                self._consecutive_empty_cycles = 0
                self._last_response_time = time.time()
                reconnect_backoff = 0
            else:
                self._consecutive_empty_cycles += 1
                if self._consecutive_empty_cycles >= DISCONNECT_THRESHOLD:
                    self._bus_connected = False
                # After extended disconnection, try reopening the socket
                # in case can0 was cycled by the watchdog
                if self._consecutive_empty_cycles >= DISCONNECT_THRESHOLD * 6:
                    LOGGER.info("Extended bus silence -- reopening CAN socket")
                    self._reconnect_bus()
                    self._consecutive_empty_cycles = 0

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

                # Found our response -- decode it
                return self._decode_pid(pid, resp.data)

        except OSError:
            raise  # Bus socket died -- let poll_loop handle reconnection
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
