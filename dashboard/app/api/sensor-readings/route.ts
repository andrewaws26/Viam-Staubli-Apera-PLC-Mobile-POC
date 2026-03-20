/**
 * Server-side API route that proxies Viam sensor readings.
 *
 * Credentials (VIAM_API_KEY, VIAM_API_KEY_ID, VIAM_MACHINE_ADDRESS) are
 * loaded from server-only env vars — they are NEVER sent to the browser.
 * The browser calls this route instead of connecting to Viam directly.
 *
 * GET /api/sensor-readings?component=plc-monitor
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
    // Wait for in-flight connection
    await new Promise((r) => setTimeout(r, 500));
    if (_client) return _client;
    throw new Error(_lastError || "Connection in progress");
  }

  // Server-only env vars — NOT prefixed with NEXT_PUBLIC_
  const host = process.env.VIAM_MACHINE_ADDRESS;
  const apiKey = process.env.VIAM_API_KEY;
  const apiKeyId = process.env.VIAM_API_KEY_ID;

  if (!host || !apiKey || !apiKeyId) {
    throw new Error(
      "Missing server-side Viam credentials. " +
        "Set VIAM_MACHINE_ADDRESS, VIAM_API_KEY, and VIAM_API_KEY_ID " +
        "in environment variables (NOT NEXT_PUBLIC_ prefixed)."
    );
  }

  _connecting = true;
  _lastError = null;
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

    // Component not found — return 404 so the dashboard can show "pending"
    if (
      /not found/i.test(msg) ||
      /no resource/i.test(msg) ||
      /unknown/i.test(msg) ||
      /does not exist/i.test(msg) ||
      /no component/i.test(msg) ||
      /unimplemented/i.test(msg)
    ) {
      return NextResponse.json(
        { error: "component_not_found", component: componentName },
        { status: 404 }
      );
    }

    // Connection error — reset client so next request retries
    _client = null;
    return NextResponse.json(
      { error: "sensor_read_failed", message: msg },
      { status: 502 }
    );
  }
}
