/**
 * Local SQLite database schema for offline-first data storage.
 *
 * All user-generated data (notes, inspections, maintenance, GPS) is written
 * to local SQLite first, then synced to Supabase when online.
 * Sensor readings and AI results are cached locally for offline access.
 *
 * Uses @op-engineering/op-sqlite for fast synchronous SQLite on React Native.
 */

/** SQL statements to create all local tables. Run on app startup. */
export const CREATE_TABLES_SQL = [
  // ── User-generated data (synced to Supabase) ──────────────────────

  `CREATE TABLE IF NOT EXISTS truck_notes (
    local_id INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT UNIQUE,
    truck_id TEXT NOT NULL,
    author_id TEXT NOT NULL,
    author_name TEXT NOT NULL,
    author_role TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    sync_status TEXT NOT NULL DEFAULT 'pending' CHECK(sync_status IN ('synced', 'pending', 'failed'))
  )`,

  `CREATE TABLE IF NOT EXISTS inspections (
    local_id INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT UNIQUE,
    truck_id TEXT NOT NULL,
    inspector_id TEXT NOT NULL,
    inspector_name TEXT NOT NULL,
    inspector_role TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('pre_shift', 'post_shift')),
    items_json TEXT NOT NULL,
    overall_status TEXT NOT NULL CHECK(overall_status IN ('pass', 'fail', 'incomplete')),
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    sync_status TEXT NOT NULL DEFAULT 'pending' CHECK(sync_status IN ('synced', 'pending', 'failed'))
  )`,

  `CREATE TABLE IF NOT EXISTS shift_handoffs (
    local_id INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT UNIQUE,
    truck_id TEXT NOT NULL,
    outgoing_user_id TEXT NOT NULL,
    outgoing_user_name TEXT NOT NULL,
    summary TEXT NOT NULL,
    issues_json TEXT NOT NULL DEFAULT '[]',
    fuel_level_pct REAL,
    mileage INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    sync_status TEXT NOT NULL DEFAULT 'pending' CHECK(sync_status IN ('synced', 'pending', 'failed'))
  )`,

  `CREATE TABLE IF NOT EXISTS maintenance_records (
    local_id INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT UNIQUE,
    truck_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    description TEXT,
    mileage INTEGER,
    engine_hours REAL,
    performed_by TEXT NOT NULL,
    performed_at TEXT NOT NULL DEFAULT (datetime('now')),
    parts_json TEXT DEFAULT '[]',
    photo_uris TEXT DEFAULT '[]',
    next_due_mileage INTEGER,
    next_due_date TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    sync_status TEXT NOT NULL DEFAULT 'pending' CHECK(sync_status IN ('synced', 'pending', 'failed'))
  )`,

  `CREATE TABLE IF NOT EXISTS gps_tracks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    truck_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    altitude REAL,
    speed_mph REAL,
    heading REAL,
    accuracy_meters REAL,
    recorded_at TEXT NOT NULL,
    sync_status TEXT NOT NULL DEFAULT 'pending' CHECK(sync_status IN ('synced', 'pending', 'failed'))
  )`,

  `CREATE TABLE IF NOT EXISTS pending_photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    local_uri TEXT NOT NULL,
    remote_url TEXT,
    associated_table TEXT NOT NULL,
    associated_id TEXT NOT NULL,
    sync_status TEXT NOT NULL DEFAULT 'pending' CHECK(sync_status IN ('synced', 'pending', 'failed'))
  )`,

  // ── Cached data (pulled from server, read-only locally) ──────────

  `CREATE TABLE IF NOT EXISTS cached_truck_readings (
    truck_id TEXT PRIMARY KEY,
    readings_json TEXT NOT NULL,
    fetched_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS cached_fleet_config (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    trucks_json TEXT NOT NULL,
    fetched_at TEXT NOT NULL
  )`,

  // ── AI caches ─────────────────────────────────────────────────────

  `CREATE TABLE IF NOT EXISTS ai_conversation_cache (
    id TEXT PRIMARY KEY,
    truck_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    messages_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS ai_diagnosis_cache (
    id TEXT PRIMARY KEY,
    truck_id TEXT NOT NULL,
    dtc_codes_json TEXT NOT NULL DEFAULT '[]',
    diagnosis_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS shift_reports_cache (
    id TEXT PRIMARY KEY,
    truck_id TEXT NOT NULL,
    shift_date TEXT NOT NULL,
    report_json TEXT NOT NULL,
    fetched_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS pending_ai_requests (
    id TEXT PRIMARY KEY,
    request_type TEXT NOT NULL CHECK(request_type IN ('chat', 'diagnose', 'shift_report')),
    truck_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    sync_status TEXT NOT NULL DEFAULT 'pending' CHECK(sync_status IN ('pending', 'failed'))
  )`,

  `CREATE TABLE IF NOT EXISTS dtc_history_local (
    id TEXT PRIMARY KEY,
    truck_id TEXT NOT NULL,
    spn INTEGER NOT NULL,
    fmi INTEGER NOT NULL,
    ecu_suffix TEXT NOT NULL,
    ecu_label TEXT NOT NULL,
    spn_name TEXT NOT NULL,
    event TEXT NOT NULL CHECK(event IN ('appeared', 'cleared')),
    timestamp TEXT NOT NULL
  )`,

  // ── Indexes ───────────────────────────────────────────────────────

  `CREATE INDEX IF NOT EXISTS idx_notes_truck ON truck_notes(truck_id)`,
  `CREATE INDEX IF NOT EXISTS idx_notes_sync ON truck_notes(sync_status) WHERE sync_status != 'synced'`,
  `CREATE INDEX IF NOT EXISTS idx_inspections_truck ON inspections(truck_id)`,
  `CREATE INDEX IF NOT EXISTS idx_gps_truck_time ON gps_tracks(truck_id, recorded_at)`,
  `CREATE INDEX IF NOT EXISTS idx_gps_sync ON gps_tracks(sync_status) WHERE sync_status != 'synced'`,
  `CREATE INDEX IF NOT EXISTS idx_ai_conv_truck ON ai_conversation_cache(truck_id)`,
  `CREATE INDEX IF NOT EXISTS idx_ai_diag_truck ON ai_diagnosis_cache(truck_id)`,
  `CREATE INDEX IF NOT EXISTS idx_dtc_local_truck ON dtc_history_local(truck_id)`,
  `CREATE INDEX IF NOT EXISTS idx_pending_ai ON pending_ai_requests(sync_status)`,
  `CREATE INDEX IF NOT EXISTS idx_maintenance_truck ON maintenance_records(truck_id)`,
];

/** Current schema version — bump when adding migrations. */
export const SCHEMA_VERSION = 1;
