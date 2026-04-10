/**
 * Warning and critical thresholds for gauge color coding.
 * Used by both web dashboard and mobile app.
 */

import type { GaugeThreshold, GaugeThresholds } from './sensor-types';

export type { GaugeThreshold, GaugeThresholds };

export const TRUCK_GAUGE_THRESHOLDS: GaugeThresholds = {
  // Temperatures — above threshold is bad
  coolant_temp_f: { warn: 203, crit: 221 },
  oil_temp_f: { warn: 230, crit: 266 },
  intake_manifold_temp_f: { warn: 140, crit: 160 },
  trans_oil_temp_f: { warn: 230, crit: 260 },

  // Pressures
  oil_pressure_psi: { warn: 29, crit: 14.5, inverted: true },
  boost_pressure_psi: { warn: 36, crit: 43.5 },

  // Voltage — below threshold is bad
  battery_voltage_v: { warn: 12.0, crit: 11.5, inverted: true },
  alternator_voltage_v: { warn: 13.2, crit: 12.0, inverted: true },
  charging_spread_v: { warn: 0.5, crit: 0, inverted: true },

  // Current — below threshold is bad
  alternator_current_a: { warn: 5, crit: 0, inverted: true },

  // Fuel — below threshold is bad
  fuel_level_pct: { warn: 20, crit: 10, inverted: true },
  def_level_pct: { warn: 15, crit: 5, inverted: true },

  // Idle fuel — above threshold is bad
  idle_fuel_pct: { warn: 25, crit: 35 },

  // DPF — above threshold is bad
  dpf_soot_load_pct: { warn: 70, crit: 85 },

  // SCR — below threshold is bad
  scr_efficiency_pct: { warn: 80, crit: 50, inverted: true },

  // Engine
  engine_rpm: { warn: 2200, crit: 2500 },
};

/**
 * Determine the status for a gauge value.
 */
export function getGaugeStatus(
  key: string,
  value: number | null | undefined,
): 'normal' | 'warning' | 'critical' {
  if (value === null || value === undefined || isNaN(value)) return 'normal';

  const threshold = TRUCK_GAUGE_THRESHOLDS[key];
  if (!threshold) return 'normal';

  if (threshold.inverted) {
    if (value <= threshold.crit) return 'critical';
    if (value <= threshold.warn) return 'warning';
  } else {
    if (value >= threshold.crit) return 'critical';
    if (value >= threshold.warn) return 'warning';
  }

  return 'normal';
}

/**
 * Get the color hex for a gauge status.
 */
export function getGaugeColor(status: 'normal' | 'warning' | 'critical'): string {
  switch (status) {
    case 'critical': return '#dc2626';
    case 'warning': return '#d97706';
    case 'normal': return '#16a34a';
  }
}
