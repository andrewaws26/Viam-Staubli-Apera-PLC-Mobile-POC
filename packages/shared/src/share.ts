/** Types for the report/snapshot sharing system. */

export type ShareableEntityType = "snapshot" | "shift_report" | "saved_report";

export interface SharedLink {
  id: string;
  token: string;
  entity_type: ShareableEntityType;
  entity_id: string | null;
  entity_payload: Record<string, unknown> | null;
  title: string;
  created_by: string;
  created_by_name: string;
  recipient_email: string | null;
  recipient_name: string | null;
  message: string | null;
  expires_at: string | null;
  viewed_at: string | null;
  view_count: number;
  created_at: string;
}

export interface CreateSharePayload {
  entity_type: ShareableEntityType;
  entity_id?: string;
  entity_payload?: Record<string, unknown>;
  title: string;
  recipient_email?: string;
  recipient_name?: string;
  message?: string;
  expires_in_days?: number;
}

export interface ShareResponse {
  token: string;
  url: string;
  email_sent: boolean;
}
