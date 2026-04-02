/**
 * Server-side API route for sending commands to the PLC via Viam do_command.
 *
 * POST /api/plc-command
 * Body: { "action": "test_eject", "output": "Y1" }
 */

import { NextRequest, NextResponse } from "next/server";
import { createRobotClient, SensorClient } from "@viamrobotics/sdk";
import type { RobotClient } from "@viamrobotics/sdk";
import { getTruckById, getDefaultTruck } from "@/lib/machines";

let _client: RobotClient | null = null;
let _connecting = false;

async function getDefaultClient(): Promise<RobotClient> {
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
      iceServers: [{ urls: "stun:global.stun.twilio.com:3478" }],
      reconnectMaxAttempts: 3,
    });
    return _client;
  } catch (err) {
    throw err;
  } finally {
    _connecting = false;
  }
}

async function getFleetClient(machineAddress: string): Promise<RobotClient> {
  const apiKey = process.env.VIAM_API_KEY;
  const apiKeyId = process.env.VIAM_API_KEY_ID;
  if (!apiKey || !apiKeyId) throw new Error("Missing Viam API credentials");

  return createRobotClient({
    host: machineAddress,
    credentials: { type: "api-key", authEntity: apiKeyId, payload: apiKey },
    signalingAddress: "https://app.viam.com:443",
    iceServers: [{ urls: "stun:global.stun.twilio.com:3478" }],
    reconnectMaxAttempts: 3,
  });
}

export async function POST(request: NextRequest) {
  const truckId = request.nextUrl.searchParams.get("truck_id");
  const truck = truckId ? getTruckById(truckId) : getDefaultTruck();
  if (!truck) {
    return NextResponse.json(
      { error: "truck_not_found", truck_id: truckId },
      { status: 404 }
    );
  }

  let fleetClient: RobotClient | null = null;

  try {
    const body = await request.json();
    const { action, ...params } = body;

    if (!action) {
      return NextResponse.json(
        { error: "Missing 'action' in request body" },
        { status: 400 }
      );
    }

    let client: RobotClient;
    if (truckId && truck.tpsMachineAddress) {
      fleetClient = await getFleetClient(truck.tpsMachineAddress);
      client = fleetClient;
    } else {
      client = await getDefaultClient();
    }

    const sensor = new SensorClient(client, "plc-monitor");
    const result = await sensor.doCommand({ action, ...params });

    return NextResponse.json(result);
  } catch (err) {
    if (!truckId) _client = null;
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "command_failed", message: msg },
      { status: 502 }
    );
  } finally {
    if (fleetClient) {
      try { fleetClient.disconnect(); } catch { /* best-effort */ }
    }
  }
}
