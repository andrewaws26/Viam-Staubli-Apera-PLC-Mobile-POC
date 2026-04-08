/**
 * PTO (Paid Time Off) types for IronSight Company OS.
 *
 * Covers the full time-off lifecycle:
 *   1. Balance tracking per user per year (vacation, sick, personal hours)
 *   2. Request creation with date range and hours
 *   3. Approval workflow: pending → approved/rejected/cancelled
 *   4. Manager admin view with pending queue and calendar
 *
 * Hours are deducted from balance only when a request is approved.
 * Rejected or cancelled requests do not affect balances.
 */

export type PTORequestType = 'vacation' | 'sick' | 'personal' | 'bereavement' | 'other';
export type PTOStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

/** Available PTO hours per category for a given year (matches DB columns). */
export interface PTOBalance {
  id: string;
  user_id: string;
  user_name?: string;
  year: number;
  vacation_hours_total: number;
  vacation_hours_used: number;
  sick_hours_total: number;
  sick_hours_used: number;
  personal_hours_total: number;
  personal_hours_used: number;
  /** Computed by API: total - used */
  vacation_remaining: number;
  sick_remaining: number;
  personal_remaining: number;
  created_at: string;
  updated_at: string;
}

/** A single PTO request with approval workflow fields (matches DB columns). */
export interface PTORequest {
  id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  pto_type: PTORequestType;
  start_date: string;
  end_date: string;
  hours: number;
  status: PTOStatus;
  notes: string | null;
  manager_notes: string | null;
  reviewed_by: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Payload for creating a new PTO request (matches API expected fields). */
export interface CreatePTORequestPayload {
  pto_type: PTORequestType;
  start_date: string;
  end_date: string;
  hours: number;
  notes?: string;
}

/** Payload for updating a PTO request (status transitions, manager notes). */
export interface UpdatePTORequestPayload {
  status?: PTOStatus;
  manager_notes?: string;
  notes?: string;
}

/** Admin API response from GET /api/pto/admin. */
export interface PTOAdminResponse {
  requests: PTORequest[];
  summary: {
    total: number;
    pending_count: number;
    approved_this_month: number;
    by_employee: {
      user_id: string;
      name: string;
      pending: number;
      approved_hours: number;
      total_requests: number;
    }[];
  };
  upcoming: PTORequest[];
}

/** Human-readable labels for PTO request types. */
export const PTO_TYPE_LABELS: Record<PTORequestType, string> = {
  vacation: 'Vacation',
  sick: 'Sick',
  personal: 'Personal',
  bereavement: 'Bereavement',
  other: 'Other',
};

/** Human-readable labels for PTO statuses. */
export const PTO_STATUS_LABELS: Record<PTOStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

/** Color coding for PTO statuses (hex values). */
export const PTO_STATUS_COLORS: Record<PTOStatus, string> = {
  pending: '#f59e0b',
  approved: '#22c55e',
  rejected: '#ef4444',
  cancelled: '#6b7280',
};
