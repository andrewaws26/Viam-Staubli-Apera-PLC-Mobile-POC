"""
OBD-II PID definitions and decode lambdas for standard (11-bit) CAN bus.

Contains all 33 PIDs with US imperial conversions:
- Temperatures in Fahrenheit
- Pressures in PSI
- Speed in mph
- Distances in miles
"""

# OBD-II CAN IDs
OBD2_REQUEST_ID = 0x7DF
OBD2_RESPONSE_ID = 0x7E8

# OBD-II service 01 (show current data)
OBD2_SERVICE_CURRENT = 0x01
OBD2_RESPONSE_SERVICE = 0x41

# Timeout per PID request
PID_TIMEOUT_S = 0.3

# Consecutive zero-response cycles before declaring bus disconnected
DISCONNECT_THRESHOLD = 5

# Helper conversions (noqa: E731 — lambdas are clearer than def for one-liners)
_C_TO_F = lambda c: c * 9.0 / 5.0 + 32  # noqa: E731
_KPA_TO_PSI = lambda kpa: kpa * 0.145038  # noqa: E731
_KPH_TO_MPH = lambda kph: kph * 0.621371  # noqa: E731
_KM_TO_MI = lambda km: km * 0.621371  # noqa: E731

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
