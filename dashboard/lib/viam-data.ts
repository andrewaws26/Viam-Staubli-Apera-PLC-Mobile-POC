/**
 * Shared Viam Data API client — connects to Viam Cloud directly (no WebRTC).
 *
 * Uses createViamClient which communicates over HTTPS/gRPC to the Viam Cloud
 * API, bypassing WebRTC entirely. This works reliably through any NAT,
 * including carrier-grade NAT from iPhone tethering.
 *
 * Data captured by viam-server syncs to the cloud every ~6 seconds, so
 * readings fetched here may be up to 6 seconds old.
 */

import { createViamClient } from "@viamrobotics/sdk";

// The SDK exports ViamClient as a type-only export, so we define an interface
// matching the properties we actually use.
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

export interface TabularDataPoint {
  timeCaptured: Date;
  payload: unknown;
  [key: string]: unknown;
}

let _viamClient: CachedViamClient | null = null;
let _connecting = false;
let _lastError: string | null = null;

/**
 * Returns a cached Viam Data API client, creating one if needed.
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

/**
 * Reset the cached client (e.g. on connection errors).
 */
export function resetDataClient(): void {
  _viamClient = null;
}

/**
 * Fetch the most recent sensor reading from the Viam Data API.
 *
 * Queries the last `windowSeconds` of data and returns the most recent point.
 * Returns null if no data is available in that window.
 */
export async function getLatestReading(
  partId: string,
  resourceName: string,
  windowSeconds = 30,
): Promise<{ timeCaptured: Date; payload: Record<string, unknown> } | null> {
  const dc = await getDataClient();
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - windowSeconds * 1000);

  const rows = await dc.exportTabularData(
    partId,
    resourceName,
    "rdk:component:sensor",
    "Readings",
    startTime,
    endTime,
  );

  if (rows.length === 0) return null;

  // Sort by time and return the most recent
  rows.sort((a, b) => {
    const ta = a.timeCaptured instanceof Date ? a.timeCaptured : new Date(String(a.timeCaptured));
    const tb = b.timeCaptured instanceof Date ? b.timeCaptured : new Date(String(b.timeCaptured));
    return tb.getTime() - ta.getTime();
  });

  const latest = rows[0];
  return {
    timeCaptured: latest.timeCaptured instanceof Date
      ? latest.timeCaptured
      : new Date(String(latest.timeCaptured)),
    payload: (typeof latest.payload === "object" && latest.payload !== null
      ? latest.payload
      : {}) as Record<string, unknown>,
  };
}
