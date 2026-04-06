"""
PLC Modbus Sensor Module for Viam — TPS Production Monitor.

Reads the TPS (Tie Plate System) PLC state via Modbus TCP and returns
structured sensor readings for remote monitoring.  Connects to a Click PLC
C0-10DD2E-D.

Register map — everything the Click PLC ladder logic exposes:
  DS1-DS25 (addr 0-24):   TPS holding registers (config + status)
  DD1 (addr 16384-16385): Encoder pulse count (32-bit signed, quadrature x1)
  X1-X8 (discrete):       TPS discrete inputs (power loop, plate flipper, air eagles)
  Note: X3 is labeled "Camera" in the PLC project file but is actually a
  plate flipper — a needle on a bearing that detects plate orientation.
  Internal field names still use "camera_*" for Viam Cloud compatibility.
  Y1-Y3 (coils 8192+):    TPS eject output coils
  C1999-C2000 (coils):    Encoder reset, floating zero

Offline buffering:
  When configured with offline_buffer_dir, readings are buffered to local
  JSONL files so no data is lost during network outages.  Viam's built-in
  data manager syncs the capture directory when connectivity is restored.
  The buffer also writes a separate JSONL file that persists across reboots
  and can be replayed or uploaded independently.
"""

import asyncio
import collections
import math
import time
import uuid
from collections.abc import Mapping, Sequence
from typing import Any, ClassVar, Self

from plc_commands import dispatch_command
from plc_metrics import ConnectionQualityMonitor, SignalMetrics
from plc_offline import _DEFAULT_BUFFER_MAX_MB, OfflineBuffer
from plc_readings import (
    build_connected_readings,
    build_disconnected_readings,
    evaluate_and_log_diagnostics,
    read_modbus_io,
)

# Extracted sub-modules
from plc_utils import _read_chat_queue, _uint16
from plc_weather import _weather_cache
from pymodbus.client import ModbusTcpClient
from system_health import get_system_health
from viam.components.sensor import Sensor
from viam.logging import getLogger
from viam.module.module import Module
from viam.proto.app.robot import ComponentConfig
from viam.proto.common import ResourceName
from viam.resource.base import ResourceBase
from viam.resource.registry import Registry, ResourceCreatorRegistration
from viam.resource.types import Model, ModelFamily
from viam.utils import SensorReading

LOGGER = getLogger(__name__)

# Connection timeout in seconds
_CONNECT_TIMEOUT = 2

# Self-healing: retry backoff on repeated connection failures
_MAX_BACKOFF_SECONDS = 30.0
_INITIAL_BACKOFF_SECONDS = 1.0

# Encoder constants — SICK DBS60E-BDEC01000
_ENCODER_PPR = 1000          # Pulses per revolution (from datasheet)
_ENCODER_QUADRATURE = 1      # Production HSC uses x1 count mode
_ENCODER_COUNTS_PER_REV = _ENCODER_PPR * _ENCODER_QUADRATURE  # 1000
# Wheel diameter — physical DMF RW-1650 wheel is 406.4mm (16 in).
# Encoder is direct-drive (no gear ratio). Verified against PLC:
# Rung 0 defines 10 encoder counts = 0.5 inches, which with 1000 PPR
# gives mm_per_count = 1.277mm. That matches pi*406.4/1000 = 1.277mm.
# The previous 341.4mm "calibrated" value was 15.5% wrong.
_DEFAULT_WHEEL_DIAMETER_MM = 406.4  # 16 in physical wheel, direct-drive encoder


class PlcSensor(Sensor):
    """Reads TPS PLC state via Modbus TCP.

    Returns production readings: encoder, discrete inputs, output coils,
    internal coils, and DS holding registers — only what the real Click PLC
    ladder logic provides.  No simulated or placeholder values.
    """

    MODEL: ClassVar[Model] = Model(
        ModelFamily("viam-staubli-apera-poc", "monitor"),
        "plc-sensor",
    )

    def __init__(self, name: str, *, host: str, port: int,
                 wheel_diameter_mm: float = _DEFAULT_WHEEL_DIAMETER_MM,
                 offline_buffer_dir: str | None = None,
                 offline_buffer_max_mb: float = _DEFAULT_BUFFER_MAX_MB,
                 truck_id: str = "truck-00"):
        super().__init__(name)
        self.host = host
        self.port = port
        self.client: ModbusTcpClient | None = None
        self._start_time: float = time.time()
        self._session_id: str = uuid.uuid4().hex[:8]  # unique per power cycle
        self._truck_id: str = truck_id
        # Offline buffer — persists readings to local disk across reboots
        self._offline_buffer: OfflineBuffer | None = None
        if offline_buffer_dir:
            self._offline_buffer = OfflineBuffer(offline_buffer_dir, offline_buffer_max_mb)
        # Encoder: distance-per-count derived from wheel diameter
        # mm_per_count = circumference / counts_per_rev
        #   = (π × 406.4) / 1000 = 1.2767 mm per encoder count
        #   = 0.05025 inches per count, 4.19 ft per revolution
        # Verified: PLC Rung 0 says 10 counts = 0.5", so 1 count = 1.27mm ✓
        self._wheel_diameter_mm = wheel_diameter_mm
        wheel_circumference_mm = math.pi * wheel_diameter_mm
        self._mm_per_count = wheel_circumference_mm / _ENCODER_COUNTS_PER_REV
        # Encoder: distance from DS10 (Encoder Next Tie countdown)
        self._prev_ds10: int | None = None
        self._prev_distance_mm: float | None = None
        self._prev_encoder_time: float | None = None
        self._encoder_speed_mmps: float = 0.0  # mm per second
        self._accumulated_distance_mm: float = 0.0  # cumulative from DS10 deltas
        # Encoder hardware health — track if DD1 and DS10 are changing
        self._dd1_history: collections.deque = collections.deque(maxlen=30)
        self._ds10_history: collections.deque = collections.deque(maxlen=30)
        # DD1-based direction detection (DS10 freezes during reverse)
        self._prev_dd1: int | None = None
        # Rolling window of DD1 deltas to determine direction.
        # DD1 stays negative long after reversing, so sign alone is useless.
        # Delta sign is the real signal: negative delta = reverse, positive = forward.
        self._dd1_deltas: collections.deque = collections.deque(maxlen=5)
        # TPS plate drop counter — tracks OFF→ON transitions on Y1 (Eject TPS_1)
        self._prev_eject_tps1: bool | None = None
        self._plate_drop_count: int = 0
        # Self-healing: exponential backoff on repeated connection failures
        self._consecutive_failures: int = 0
        self._next_retry_time: float = 0.0
        self._total_reads: int = 0
        self._total_errors: int = 0
        # Connection quality monitor — detects cable issues, link flapping
        self._conn_monitor = ConnectionQualityMonitor()
        # Signal metrics — rolling window analysis for diagnostics
        self._signal_metrics = SignalMetrics()
        # Drop spacing tracking — distance between consecutive plate drops
        self._distance_at_last_drop: float = 0.0
        self._drop_spacings: collections.deque = collections.deque(maxlen=100)

    @classmethod
    def new(
        cls,
        config: ComponentConfig,
        dependencies: Mapping[ResourceName, ResourceBase],
    ) -> Self:
        fields = config.attributes.fields
        wheel_dia = _DEFAULT_WHEEL_DIAMETER_MM
        if "wheel_diameter_mm" in fields and fields["wheel_diameter_mm"].number_value:
            wheel_dia = fields["wheel_diameter_mm"].number_value
        # Offline buffer config
        buf_dir: str | None = None
        if "offline_buffer_dir" in fields and fields["offline_buffer_dir"].string_value:
            buf_dir = fields["offline_buffer_dir"].string_value
        buf_max_mb = _DEFAULT_BUFFER_MAX_MB
        if "offline_buffer_max_mb" in fields and fields["offline_buffer_max_mb"].number_value:
            buf_max_mb = fields["offline_buffer_max_mb"].number_value
        truck_id = "truck-00"
        if "truck_id" in fields and fields["truck_id"].string_value:
            truck_id = fields["truck_id"].string_value
        sensor = cls(
            config.name,
            host=fields["host"].string_value or "192.168.0.10",
            port=int(fields["port"].number_value or 502),
            wheel_diameter_mm=wheel_dia,
            offline_buffer_dir=buf_dir,
            offline_buffer_max_mb=buf_max_mb,
            truck_id=truck_id,
        )
        LOGGER.info(
            "PlcSensor configured: host=%s port=%d wheel_diameter_mm=%.1f buffer=%s",
            sensor.host, sensor.port, sensor._wheel_diameter_mm,
            buf_dir or "disabled",
        )
        return sensor

    @classmethod
    def validate_config(cls, config: ComponentConfig) -> Sequence[str]:
        """Validate that required attributes are present."""
        fields = config.attributes.fields
        if "host" not in fields or not fields["host"].string_value:
            raise ValueError("'host' attribute is required (PLC IP address)")
        return []

    def _disconnect(self) -> None:
        """Close and discard the Modbus client so the next poll reconnects."""
        if self.client is not None:
            try:
                self.client.close()
            except Exception:
                LOGGER.debug("Failed to close Modbus client")
            self.client = None

    def _ensure_connected(self) -> bool:
        """Connect to the PLC if not already connected. Returns True on success.

        Self-healing: on repeated failures, backs off exponentially up to
        _MAX_BACKOFF_SECONDS to avoid hammering a down PLC.  Resets
        immediately on successful connection.
        """
        if self.client is not None and self.client.connected:
            return True

        # Backoff: skip reconnect if we're in a cooldown period
        now = time.time()
        if now < self._next_retry_time:
            return False

        # Discard any dead socket before creating a fresh one
        self._disconnect()

        try:
            self.client = ModbusTcpClient(
                self.host,
                port=self.port,
                timeout=_CONNECT_TIMEOUT,
            )
            connected = self.client.connect()
            if connected:
                if self._consecutive_failures > 0:
                    LOGGER.info(
                        "🟢 PLC reconnected at %s:%d after %d failures — self-healed",
                        self.host, self.port, self._consecutive_failures,
                    )
                else:
                    LOGGER.info("🟢 Connected to PLC at %s:%d", self.host, self.port)
                self._consecutive_failures = 0
                self._next_retry_time = 0.0
                return True
            else:
                self._on_connection_failure("TCP connect returned False")
                return False
        except Exception as e:
            self._on_connection_failure(str(e))
            return False

    def _on_connection_failure(self, reason: str) -> None:
        """Handle a connection failure: log diagnostics and schedule retry."""
        self._disconnect()
        self._consecutive_failures += 1
        self._total_errors += 1
        capped_exp = min(self._consecutive_failures - 1, 5)  # cap at 32s to avoid OverflowError
        backoff = min(
            _INITIAL_BACKOFF_SECONDS * (2 ** capped_exp),
            _MAX_BACKOFF_SECONDS,
        )
        self._next_retry_time = time.time() + backoff
        LOGGER.warning(
            "🔴 PLC connection failed [%s:%d]: %s | "
            "failures=%d | retry_in=%.1fs | total_reads=%d | total_errors=%d",
            self.host, self.port, reason,
            self._consecutive_failures, backoff,
            self._total_reads, self._total_errors,
        )
        if self._consecutive_failures == 1:
            LOGGER.info(
                "🔧 TROUBLESHOOT: Check that the PLC is powered (PWR+RUN LEDs green), "
                "Ethernet cable is connected to the PLC's Ethernet port, "
                "and the Pi is on the same subnet as %s",
                self.host,
            )

    def _disconnected_readings(self, reason: str) -> Mapping[str, SensorReading]:
        """Return a full readings dict with connected=False and all values zeroed."""
        readings = build_disconnected_readings(
            truck_id=self._truck_id,
            session_id=self._session_id,
            uptime_seconds=round(time.time() - self._start_time),
            total_reads=self._total_reads,
            total_errors=self._total_errors,
        )
        readings["last_fault"] = reason
        # Connection quality
        readings.update(self._conn_monitor.check())
        # Chat events sync (even when PLC offline — operators still chat)
        chat_events = _read_chat_queue()
        if chat_events:
            readings["chat_events"] = chat_events
            readings["chat_event_count"] = len(chat_events)
        else:
            readings["chat_event_count"] = 0
        return readings

    async def get_readings(
        self,
        extra: dict[str, Any] | None = None,
        **kwargs,
    ) -> Mapping[str, SensorReading]:
        """Return current TPS PLC state as structured sensor readings.

        Reads only real PLC registers: DS holding registers, encoder (DD1),
        discrete inputs, output coils, and internal coils.  On any failure
        the client is closed so the next poll cycle creates a fresh connection.
        """
        self._total_reads += 1
        connected = self._ensure_connected()

        if not connected:
            return self._disconnected_readings("connection_failed")

        try:
            # ── Read all Modbus I/O in one pass ──
            try:
                io = read_modbus_io(self.client, _uint16)
            except OSError:
                LOGGER.warning("Error reading DS registers")
                self._disconnect()
                return self._disconnected_readings("ds_read_error")

            ds = io["ds"]
            encoder_count = io["encoder_count"]
            discrete_bits = io["discrete_bits"]
            c_app_bits = io["c_app_bits"]
            _mode = io["operating_mode"]
            _modbus_elapsed_ms = io["modbus_elapsed_ms"]
            td5_laying = io["td5_laying"]
            td6_travel = io["td6_travel"]

            # Unpack discrete signals
            tps_power_loop = bool(discrete_bits[3])       # X4
            camera_signal = bool(discrete_bits[2])         # X3 — plate flipper
            air_eagle_1_feedback = bool(discrete_bits[4])  # X5
            air_eagle_2_feedback = bool(discrete_bits[5])  # X6
            air_eagle_3_enable = bool(discrete_bits[6])    # X7

            # Unpack output coils
            eject_tps_1 = bool(io["output_coils"][0])       # Y1
            eject_left_tps_2 = bool(io["output_coils"][1])   # Y2
            eject_right_tps_2 = bool(io["output_coils"][2])  # Y3

            # Unpack internal coils
            encoder_reset_coil = bool(io["internal_coils"][0])  # C1999
            floating_zero = bool(io["internal_coils"][1])        # C2000

            # ── DD1 hardware health: is the encoder producing any pulses? ──
            # Only matters when TPS is on (production). When TPS is off,
            # DD1 may legitimately be frozen — don't diagnose at idle.
            self._dd1_history.append(encoder_count)
            dd1_unique = len(set(self._dd1_history))
            dd1_frozen = dd1_unique <= 1 and len(self._dd1_history) >= 10

            # ── DS10 health: is the PLC counting distance? ──
            # DS10 should change when TPS is on and encoder is moving.
            # If DS10 is frozen while DD1 is alive, the PLC isn't processing.
            self._ds10_history.append(ds[9])
            ds10_unique = len(set(self._ds10_history))
            ds10_frozen = ds10_unique <= 1 and len(self._ds10_history) >= 15

            # ── Distance from DS10 (Encoder Next Tie) ──
            # DD1 is NOT usable for distance — the PLC resets it every ~10
            # counts (Rung 0) at 0.1ms scan rate. We can't sample fast enough.
            #
            # Instead, use DS10 which counts down from DS3 (tie spacing in
            # 0.1" units, typically 195 = 19.5") to 0, then resets. Each
            # full cycle = one tie spacing of travel. We track the countdown
            # and accumulate distance from the deltas.
            ds10_encoder_next = ds[9]  # DS10: Encoder Next Tie (0.1" units)
            ds3_tie_spacing = ds[2]    # DS3: Tie Spacing (0.1" units)
            now_ts = time.time()
            encoder_direction = 0  # 0 = forward, 1 = reverse

            # ── Direction detection from DD1 delta ──
            # DS10 freezes during reverse — can't use it for direction.
            # DD1 sign is unreliable — it stays negative long after reversing.
            # DD1 DELTA sign is the real signal (verified 2026-03-23):
            #   Δdd1 negative = reverse, Δdd1 positive = forward
            # We use a rolling window of recent deltas and check if majority
            # are negative (reverse) or positive (forward).
            if self._prev_dd1 is not None:
                dd1_delta = encoder_count - self._prev_dd1
                # Only track significant deltas (ignore noise/stall)
                if abs(dd1_delta) > 5:
                    self._dd1_deltas.append(dd1_delta)
            self._prev_dd1 = encoder_count

            if len(self._dd1_deltas) >= 2:
                neg_count = sum(1 for d in self._dd1_deltas if d < 0)
                if neg_count > len(self._dd1_deltas) / 2:
                    encoder_direction = 1  # majority negative = reverse

            # ── Distance from DS10 (Encoder Next Tie) ──
            # DS10 counts down from DS3 to 0, then resets. Only moves forward.
            if self._prev_ds10 is not None and ds3_tie_spacing > 0:
                delta_ds10 = self._prev_ds10 - ds10_encoder_next  # countdown: prev > current = forward
                if delta_ds10 < 0:
                    # DS10 jumped up — either rollover or reverse (DS10 frozen).
                    # Rollover: prev was near 0, current jumped to near DS3.
                    # Use threshold: large jump = rollover, small = noise/reverse.
                    if abs(delta_ds10) > ds3_tie_spacing * 0.5:
                        # Rollover — distance = remaining prev + new cycle used
                        delta_ds10 = self._prev_ds10 + (ds3_tie_spacing - ds10_encoder_next)
                    else:
                        # Small negative = DS10 noise or reverse, ignore
                        delta_ds10 = 0
                if delta_ds10 > 0 and delta_ds10 < ds3_tie_spacing * 2:
                    # Convert 0.1" units to mm (1 unit = 0.1" = 2.54mm)
                    self._accumulated_distance_mm += delta_ds10 * 2.54
            self._prev_ds10 = ds10_encoder_next

            encoder_distance_mm = self._accumulated_distance_mm
            encoder_distance_ft = encoder_distance_mm / 304.8
            encoder_revolutions = encoder_distance_mm / (math.pi * self._wheel_diameter_mm)

            # Speed from distance delta / time delta
            if self._prev_distance_mm is not None and self._prev_encoder_time is not None:
                dt = now_ts - self._prev_encoder_time
                if dt > 0.01:
                    delta_mm = self._accumulated_distance_mm - self._prev_distance_mm
                    self._encoder_speed_mmps = delta_mm / dt
            self._prev_distance_mm = self._accumulated_distance_mm
            self._prev_encoder_time = now_ts

            # Speed in feet per minute (common railroad unit)
            encoder_speed_ftpm = (self._encoder_speed_mmps / 304.8) * 60.0

            # ── TPS plate drop counter — detect OFF→ON on Y1 (Eject TPS_1) ──
            # Also compute drop spacing (distance between consecutive drops)
            encoder_distance_in = (self._accumulated_distance_mm / 25.4)
            if self._prev_eject_tps1 is not None and not self._prev_eject_tps1 and eject_tps_1:
                self._plate_drop_count += 1
                spacing = encoder_distance_in - self._distance_at_last_drop
                if self._distance_at_last_drop > 0 and spacing > 0:
                    self._drop_spacings.append(spacing)
                self._distance_at_last_drop = encoder_distance_in
                LOGGER.info(
                    "Plate drop #%d — encoder=%d spacing=%.1fin",
                    self._plate_drop_count, encoder_count,
                    spacing if self._distance_at_last_drop > 0 else 0,
                )
            self._prev_eject_tps1 = eject_tps_1

            # Drop spacing stats
            _spacings = list(self._drop_spacings)
            last_drop_spacing_in = round(_spacings[-1], 2) if _spacings else 0.0
            avg_drop_spacing_in = round(sum(_spacings) / len(_spacings), 2) if _spacings else 0.0
            min_drop_spacing_in = round(min(_spacings), 2) if _spacings else 0.0
            max_drop_spacing_in = round(max(_spacings), 2) if _spacings else 0.0
            distance_since_last_drop_in = round(encoder_distance_in - self._distance_at_last_drop, 2)
            drop_count_in_window = len(_spacings)

            # Encoder enabled: True when C1999 (Encoder Reset) is OFF and encoder is counting
            encoder_enabled = not encoder_reset_coil and encoder_count != 0

            # ── Derive system state from real PLC signals ──
            system_state = "running" if tps_power_loop else "idle"

            # ── Build readings — everything the PLC exposes ──
            uptime_s = round(time.time() - self._start_time)
            readings: dict[str, Any] = build_connected_readings(
                truck_id=self._truck_id,
                session_id=self._session_id,
                uptime_seconds=uptime_s,
                total_reads=self._total_reads,
                total_errors=self._total_errors,
                system_state=system_state,
                encoder_count=encoder_count,
                dd1_frozen=dd1_frozen,
                ds10_frozen=ds10_frozen,
                encoder_direction=encoder_direction,
                encoder_distance_ft=encoder_distance_ft,
                encoder_speed_ftpm=encoder_speed_ftpm,
                encoder_revolutions=encoder_revolutions,
                tps_power_loop=tps_power_loop,
                camera_signal=camera_signal,
                encoder_enabled=encoder_enabled,
                floating_zero=floating_zero,
                encoder_reset=encoder_reset_coil,
                discrete_bits=discrete_bits,
                eject_tps_1=eject_tps_1,
                eject_left_tps_2=eject_left_tps_2,
                eject_right_tps_2=eject_right_tps_2,
                air_eagle_1_feedback=air_eagle_1_feedback,
                air_eagle_2_feedback=air_eagle_2_feedback,
                air_eagle_3_enable=air_eagle_3_enable,
                plate_drop_count=self._plate_drop_count,
                ds=ds,
                c_app_bits=c_app_bits,
                operating_mode=_mode,
                td5_laying=td5_laying,
                td6_travel=td6_travel,
            )

            # ── Drop spacing metrics ──
            readings["last_drop_spacing_in"] = last_drop_spacing_in
            readings["avg_drop_spacing_in"] = avg_drop_spacing_in
            readings["min_drop_spacing_in"] = min_drop_spacing_in
            readings["max_drop_spacing_in"] = max_drop_spacing_in
            readings["distance_since_last_drop_in"] = distance_since_last_drop_in
            readings["drop_count_in_window"] = drop_count_in_window

            # ── Signal metrics — rolling window analysis ──
            sig = self._signal_metrics.update(
                x3=camera_signal,
                y1=eject_tps_1,
                c30=bool(c_app_bits[29]),  # C30 = detector eject
                encoder_dir=encoder_direction,
                modbus_ms=_modbus_elapsed_ms,
                now=now_ts,
            )
            readings.update(sig)

            # Track TPS power duration for diagnostics
            tps_power_duration_s = self._signal_metrics.track_power(
                tps_power_loop, now=now_ts,
            )
            readings["tps_power_duration_s"] = round(tps_power_duration_s, 1)

            # Connection quality monitoring — detect cable degradation
            conn_quality = self._conn_monitor.check()
            readings.update(conn_quality)

            # Location & weather (cached, refreshes every 15 min in background)
            readings.update(_weather_cache.get())

            # ── Diagnostic rules engine + state change log ──
            if not hasattr(self, "_prev_diag_rules"):
                self._prev_diag_rules: set = set()
            self._prev_diag_rules, _ = evaluate_and_log_diagnostics(
                readings, self._prev_diag_rules,
            )

            # ── Voice chat events (synced to Viam Cloud for fleet analysis) ──
            chat_events = _read_chat_queue()
            if chat_events:
                readings["chat_events"] = chat_events
                readings["chat_event_count"] = len(chat_events)
                LOGGER.info("Chat events synced to cloud: %d", len(chat_events))
            else:
                readings["chat_event_count"] = 0

            # Persist to local offline buffer (survives reboots + cloud outages)
            if self._offline_buffer is not None:
                self._offline_buffer.write(readings)

            return readings

        except Exception as e:
            self._total_errors += 1
            LOGGER.error(
                "🔴 Error reading PLC registers: %s | total_reads=%d errors=%d",
                e, self._total_reads, self._total_errors, exc_info=True,
            )
            self._disconnect()
            return self._disconnected_readings(str(e))

    async def do_command(
        self,
        command: dict[str, Any],
        *,
        timeout: float | None = None,
        **kwargs,
    ) -> dict[str, Any]:
        """Execute remote commands on the PLC via Modbus writes.

        Delegates to plc_commands.dispatch_command() for all command handling.
        """
        if not self.client or not self._ensure_connected():
            return {"action": command.get("action", ""), "status": "error",
                    "message": "PLC not connected"}

        def _reset_plate_count():
            self._plate_drop_count = 0

        result = await dispatch_command(
            self.client, command,
            plate_drop_reset_cb=_reset_plate_count,
        )
        # Merge system health into result
        try:
            result.update(get_system_health())
        except Exception:
            LOGGER.debug("Failed to collect system health for do_command result")
        return result

    async def close(self):
        LOGGER.info("%s is closing.", self.name)
        if self.client is not None:
            self.client.close()
            self.client = None


async def main():
    Registry.register_resource_creator(
        Sensor.API,
        PlcSensor.MODEL,
        ResourceCreatorRegistration(PlcSensor.new, PlcSensor.validate_config),
    )
    module = Module.from_args()
    module.add_model_from_registry(Sensor.API, PlcSensor.MODEL)
    await module.start()


if __name__ == "__main__":
    asyncio.run(main())
