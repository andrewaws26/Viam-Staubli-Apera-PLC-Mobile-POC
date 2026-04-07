/**
 * Typed query functions for the local SQLite database.
 * All functions are synchronous (op-sqlite) and return plain objects.
 */

import type { SyncStatus } from '@/types/supabase';

// ⚠️ CRITICAL: This module is designed for @op-engineering/op-sqlite.
// During development without native modules, it falls back to no-ops.
// The DB handle is injected at runtime from the sync engine.

let _db: DatabaseHandle | null = null;

interface DatabaseHandle {
  execute: (sql: string, params?: unknown[]) => { rows: { _array: Record<string, unknown>[] } };
}

/** Set the database handle. Called once from the sync engine on init. */
export function setDbHandle(db: DatabaseHandle): void {
  _db = db;
}

function getDb(): DatabaseHandle {
  if (!_db) throw new Error('Database not initialized. Call setDbHandle() first.');
  return _db;
}

// ── Truck Notes ─────────────────────────────────────────────────────

export interface LocalNote {
  localId: number;
  id: string | null;
  truckId: string;
  authorId: string;
  authorName: string;
  authorRole: string;
  body: string;
  createdAt: string;
  syncStatus: SyncStatus;
}

export function insertNote(note: Omit<LocalNote, 'localId' | 'syncStatus'>): void {
  const db = getDb();
  db.execute(
    `INSERT INTO truck_notes (id, truck_id, author_id, author_name, author_role, body, created_at, sync_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
    [note.id, note.truckId, note.authorId, note.authorName, note.authorRole, note.body, note.createdAt]
  );
}

export function getNotesForTruck(truckId: string, limit: number = 50): LocalNote[] {
  const db = getDb();
  const result = db.execute(
    `SELECT local_id, id, truck_id, author_id, author_name, author_role, body, created_at, sync_status
     FROM truck_notes WHERE truck_id = ? ORDER BY created_at DESC LIMIT ?`,
    [truckId, limit]
  );
  return result.rows._array.map(mapNote);
}

export function getPendingNotes(): LocalNote[] {
  const db = getDb();
  const result = db.execute(
    `SELECT * FROM truck_notes WHERE sync_status != 'synced' ORDER BY created_at ASC`
  );
  return result.rows._array.map(mapNote);
}

export function markNoteSynced(localId: number, remoteId: string): void {
  const db = getDb();
  db.execute(`UPDATE truck_notes SET id = ?, sync_status = 'synced' WHERE local_id = ?`, [remoteId, localId]);
}

function mapNote(row: Record<string, unknown>): LocalNote {
  return {
    localId: row.local_id as number,
    id: row.id as string | null,
    truckId: row.truck_id as string,
    authorId: row.author_id as string,
    authorName: row.author_name as string,
    authorRole: row.author_role as string,
    body: row.body as string,
    createdAt: row.created_at as string,
    syncStatus: row.sync_status as SyncStatus,
  };
}

// ── Inspections ─────────────────────────────────────────────────────

export function insertInspection(data: {
  id: string;
  truckId: string;
  inspectorId: string;
  inspectorName: string;
  inspectorRole: string;
  type: string;
  itemsJson: string;
  overallStatus: string;
  notes?: string;
  createdAt: string;
}): void {
  const db = getDb();
  db.execute(
    `INSERT INTO inspections (id, truck_id, inspector_id, inspector_name, inspector_role, type, items_json, overall_status, notes, created_at, sync_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    [data.id, data.truckId, data.inspectorId, data.inspectorName, data.inspectorRole, data.type, data.itemsJson, data.overallStatus, data.notes || null, data.createdAt]
  );
}

export function getInspectionsForTruck(truckId: string, limit: number = 20): Record<string, unknown>[] {
  const db = getDb();
  const result = db.execute(
    `SELECT * FROM inspections WHERE truck_id = ? ORDER BY created_at DESC LIMIT ?`,
    [truckId, limit]
  );
  return result.rows._array;
}

// ── Maintenance ─────────────────────────────────────────────────────

export function insertMaintenance(data: {
  id: string;
  truckId: string;
  eventType: string;
  description?: string;
  mileage?: number;
  engineHours?: number;
  performedBy: string;
  performedAt: string;
  partsJson?: string;
  photoUris?: string;
  nextDueMileage?: number;
  nextDueDate?: string;
  createdBy: string;
}): void {
  const db = getDb();
  db.execute(
    `INSERT INTO maintenance_records (id, truck_id, event_type, description, mileage, engine_hours, performed_by, performed_at, parts_json, photo_uris, next_due_mileage, next_due_date, created_by, sync_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    [data.id, data.truckId, data.eventType, data.description || null, data.mileage || null, data.engineHours || null, data.performedBy, data.performedAt, data.partsJson || '[]', data.photoUris || '[]', data.nextDueMileage || null, data.nextDueDate || null, data.createdBy]
  );
}

export function getMaintenanceForTruck(truckId: string, limit: number = 20): Record<string, unknown>[] {
  const db = getDb();
  const result = db.execute(
    `SELECT * FROM maintenance_records WHERE truck_id = ? ORDER BY performed_at DESC LIMIT ?`,
    [truckId, limit]
  );
  return result.rows._array;
}

// ── GPS Tracks ──────────────────────────────────────────────────────

export function insertGpsPoint(data: {
  truckId: string;
  userId: string;
  latitude: number;
  longitude: number;
  altitude?: number;
  speedMph?: number;
  heading?: number;
  accuracyMeters?: number;
  recordedAt: string;
}): void {
  const db = getDb();
  db.execute(
    `INSERT INTO gps_tracks (truck_id, user_id, latitude, longitude, altitude, speed_mph, heading, accuracy_meters, recorded_at, sync_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    [data.truckId, data.userId, data.latitude, data.longitude, data.altitude || null, data.speedMph || null, data.heading || null, data.accuracyMeters || null, data.recordedAt]
  );
}

export function getPendingGpsCount(): number {
  const db = getDb();
  const result = db.execute(`SELECT COUNT(*) as count FROM gps_tracks WHERE sync_status = 'pending'`);
  return (result.rows._array[0]?.count as number) || 0;
}

// ── Cached Readings ─────────────────────────────────────────────────

export function cacheTruckReadings(truckId: string, readings: Record<string, unknown>): void {
  const db = getDb();
  db.execute(
    `INSERT OR REPLACE INTO cached_truck_readings (truck_id, readings_json, fetched_at)
     VALUES (?, ?, datetime('now'))`,
    [truckId, JSON.stringify(readings)]
  );
}

export function getCachedReadings(truckId: string): Record<string, unknown> | null {
  const db = getDb();
  const result = db.execute(
    `SELECT readings_json, fetched_at FROM cached_truck_readings WHERE truck_id = ?`,
    [truckId]
  );
  if (result.rows._array.length === 0) return null;
  try {
    return JSON.parse(result.rows._array[0].readings_json as string);
  } catch {
    return null;
  }
}

export function getCachedReadingsAge(truckId: string): number | null {
  const db = getDb();
  const result = db.execute(
    `SELECT fetched_at FROM cached_truck_readings WHERE truck_id = ?`,
    [truckId]
  );
  if (result.rows._array.length === 0) return null;
  const fetched = new Date(result.rows._array[0].fetched_at as string).getTime();
  return (Date.now() - fetched) / 1000;
}

// ── Fleet Config Cache ──────────────────────────────────────────────

export function cacheFleetConfig(trucks: unknown[]): void {
  const db = getDb();
  db.execute(
    `INSERT OR REPLACE INTO cached_fleet_config (id, trucks_json, fetched_at) VALUES (1, ?, datetime('now'))`,
    [JSON.stringify(trucks)]
  );
}

export function getCachedFleetConfig(): unknown[] | null {
  const db = getDb();
  const result = db.execute(`SELECT trucks_json FROM cached_fleet_config WHERE id = 1`);
  if (result.rows._array.length === 0) return null;
  try {
    return JSON.parse(result.rows._array[0].trucks_json as string);
  } catch {
    return null;
  }
}

// ── AI Caches ───────────────────────────────────────────────────────

export function cacheAiConversation(id: string, truckId: string, userId: string, messages: unknown[]): void {
  const db = getDb();
  db.execute(
    `INSERT OR REPLACE INTO ai_conversation_cache (id, truck_id, user_id, messages_json, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))`,
    [id, truckId, userId, JSON.stringify(messages)]
  );
}

export function getCachedConversation(truckId: string): { id: string; messages: unknown[] } | null {
  const db = getDb();
  const result = db.execute(
    `SELECT id, messages_json FROM ai_conversation_cache WHERE truck_id = ? ORDER BY updated_at DESC LIMIT 1`,
    [truckId]
  );
  if (result.rows._array.length === 0) return null;
  try {
    return {
      id: result.rows._array[0].id as string,
      messages: JSON.parse(result.rows._array[0].messages_json as string),
    };
  } catch {
    return null;
  }
}

export function cacheAiDiagnosis(id: string, truckId: string, dtcCodes: string[], diagnosis: string): void {
  const db = getDb();
  db.execute(
    `INSERT OR REPLACE INTO ai_diagnosis_cache (id, truck_id, dtc_codes_json, diagnosis_json, created_at)
     VALUES (?, ?, ?, ?, datetime('now'))`,
    [id, truckId, JSON.stringify(dtcCodes), diagnosis]
  );
}

export function getCachedDiagnosis(truckId: string): { id: string; diagnosis: string; createdAt: string } | null {
  const db = getDb();
  const result = db.execute(
    `SELECT id, diagnosis_json, created_at FROM ai_diagnosis_cache WHERE truck_id = ? ORDER BY created_at DESC LIMIT 1`,
    [truckId]
  );
  if (result.rows._array.length === 0) return null;
  return {
    id: result.rows._array[0].id as string,
    diagnosis: result.rows._array[0].diagnosis_json as string,
    createdAt: result.rows._array[0].created_at as string,
  };
}

// ── Pending AI Requests ─────────────────────────────────────────────

export function queueAiRequest(data: {
  id: string;
  requestType: 'chat' | 'diagnose' | 'shift_report';
  truckId: string;
  payload: Record<string, unknown>;
}): void {
  const db = getDb();
  db.execute(
    `INSERT INTO pending_ai_requests (id, request_type, truck_id, payload_json, sync_status)
     VALUES (?, ?, ?, ?, 'pending')`,
    [data.id, data.requestType, data.truckId, JSON.stringify(data.payload)]
  );
}

export function getPendingAiRequests(): Record<string, unknown>[] {
  const db = getDb();
  const result = db.execute(
    `SELECT * FROM pending_ai_requests WHERE sync_status = 'pending' ORDER BY created_at ASC`
  );
  return result.rows._array;
}

export function removePendingAiRequest(id: string): void {
  const db = getDb();
  db.execute(`DELETE FROM pending_ai_requests WHERE id = ?`, [id]);
}

// ── Sync Counts ─────────────────────────────────────────────────────

export function getPendingSyncCount(): { notes: number; inspections: number; maintenance: number; gps: number; photos: number; ai: number; total: number } {
  const db = getDb();
  const counts = {
    notes: (db.execute(`SELECT COUNT(*) as c FROM truck_notes WHERE sync_status = 'pending'`).rows._array[0]?.c as number) || 0,
    inspections: (db.execute(`SELECT COUNT(*) as c FROM inspections WHERE sync_status = 'pending'`).rows._array[0]?.c as number) || 0,
    maintenance: (db.execute(`SELECT COUNT(*) as c FROM maintenance_records WHERE sync_status = 'pending'`).rows._array[0]?.c as number) || 0,
    gps: (db.execute(`SELECT COUNT(*) as c FROM gps_tracks WHERE sync_status = 'pending'`).rows._array[0]?.c as number) || 0,
    photos: (db.execute(`SELECT COUNT(*) as c FROM pending_photos WHERE sync_status = 'pending'`).rows._array[0]?.c as number) || 0,
    ai: (db.execute(`SELECT COUNT(*) as c FROM pending_ai_requests WHERE sync_status = 'pending'`).rows._array[0]?.c as number) || 0,
    total: 0,
  };
  counts.total = counts.notes + counts.inspections + counts.maintenance + counts.gps + counts.photos + counts.ai;
  return counts;
}
