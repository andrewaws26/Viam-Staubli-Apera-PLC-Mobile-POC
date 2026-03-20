// Viam sensor readings — direct browser-to-machine via WebRTC.
//
// The Viam TypeScript SDK requires WebRTC (RTCPeerConnection) which is only
// available in browsers, not in Node.js / Vercel serverless functions.
// Therefore the browser connects directly to the machine through Viam Cloud.
//
// Credentials are NEXT_PUBLIC_ env vars. For internal monitoring dashboards
// this is acceptable. For public-facing dashboards, create a read-only API
// key with Operator role in the Viam app.

import { createRobotClient, SensorClient } from "@viamrobotics/sdk";
import type { RobotClient } from "@viamrobotics/sdk";
import { SensorReadings } from "./types";

let _client: RobotClient | null = null;
let _connecting = false;

export class ComponentNotFoundError extends Error {
  constructor(componentName: string) {
    super(`Component "${componentName}" not configured on this machine`);
    this.name = "ComponentNotFoundError";
  }
}

async function getClient(): Promise<RobotClient> {
  if (_client) return _client;
  if (_connecting) {
    // Wait for in-flight connection attempt
    await new Promise((r) => setTimeout(r, 1000));
    if (_client) return _client;
    throw new Error("Connection in progress");
  }

  const host = process.env.NEXT_PUBLIC_VIAM_MACHINE_ADDRESS;
  const apiKeyId = process.env.NEXT_PUBLIC_VIAM_API_KEY_ID;
  const apiKey = process.env.NEXT_PUBLIC_VIAM_API_KEY;

  if (!host || !apiKeyId || !apiKey) {
    throw new Error(
      "Missing Viam credentials. Set NEXT_PUBLIC_VIAM_MACHINE_ADDRESS, " +
        "NEXT_PUBLIC_VIAM_API_KEY_ID, and NEXT_PUBLIC_VIAM_API_KEY."
    );
  }

  _connecting = true;
  try {
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
    return _client;
  } catch (err) {
    _client = null;
    throw err;
  } finally {
    _connecting = false;
  }
}

export async function getSensorReadings(
  componentName: string
): Promise<SensorReadings> {
  try {
    const client = await getClient();
    const sensor = new SensorClient(client, componentName);
    const readings = await sensor.getReadings();
    return readings as SensorReadings;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    // Component not found on the machine
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

    // Connection error — reset client so next poll retries
    _client = null;
    throw err;
  }
}
