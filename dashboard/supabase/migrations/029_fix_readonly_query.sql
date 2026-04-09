-- Migration 029: Fix exec_readonly_query — word boundary regex
--
-- The original regex used substring matching, blocking any query with columns
-- like created_at, updated_at, is_deleted, etc. because "create", "update",
-- "delete" matched as substrings. PostgreSQL uses \m and \M for word boundaries.

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

  -- Block mutation and system access keywords (with word boundaries)
  IF normalized ~ '\m(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|execute)\M' THEN
    RAISE EXCEPTION 'Query contains forbidden keywords';
  END IF;

  -- Block system catalog and file I/O access
  IF normalized ~ '\m(pg_catalog|information_schema|pg_read_file|pg_write_file|lo_import|lo_export)\M' THEN
    RAISE EXCEPTION 'Query contains forbidden system access';
  END IF;

  -- Block privilege escalation
  IF normalized ~ '\mset\s+(role|session)\M' THEN
    RAISE EXCEPTION 'Query contains forbidden privilege commands';
  END IF;

  EXECUTE format('SELECT jsonb_agg(row_to_json(t)) FROM (%s) t', query_text) INTO result;
  RETURN COALESCE(result, '[]'::jsonb);
END;
$$;
