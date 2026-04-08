-- IronSight Fleet Monitor — Migration 003
-- Work order system: task assignment, status tracking, blocker visibility

-- ---------------------------------------------------------------------------
-- Work Orders — shop floor task management
-- ---------------------------------------------------------------------------
create table if not exists work_orders (
  id uuid primary key default gen_random_uuid(),
  truck_id text,                    -- nullable: not all work is truck-specific
  title text not null,
  description text,
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'blocked', 'done')),
  priority text not null default 'normal'
    check (priority in ('low', 'normal', 'urgent')),
  blocker_reason text,              -- first-class: why is this stalled?
  assigned_to text,                 -- clerk user id, null = backlog (pull queue)
  assigned_to_name text,
  created_by text not null,         -- clerk user id
  created_by_name text not null,
  truck_snapshot jsonb,             -- readings snapshot at creation (ambient context)
  linked_dtcs jsonb default '[]',   -- [{spn, fmi, ecuLabel}] from active DTCs
  due_date timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_work_orders_status on work_orders (status);
create index if not exists idx_work_orders_assigned_to on work_orders (assigned_to)
  where assigned_to is not null;
create index if not exists idx_work_orders_truck_id on work_orders (truck_id)
  where truck_id is not null;
create index if not exists idx_work_orders_created_at on work_orders (created_at desc);
create index if not exists idx_work_orders_priority on work_orders (priority)
  where status != 'done';

-- ---------------------------------------------------------------------------
-- Work Order Notes — activity feed / context accumulation
-- ---------------------------------------------------------------------------
create table if not exists work_order_notes (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references work_orders(id) on delete cascade,
  author_id text not null,
  author_name text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_wo_notes_order_id on work_order_notes (work_order_id);
create index if not exists idx_wo_notes_created_at on work_order_notes (created_at desc);

-- ---------------------------------------------------------------------------
-- Work Order Subtasks — breakable steps within a work order
-- ---------------------------------------------------------------------------
create table if not exists work_order_subtasks (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references work_orders(id) on delete cascade,
  title text not null,
  is_done boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_wo_subtasks_order_id on work_order_subtasks (work_order_id);
