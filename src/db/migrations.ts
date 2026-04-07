/**
 * Schema versioning for local SQLite database.
 * Handles upgrades when the app is updated with new table definitions.
 */

import { SCHEMA_VERSION, CREATE_TABLES_SQL } from './schema';

interface DBHandle {
  execute: (sql: string) => void;
  executeSql?: (sql: string) => { rows: { _array: Record<string, unknown>[] } };
}

/**
 * Initialize the database: create tables and run any pending migrations.
 * Safe to call on every app start — CREATE IF NOT EXISTS is idempotent.
 */
export function initializeDatabase(db: DBHandle): void {
  // Create user_version tracking
  db.execute(`CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, value TEXT)`);

  // Get current version
  let currentVersion = 0;
  try {
    const result = db.executeSql?.(`SELECT value FROM _meta WHERE key = 'schema_version'`);
    if (result && result.rows._array.length > 0) {
      currentVersion = parseInt(String(result.rows._array[0].value), 10) || 0;
    }
  } catch {
    // Table might not exist yet
  }

  // Run all CREATE TABLE statements (idempotent)
  for (const sql of CREATE_TABLES_SQL) {
    db.execute(sql);
  }

  // Update version
  if (currentVersion < SCHEMA_VERSION) {
    db.execute(
      `INSERT OR REPLACE INTO _meta (key, value) VALUES ('schema_version', '${SCHEMA_VERSION}')`
    );
  }
}
