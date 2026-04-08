-- Migration 027: Add nextval_text RPC function
-- Used by estimates route to atomically get next estimate number from sequence.
-- Without this, the fallback (max + 1) has a race condition on concurrent requests.

CREATE OR REPLACE FUNCTION nextval_text(seq_name TEXT)
RETURNS TEXT AS $$
BEGIN
  RETURN nextval(seq_name)::TEXT;
END;
$$ LANGUAGE plpgsql;
