"""
OBD-II PID poller for standard (11-bit) CAN bus diagnostics.

Actively polls OBD-II PIDs on a 1-second loop using python-can.
Requests are sent on CAN ID 0x7DF (broadcast), responses read from 0x7E8.
This is completely separate from the J1939 passive listener.
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

# PID definitions: pid -> (name, field_key, decode_func)
# decode_func takes the data bytes (A, B, ...) after the PID byte
OBD2_PIDS: dict[int, tuple[str, str, callable]] = {
    0x0C: (
        "Engine RPM",
        "engine_rpm",
        lambda a, b: ((a * 256) + b) / 4.0,
    ),
    0x05: (
        "Coolant Temperature",
        "coolant_temp_f",
        lambda a: (a - 40) * 9.0 / 5.0 + 32,
    ),
    0x0D: (
        "Vehicle Speed",
        "vehicle_speed_mph",
        lambda a: a * 0.621371,
    ),
    0x11: (
        "Throttle Position",
        "throttle_position_pct",
        lambda a: a * 100 / 255.0,
    ),
    0x0F: (
        "Intake Air Temperature",
        "intake_air_temp_f",
        lambda a: (a - 40) * 9.0 / 5.0 + 32,
    ),
    0x2F: (
        "Fuel Level",
        "fuel_level_pct",
        lambda a: a * 100 / 255.0,
    ),
}

# Timeout per PID request
PID_TIMEOUT_S = 0.3

# Consecutive zero-response cycles before declaring bus disconnected
DISCONNECT_THRESHOLD = 5


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

    @property
    def bus_connected(self) -> bool:
        return self._bus_connected

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
            self._thread.start()
            LOGGER.info(
                f"OBD-II poller started on {self._can_interface} "
                f"at {self._bitrate} bps"
            )
        except Exception as e:
            LOGGER.error(f"Failed to start OBD-II poller: {e}")
            self._bus = None
            self._running = False

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
            return dict(self._readings)

    def _poll_loop(self):
        """Background thread: poll all PIDs once per second."""
        while self._running and self._bus:
            cycle_start = time.monotonic()
            responses_this_cycle = 0

            for pid in OBD2_PIDS:
                if not self._running:
                    break
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
