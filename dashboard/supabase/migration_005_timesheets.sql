-- IronSight Fleet Monitor — Migration 005
-- Timesheet system: weekly field operations time tracking with approval workflow

-- ---------------------------------------------------------------------------
-- Timesheets — one per employee per week
-- ---------------------------------------------------------------------------
create table if not exists timesheets (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,                  -- clerk user id
  user_name text not null,
  user_email text not null default '',
  week_ending date not null,              -- always a Saturday
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'approved', 'rejected')),

  -- Railroad / field work details
  railroad_working_on text,               -- which railroad (CSX, NS, BNSF, etc.)
  chase_vehicles jsonb not null default '[]',   -- array of vehicle number strings
  semi_trucks jsonb not null default '[]',      -- array of semi truck number strings
  work_location text,                     -- city/state
  nights_out integer not null default 0,
  layovers integer not null default 0,
  coworkers jsonb not null default '[]',  -- [{id, name}]

  -- Approval workflow
  submitted_at timestamptz,
  approved_by text,                       -- clerk user id of approver
  approved_by_name text,
  approved_at timestamptz,
  rejection_reason text,

  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Prevent duplicate timesheets for same user + week
  unique (user_id, week_ending)
);

create index if not exists idx_timesheets_user_id on timesheets (user_id);
create index if not exists idx_timesheets_status on timesheets (status);
create index if not exists idx_timesheets_week_ending on timesheets (week_ending desc);
create index if not exists idx_timesheets_submitted on timesheets (submitted_at desc)
  where status != 'draft';

-- ---------------------------------------------------------------------------
-- Timesheet Daily Logs — one per day per timesheet (up to 7)
-- ---------------------------------------------------------------------------
create table if not exists timesheet_daily_logs (
  id uuid primary key default gen_random_uuid(),
  timesheet_id uuid not null references timesheets(id) on delete cascade,
  log_date date not null,
  start_time time,                        -- clock in
  end_time time,                          -- clock out
  hours_worked numeric(5,2) default 0,    -- total work hours for the day
  travel_hours numeric(5,2) default 0,    -- travel time
  description text,                       -- what was done
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_ts_daily_logs_timesheet on timesheet_daily_logs (timesheet_id);
create index if not exists idx_ts_daily_logs_date on timesheet_daily_logs (log_date);

-- ---------------------------------------------------------------------------
-- Company Vehicles — reference data for dropdowns
-- ---------------------------------------------------------------------------
create table if not exists company_vehicles (
  id uuid primary key default gen_random_uuid(),
  vehicle_number text not null unique,
  vehicle_type text not null default 'chase'
    check (vehicle_type in ('chase', 'semi', 'other')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_company_vehicles_type on company_vehicles (vehicle_type)
  where is_active = true;

-- ---------------------------------------------------------------------------
-- Seed some common vehicle numbers (can be managed via admin)
-- ---------------------------------------------------------------------------
insert into company_vehicles (vehicle_number, vehicle_type) values
  ('CV-01', 'chase'), ('CV-02', 'chase'), ('CV-03', 'chase'),
  ('CV-04', 'chase'), ('CV-05', 'chase'),
  ('ST-01', 'semi'), ('ST-02', 'semi'), ('ST-03', 'semi'),
  ('ST-04', 'semi'), ('ST-05', 'semi')
on conflict (vehicle_number) do nothing;
