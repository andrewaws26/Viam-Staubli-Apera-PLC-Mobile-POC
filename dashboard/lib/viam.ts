// Viam SDK wrapper for browser-side machine connection.
//
// Credentials are loaded from NEXT_PUBLIC_* env vars and are therefore
// visible in the browser bundle. This is acceptable for a POC demo.
// In production, proxy these calls through a Next.js API route.
//
// Viam SDK version note: this file targets @viamrobotics/sdk ^0.34.0.
// If the API has changed, the most likely fix is renaming `credentials`
// to `credential` (singular) in the createRobotClient call below.

import { createRobotClient, SensorClient } from "@viamrobotics/sdk";
import type { RobotClient } from "@viamrobotics/sdk";

import { SensorReadings } from "./types";

let _client: RobotClient | null = null;
let _connecting = false;

async function getClient(): Promise<RobotClient> {
  if (_client) return _client;
  if (_connecting) {
    // Wait for in-flight connection to resolve
    await new Promise((r) => setTimeout(r, 500));
    if (_client) return _client;
  }

  const host = process.env.NEXT_PUBLIC_VIAM_MACHINE_ADDRESS;
  const apiKey = process.env.NEXT_PUBLIC_VIAM_API_KEY;
  const apiKeyId = process.env.NEXT_PUBLIC_VIAM_API_KEY_ID;

  if (!host || !apiKey || !apiKeyId) {
    throw new Error(
      "Missing Viam credentials. " +
        "Set NEXT_PUBLIC_VIAM_MACHINE_ADDRESS, NEXT_PUBLIC_VIAM_API_KEY, " +
        "and NEXT_PUBLIC_VIAM_API_KEY_ID in dashboard/.env.local"
    );
  }

  _connecting = true;
  try {
    console.log("[viam] Connecting to", host);
    _client = await createRobotClient({
      host,
      credentials: {
        type: "api-key",
        authEntity: apiKeyId,
        payload: apiKey,
      },
      signalingAddress: "https://app.viam.com:443",
      reconnectMaxAttempts: 3,
    });
    console.log("[viam] Connected successfully");
    return _client;
  } catch (err) {
    console.error("[viam] Connection failed:", err);
    throw err;
  } finally {
    _connecting = false;
  }
}

export class ComponentNotFoundError extends Error {
  constructor(componentName: string) {
    super(`Component "${componentName}" not configured on this machine`);
    this.name = "ComponentNotFoundError";
  }
}

export async function getSensorReadings(
  componentName: string
): Promise<SensorReadings> {
  const client = await getClient();
  try {
    const sensor = new SensorClient(client, componentName);
    const readings = await sensor.getReadings();
    return readings as SensorReadings;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[viam] getSensorReadings("${componentName}") error:`, msg);
    // Viam SDK / gRPC returns various error messages when a component
    // doesn't exist on the machine. Catch them all so the dashboard
    // can show "pending" instead of "error".
    if (
      /not found/i.test(msg) ||
      /no resource/i.test(msg) ||
      /unknown/i.test(msg) ||
      /does not exist/i.test(msg) ||
      /no component/i.test(msg) ||
      /unimplemented/i.test(msg)
    ) {
      throw new ComponentNotFoundError(componentName);
    }
    throw err;
  }
}

export async function disconnectViam(): Promise<void> {
  if (_client) {
    await _client.disconnect();
    _client = null;
  }
}
