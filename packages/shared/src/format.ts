/**
 * Formatting helpers for dates, numbers, and units.
 * All readings are US imperial (temperatures F, pressures PSI, speed mph).
 *
 * NOTE: This module requires `date-fns` as a peer dependency.
 * Both dashboard and mobile should have it installed.
 */

import { formatDistanceToNow, format, parseISO, isValid } from 'date-fns';

/**
 * Format a timestamp as relative time (e.g., "5 minutes ago").
 */
export function timeAgo(iso: string | undefined | null): string {
  if (!iso) return 'unknown';
  try {
    const date = parseISO(iso);
    if (!isValid(date)) return 'unknown';
    return formatDistanceToNow(date, { addSuffix: true });
  } catch {
    return 'unknown';
  }
}

/**
 * Format a timestamp for display (e.g., "Apr 6, 11:30 AM").
 */
export function formatTimestamp(iso: string | undefined | null): string {
  if (!iso) return '--';
  try {
    const date = parseISO(iso);
    if (!isValid(date)) return '--';
    return format(date, 'MMM d, h:mm a');
  } catch {
    return '--';
  }
}

/**
 * Format a date for display (e.g., "Apr 6, 2026").
 */
export function formatDate(iso: string | undefined | null): string {
  if (!iso) return '--';
  try {
    const date = parseISO(iso);
    if (!isValid(date)) return '--';
    return format(date, 'MMM d, yyyy');
  } catch {
    return '--';
  }
}

/**
 * Round a number to a given precision.
 */
export function round(value: number, decimals: number = 0): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Format a numeric value with unit, handling null/undefined gracefully.
 * @returns "1,234 rpm" or "--" if value is missing
 */
export function formatValue(
  value: number | null | undefined,
  unit: string,
  decimals: number = 0,
): string {
  if (value === null || value === undefined || isNaN(value)) return '--';
  const formatted = round(value, decimals).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return unit ? `${formatted} ${unit}` : formatted;
}

export function formatTemp(value: number | null | undefined): string {
  return formatValue(value, '\u00B0F', 0);
}

export function formatPressure(value: number | null | undefined): string {
  return formatValue(value, 'psi', 0);
}

export function formatPercent(value: number | null | undefined): string {
  return formatValue(value, '%', 0);
}

export function formatVoltage(value: number | null | undefined): string {
  return formatValue(value, 'V', 1);
}

export function formatSpeed(value: number | null | undefined): string {
  return formatValue(value, 'mph', 0);
}
