-- Migration 028: AI Report Generator — saved reports + sandboxed query execution
-- Enables natural-language reporting where Claude generates SQL, executed read-only.

-- Saved report definitions
CREATE TABLE saved_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by TEXT NOT NULL,
  created_by_name TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  prompt TEXT NOT NULL,
  generated_sql TEXT NOT NULL,
  is_shared BOOLEAN DEFAULT false,
  category TEXT,
  last_run_at TIMESTAMPTZ,
  run_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_saved_reports_created_by ON saved_reports(created_by);
CREATE INDEX idx_saved_reports_shared ON saved_reports(is_shared) WHERE is_shared = true;

-- Sandboxed read-only query execution function
-- 4-layer security: auth check (app), app-level validation (app), this function (DB), audit log (app)
CREATE OR REPLACE FUNCTION exec_readonly_query(query_text TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '10s'
SET search_path = public
AS $$
DECLARE
  result JSONB;
  normalized TEXT;
BEGIN
  normalized := lower(trim(query_text));

  -- Must be a SELECT or CTE
  IF NOT (normalized LIKE 'select%' OR normalized LIKE 'with%') THEN
    RAISE EXCEPTION 'Only SELECT queries are allowed';
  END IF;

  -- Block mutation and system access keywords
  IF normalized ~ '(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|execute|pg_read_file|pg_write_file|lo_import|lo_export)' THEN
    RAISE EXCEPTION 'Query contains forbidden keywords';
  END IF;

  EXECUTE format('SELECT jsonb_agg(row_to_json(t)) FROM (%s) t', query_text) INTO result;
  RETURN COALESCE(result, '[]'::jsonb);
END;
$$;
