/**
 * Shared Viam Data API client — connects to Viam Cloud directly (no WebRTC).
 *
 * This is the SINGLE source of truth for all Viam Data API access in the
 * dashboard. Every API route that reads sensor data should import from here
 * instead of creating its own client.
 *
 * Uses createViamClient which communicates over HTTPS/gRPC to the Viam Cloud
 * API, bypassing WebRTC entirely. This works reliably through any NAT,
 * including carrier-grade NAT from iPhone tethering.
 *
 * Data captured by viam-server syncs to the cloud every ~6 seconds, so
 * readings fetched here may be up to 6 seconds old.
 *
 * Exports:
 *   - getDataClient()     — cached singleton Viam Data API client
 *   - resetDataClient()   — reset on connection errors
 *   - getLatestReading()  — fetch most recent sensor reading
 *   - fetchSensorData()   — fetch time range of sensor readings
 *   - unwrapPayload()     — unwrap Viam's payload.readings nesting
 *   - Types: CachedViamClient, TabularDataPoint, RawPoint
 */

import { createViamClient } from "@viamrobotics/sdk";

// ── Types ─────────────────────────────────────────────────────────────

/** Cached Viam Data API client interface (SDK exports ViamClient as type-only). */
export interface CachedViamClient {
  dataClient: {
    exportTabularData(
      partId: string,
      resourceName: string,
      resourceSubtype: string,
      methodName: string,
      startTime?: Date,
      endTime?: Date,
    ): Promise<TabularDataPoint[]>;
  };
}

/** A single row from exportTabularData. */
export interface TabularDataPoint {
  timeCaptured: Date;
  payload: unknown;
  [key: string]: unknown;
}

/** A sensor reading after unwrapping the Viam payload nesting. */
export interface RawPoint {
  timeCaptured: Date;
  payload: Record<string, unknown>;
}

// ── Constants ─────────────────────────────────────────────────────────

const RESOURCE_SUBTYPE = "rdk:component:sensor";
const METHOD_NAME = "Readings";

// ── Singleton client ──────────────────────────────────────────────────

let _viamClient: CachedViamClient | null = null;
let _connecting = false;
let _lastError: string | null = null;

/**
 * Returns a cached Viam Data API client, creating one if needed.
 * All API routes should use this instead of creating their own client.
 */
export async function getDataClient(): Promise<CachedViamClient["dataClient"]> {
  if (_viamClient !== null) return _viamClient.dataClient;

  if (_connecting) {
    await new Promise((r) => setTimeout(r, 500));
    if (_viamClient !== null) return (_viamClient as CachedViamClient).dataClient;
    throw new Error(_lastError || "Connection in progress");
  }

  const apiKey = process.env.VIAM_API_KEY;
  const apiKeyId = process.env.VIAM_API_KEY_ID;

  if (!apiKey || !apiKeyId) {
    throw new Error(
      "Missing server-side Viam credentials. " +
        "Set VIAM_API_KEY and VIAM_API_KEY_ID in environment variables."
    );
  }

  _connecting = true;
  _lastError = null;
  try {
    const client = await createViamClient({
      credentials: {
        type: "api-key",
        authEntity: apiKeyId,
        payload: apiKey,
      },
    });
    _viamClient = client as unknown as CachedViamClient;
    return _viamClient.dataClient;
  } catch (err) {
    _lastError = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    _connecting = false;
  }
}

/** Reset the cached client (e.g. on connection errors so the next request retries). */
export function resetDataClient(): void {
  _viamClient = null;
}

// ── Payload helpers ───────────────────────────────────────────────────

/**
 * Unwrap the Viam Cloud payload nesting.
 *
 * Viam stores sensor readings as: { payload: { readings: { ...fields } } }
 * This function extracts the inner readings object. If the nesting is absent
 * (e.g. during format changes), it falls back to the raw payload.
 */
export function unwrapPayload(payload: unknown): Record<string, unknown> {
  const raw = (typeof payload === "object" && payload !== null
    ? payload
    : {}) as Record<string, unknown>;
  return (typeof raw.readings === "object" && raw.readings !== null
    ? raw.readings
    : raw) as Record<string, unknown>;
}

/**
 * Normalize a timeCaptured value to a Date (Viam SDK sometimes returns strings).
 */
export function normalizeTimestamp(t: Date | string | unknown): Date {
  if (t instanceof Date) return t;
  return new Date(String(t));
}

// ── Query helpers ─────────────────────────────────────────────────────

/**
 * Fetch the most recent sensor reading from the Viam Data API.
 *
 * Queries the last `windowSeconds` of data and returns the most recent point.
 * Returns null if no data is available in that window.
 */
export async function getLatestReading(
  partId: string,
  resourceName: string,
  windowSeconds = 300,
): Promise<RawPoint | null> {
  const dc = await getDataClient();
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - windowSeconds * 1000);

  const rows = await dc.exportTabularData(
    partId, resourceName, RESOURCE_SUBTYPE, METHOD_NAME, startTime, endTime,
  );

  if (rows.length === 0) return null;

  // Sort descending by time, take the newest
  rows.sort((a, b) =>
    normalizeTimestamp(b.timeCaptured).getTime() - normalizeTimestamp(a.timeCaptured).getTime()
  );

  return {
    timeCaptured: normalizeTimestamp(rows[0].timeCaptured),
    payload: unwrapPayload(rows[0].payload),
  };
}

/**
 * Fetch a time range of sensor readings, sorted oldest-first.
 *
 * Returns unwrapped RawPoint[] ready for analysis. Used by history routes,
 * shift reports, and AI analytics.
 */
export async function fetchSensorData(
  partId: string,
  resourceName: string,
  hours: number,
): Promise<RawPoint[]> {
  const dc = await getDataClient();
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - hours * 3600000);

  const rows = await dc.exportTabularData(
    partId, resourceName, RESOURCE_SUBTYPE, METHOD_NAME, startTime, endTime,
  );

  const points: RawPoint[] = rows.map((row) => ({
    timeCaptured: normalizeTimestamp(row.timeCaptured),
    payload: unwrapPayload(row.payload),
  }));

  points.sort((a, b) => a.timeCaptured.getTime() - b.timeCaptured.getTime());
  return points;
}
