-- ---------------------------------------------------------------------------
-- Report Query Log — tracks every AI report generation attempt for analysis
-- ---------------------------------------------------------------------------
create table if not exists report_query_log (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  user_name text not null,
  prompt text not null,
  generated_sql text,
  success boolean not null default false,
  error_message text,
  row_count integer,
  execution_time_ms integer,
  retry_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_report_query_log_user on report_query_log (user_id);
create index if not exists idx_report_query_log_success on report_query_log (success);
create index if not exists idx_report_query_log_created on report_query_log (created_at desc);
