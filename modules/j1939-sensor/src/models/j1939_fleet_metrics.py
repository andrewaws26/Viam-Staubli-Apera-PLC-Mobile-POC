"""
Fleet metrics computation extracted from j1939_sensor.py.

Pure functions that operate on the readings dict to add vehicle state inference,
minimal off-readings, derived fleet metrics, and history retrieval.
"""

import json
import os
import time
from typing import Any

from viam.logging import getLogger

LOGGER = getLogger(__name__)

FUEL_PRICE = 3.80


def infer_vehicle_state(readings: dict) -> None:
    """Add vehicle_state and _vehicle_off to readings dict in-place."""
    rpm = readings.get("engine_rpm", None)
    secs_since = readings.get("_seconds_since_last_frame", -1)
    frame_count = readings.get("_frame_count", 0)

    if frame_count == 0 or secs_since > 60 or secs_since == -1:
        readings["vehicle_state"] = "Truck Off"
    elif rpm is not None and rpm > 0:
        readings["vehicle_state"] = "Engine On"
    elif rpm is not None and rpm == 0:
        readings["vehicle_state"] = "Ignition On"
    elif rpm is None and secs_since >= 0 and secs_since < 60:
        # Receiving frames but no RPM decoded -- could be KOEO
        has_any_data = any(
            k in readings for k in ("battery_voltage_v", "coolant_temp_f", "oil_pressure_psi")
        )
        readings["vehicle_state"] = "Ignition On" if has_any_data else "Unknown"
    else:
        readings["vehicle_state"] = "Unknown"

    # Vehicle-off detection for data capture optimization
    # If vehicle is off (no CAN traffic) for >30 seconds, flag it
    bus_connected = readings.get("_bus_connected", False)
    vehicle_off = (
        readings["vehicle_state"] == "Truck Off"
        or (not bus_connected and (secs_since > 30 or secs_since == -1))
    )
    readings["_vehicle_off"] = vehicle_off


def get_minimal_off_readings(readings: dict, sensor) -> dict:
    """Return minimal readings payload when vehicle is off.

    Args:
        readings: The full readings dict (must have vehicle_state, _vehicle_off, etc.)
        sensor: The J1939TruckSensor instance (for _current_bitrate, _vehicle_vin,
                _protocol, _vehicle_profile access)

    Returns:
        Minimal dict suitable for cloud upload, or None if vehicle is not off.
    """
    if not readings.get("_vehicle_off", False):
        return None

    bus_connected = readings.get("_bus_connected", False)
    minimal = {
        "_vehicle_off": True,
        "_protocol": readings.get("_protocol", "j1939"),
        "_bus_connected": bus_connected,
        "_can_interface": readings.get("_can_interface", "can0"),
        "can_bitrate": sensor._current_bitrate,
        "vehicle_state": readings["vehicle_state"],
        "battery_voltage_v": readings.get("battery_voltage_v", 0),
        "vehicle_vin": sensor._vehicle_vin,
        "vehicle_protocol": sensor._protocol,
    }
    if sensor._vehicle_profile:
        minimal["vehicle_make"] = sensor._vehicle_profile.make
        minimal["vehicle_model"] = sensor._vehicle_profile.model
        minimal["vehicle_year"] = sensor._vehicle_profile.year
    return minimal


def compute_fleet_metrics(readings: dict, prev_speed: float, prev_accel: float, prev_time: float) -> tuple:
    """Add derived fleet metrics to readings dict in-place.

    Args:
        readings: The readings dict to augment with fleet metrics.
        prev_speed: Previous vehicle speed reading.
        prev_accel: Previous accelerator pedal position reading.
        prev_time: Previous reading timestamp.

    Returns:
        Tuple of (new_speed, new_accel, new_time) for caller to store.
    """
    now = time.time()
    speed = readings.get("vehicle_speed_mph", 0) or 0
    accel = readings.get("accel_pedal_pos_pct", 0) or 0
    pto = readings.get("pto_engaged", None)

    # Idle Waste: engine on, not moving, PTO not engaged
    readings["idle_waste_active"] = (
        readings["vehicle_state"] == "Engine On"
        and speed == 0
        and (pto is None or pto == 0)
    )

    # Harsh Behavior: rapid delta in speed or accelerator pedal
    dt = now - prev_time if prev_time > 0 else 1.0
    if dt > 0 and dt < 10:  # only valid for consecutive 1Hz readings
        speed_delta = abs(speed - prev_speed)
        accel_delta = abs(accel - prev_accel)
        # Thresholds: >7 mph/s decel = hard brake, >30% pedal change/s = aggressive
        readings["harsh_braking"] = speed_delta > 7 and speed < prev_speed
        readings["harsh_acceleration"] = accel_delta > 30
        readings["harsh_behavior_flag"] = readings["harsh_braking"] or readings["harsh_acceleration"]
    else:
        readings["harsh_braking"] = False
        readings["harsh_acceleration"] = False
        readings["harsh_behavior_flag"] = False

    # ---------------------------------------------------------------
    # Additional Derived Fleet Metrics
    # ---------------------------------------------------------------
    fuel_rate = readings.get("fuel_rate_gph", None)
    engine_hours = readings.get("engine_hours", None)
    idle_hours = readings.get("idle_engine_hours", None)
    idle_fuel = readings.get("idle_fuel_used_gal", None)
    total_fuel = readings.get("total_fuel_used_gal", None)
    distance = readings.get("vehicle_distance_hr_mi", None) or readings.get("vehicle_distance_mi", None)

    # Fuel cost per hour (assume $3.80/gal diesel)
    if fuel_rate is not None and fuel_rate > 0:
        readings["fuel_cost_per_hour"] = round(fuel_rate * FUEL_PRICE, 2)

    # Idle waste dollars
    if idle_fuel is not None:
        readings["idle_waste_dollars"] = round(idle_fuel * FUEL_PRICE, 2)

    # Idle percentage
    if idle_hours is not None and engine_hours is not None and engine_hours > 0:
        readings["idle_pct"] = round((idle_hours / engine_hours) * 100, 1)

    # Cost per mile -- use instantaneous fuel economy, not lifetime totals
    fuel_econ = readings.get("fuel_economy_mpg", None)
    if fuel_econ is not None and fuel_econ > 0:
        readings["fuel_cost_per_mile"] = round(FUEL_PRICE / fuel_econ, 3)
    elif total_fuel is not None and distance is not None and distance > 100:
        # Fallback to lifetime average only if we have significant distance
        readings["fuel_cost_per_mile"] = round((total_fuel * FUEL_PRICE) / distance, 3)

    # PTO duty cycle
    pto_status = readings.get("pto_engaged", None)
    if pto_status is not None and engine_hours is not None and engine_hours > 0:
        # We track PTO state -- can estimate from idle vs PTO
        readings["pto_active"] = pto_status > 0

    # DPF health indicator
    soot = readings.get("dpf_soot_load_pct", None)
    if soot is not None:
        if soot > 80:
            readings["dpf_health"] = "CRITICAL"
        elif soot > 60:
            readings["dpf_health"] = "WARNING"
        else:
            readings["dpf_health"] = "OK"

    # Idle fuel percentage (of total lifetime fuel burned at idle)
    if idle_fuel is not None and total_fuel is not None and total_fuel > 0:
        readings["idle_fuel_pct"] = round((idle_fuel / total_fuel) * 100, 1)

    # DEF level alert
    def_level = readings.get("def_level_pct", None)
    if def_level is not None:
        readings["def_low"] = def_level < 15

    # SCR health indicator
    scr_eff = readings.get("scr_efficiency_pct", None)
    if scr_eff is not None:
        if scr_eff < 50:
            readings["scr_health"] = "CRITICAL"
        elif scr_eff < 80:
            readings["scr_health"] = "WARNING"
        else:
            readings["scr_health"] = "OK"

    # DEF dosing status
    dose_rate = readings.get("def_dose_rate_gs", None)
    dose_cmd = readings.get("def_dose_commanded_gs", None)
    if dose_rate is not None or dose_cmd is not None:
        readings["def_dosing_active"] = (
            (dose_rate is not None and dose_rate > 0)
            or (dose_cmd is not None and dose_cmd > 0)
        )

    # Battery health -- 12.0-12.6V is normal for engine-off, 13.5-14.5V for running
    batt = readings.get("battery_voltage_v", None)
    rpm = readings.get("engine_rpm", 0) or 0
    if batt is not None:
        if rpm > 0:
            # Engine running -- alternator should be charging
            if batt < 13.0:
                readings["battery_health"] = "LOW"
            elif batt > 15.0:
                readings["battery_health"] = "OVERCHARGE"
            else:
                readings["battery_health"] = "OK"
        else:
            # Engine off -- resting voltage
            if batt < 11.5:
                readings["battery_health"] = "CRITICAL"
            elif batt < 12.0:
                readings["battery_health"] = "LOW"
            else:
                readings["battery_health"] = "OK"

    return (speed, accel, now)


def get_history(offline_buffer, days: int = 7) -> dict[str, Any]:
    """Read historical data from the offline JSONL buffer and return summary + time series."""
    if offline_buffer is None:
        return {"error": "No offline buffer configured", "totalPoints": 0}

    buf_path = offline_buffer._dir

    # Read JSONL files line by line -- filter as we go to keep memory low on Pi Zero (512MB)
    all_points = []
    for d in range(min(int(days), 7)):
        if len(all_points) >= 3600:
            break
        ts = time.time() - d * 86400
        date_str = time.strftime("%Y%m%d", time.localtime(ts))
        path = os.path.join(buf_path, f"readings_{date_str}.jsonl")
        if os.path.exists(path):
            try:
                with open(path) as f:
                    for line in f:
                        try:
                            pt = json.loads(line.strip())
                            if pt.get("_bus_connected") or (isinstance(pt.get("engine_rpm"), (int, float)) and pt["engine_rpm"] > 0):
                                all_points.append(pt)
                                if len(all_points) >= 3600:
                                    break
                        except (json.JSONDecodeError, ValueError):
                            LOGGER.debug("Failed to parse offline buffer JSON line")
            except OSError:
                LOGGER.debug("Failed to read offline buffer file: %s", path)

    if not all_points:
        return {"totalPoints": 0, "source": "offline-buffer", "summary": None}

    all_points.sort(key=lambda p: p.get("epoch", 0))

    def _nums(key):
        return [p[key] for p in all_points if isinstance(p.get(key), (int, float)) and p[key] != 0]

    def _avg(arr):
        return round(sum(arr) / len(arr), 2) if arr else 0

    first, last = all_points[0], all_points[-1]
    total_min = round((last.get("epoch", 0) - first.get("epoch", 0)) / 60)

    # DTC events
    dtc_events = []
    prev_count = 0
    for p in all_points:
        c = p.get("active_dtc_count", 0) or 0
        if c > 0 and c != prev_count:
            for i in range(min(int(c), 5)):
                code = p.get(f"obd2_dtc_{i}")
                if code:
                    dtc_events.append({"timestamp": p.get("ts", ""), "code": str(code)})
        prev_count = c

    rpms = _nums("engine_rpm")
    coolants = _nums("coolant_temp_f")
    speeds = [p.get("vehicle_speed_mph", 0) for p in all_points if isinstance(p.get("vehicle_speed_mph"), (int, float))]
    batts = _nums("battery_voltage_v")
    fuels = _nums("fuel_level_pct")
    st = [p.get("short_fuel_trim_b1_pct", 0) for p in all_points if isinstance(p.get("short_fuel_trim_b1_pct"), (int, float))]
    lt = [p.get("long_fuel_trim_b1_pct", 0) for p in all_points if isinstance(p.get("long_fuel_trim_b1_pct"), (int, float))]

    # Downsample time series (max 100 points to keep response under 50KB for WebRTC)
    step = max(1, len(all_points) // 100)
    ts_data = []
    for i in range(0, len(all_points), step):
        p = all_points[i]
        ts_data.append({
            "t": p.get("ts", ""),
            "rpm": p.get("engine_rpm", 0),
            "coolant_f": p.get("coolant_temp_f", 0),
            "speed_mph": p.get("vehicle_speed_mph", 0),
            "battery_v": p.get("battery_voltage_v", 0),
            "fuel_pct": p.get("fuel_level_pct", 0),
            "short_trim": p.get("short_fuel_trim_b1_pct", 0),
            "long_trim": p.get("long_fuel_trim_b1_pct", 0),
        })

    return {
        "totalPoints": len(all_points),
        "source": "offline-buffer",
        "totalMinutes": total_min,
        "periodStart": first.get("ts", ""),
        "periodEnd": last.get("ts", ""),
        "summary": {
            "engine_rpm": {"avg": round(_avg(rpms)), "max": max(rpms) if rpms else 0, "min": min(rpms) if rpms else 0},
            "coolant_temp_f": {"avg": round(_avg(coolants), 1), "max": round(max(coolants), 1) if coolants else 0, "min": round(min(coolants), 1) if coolants else 0},
            "vehicle_speed_mph": {"avg": round(_avg(speeds), 1), "max": round(max(speeds), 1) if speeds else 0},
            "battery_voltage_v": {"avg": round(_avg(batts), 2), "min": round(min(batts), 2) if batts else 0, "max": round(max(batts), 2) if batts else 0},
            "fuel_level_pct": {"start": round(fuels[0], 1) if fuels else 0, "end": round(fuels[-1], 1) if fuels else 0, "consumed": round(fuels[0] - fuels[-1], 1) if fuels else 0},
            "short_fuel_trim_b1_pct": {"avg": round(_avg(st), 2), "min": round(min(st), 2) if st else 0, "max": round(max(st), 2) if st else 0},
            "long_fuel_trim_b1_pct": {"avg": round(_avg(lt), 2), "min": round(min(lt), 2) if lt else 0, "max": round(max(lt), 2) if lt else 0},
        },
        "dtcEvents": dtc_events,
        "timeSeries": ts_data,
    }
