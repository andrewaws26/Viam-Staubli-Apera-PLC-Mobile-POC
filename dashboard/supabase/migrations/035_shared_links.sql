-- Shared links for report/snapshot sharing (email + public URL)
-- Supports snapshots, shift reports, and saved reports

CREATE TABLE IF NOT EXISTS shared_links (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('snapshot', 'shift_report', 'saved_report')),
  entity_id TEXT,                        -- UUID for snapshots/reports, NULL for shift reports
  entity_payload JSONB,                  -- Stored report data (shift reports have no DB row)
  title TEXT NOT NULL,                   -- Human-readable title for the shared item
  created_by TEXT NOT NULL,              -- Clerk user ID
  created_by_name TEXT NOT NULL,
  recipient_email TEXT,                  -- Optional: who it was shared with
  recipient_name TEXT,                   -- Optional: display name
  message TEXT,                          -- Optional: personal message from sender
  expires_at TIMESTAMPTZ,               -- NULL = never expires
  viewed_at TIMESTAMPTZ,                -- First view timestamp
  view_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_shared_links_token ON shared_links(token);
CREATE INDEX idx_shared_links_creator ON shared_links(created_by);
CREATE INDEX idx_shared_links_entity ON shared_links(entity_type, entity_id);
