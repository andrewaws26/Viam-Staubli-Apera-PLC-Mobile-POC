/**
 * Server-side API route for truck J1939 CAN bus sensor readings.
 *
 * Connects to the truck-diagnostics Viam machine (separate from the TPS machine)
 * using TRUCK_VIAM_* env vars.
 *
 * GET /api/truck-readings?component=truck-engine
 */

import { NextRequest, NextResponse } from "next/server";
import { createRobotClient, SensorClient } from "@viamrobotics/sdk";
import type { RobotClient } from "@viamrobotics/sdk";

let _client: RobotClient | null = null;
let _connecting = false;
let _lastError: string | null = null;

async function getClient(): Promise<RobotClient> {
  if (_client) return _client;
  if (_connecting) {
    await new Promise((r) => setTimeout(r, 500));
    if (_client) return _client;
    throw new Error(_lastError || "Connection in progress");
  }

  const host = process.env.TRUCK_VIAM_MACHINE_ADDRESS;
  const apiKey = process.env.TRUCK_VIAM_API_KEY;
  const apiKeyId = process.env.TRUCK_VIAM_API_KEY_ID;

  if (!host || !apiKey || !apiKeyId) {
    throw new Error(
      "Missing truck Viam credentials. " +
        "Set TRUCK_VIAM_MACHINE_ADDRESS, TRUCK_VIAM_API_KEY, and TRUCK_VIAM_API_KEY_ID."
    );
  }

  _connecting = true;
  _lastError = null;
  try {
    _client = await createRobotClient({
      host,
      credentials: { type: "api-key", authEntity: apiKeyId, payload: apiKey },
      signalingAddress: "https://app.viam.com:443",
      reconnectMaxAttempts: 3,
    });
    return _client;
  } catch (err) {
    _lastError = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    _connecting = false;
  }
}

export async function GET(request: NextRequest) {
  const componentName = request.nextUrl.searchParams.get("component");
  if (!componentName) {
    return NextResponse.json(
      { error: "Missing 'component' query parameter" },
      { status: 400 }
    );
  }

  try {
    const client = await getClient();
    const sensor = new SensorClient(client, componentName);
    const readings = await sensor.getReadings();
    return NextResponse.json(readings);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    if (
      /not found/i.test(msg) ||
      /no resource/i.test(msg) ||
      /does not exist/i.test(msg)
    ) {
      return NextResponse.json(
        { error: "component_not_found", component: componentName },
        { status: 404 }
      );
    }

    _client = null;
    return NextResponse.json(
      { error: "sensor_read_failed", message: msg },
      { status: 502 }
    );
  }
}
