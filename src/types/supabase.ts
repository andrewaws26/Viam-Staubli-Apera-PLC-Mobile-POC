/** Supabase table types matching the database schema. */

export interface TruckNote {
  id: string;
  truck_id: string;
  author_id: string;
  author_name: string;
  author_role: string;
  body: string;
  created_at: string;
}

export interface TruckAssignment {
  id: string;
  user_id: string;
  user_name: string;
  user_role: string;
  truck_id: string;
  assigned_by: string;
  assigned_at: string;
}

export interface AuditLogEntry {
  id: string;
  user_id: string;
  user_name: string;
  user_role: string;
  action: string;
  truck_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

export interface MaintenanceEvent {
  id: string;
  truck_id: string;
  event_type: MaintenanceEventType;
  description: string | null;
  mileage: number | null;
  engine_hours: number | null;
  performed_by: string;
  performed_at: string;
  next_due_mileage: number | null;
  next_due_date: string | null;
  created_by: string;
  created_at: string;
}

export type MaintenanceEventType =
  | 'oil_change'
  | 'filter_replace'
  | 'def_fill'
  | 'tire_rotation'
  | 'brake_inspection'
  | 'coolant_flush'
  | 'belt_replace'
  | 'battery_replace'
  | 'general_service'
  | 'other';

export interface DtcHistoryRecord {
  id: string;
  truck_id: string;
  spn: number;
  fmi: number;
  source_address: number | null;
  description: string | null;
  occurrence_count: number;
  first_seen_at: string;
  last_seen_at: string;
  cleared_at: string | null;
  active: boolean;
  created_at: string;
}

/** Fleet truck config from /api/fleet/trucks */
export interface FleetTruck {
  id: string;
  name: string;
  tpsPartId?: string;
  truckPartId?: string;
  tpsMachineAddress?: string;
  truckMachineAddress?: string;
}

/** Sync status for local records */
export type SyncStatus = 'synced' | 'pending' | 'failed';
