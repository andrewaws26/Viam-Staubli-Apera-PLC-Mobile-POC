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

/** Available PTO hours per category for a given year. */
export interface PTOBalance {
  id: string;
  user_id: string;
  year: number;
  vacation_hours: number;
  sick_hours: number;
  personal_hours: number;
  created_at: string;
  updated_at: string;
}

/** A single PTO request with approval workflow fields. */
export interface PTORequest {
  id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  request_type: PTORequestType;
  start_date: string;
  end_date: string;
  hours_requested: number;
  status: PTOStatus;
  reason: string | null;
  manager_notes: string | null;
  approved_by: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Payload for creating a new PTO request. */
export interface CreatePTORequestPayload {
  request_type: PTORequestType;
  start_date: string;
  end_date: string;
  hours_requested: number;
  reason?: string;
}

/** Payload for updating a PTO request (status transitions, manager notes). */
export interface UpdatePTORequestPayload {
  status?: PTOStatus;
  manager_notes?: string;
  reason?: string;
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
