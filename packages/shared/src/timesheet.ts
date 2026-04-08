/**
 * Timesheet types for the IronSight field operations time tracking system.
 *
 * A weekly timesheet is the central work report for B&B Metals employees.
 * It captures ALL work activities for a Mon–Sun week:
 *   • Railroad time (daily logs with clock in/out)
 *   • Railroad timecards (supervisor documentation)
 *   • Equipment inspections
 *   • IFTA fuel tax entries (per-state)
 *   • Expenses (with receipt capture)
 *   • Maintenance time
 *   • Shop time
 *   • Mileage pay
 *   • Flight pay
 *   • Holiday pay
 *   • Vacation pay
 *
 * Each section is a separate table linked by timesheet_id, making them
 * independently queryable for reporting, compliance, and financials.
 */

export type TimesheetStatus = 'draft' | 'submitted' | 'approved' | 'rejected';

// ── Core daily log (railroad time) ────────────────────────────────────

export interface TimesheetDailyLog {
  id: string;
  timesheet_id: string;
  log_date: string;
  start_time: string | null;
  end_time: string | null;
  hours_worked: number | null;
  travel_hours: number | null;
  lunch_minutes: number;
  description: string | null;
  // Semi truck travel fields (per-day)
  semi_truck_travel: boolean;
  traveling_from: string | null;
  destination: string | null;
  travel_miles: number | null;
  sort_order: number;
  created_at: string;
}

// ── Timesheet sub-section types ───────────────────────────────────────

export interface TimesheetRailroadTimecard {
  id: string;
  timesheet_id: string;
  railroad: string;
  track_supervisor: string | null;
  division_engineer: string | null;
  images: string[];  // Supabase Storage URLs
  created_at: string;
}

export interface TimesheetInspection {
  id: string;
  timesheet_id: string;
  inspection_time: string;
  images: string[];
  notes: string | null;
  created_at: string;
}

export interface TimesheetIftaEntry {
  id: string;
  timesheet_id: string;
  state_code: string;
  reportable_miles: number;
  gallons_purchased: number;
  created_at: string;
}

export type ExpenseCategory =
  | 'Fuel' | 'Safety' | 'Repairs & Maintenance' | 'Parts'
  | 'Parking' | 'Lodging/Hotels' | 'Travel' | 'Supplies'
  | 'MGT Approved Expense' | 'Other';

export interface TimesheetExpense {
  id: string;
  timesheet_id: string;
  expense_date: string;
  amount: number;
  category: ExpenseCategory;
  description: string | null;
  needs_reimbursement: boolean;
  payment_type: 'cash' | 'credit';
  receipt_image_url: string | null;
  is_fuel: boolean;
  fuel_vehicle_type: 'chase' | 'semi' | null;
  fuel_vehicle_number: string | null;
  odometer_image_url: string | null;
  created_at: string;
}

export interface TimesheetMaintenanceTime {
  id: string;
  timesheet_id: string;
  log_date: string;
  start_time: string;
  stop_time: string;
  hours_worked: number | null;
  description: string;
  parts_used: string | null;
  created_at: string;
}

export interface TimesheetShopTime {
  id: string;
  timesheet_id: string;
  log_date: string;
  start_time: string;
  stop_time: string | null;
  lunch_minutes: number;
  hours_worked: number | null;
  created_at: string;
}

export interface TimesheetMileagePay {
  id: string;
  timesheet_id: string;
  log_date: string;
  traveling_from: string;
  destination: string;
  miles: number;
  chase_vehicle: string | null;
  description: string | null;
  created_at: string;
}

export interface TimesheetFlightPay {
  id: string;
  timesheet_id: string;
  log_date: string;
  traveling_from: string;
  destination: string;
  created_at: string;
}

export interface TimesheetHolidayPay {
  id: string;
  timesheet_id: string;
  holiday_date: string;
  created_at: string;
}

export interface TimesheetVacationPay {
  id: string;
  timesheet_id: string;
  start_date: string;
  end_date: string;
  hours_per_day: number;
  total_hours: number | null;
  created_at: string;
}

// ── Main timesheet interface ──────────────────────────────────────────

export interface Timesheet {
  id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  week_ending: string;
  status: TimesheetStatus;

  // Railroad / field work details
  railroad_working_on: string | null;
  norfolk_southern_job_code: string | null;
  chase_vehicles: string[];
  semi_trucks: string[];
  work_location: string | null;
  nights_out: number;
  layovers: number;
  coworkers: { id: string; name: string }[];

  // IFTA odometer (per-week)
  ifta_odometer_start: number | null;
  ifta_odometer_end: number | null;

  // Approval workflow
  submitted_at: string | null;
  approved_by: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
  rejection_reason: string | null;

  notes: string | null;
  created_at: string;
  updated_at: string;

  // Embedded sub-sections from API
  daily_logs: TimesheetDailyLog[];
  railroad_timecards: TimesheetRailroadTimecard[];
  inspections: TimesheetInspection[];
  ifta_entries: TimesheetIftaEntry[];
  expenses: TimesheetExpense[];
  maintenance_time: TimesheetMaintenanceTime[];
  shop_time: TimesheetShopTime[];
  mileage_pay: TimesheetMileagePay[];
  flight_pay: TimesheetFlightPay[];
  holiday_pay: TimesheetHolidayPay[];
  vacation_pay: TimesheetVacationPay[];

  // Computed totals
  total_hours: number;
  total_travel_hours: number;
}

// ── Payloads ──────────────────────────────────────────────────────────

export interface CreateTimesheetPayload {
  week_ending: string;
  railroad_working_on?: string;
  norfolk_southern_job_code?: string;
  chase_vehicles?: string[];
  semi_trucks?: string[];
  work_location?: string;
  nights_out?: number;
  layovers?: number;
  coworkers?: { id: string; name: string }[];
  ifta_odometer_start?: number;
  ifta_odometer_end?: number;
  notes?: string;
  daily_logs?: {
    log_date: string;
    start_time?: string;
    end_time?: string;
    hours_worked?: number;
    travel_hours?: number;
    lunch_minutes?: number;
    description?: string;
    semi_truck_travel?: boolean;
    traveling_from?: string;
    destination?: string;
    travel_miles?: number;
  }[];
}

export interface UpdateTimesheetPayload {
  week_ending?: string;
  railroad_working_on?: string;
  norfolk_southern_job_code?: string;
  chase_vehicles?: string[];
  semi_trucks?: string[];
  work_location?: string;
  nights_out?: number;
  layovers?: number;
  coworkers?: { id: string; name: string }[];
  ifta_odometer_start?: number;
  ifta_odometer_end?: number;
  notes?: string;
  status?: TimesheetStatus;
  rejection_reason?: string;
  daily_logs?: {
    id?: string;
    log_date: string;
    start_time?: string;
    end_time?: string;
    hours_worked?: number;
    travel_hours?: number;
    lunch_minutes?: number;
    description?: string;
    semi_truck_travel?: boolean;
    traveling_from?: string;
    destination?: string;
    travel_miles?: number;
  }[];
}

export const TIMESHEET_STATUS_LABELS: Record<TimesheetStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  approved: 'Approved',
  rejected: 'Rejected',
};

export const TIMESHEET_STATUS_COLORS: Record<TimesheetStatus, string> = {
  draft: 'gray',
  submitted: 'blue',
  approved: 'green',
  rejected: 'red',
};

/** Expense categories matching the B&B Metals chart of accounts. */
export const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  'Fuel', 'Safety', 'Repairs & Maintenance', 'Parts',
  'Parking', 'Lodging/Hotels', 'Travel', 'Supplies',
  'MGT Approved Expense', 'Other',
];

/** Lunch break duration options (minutes). */
export const LUNCH_OPTIONS = [0, 15, 30, 45, 60] as const;

/** US state codes for IFTA reporting. */
export const US_STATE_CODES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA',
  'HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
] as const;

/** Standard railroad options for B&B Metals operations */
export const RAILROAD_OPTIONS = [
  'CSX',
  'Norfolk Southern',
  'BNSF',
  'Union Pacific',
  'Canadian National',
  'Canadian Pacific',
  'Kansas City Southern',
  'Amtrak',
  'Short Line',
  'Other',
] as const;

/** Day labels for a Mon-Sun work week */
export const WEEKDAY_LABELS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;
