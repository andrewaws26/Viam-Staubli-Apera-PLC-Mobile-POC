/**
 * Server-side API route for sending commands to the PLC via Viam do_command.
 *
 * POST /api/plc-command
 * Body: { "action": "test_eject", "output": "Y1" }
 */

import { NextRequest, NextResponse } from "next/server";
import { createRobotClient, SensorClient } from "@viamrobotics/sdk";
import type { RobotClient } from "@viamrobotics/sdk";

let _client: RobotClient | null = null;
let _connecting = false;

async function getClient(): Promise<RobotClient> {
  if (_client) return _client;
  if (_connecting) {
    await new Promise((r) => setTimeout(r, 500));
    if (_client) return _client;
    throw new Error("Connection in progress");
  }

  const host = process.env.VIAM_MACHINE_ADDRESS;
  const apiKey = process.env.VIAM_API_KEY;
  const apiKeyId = process.env.VIAM_API_KEY_ID;

  if (!host || !apiKey || !apiKeyId) {
    throw new Error("Missing Viam credentials");
  }

  _connecting = true;
  try {
    _client = await createRobotClient({
      host,
      credentials: { type: "api-key", authEntity: apiKeyId, payload: apiKey },
      signalingAddress: "https://app.viam.com:443",
      reconnectMaxAttempts: 3,
    });
    return _client;
  } catch (err) {
    throw err;
  } finally {
    _connecting = false;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, ...params } = body;

    if (!action) {
      return NextResponse.json(
        { error: "Missing 'action' in request body" },
        { status: 400 }
      );
    }

    const client = await getClient();
    const sensor = new SensorClient(client, "plc-monitor");
    const result = await sensor.doCommand({ action, ...params });

    return NextResponse.json(result);
  } catch (err) {
    _client = null;
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "command_failed", message: msg },
      { status: 502 }
    );
  }
}
