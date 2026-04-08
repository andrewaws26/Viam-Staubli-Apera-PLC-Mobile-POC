/**
 * Per diem types for IronSight Company OS.
 *
 * Per diem is auto-calculated from timesheet data (nights_out, layovers)
 * when a timesheet is approved. Rates are configurable with effective dates
 * so historical calculations remain accurate when rates change.
 *
 * Flow:
 *   1. Employee submits timesheet with nights_out and layovers counts
 *   2. Manager approves timesheet
 *   3. API auto-creates per_diem_entry using the active rate
 *   4. If timesheet is un-approved or deleted, entry is removed
 *
 * Rates follow GSA federal per diem schedule as a baseline.
 */

/** A configurable per diem rate with effective date. */
export interface PerDiemRate {
  id: string;
  name: string;
  /** Dollar amount per night out. */
  daily_rate: number;
  /** Dollar amount per layover day. */
  layover_rate: number;
  effective_date: string;
  is_active: boolean;
  created_at: string;
}

/** A single per diem entry linked to an approved timesheet. */
export interface PerDiemEntry {
  id: string;
  timesheet_id: string;
  user_id: string;
  rate_id: string;
  /** Joined from per_diem_rates — present in API responses. */
  rate_name?: string;
  nights_count: number;
  layover_count: number;
  nights_amount: number;
  layover_amount: number;
  total_amount: number;
  week_ending: string;
  created_at: string;
}

/** Aggregated per diem summary for a date range. */
export interface PerDiemSummary {
  user_id: string;
  user_name: string;
  period_start: string;
  period_end: string;
  total_nights: number;
  total_layovers: number;
  total_amount: number;
  entries: PerDiemEntry[];
}

/** Payload for creating or updating a per diem rate. */
export interface UpdatePerDiemRatePayload {
  name?: string;
  daily_rate?: number;
  layover_rate?: number;
  effective_date?: string;
  is_active?: boolean;
}
