-- IronSight Mobile — Supabase migration
-- New tables for mobile app features (GPS tracking, push notifications, inspections, handoffs)
-- Run in Supabase SQL Editor: https://supabase.com/dashboard/project/bppztvrvaajrgyfwesoe/sql

-- ---------------------------------------------------------------------------
-- GPS Tracks — location history from mobile GPS tracking
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gps_tracks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  truck_id text NOT NULL,
  user_id text NOT NULL,
  latitude numeric NOT NULL,
  longitude numeric NOT NULL,
  altitude numeric,
  speed_mph numeric,
  heading numeric,
  accuracy_meters numeric,
  recorded_at timestamptz NOT NULL,
  synced_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gps_tracks_truck_time ON gps_tracks (truck_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_gps_tracks_user ON gps_tracks (user_id);

-- ---------------------------------------------------------------------------
-- Push Tokens — Expo push notification tokens per device
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS push_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  expo_token text NOT NULL,
  device_name text,
  platform text NOT NULL, -- 'ios' or 'android'
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, expo_token)
);

CREATE INDEX IF NOT EXISTS idx_push_tokens_user ON push_tokens (user_id);

-- ---------------------------------------------------------------------------
-- Inspections — pre/post-shift checklists from mobile app
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  truck_id text NOT NULL,
  inspector_id text NOT NULL,
  inspector_name text NOT NULL,
  inspector_role text NOT NULL,
  type text NOT NULL CHECK (type IN ('pre_shift', 'post_shift')),
  items_json jsonb NOT NULL,
  overall_status text NOT NULL CHECK (overall_status IN ('pass', 'fail', 'incomplete')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inspections_truck ON inspections (truck_id);
CREATE INDEX IF NOT EXISTS idx_inspections_created ON inspections (created_at DESC);

-- ---------------------------------------------------------------------------
-- Shift Handoffs — end-of-shift handoff forms
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shift_handoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  truck_id text NOT NULL,
  outgoing_user_id text NOT NULL,
  outgoing_user_name text NOT NULL,
  summary text NOT NULL,
  issues_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  fuel_level_pct numeric,
  mileage integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_handoffs_truck ON shift_handoffs (truck_id);
CREATE INDEX IF NOT EXISTS idx_handoffs_created ON shift_handoffs (created_at DESC);
