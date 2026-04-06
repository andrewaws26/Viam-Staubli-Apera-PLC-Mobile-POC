"""
Viam sensor component for J1939 CAN bus truck diagnostics.

Reads J1939 data from a CAN interface (via Waveshare RS485 CAN HAT or similar),
decodes PGNs into human-readable parameters, and exposes them through
the Viam Sensor API for cloud data capture and monitoring.

Supports:
- All standard engine/vehicle J1939 PGNs (RPM, temps, pressures, fuel, etc.)
- Active DTC (Diagnostic Trouble Code) reading via DM1
- DTC clearing via DM11 (clear active DTCs on the dash)
- PGN request messages for on-demand data
- Configurable CAN interface, bitrate, and PGN filters
"""

import os as _os
import sys
import threading
import time
from collections.abc import Mapping
from typing import Any, ClassVar, Self

from viam.components.sensor import Sensor
from viam.logging import getLogger
from viam.proto.app.robot import ComponentConfig
from viam.proto.common import ResourceName
from viam.resource.base import ResourceBase
from viam.resource.types import Model, ModelFamily
from viam.utils import SensorReading

# Add parent dir for system_health import
sys.path.insert(0, _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
from system_health import get_system_health

from .j1939_can import (
    DEFAULT_BUFFER_DIR,
    DEFAULT_BUFFER_MAX_MB,
    DEFAULT_PROP_LOG_DIR,
    DEFAULT_PROP_LOG_MAX_MB,
    OfflineBuffer,
    ProprietaryPGNTracker,
    get_bus_stats,
    negotiate_bitrate,
    request_pgn,
    run_listen_loop,
    send_raw,
    start_can_listener,
)
from .j1939_discovery import (
    auto_detect_protocol,
    execute_protocol_switch,
    maybe_check_redetect,
    start_vin_reading,
)
from .j1939_dtc import clear_dtcs
from .j1939_fleet_metrics import (
    compute_fleet_metrics,
    get_history,
    get_minimal_off_readings,
    infer_vehicle_state,
)
from .obd2_poller import OBD2Poller
from .pgn_decoder import get_supported_pgns

LOGGER = getLogger(__name__)


class J1939TruckSensor(Sensor):
    """
    Viam sensor that reads J1939 CAN bus data from heavy-duty trucks.

    Configuration attributes:
        can_interface (str): CAN interface name. Default: "can0"
        bitrate (int): CAN bus bitrate. Default: 500000. NOTE: The Pi Zero
            production deploy MUST use 250000 (J1939). 500000 is the code default
            because the OBD-II path needs it. The Viam machine config overrides
            this — see config/fragment-tps-truck.json. NEVER change the Pi Zero
            config to 500000; see CLAUDE.md "Pi Zero CAN = 250kbps J1939 only".
        source_address (int): Our J1939 source address for sending. Default: 0xFE (null)
        pgn_filter (list[int]): Optional list of PGNs to capture. Empty = capture all known.
        include_raw (bool): Include raw hex data in readings. Default: false
        bus_type (str): python-can bus type. Default: "socketcan"
        protocol (str): "j1939" (default) or "obd2". Selects passive J1939 listener
            or active OBD-II PID polling mode.
    """

    MODEL: ClassVar[Model] = Model(
        ModelFamily("ironsight", "j1939-truck-sensor"), "can-sensor"
    )

    def __init__(self, name: str):
        super().__init__(name)
        self._bus = None
        self._listener_thread = None
        self._running = False
        self._readings: dict[str, Any] = {}
        self._readings_lock = threading.Lock()
        self._last_frame_time: float = 0
        self._frame_count: int = 0
        self._can_interface = "can0"
        self._bitrate = 500000  # Overridden by config; Pi Zero uses 250000 (J1939)
        self._source_address = 0xFE
        self._pgn_filter: set[int] = set()
        self._include_raw = False
        self._bus_type = "socketcan"
        self._protocol = "j1939"
        self._obd2_poller: OBD2Poller | None = None
        self._config_protocol = "j1939"  # raw config value before auto-detect
        # Protocol re-detection state (auto mode only)
        self._redetect_extended = 0
        self._redetect_standard = 0
        self._redetect_mismatch_count = 0
        self._last_redetect_check = 0.0
        self._pending_protocol_switch: str | None = None
        # Bitrate auto-negotiation state
        self._current_bitrate = 500000
        self._configured_bitrate = 500000
        self._auto_bitrate = False
        self._bitrate_candidates: list[int] = [500000, 250000, 125000]
        self._pending_bitrate_negotiation = False
        self._last_negotiation_time = 0.0
        self._last_any_frame_time: float = 0
        self._obd2_bus_lost_time: float = 0
        self._offline_buffer: OfflineBuffer | None = None
        # VIN tracking
        self._vehicle_vin: str = "UNKNOWN"
        self._vin_thread: threading.Thread | None = None
        # Vehicle profile (populated after VIN read)
        self._vehicle_profile = None
        self._discovery_status: str = ""  # "", "cached", "running", "complete"
        self._profile_applied = False  # True once profile fields emitted
        # Proprietary PGN capture
        self._prop_tracker: ProprietaryPGNTracker | None = None
        self._capture_proprietary = True
        # State inference
        self._prev_speed: float = 0.0
        self._prev_accel_pedal: float = 0.0
        self._prev_readings_time: float = 0.0
        # Per-ECU DTC tracking
        self._dtc_by_source: dict = {}

    @classmethod
    def new(cls, config: ComponentConfig,
            dependencies: Mapping[ResourceName, ResourceBase]) -> Self:
        sensor = cls(config.name)
        sensor.reconfigure(config, dependencies)
        return sensor

    @classmethod
    def validate_config(cls, config: ComponentConfig) -> tuple[list[str], list[str]]:
        fields = config.attributes.fields
        bitrate = fields.get("bitrate")
        if bitrate and bitrate.number_value:
            br = int(bitrate.number_value)
            valid_bitrates = [125000, 250000, 500000, 1000000]
            if br not in valid_bitrates:
                raise ValueError(
                    f"bitrate must be one of {valid_bitrates}, got {br}"
                )
        protocol = fields.get("protocol")
        if protocol and protocol.string_value:
            if protocol.string_value not in ("j1939", "obd2", "auto"):
                raise ValueError(
                    f"protocol must be 'j1939', 'obd2', or 'auto', got '{protocol.string_value}'"
                )
        return [], []

    def reconfigure(self, config: ComponentConfig,
                    dependencies: Mapping[ResourceName, ResourceBase]) -> None:
        # Stop existing listener / poller if running
        self._stop_listener()
        if self._obd2_poller:
            self._obd2_poller.stop()
            self._obd2_poller = None
        self._vehicle_vin = "UNKNOWN"
        self._vin_thread = None
        self._vehicle_profile = None
        self._discovery_status = ""
        self._profile_applied = False

        fields = config.attributes.fields

        self._can_interface = (
            fields["can_interface"].string_value
            if "can_interface" in fields and fields["can_interface"].string_value
            else "can0"
        )
        self._bitrate = (
            int(fields["bitrate"].number_value)
            if "bitrate" in fields and fields["bitrate"].number_value
            else 500000
        )
        self._source_address = (
            int(fields["source_address"].number_value)
            if "source_address" in fields and fields["source_address"].number_value
            else 0xFE
        )
        self._include_raw = (
            fields["include_raw"].bool_value
            if "include_raw" in fields
            else False
        )
        self._bus_type = (
            fields["bus_type"].string_value
            if "bus_type" in fields and fields["bus_type"].string_value
            else "socketcan"
        )
        self._protocol = (
            fields["protocol"].string_value
            if "protocol" in fields and fields["protocol"].string_value
            else "j1939"
        )

        # Save raw config protocol and reset re-detection state
        self._config_protocol = self._protocol
        self._redetect_extended = 0
        self._redetect_standard = 0
        self._redetect_mismatch_count = 0
        self._last_redetect_check = time.time()
        self._pending_protocol_switch = None

        # Bitrate auto-negotiation config
        self._configured_bitrate = self._bitrate
        self._current_bitrate = self._bitrate
        if "auto_bitrate" in fields:
            self._auto_bitrate = bool(fields["auto_bitrate"].bool_value)
        else:
            # Default: auto-bitrate ON when protocol is "auto", OFF otherwise
            self._auto_bitrate = self._config_protocol == "auto"
        if "bitrate_candidates" in fields and fields["bitrate_candidates"].list_value:
            self._bitrate_candidates = [
                int(v.number_value)
                for v in fields["bitrate_candidates"].list_value.values
            ]
        else:
            self._bitrate_candidates = [500000, 250000, 125000]
        self._pending_bitrate_negotiation = False
        self._last_negotiation_time = 0.0
        self._last_any_frame_time = 0
        self._obd2_bus_lost_time = 0

        # Offline buffer -- local JSONL backup for when cloud sync fails
        buf_dir = DEFAULT_BUFFER_DIR
        buf_max_mb = DEFAULT_BUFFER_MAX_MB
        if "offline_buffer_dir" in fields and fields["offline_buffer_dir"].string_value:
            buf_dir = fields["offline_buffer_dir"].string_value
        if "offline_buffer_max_mb" in fields and fields["offline_buffer_max_mb"].number_value:
            buf_max_mb = fields["offline_buffer_max_mb"].number_value
        self._offline_buffer = OfflineBuffer(buf_dir, buf_max_mb)

        # Proprietary PGN capture -- logs raw proprietary traffic for RE
        self._capture_proprietary = True
        if "capture_proprietary" in fields:
            self._capture_proprietary = bool(fields["capture_proprietary"].bool_value)
        if self._capture_proprietary:
            prop_dir = DEFAULT_PROP_LOG_DIR
            prop_max = DEFAULT_PROP_LOG_MAX_MB
            if "proprietary_log_dir" in fields and fields["proprietary_log_dir"].string_value:
                prop_dir = fields["proprietary_log_dir"].string_value
            if "proprietary_log_max_mb" in fields and fields["proprietary_log_max_mb"].number_value:
                prop_max = fields["proprietary_log_max_mb"].number_value
            self._prop_tracker = ProprietaryPGNTracker(prop_dir, prop_max)
        else:
            self._prop_tracker = None

        # PGN filter (J1939 only, but parse regardless)
        if "pgn_filter" in fields and fields["pgn_filter"].list_value:
            self._pgn_filter = {
                int(v.number_value) for v in fields["pgn_filter"].list_value.values
            }
        else:
            self._pgn_filter = set()

        # Reset readings
        with self._readings_lock:
            self._readings = {}
            self._dtc_by_source = {}  # SA -> list of DTC dicts, for per-ECU tracking
            self._frame_count = 0

        # Bitrate auto-negotiation on startup
        if self._auto_bitrate:
            LOGGER.info(
                "Auto-bitrate enabled -- probing for CAN traffic on %s...",
                self._can_interface,
            )
            found, new_bitrate = negotiate_bitrate(
                self._can_interface, self._bus_type,
                self._current_bitrate, self._configured_bitrate,
                self._bitrate_candidates,
            )
            self._current_bitrate = new_bitrate
            self._bitrate = new_bitrate
            self._last_negotiation_time = time.time()
            if found:
                LOGGER.info(
                    "Startup bitrate negotiation: traffic found at %d bps",
                    self._current_bitrate,
                )
            else:
                LOGGER.warning(
                    "Startup bitrate negotiation: no traffic found -- "
                    "using configured %d bps",
                    self._configured_bitrate,
                )

        # Start the appropriate protocol handler
        if self._protocol == "auto":
            # Auto-detect: listen passively for 3 seconds to determine protocol
            LOGGER.info("Auto-detecting protocol (listening for 3 seconds)...")
            detected = auto_detect_protocol(
                self._can_interface, self._bus_type, self._bitrate
            )
            LOGGER.info(f"Auto-detected protocol: {detected}")
            self._protocol = detected

        if self._protocol == "obd2":
            LOGGER.warning(
                "OBD-II mode TRANSMITS on the CAN bus. "
                "DO NOT use on J1939 heavy-duty trucks -- use 'j1939' protocol instead. "
                "OBD-II polling sends request frames that can cause DTCs on truck ECUs."
            )
            self._obd2_poller = OBD2Poller(
                can_interface=self._can_interface,
                bus_type=self._bus_type,
                bitrate=self._bitrate,
            )
            self._obd2_poller.start()
            LOGGER.info("Configured in OBD-II polling mode (ACTIVE -- transmits on bus)")
            if self._config_protocol == "auto":
                self._start_listener()
                LOGGER.info("Passive CAN listener started for protocol re-detection")
        else:
            self._start_listener()
            LOGGER.info("Configured in J1939 passive listener mode (LISTEN-ONLY -- no transmissions)")

        # Read VIN in background (needs protocol handler running first)
        threading.Thread(
            target=start_vin_reading,
            args=(self,),
            daemon=True,
            name="vin-init",
        ).start()

    # ---------------------------------------------------------------
    # CAN Bus Listener Management
    # ---------------------------------------------------------------

    def _start_listener(self):
        """Start the background CAN bus listener thread."""
        self._bus = start_can_listener(
            self._can_interface, self._bus_type, self._bitrate
        )
        if self._bus:
            self._running = True
            self._listener_thread = threading.Thread(
                target=run_listen_loop,
                args=(self,),
                daemon=True,
                name=f"j1939-listener-{self._can_interface}",
            )
            self._listener_thread.start()
        else:
            self._running = False

    def _stop_listener(self):
        """Stop the background CAN bus listener."""
        self._running = False
        if self._listener_thread and self._listener_thread.is_alive():
            self._listener_thread.join(timeout=3.0)
        if self._bus:
            try:
                self._bus.shutdown()
            except Exception:
                LOGGER.debug("Failed to shutdown CAN bus in stop_listener")
            self._bus = None

    def _maybe_check_redetect(self):
        """Delegate to discovery module for protocol re-detection."""
        maybe_check_redetect(self)

    def _maybe_trigger_bitrate_negotiation(self):
        """Check if bus silence warrants bitrate negotiation.

        Called from listen_loop on recv timeout (~1-second intervals).
        Sets _pending_bitrate_negotiation which is executed from
        get_readings() on the next 1 Hz tick.
        """
        if not self._auto_bitrate:
            return
        if self._pending_bitrate_negotiation:
            return

        now = time.time()

        # Cooldown: don't renegotiate within 60 seconds of last attempt
        if now - self._last_negotiation_time < 60:
            return

        # Check silence based on last received frame (any type)
        if self._last_any_frame_time > 0:
            silence = now - self._last_any_frame_time
            if silence > 30:
                LOGGER.warning(
                    "No CAN traffic for %.0f seconds on %s -- "
                    "triggering bitrate negotiation",
                    silence, self._can_interface,
                )
                self._pending_bitrate_negotiation = True
        elif self._last_negotiation_time > 0 and now - self._last_negotiation_time > 60:
            # Never received any frames since last negotiation attempt
            LOGGER.warning(
                "No CAN traffic received on %s -- "
                "triggering bitrate renegotiation",
                self._can_interface,
            )
            self._pending_bitrate_negotiation = True

    def _execute_bitrate_negotiation(self):
        """Execute pending bitrate negotiation.

        Stops all CAN handlers, cycles through bitrates, re-detects
        protocol if in auto mode, and restarts the appropriate handler.
        Called from get_readings().
        """
        LOGGER.info("Executing bitrate negotiation on %s", self._can_interface)

        # Stop all handlers BEFORE cycling the interface
        if self._obd2_poller:
            self._obd2_poller.stop()
            self._obd2_poller = None
        self._stop_listener()

        # Run negotiation
        found, new_bitrate = negotiate_bitrate(
            self._can_interface, self._bus_type,
            self._current_bitrate, self._configured_bitrate,
            self._bitrate_candidates,
        )
        self._current_bitrate = new_bitrate
        self._bitrate = new_bitrate
        self._last_negotiation_time = time.time()

        if not found:
            LOGGER.warning(
                "Bitrate negotiation failed -- restarting with %d bps, "
                "will retry in 60 seconds",
                self._configured_bitrate,
            )
            if self._config_protocol == "auto":
                self._protocol = "j1939"  # safe default
            self._start_listener()
            return

        # Bitrate found -- re-detect protocol if in auto mode
        if self._config_protocol == "auto":
            detected = auto_detect_protocol(
                self._can_interface, self._bus_type, self._bitrate
            )
            if detected != self._protocol:
                LOGGER.info(
                    "Protocol changed after bitrate negotiation: %s -> %s",
                    self._protocol, detected,
                )
            self._protocol = detected

            # Reset re-detection counters
            self._redetect_mismatch_count = 0
            self._redetect_extended = 0
            self._redetect_standard = 0
            self._last_redetect_check = time.time()

        # Reset readings for clean start
        with self._readings_lock:
            self._readings = {}
            self._dtc_by_source = {}
            self._frame_count = 0
        self._last_any_frame_time = 0
        self._obd2_bus_lost_time = 0

        # Start appropriate handler
        if self._protocol == "obd2":
            LOGGER.warning(
                "OBD-II mode TRANSMITS on the CAN bus. "
                "DO NOT use on J1939 heavy-duty trucks."
            )
            self._obd2_poller = OBD2Poller(
                can_interface=self._can_interface,
                bus_type=self._bus_type,
                bitrate=self._current_bitrate,
            )
            self._obd2_poller.start()
            if self._config_protocol == "auto":
                self._start_listener()
                LOGGER.info(
                    "Passive CAN listener started for protocol re-detection"
                )
        else:
            self._start_listener()

        LOGGER.info(
            "Bitrate negotiation complete: %d bps, protocol %s on %s",
            self._current_bitrate, self._protocol, self._can_interface,
        )

        # Re-read VIN for the (potentially different) vehicle
        self._vehicle_vin = "UNKNOWN"
        threading.Thread(
            target=start_vin_reading,
            args=(self,),
            daemon=True,
            name="vin-renegotiate",
        ).start()

    # ---------------------------------------------------------------
    # get_readings
    # ---------------------------------------------------------------

    async def get_readings(
        self,
        *,
        extra: Mapping[str, Any] | None = None,
        timeout: float | None = None,
        **kwargs,
    ) -> Mapping[str, SensorReading]:
        """
        Return the latest decoded J1939 readings.

        All decoded parameters are included as flat key-value pairs.
        Additional metadata:
          - _can_interface: which CAN interface is being read
          - _frame_count: total frames decoded since startup
          - _bus_connected: whether the CAN bus is active
          - _seconds_since_last_frame: time since last decoded frame
        """
        # Execute pending bitrate negotiation (priority over protocol switch)
        if self._pending_bitrate_negotiation:
            self._pending_bitrate_negotiation = False
            self._pending_protocol_switch = None  # negotiation includes protocol detection
            self._execute_bitrate_negotiation()

        # Execute pending protocol switch from re-detection
        if self._pending_protocol_switch:
            new_proto = self._pending_protocol_switch
            self._pending_protocol_switch = None
            execute_protocol_switch(self, new_proto)

        if self._protocol == "obd2" and self._obd2_poller:
            readings = self._obd2_poller.get_readings()
            readings["_can_interface"] = self._can_interface
            readings["_protocol"] = "obd2"
            readings["_bus_connected"] = self._obd2_poller.bus_connected
            readings["can_bitrate"] = self._current_bitrate
            # Provide frame metadata so vehicle state detection works for OBD2
            # Without these, defaults (0 / -1) always trigger "Truck Off"
            readings["_frame_count"] = self._obd2_poller._poll_count
            last_resp = self._obd2_poller._last_response_time
            if last_resp > 0:
                readings["_seconds_since_last_frame"] = round(
                    time.time() - last_resp, 2
                )
            else:
                readings["_seconds_since_last_frame"] = -1
        else:
            with self._readings_lock:
                readings = dict(self._readings)

            readings["_can_interface"] = self._can_interface
            readings["_protocol"] = "j1939"
            readings["_frame_count"] = self._frame_count
            readings["_bus_connected"] = self._bus is not None and self._running
            readings["can_bitrate"] = self._current_bitrate

            if self._last_frame_time > 0:
                readings["_seconds_since_last_frame"] = round(
                    time.time() - self._last_frame_time, 2
                )
            else:
                readings["_seconds_since_last_frame"] = -1

        # Track OBD-II bus loss for bitrate negotiation (non-auto protocol mode)
        if (self._auto_bitrate and self._protocol == "obd2"
                and self._obd2_poller and self._config_protocol != "auto"):
            if not self._obd2_poller.bus_connected:
                if self._obd2_bus_lost_time == 0:
                    self._obd2_bus_lost_time = time.time()
                elif (time.time() - self._obd2_bus_lost_time > 30
                      and time.time() - self._last_negotiation_time > 60):
                    LOGGER.warning(
                        "OBD-II bus disconnected for >30s -- "
                        "triggering bitrate negotiation"
                    )
                    self._pending_bitrate_negotiation = True
            else:
                self._obd2_bus_lost_time = 0

        # VIN and protocol tagging -- in EVERY reading for Viam Data API filtering
        readings["vehicle_vin"] = self._vehicle_vin
        readings["vehicle_protocol"] = self._protocol

        # Vehicle profile fields -- in EVERY reading for dashboard display
        profile = self._vehicle_profile
        if profile:
            readings["vehicle_make"] = profile.make
            readings["vehicle_model"] = profile.model
            readings["vehicle_year"] = profile.year
            # Emit discovery metadata once (first reading after profile loaded)
            if not self._profile_applied:
                self._profile_applied = True
                readings["discovery_status"] = self._discovery_status
                if self._protocol == "obd2" and profile.supported_pids:
                    readings["supported_pid_count"] = len(profile.supported_pids)
                    readings["missing_parameters"] = [
                        f"0x{p:02X}" for p in profile.unsupported_pids
                    ]
                elif self._protocol == "j1939" and profile.supported_pgns:
                    readings["discovered_pgn_count"] = len(profile.supported_pgns)
                    pgn_names = get_supported_pgns()
                    readings["missing_parameters"] = [
                        f"{p} ({pgn_names.get(p, '?')})"
                        for p in profile.unsupported_pgns
                    ]

        # Proprietary PGN summary -- lightweight stats in every reading
        if self._prop_tracker:
            readings.update(self._prop_tracker.get_summary())

        # ---------------------------------------------------------------
        # Vehicle State Inference
        # ---------------------------------------------------------------
        infer_vehicle_state(readings)

        # When vehicle is off, return minimal readings to save cloud storage
        minimal = get_minimal_off_readings(readings, self)
        if minimal is not None:
            # Always include Pi system health -- dashboard needs it even when vehicle is off
            try:
                minimal.update(get_system_health())
            except Exception:
                LOGGER.debug("Failed to collect system health for minimal readings")
            return minimal

        # ---------------------------------------------------------------
        # Derived Fleet Metrics
        # ---------------------------------------------------------------
        self._prev_speed, self._prev_accel_pedal, self._prev_readings_time = (
            compute_fleet_metrics(readings, self._prev_speed, self._prev_accel_pedal, self._prev_readings_time)
        )

        # ---------------------------------------------------------------
        # System health + offline buffer
        # ---------------------------------------------------------------
        try:
            readings.update(get_system_health())
        except Exception:
            LOGGER.debug("Failed to collect system health for readings")

        # Ensure core fields exist for both protocols (dashboard expects these)
        core_fields = [
            "engine_rpm", "coolant_temp_f", "vehicle_speed_mph",
            "battery_voltage_v", "fuel_level_pct", "_protocol",
            "_bus_connected", "_vehicle_off", "vehicle_state",
            "active_dtc_count"
        ]
        for field in core_fields:
            if field not in readings:
                readings[field] = 0

        # Persist to local offline buffer (survives reboots + cloud outages)
        # Skip buffer write when vehicle is off -- no point buffering zero data
        if self._offline_buffer and not readings.get("_vehicle_off", False):
            self._offline_buffer.write(readings)

        return readings

    # ---------------------------------------------------------------
    # do_command
    # ---------------------------------------------------------------

    async def do_command(
        self,
        command: Mapping[str, Any],
        *,
        timeout: float | None = None,
        **kwargs,
    ) -> Mapping[str, Any]:
        """
        Execute custom commands on the CAN bus.

        Supported commands:
            {"command": "clear_dtcs"}
                Send DM11 to clear active diagnostic trouble codes.

            {"command": "request_pgn", "pgn": <int>}
                Send a PGN request message to solicit data from the ECU.

            {"command": "get_supported_pgns"}
                Return list of PGN numbers and names this module can decode.

            {"command": "get_bus_stats"}
                Return CAN bus statistics (frame count, uptime, etc.)

            {"command": "get_proprietary_pgns"}
                Return detailed stats on all proprietary PGNs seen on the bus.
                Includes PGN type, frame count, source addresses, unique payloads,
                and last raw data for each proprietary PGN.

            {"command": "reset_proprietary_pgns"}
                Clear in-memory proprietary PGN stats (disk logs preserved).

            {"command": "send_raw", "can_id": <int>, "data": <hex_string>}
                Send a raw CAN frame (use with caution).
        """
        cmd = command.get("command", "")

        if cmd == "clear_dtcs":
            # Route to OBD-II poller if in OBD-II mode
            if self._protocol == "obd2" and self._obd2_poller:
                return self._obd2_poller.clear_dtcs()
            return await clear_dtcs(self)
        elif cmd == "get_freeze_frame":
            if self._protocol == "obd2" and self._obd2_poller and self._obd2_poller._advanced_diag:
                return {"success": True, "freeze_frame": self._obd2_poller._advanced_diag.get_freeze_frame()}
            return {"error": "Freeze frame only available in OBD-II mode"}
        elif cmd == "get_readiness":
            if self._protocol == "obd2" and self._obd2_poller and self._obd2_poller._advanced_diag:
                return {"success": True, "readiness": self._obd2_poller._advanced_diag.get_readiness_monitors()}
            return {"error": "Readiness monitors only available in OBD-II mode"}
        elif cmd == "get_pending_dtcs":
            if self._protocol == "obd2" and self._obd2_poller and self._obd2_poller._advanced_diag:
                return {"success": True, "pending_dtcs": self._obd2_poller._advanced_diag.get_pending_dtcs()}
            return {"error": "Pending DTCs only available in OBD-II mode"}
        elif cmd == "get_permanent_dtcs":
            if self._protocol == "obd2" and self._obd2_poller and self._obd2_poller._advanced_diag:
                return {"success": True, "permanent_dtcs": self._obd2_poller._advanced_diag.get_permanent_dtcs()}
            return {"error": "Permanent DTCs only available in OBD-II mode"}
        elif cmd == "get_vin":
            if self._protocol == "obd2" and self._obd2_poller and self._obd2_poller._advanced_diag:
                vin = self._obd2_poller._advanced_diag.get_vin()
                return {"success": bool(vin), "vin": vin}
            return {"error": "VIN query only available in OBD-II mode"}
        elif cmd == "get_history":
            return self._get_history(command.get("days", 7))
        elif cmd == "request_pgn":
            pgn_val = command.get("pgn")
            if pgn_val is None:
                return {"error": "pgn parameter required"}
            return await request_pgn(self._bus, int(pgn_val), self._source_address)
        elif cmd == "get_supported_pgns":
            return {"supported_pgns": get_supported_pgns()}
        elif cmd == "get_bus_stats":
            return get_bus_stats(self)
        elif cmd == "get_proprietary_pgns":
            if not self._prop_tracker:
                return {"error": "Proprietary PGN capture is disabled"}
            return {
                "success": True,
                "summary": self._prop_tracker.get_summary(),
                "pgns": self._prop_tracker.get_detailed(),
            }
        elif cmd == "reset_proprietary_pgns":
            if not self._prop_tracker:
                return {"error": "Proprietary PGN capture is disabled"}
            self._prop_tracker.reset()
            return {"success": True, "message": "Proprietary PGN stats reset"}
        elif cmd == "send_raw":
            can_id_val = command.get("can_id")
            data_hex = command.get("data", "")
            if can_id_val is None:
                return {"error": "can_id parameter required"}
            return await send_raw(self._bus, int(can_id_val), data_hex)
        else:
            return {"error": f"Unknown command: {cmd}",
                    "available": ["clear_dtcs", "get_freeze_frame",
                                  "get_readiness", "get_pending_dtcs",
                                  "get_permanent_dtcs", "get_vin",
                                  "request_pgn", "get_supported_pgns",
                                  "get_bus_stats", "get_proprietary_pgns",
                                  "reset_proprietary_pgns", "send_raw"]}

    # ---------------------------------------------------------------
    # History
    # ---------------------------------------------------------------

    def _get_history(self, days: int = 7) -> dict[str, Any]:
        """Read historical data from the offline JSONL buffer and return summary + time series."""
        return get_history(self._offline_buffer, days)

    # ---------------------------------------------------------------
    # Cleanup
    # ---------------------------------------------------------------

    async def close(self):
        """Clean up CAN bus resources."""
        LOGGER.info(f"Closing J1939 sensor {self.name}")
        self._stop_listener()
        if self._vin_thread and self._vin_thread.is_alive():
            self._vin_thread.join(timeout=2.0)
        if self._obd2_poller:
            self._obd2_poller.stop()
            self._obd2_poller = None
