-- 042_device_sync.sql — Mac ↔ Pi 5 sync layer for IronSight Dev Portal
-- Enables coordinated workflow execution between Mac app and Pi daemon

-- ============================================================
-- Device Heartbeats — tracks which devices are online
-- ============================================================
CREATE TABLE IF NOT EXISTS device_heartbeats (
  id            text PRIMARY KEY,               -- 'mac' or 'pi5'
  device_name   text NOT NULL,
  hostname      text,
  ip_address    text,
  last_seen     timestamptz NOT NULL DEFAULT now(),
  metadata      jsonb NOT NULL DEFAULT '{}'      -- uptime, load, mem, etc.
);

-- ============================================================
-- Add executor tracking to workflow_runs
-- ============================================================
ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS executor text;
-- 'mac', 'pi5', or null (legacy/unknown)

CREATE INDEX IF NOT EXISTS idx_workflow_runs_executor ON workflow_runs(executor);

-- ============================================================
-- Seed starter workflows
-- ============================================================
INSERT INTO dev_workflows (name, description, engine, cron_expression, is_active, config, created_by)
VALUES
  (
    'Fleet Health Check',
    'Run fleet health script on Pi 5 — checks viam-server, CAN bus, PLC, network',
    'dev-pi',
    '*/10 * * * *',
    true,
    '{"command": "/usr/local/bin/fleet-health.sh"}',
    'dev-app'
  ),
  (
    'Git Sync',
    'Pull latest code on Pi 5 from origin/main',
    'dev-pi',
    '*/10 * * * *',
    true,
    '{"command": "/usr/local/bin/fleet-sync.sh"}',
    'dev-app'
  ),
  (
    'Self-Heal Check',
    'Run self-healing diagnostics on Pi 5 — auto-fixes common issues',
    'dev-pi',
    '*/5 * * * *',
    true,
    '{"command": "python3 /home/andrew/Viam-Staubli-Apera-PLC-Mobile-POC/scripts/self-heal.py --force"}',
    'dev-app'
  ),
  (
    'Dashboard Tests',
    'Run vitest suite for the Next.js dashboard',
    'vercel-cron',
    NULL,
    false,
    '{"command": "cd /Users/andrewsieg/Viam-Staubli-Apera-PLC-Mobile-POC/dashboard && npx vitest run"}',
    'dev-app'
  ),
  (
    'System Health Snapshot',
    'Capture system metrics snapshot on Pi 5 for field log',
    'dev-pi',
    NULL,
    false,
    '{"command": "/home/andrew/Viam-Staubli-Apera-PLC-Mobile-POC/scripts/health-snapshot.sh"}',
    'dev-app'
  ),
  (
    'Nightly Code Review',
    'Claude reviews recent git changes and flags issues',
    'vercel-cron',
    '0 3 * * *',
    false,
    '{"prompt": "Review the last 24 hours of git commits in this repo. Summarize changes, flag any potential issues, and suggest improvements. Keep it concise."}',
    'dev-app'
  )
ON CONFLICT DO NOTHING;
