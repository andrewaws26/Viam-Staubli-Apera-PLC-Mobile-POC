/** Timesheet types for the IronSight field operations time tracking system. */

export type TimesheetStatus = 'draft' | 'submitted' | 'approved' | 'rejected';

export interface TimesheetDailyLog {
  id: string;
  timesheet_id: string;
  log_date: string;
  start_time: string | null;
  end_time: string | null;
  hours_worked: number | null;
  travel_hours: number | null;
  description: string | null;
  sort_order: number;
  created_at: string;
}

export interface Timesheet {
  id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  week_ending: string;
  status: TimesheetStatus;

  // Railroad / field work details
  railroad_working_on: string | null;
  chase_vehicles: string[];
  semi_trucks: string[];
  work_location: string | null;
  nights_out: number;
  layovers: number;
  coworkers: { id: string; name: string }[];

  // Approval workflow
  submitted_at: string | null;
  approved_by: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
  rejection_reason: string | null;

  notes: string | null;
  created_at: string;
  updated_at: string;

  // Embedded from API
  daily_logs: TimesheetDailyLog[];
  total_hours: number;
  total_travel_hours: number;
}

export interface CreateTimesheetPayload {
  week_ending: string;
  railroad_working_on?: string;
  chase_vehicles?: string[];
  semi_trucks?: string[];
  work_location?: string;
  nights_out?: number;
  layovers?: number;
  coworkers?: { id: string; name: string }[];
  notes?: string;
  daily_logs?: {
    log_date: string;
    start_time?: string;
    end_time?: string;
    hours_worked?: number;
    travel_hours?: number;
    description?: string;
  }[];
}

export interface UpdateTimesheetPayload {
  week_ending?: string;
  railroad_working_on?: string;
  chase_vehicles?: string[];
  semi_trucks?: string[];
  work_location?: string;
  nights_out?: number;
  layovers?: number;
  coworkers?: { id: string; name: string }[];
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
    description?: string;
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
