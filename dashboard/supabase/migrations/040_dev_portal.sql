-- 040_dev_portal.sql — Dev Portal tables for IronSight development orchestration
-- Developer-only: prompt library, sessions, health, architecture, knowledge, workflows

-- ============================================================
-- Prompt Library
-- ============================================================
CREATE TABLE IF NOT EXISTS prompt_templates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  description   text,
  category      text NOT NULL DEFAULT 'general',  -- general, diagnostic, report, code, deployment
  body          text NOT NULL,
  variables     jsonb NOT NULL DEFAULT '[]',        -- [{name, description, default}]
  is_active     boolean NOT NULL DEFAULT true,
  created_by    text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS prompt_versions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id   uuid NOT NULL REFERENCES prompt_templates(id) ON DELETE CASCADE,
  version       int NOT NULL,
  body          text NOT NULL,
  variables     jsonb NOT NULL DEFAULT '[]',
  changelog     text,
  created_by    text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, version)
);

-- ============================================================
-- Dev Sessions (Claude Code / AI instance tracking)
-- ============================================================
CREATE TABLE IF NOT EXISTS dev_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_type  text NOT NULL DEFAULT 'claude-code',  -- claude-code, vercel-cron, github-action, manual
  status        text NOT NULL DEFAULT 'running',       -- running, completed, failed, cancelled
  title         text,
  description   text,
  prompt_template_id uuid REFERENCES prompt_templates(id),
  input_context jsonb,                                 -- variables, files touched, etc.
  output_summary text,
  tokens_used   int,
  cost_cents    int,
  started_at    timestamptz NOT NULL DEFAULT now(),
  ended_at      timestamptz,
  created_by    text NOT NULL
);

-- ============================================================
-- System Health Logs
-- ============================================================
CREATE TABLE IF NOT EXISTS system_health_logs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source        text NOT NULL,                         -- vercel, supabase, viam, github, clerk, pi5
  status        text NOT NULL DEFAULT 'healthy',       -- healthy, degraded, down
  response_ms   int,
  details       jsonb,
  checked_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_health_logs_source_time
  ON system_health_logs (source, checked_at DESC);

-- ============================================================
-- Architecture Map (nodes + edges for system visualization)
-- ============================================================
CREATE TABLE IF NOT EXISTS architecture_nodes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  node_type     text NOT NULL,                         -- service, database, device, api, ui
  name          text NOT NULL,
  description   text,
  metadata      jsonb NOT NULL DEFAULT '{}',           -- url, ip, port, version, etc.
  status        text NOT NULL DEFAULT 'active',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS architecture_edges (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id     uuid NOT NULL REFERENCES architecture_nodes(id) ON DELETE CASCADE,
  target_id     uuid NOT NULL REFERENCES architecture_nodes(id) ON DELETE CASCADE,
  edge_type     text NOT NULL DEFAULT 'data',          -- data, auth, deploy, network
  label         text,
  metadata      jsonb NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- Knowledge Base
-- ============================================================
CREATE TABLE IF NOT EXISTS knowledge_entries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category      text NOT NULL,                         -- architecture, debugging, deployment, api, convention
  title         text NOT NULL,
  body          text NOT NULL,
  tags          text[] NOT NULL DEFAULT '{}',
  source        text,                                  -- file path, url, or manual
  created_by    text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_tags ON knowledge_entries USING gin(tags);

-- ============================================================
-- Test Runs
-- ============================================================
CREATE TABLE IF NOT EXISTS dev_test_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  suite         text NOT NULL,                         -- unit, e2e, api-health, visual, safety
  status        text NOT NULL DEFAULT 'running',       -- running, passed, failed, skipped
  total_tests   int,
  passed        int,
  failed        int,
  skipped       int,
  duration_ms   int,
  trigger       text NOT NULL DEFAULT 'manual',        -- manual, ci, cron, pre-deploy
  commit_sha    text,
  branch        text,
  output_url    text,
  details       jsonb,
  started_at    timestamptz NOT NULL DEFAULT now(),
  ended_at      timestamptz
);

-- ============================================================
-- Deployment History
-- ============================================================
CREATE TABLE IF NOT EXISTS deployment_history (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target        text NOT NULL,                         -- vercel, pi5, supabase, github-pages
  status        text NOT NULL DEFAULT 'deploying',     -- deploying, success, failed, rolled-back
  commit_sha    text,
  branch        text,
  deploy_url    text,
  trigger       text NOT NULL DEFAULT 'manual',        -- git-push, manual, cron, rollback
  details       jsonb,
  started_at    timestamptz NOT NULL DEFAULT now(),
  ended_at      timestamptz,
  created_by    text NOT NULL
);

-- ============================================================
-- Workflows (cron jobs, scheduled automation)
-- ============================================================
CREATE TABLE IF NOT EXISTS dev_workflows (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  description   text,
  engine        text NOT NULL,                         -- vercel-cron, github-actions, dev-pi
  cron_expression text,                                -- e.g. "0 3 * * *"
  is_active     boolean NOT NULL DEFAULT false,
  config        jsonb NOT NULL DEFAULT '{}',           -- engine-specific config
  prompt_template_id uuid REFERENCES prompt_templates(id),
  created_by    text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workflow_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id   uuid NOT NULL REFERENCES dev_workflows(id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'running',       -- running, completed, failed, cancelled
  trigger       text NOT NULL DEFAULT 'scheduled',     -- scheduled, manual
  input         jsonb,
  output        jsonb,
  started_at    timestamptz NOT NULL DEFAULT now(),
  ended_at      timestamptz
);
