-- IronSight Fleet Monitor — Supabase schema
-- Run this in the Supabase dashboard SQL editor.

-- ---------------------------------------------------------------------------
-- Truck Notes — mechanics and operators leave notes per truck
-- ---------------------------------------------------------------------------
create table if not exists truck_notes (
  id uuid primary key default gen_random_uuid(),
  truck_id text not null,
  author_id text not null,
  author_name text not null,
  author_role text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_truck_notes_truck_id on truck_notes (truck_id);
create index if not exists idx_truck_notes_created_at on truck_notes (created_at desc);

-- ---------------------------------------------------------------------------
-- Truck Assignments — which users can access which trucks
-- ---------------------------------------------------------------------------
create table if not exists truck_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  user_name text not null,
  user_role text not null,
  truck_id text not null,
  assigned_by text not null,
  assigned_at timestamptz not null default now(),
  unique (user_id, truck_id)
);

create index if not exists idx_truck_assignments_user_id on truck_assignments (user_id);
create index if not exists idx_truck_assignments_truck_id on truck_assignments (truck_id);
