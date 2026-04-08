/**
 * Sensor value range definitions — flags readings that are physically impossible
 * or clearly indicate a sensor malfunction.
 *
 * IMPORTANT: These ranges are based on hardware datasheets and protocol specs.
 * Only values that are physically impossible or unambiguously wrong get flagged.
 *
 * Sources:
 *   - SAE J1939-71 (SPN data ranges)
 *   - Click PLC C0-10DD2E-D hardware manual (16-bit DS, 32-bit DD)
 *   - Mack/Volvo D13 engine specifications
 *   - SICK DBS60E encoder specifications
 */

export type FlagLevel = "error" | "warn";

export interface RangeFlag {
  field: string;
  label: string;
  value: number;
  level: FlagLevel;
  reason: string;
}

interface RangeDef {
  label: string;
  /** Hard limits — values outside this range are physically impossible */
  min?: number;
  max?: number;
  /** Soft limits — values outside this range are suspicious but possible */
  warnMin?: number;
  warnMax?: number;
  unit?: string;
}

// ---------------------------------------------------------------------------
// PLC / TPS ranges
// ---------------------------------------------------------------------------

const PLC_RANGES: Record<string, RangeDef> = {
  encoder_speed_ftpm: {
    label: "Track Speed",
    min: 0, max: 200,       // Railroad truck can't exceed ~120 ft/min
    warnMax: 100,            // Suspicious above 100 ft/min
    unit: "ft/min",
  },
  plates_per_minute: {
    label: "Plate Rate",
    min: 0, max: 120,       // Physical limit of eject mechanism
    warnMax: 60,             // Normal range is 10-40
    unit: "/min",
  },
  modbus_response_time_ms: {
    label: "Modbus Latency",
    min: 0, max: 30000,     // 30s timeout is the hard limit
    warnMax: 500,            // Normal is <50ms on local Ethernet
    unit: "ms",
  },
  encoder_distance_ft: {
    label: "Distance",
    min: 0,                  // Can't go negative
    unit: "ft",
  },
  // DS registers are 16-bit unsigned
  ds1: { label: "DS1 Encoder Ignore", min: 0, max: 65535 },
  ds2: { label: "DS2 Tie Spacing", min: 0, max: 65535 },
  ds3: { label: "DS3 Tie Spacing", min: 0, max: 65535 },
  ds7: { label: "DS7 Plate Count", min: 0, max: 65535 },
  ds10: { label: "DS10 Enc Next Tie", min: 0, max: 65535 },
};

// ---------------------------------------------------------------------------
// J1939 Truck Engine ranges (per SAE J1939-71 SPN definitions)
// ---------------------------------------------------------------------------

const J1939_RANGES: Record<string, RangeDef> = {
  engine_rpm: {
    label: "Engine RPM",
    min: 0, max: 8192,      // J1939 SPN 190: 0-8191.875 rpm
    warnMax: 2800,           // Governed max for D13 is ~2100, 2800 is clearly wrong
    unit: "rpm",
  },
  coolant_temp_f: {
    label: "Coolant Temp",
    min: -40, max: 410,      // J1939 SPN 110: -40 to 210°C → -40 to 410°F
    warnMin: 32,             // 32°F = 0°C, likely a default/zero value if engine is running
    warnMax: 260,            // Overheating territory
    unit: "°F",
  },
  oil_temp_f: {
    label: "Oil Temp",
    min: -40, max: 410,      // Same range as coolant (SPN 175)
    warnMax: 270,            // Oil breakdown begins
    unit: "°F",
  },
  trans_oil_temp_f: {
    label: "Trans Oil Temp",
    min: -40, max: 410,
    warnMax: 270,
    unit: "°F",
  },
  oil_pressure_psi: {
    label: "Oil Pressure",
    min: 0, max: 145,        // J1939 SPN 100: 0-1000 kPa → 0-145 PSI
    warnMin: 5,              // Below 5 PSI with engine running = major problem
    unit: "PSI",
  },
  boost_pressure_psi: {
    label: "Boost Pressure",
    min: 0, max: 73,         // J1939 SPN 102: 0-500 kPa → 0-72.5 PSI
    unit: "PSI",
  },
  vehicle_speed_mph: {
    label: "Vehicle Speed",
    min: 0, max: 156,        // J1939 SPN 84: 0-250.996 km/h → 0-156 mph
    warnMax: 85,             // Heavy truck governed speed limit
    unit: "mph",
  },
  battery_voltage_v: {
    label: "Battery Voltage",
    min: 0, max: 36,         // 24V system max realistic
    warnMin: 10,             // Below 10V = dead battery
    warnMax: 16,             // Above 16V = overcharging
    unit: "V",
  },
  fuel_level_pct: {
    label: "Fuel Level",
    min: 0, max: 100,        // Percentage can't exceed 100
    unit: "%",
  },
  fuel_rate_gph: {
    label: "Fuel Rate",
    min: 0, max: 100,        // D13 max fuel rate ~25 gph at full load
    warnMax: 30,
    unit: "gal/hr",
  },
  def_level_pct: {
    label: "DEF Level",
    min: 0, max: 100,
    warnMin: 5,              // Very low DEF triggers derate
    unit: "%",
  },
  dpf_soot_load_pct: {
    label: "DPF Soot Load",
    min: 0, max: 100,
    warnMax: 80,             // Forced regen needed
    unit: "%",
  },
  intake_manifold_temp_f: {
    label: "Intake Temp",
    min: -40, max: 410,
    warnMax: 200,            // Intercooler not working
    unit: "°F",
  },
  exhaust_gas_pressure_psi: {
    label: "Exhaust Pressure",
    min: 0, max: 50,         // Realistic backpressure range
    warnMax: 15,             // Clogged DPF
    unit: "PSI",
  },
};

// ---------------------------------------------------------------------------
// Pi / System ranges
// ---------------------------------------------------------------------------

const SYSTEM_RANGES: Record<string, RangeDef> = {
  cpu_temp_c: {
    label: "CPU Temp",
    min: -10, max: 100,       // Pi 5 thermal shutdown at 85°C
    warnMax: 80,
    unit: "°C",
  },
  memory_used_pct: {
    label: "Memory",
    min: 0, max: 100,
    warnMax: 90,
    unit: "%",
  },
  disk_used_pct: {
    label: "Disk",
    min: 0, max: 100,
    warnMax: 90,
    unit: "%",
  },
};

// ---------------------------------------------------------------------------
// Combined range map
// ---------------------------------------------------------------------------

const ALL_RANGES: Record<string, RangeDef> = {
  ...PLC_RANGES,
  ...J1939_RANGES,
  ...SYSTEM_RANGES,
};

// ---------------------------------------------------------------------------
// Validation function
// ---------------------------------------------------------------------------

/**
 * Check sensor readings for out-of-range values.
 * Returns a list of flagged fields with explanations.
 */
export function validateReadings(readings: Record<string, unknown>): RangeFlag[] {
  const flags: RangeFlag[] = [];

  for (const [field, def] of Object.entries(ALL_RANGES)) {
    const raw = readings[field];
    if (raw === undefined || raw === null) continue;
    const value = typeof raw === "number" ? raw : parseFloat(String(raw));
    if (isNaN(value)) continue;

    // Hard limits — physically impossible
    if (def.min !== undefined && value < def.min) {
      flags.push({
        field, label: def.label, value, level: "error",
        reason: `${value}${def.unit ?? ""} is below minimum ${def.min}${def.unit ?? ""} — sensor malfunction`,
      });
    } else if (def.max !== undefined && value > def.max) {
      flags.push({
        field, label: def.label, value, level: "error",
        reason: `${value}${def.unit ?? ""} exceeds maximum ${def.max}${def.unit ?? ""} — sensor malfunction`,
      });
    }
    // Soft limits — suspicious
    else if (def.warnMin !== undefined && value < def.warnMin) {
      flags.push({
        field, label: def.label, value, level: "warn",
        reason: `${value}${def.unit ?? ""} is unusually low (expected >${def.warnMin}${def.unit ?? ""})`,
      });
    } else if (def.warnMax !== undefined && value > def.warnMax) {
      flags.push({
        field, label: def.label, value, level: "warn",
        reason: `${value}${def.unit ?? ""} is unusually high (expected <${def.warnMax}${def.unit ?? ""})`,
      });
    }
  }

  // Special check: 32°F coolant with engine running = likely default/zero value
  const rpm = readings.engine_rpm;
  const coolant = readings.coolant_temp_f;
  if (typeof rpm === "number" && rpm > 400 && typeof coolant === "number" && coolant <= 33 && coolant >= 31) {
    flags.push({
      field: "coolant_temp_f", label: "Coolant Temp", value: coolant as number, level: "error",
      reason: "32°F with engine running — sensor returning 0°C default, not a real reading",
    });
  }

  return flags;
}

/**
 * Get all defined range definitions (for display in dev panel).
 */
export function getAllRanges(): Record<string, RangeDef> {
  return { ...ALL_RANGES };
}
