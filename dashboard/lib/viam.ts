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
    _client = await createRobotClient({
      host,
      credentials: {
        type: "api-key",
        payload: apiKey,
      },
      authEntity: apiKeyId,
    });
    return _client;
  } finally {
    _connecting = false;
  }
}

export async function getSensorReadings(
  componentName: string
): Promise<SensorReadings> {
  const client = await getClient();
  const sensor = new SensorClient(client, componentName);
  const readings = await sensor.getReadings();
  return readings as SensorReadings;
}

export async function disconnectViam(): Promise<void> {
  if (_client) {
    await _client.disconnect();
    _client = null;
  }
}
