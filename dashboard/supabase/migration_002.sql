-- IronSight Fleet Monitor — Migration 002
-- Audit log, maintenance tracking, DTC history

-- ---------------------------------------------------------------------------
-- Audit Log — who did what, when, to which truck
-- ---------------------------------------------------------------------------
create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  user_name text not null,
  user_role text not null,
  action text not null,          -- dtc_clear, plc_command, role_change, ai_diagnosis, ai_chat, note_created, assignment_changed, maintenance_logged
  truck_id text,                 -- null for non-truck actions (e.g. role_change)
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_log_truck_id on audit_log (truck_id);
create index if not exists idx_audit_log_action on audit_log (action);
create index if not exists idx_audit_log_created_at on audit_log (created_at desc);
create index if not exists idx_audit_log_user_id on audit_log (user_id);

-- ---------------------------------------------------------------------------
-- Maintenance Events — service history per truck
-- ---------------------------------------------------------------------------
create table if not exists maintenance_events (
  id uuid primary key default gen_random_uuid(),
  truck_id text not null,
  event_type text not null,       -- oil_change, filter_replace, def_fill, tire_rotation, brake_inspection, general_service, coolant_flush, belt_replace, battery_replace, other
  description text,
  mileage integer,                -- odometer at time of service
  engine_hours numeric,           -- engine hours at time of service
  performed_by text not null,     -- name of person who did the work
  performed_at timestamptz not null default now(),
  next_due_mileage integer,       -- odometer for next service
  next_due_date timestamptz,      -- date for next service
  created_by text not null,       -- clerk user id
  created_at timestamptz not null default now()
);

create index if not exists idx_maintenance_truck_id on maintenance_events (truck_id);
create index if not exists idx_maintenance_event_type on maintenance_events (event_type);
create index if not exists idx_maintenance_performed_at on maintenance_events (performed_at desc);
create index if not exists idx_maintenance_next_due on maintenance_events (next_due_date)
  where next_due_date is not null;

-- ---------------------------------------------------------------------------
-- DTC History — fault code lifecycle tracking
-- ---------------------------------------------------------------------------
create table if not exists dtc_history (
  id uuid primary key default gen_random_uuid(),
  truck_id text not null,
  spn integer not null,           -- Suspect Parameter Number
  fmi integer not null,           -- Failure Mode Identifier
  source_address integer,         -- ECU source address
  description text,               -- human-readable DTC description
  occurrence_count integer not null default 1,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  cleared_at timestamptz,         -- null = still active
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_dtc_history_truck_id on dtc_history (truck_id);
create index if not exists idx_dtc_history_active on dtc_history (truck_id, active) where active = true;
create index if not exists idx_dtc_history_spn_fmi on dtc_history (truck_id, spn, fmi);
create index if not exists idx_dtc_history_first_seen on dtc_history (first_seen_at desc);
