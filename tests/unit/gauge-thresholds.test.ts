import { getGaugeStatus, getGaugeColor } from '../../src/utils/gauge-thresholds';

describe('getGaugeStatus', () => {
  it('returns normal for values within range', () => {
    expect(getGaugeStatus('coolant_temp_f', 190)).toBe('normal');
    expect(getGaugeStatus('oil_pressure_psi', 50)).toBe('normal');
  });

  it('returns warning for values at warn threshold', () => {
    // coolant warn = 203 (from web dashboard)
    expect(getGaugeStatus('coolant_temp_f', 205)).toBe('warning');
  });

  it('returns critical for values at crit threshold', () => {
    // coolant crit = 221 (from web dashboard)
    expect(getGaugeStatus('coolant_temp_f', 225)).toBe('critical');
  });

  it('handles inverted thresholds (low = bad)', () => {
    // oil_pressure crit = 14.5, warn = 29
    expect(getGaugeStatus('oil_pressure_psi', 10)).toBe('critical');
    expect(getGaugeStatus('oil_pressure_psi', 25)).toBe('warning');
    // battery crit = 11.5, warn = 12.0
    expect(getGaugeStatus('battery_voltage_v', 11)).toBe('critical');
    expect(getGaugeStatus('battery_voltage_v', 11.8)).toBe('warning');
  });

  it('returns normal for null/undefined', () => {
    expect(getGaugeStatus('coolant_temp_f', null)).toBe('normal');
    expect(getGaugeStatus('coolant_temp_f', undefined)).toBe('normal');
  });

  it('returns normal for unknown gauge key', () => {
    expect(getGaugeStatus('unknown_key', 999)).toBe('normal');
  });
});

describe('getGaugeColor', () => {
  it('returns correct colors', () => {
    expect(getGaugeColor('normal')).toBe('#16a34a');
    expect(getGaugeColor('warning')).toBe('#d97706');
    expect(getGaugeColor('critical')).toBe('#dc2626');
  });
});
