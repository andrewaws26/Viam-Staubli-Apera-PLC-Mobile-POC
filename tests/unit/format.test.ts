import {
  formatValue, formatTemp, formatPressure, formatPercent,
  formatVoltage, formatSpeed, round, timeAgo, formatTimestamp, formatDate,
} from '../../src/utils/format';

describe('formatValue', () => {
  it('formats numbers with units', () => {
    expect(formatValue(1234, 'rpm')).toBe('1,234 rpm');
    expect(formatValue(14.1, 'V', 1)).toBe('14.1 V');
  });

  it('returns -- for null/undefined', () => {
    expect(formatValue(null, 'rpm')).toBe('--');
    expect(formatValue(undefined, 'psi')).toBe('--');
  });

  it('returns -- for NaN', () => {
    expect(formatValue(NaN, 'mph')).toBe('--');
  });
});

describe('formatTemp', () => {
  it('formats temperatures in Fahrenheit', () => {
    expect(formatTemp(192)).toBe('192 °F');
  });

  it('returns -- for null', () => {
    expect(formatTemp(null)).toBe('--');
  });
});

describe('formatPressure', () => {
  it('formats pressure in PSI', () => {
    expect(formatPressure(45)).toBe('45 psi');
  });

  it('returns -- for null', () => {
    expect(formatPressure(null)).toBe('--');
  });
});

describe('formatPercent', () => {
  it('formats as percentage', () => {
    expect(formatPercent(85)).toBe('85 %');
  });

  it('returns -- for undefined', () => {
    expect(formatPercent(undefined)).toBe('--');
  });
});

describe('formatVoltage', () => {
  it('formats voltage with 1 decimal', () => {
    expect(formatVoltage(14.1)).toBe('14.1 V');
  });

  it('returns -- for null', () => {
    expect(formatVoltage(null)).toBe('--');
  });
});

describe('formatSpeed', () => {
  it('formats speed in mph', () => {
    expect(formatSpeed(55)).toBe('55 mph');
  });

  it('returns -- for undefined', () => {
    expect(formatSpeed(undefined)).toBe('--');
  });
});

describe('round', () => {
  it('rounds to specified decimals', () => {
    expect(round(3.14159, 2)).toBe(3.14);
    expect(round(14.05, 1)).toBe(14.1);
    expect(round(192.7, 0)).toBe(193);
  });
});

describe('timeAgo', () => {
  it('returns -- for invalid input', () => {
    expect(timeAgo('')).toBe('unknown');
    expect(timeAgo(undefined as unknown as string)).toBe('unknown');
  });

  it('returns relative time for valid ISO string', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    expect(timeAgo(fiveMinAgo)).toContain('min');
  });
});

describe('formatTimestamp', () => {
  it('returns -- for invalid input', () => {
    expect(formatTimestamp('')).toBe('--');
  });

  it('formats a valid ISO string', () => {
    const result = formatTimestamp('2026-04-06T12:30:00Z');
    expect(result).toBeTruthy();
    expect(result).not.toBe('--');
  });
});

describe('formatDate', () => {
  it('returns -- for invalid input', () => {
    expect(formatDate('')).toBe('--');
  });

  it('formats a valid ISO string', () => {
    const result = formatDate('2026-04-06T12:30:00Z');
    expect(result).toBeTruthy();
    expect(result).not.toBe('--');
  });
});
