/**
 * Training compliance types for IronSight Company OS.
 *
 * Tracks safety certifications and training requirements for field workers.
 * Two-table design:
 *   - Requirements: company-wide definitions (what training exists, frequency)
 *   - Records: individual completion entries with expiry tracking
 *
 * Compliance status is computed in the application layer:
 *   current       → latest record exists AND (no expiry OR expiry > today)
 *   expiring_soon → expiry within 30 days of today
 *   expired       → expiry < today
 *   missing       → no record exists for a required training
 *
 * A user is "compliant" when ALL active+required trainings are "current".
 */

export type TrainingComplianceStatus = 'current' | 'expiring_soon' | 'expired' | 'missing';

/** A company-wide training requirement definition. */
export interface TrainingRequirement {
  id: string;
  name: string;
  description: string | null;
  /** Months between recertification. null = one-time (never expires). */
  frequency_months: number | null;
  is_required: boolean;
  is_active: boolean;
  created_at: string;
}

/** An individual training completion record. */
export interface TrainingRecord {
  id: string;
  user_id: string;
  user_name: string;
  requirement_id: string;
  /** Joined from training_requirements — present in API responses. */
  requirement_name?: string;
  completed_date: string;
  /** Computed: completed_date + requirement.frequency_months. null if one-time. */
  expiry_date: string | null;
  certificate_url: string | null;
  notes: string | null;
  recorded_by: string;
  recorded_by_name: string;
  created_at: string;
}

/** Payload for logging a new training completion. */
export interface CreateTrainingRecordPayload {
  user_id: string;
  requirement_id: string;
  completed_date: string;
  expiry_date?: string;
  certificate_url?: string;
  notes?: string;
}

/** Aggregated compliance status for one user across all requirements. */
export interface UserTrainingStatus {
  user_id: string;
  user_name: string;
  total_required: number;
  completed: number;
  current: number;
  expiring_soon: number;
  expired: number;
  missing: number;
  /** True when every active+required training has a "current" record. */
  is_compliant: boolean;
  details: TrainingComplianceDetail[];
}

/** Compliance detail for a single requirement for a single user. */
export interface TrainingComplianceDetail {
  requirement: TrainingRequirement;
  latest_record: TrainingRecord | null;
  status: TrainingComplianceStatus;
  /** Days until expiry (negative = overdue). null if one-time or missing. */
  days_until_expiry: number | null;
}

export const COMPLIANCE_STATUS_LABELS: Record<TrainingComplianceStatus, string> = {
  current: 'Current',
  expiring_soon: 'Expiring Soon',
  expired: 'Expired',
  missing: 'Not Completed',
};

export const COMPLIANCE_STATUS_COLORS: Record<TrainingComplianceStatus, string> = {
  current: '#22c55e',
  expiring_soon: '#f59e0b',
  expired: '#ef4444',
  missing: '#6b7280',
};
