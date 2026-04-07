/**
 * Server-side API route for sending commands to the cell-sensor module.
 *
 * Supports:
 *   POST /api/cell-command { "command": "apera_health" }
 *   POST /api/cell-command { "command": "apera_reconnect" }
 *   POST /api/cell-command { "command": "apera_restart" }
 *   POST /api/cell-command { "command": "status" }
 *   POST /api/cell-command { "command": "poll_all" }
 *   POST /api/cell-command { "command": "discover" }
 */

import { NextRequest, NextResponse } from "next/server";
import { createRobotClient, SensorClient } from "@viamrobotics/sdk";
import type { RobotClient } from "@viamrobotics/sdk";
import { getDefaultTruck } from "@/lib/machines";
import { CellCommandBody, parseBody } from "@/lib/api-schemas";

const COMPONENT_NAME = "cell-monitor";

let _client: RobotClient | null = null;
let _connecting = false;

async function getCellClient(): Promise<RobotClient> {
  if (_client) return _client;
  if (_connecting) {
    await new Promise((r) => setTimeout(r, 500));
    if (_client) return _client;
    throw new Error("Connection in progress");
  }

  // Cell monitor runs on the Pi 5 (same machine as TPS/PLC)
  const host = process.env.VIAM_MACHINE_ADDRESS;
  const apiKey = process.env.VIAM_API_KEY;
  const apiKeyId = process.env.VIAM_API_KEY_ID;

  if (!host || !apiKey || !apiKeyId) {
    throw new Error("Missing Viam credentials (VIAM_MACHINE_ADDRESS, VIAM_API_KEY, VIAM_API_KEY_ID)");
  }

  _connecting = true;
  try {
    _client = await createRobotClient({
      host,
      credentials: { type: "api-key", authEntity: apiKeyId, payload: apiKey },
      signalingAddress: "https://app.viam.com:443",
      iceServers: [{ urls: "stun:global.stun.twilio.com:3478" }],
      reconnectMaxAttempts: 3,
    });
    return _client;
  } finally {
    _connecting = false;
  }
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const body = await request.json();
    const parsed = parseBody(CellCommandBody, body);
    if (parsed.error) {
      return NextResponse.json(parsed.error, { status: 400 });
    }

    const { command } = parsed.data;
    const client = await getCellClient();
    const sensor = new SensorClient(client, COMPONENT_NAME);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await sensor.doCommand(body as any);

    console.log(
      "[CELL-COMMAND]", command,
      "result:", JSON.stringify(result).substring(0, 300),
      `(${Date.now() - startTime}ms)`,
    );

    return NextResponse.json(result);
  } catch (err) {
    _client = null;
    console.error("[API-ERROR]", "/api/cell-command", err);
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "command_failed", message: msg },
      { status: 502 },
    );
  }
}
