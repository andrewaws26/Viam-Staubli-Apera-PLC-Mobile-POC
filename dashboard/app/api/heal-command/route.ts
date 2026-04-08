/**
 * API route for triggering self-healing fixes on the Pi via Viam do_command.
 *
 * Commands flow: Dashboard → Viam Cloud (WebRTC) → Pi plc-monitor → self-heal.py
 * This works even through NAT/cellular — no SSH needed.
 *
 * POST /api/heal-command
 * Body: { "check": "can-bus" }           — fix one specific issue
 *        { "check": "all" }               — run full diagnostic sweep
 *        { "list": true }                 — list available checks
 *        { "status": true }               — get last heal status
 *
 * Requires "developer" role.
 */

import { NextRequest, NextResponse } from "next/server";
import { createRobotClient, SensorClient } from "@viamrobotics/sdk";
import type { RobotClient } from "@viamrobotics/sdk";
import { Struct } from "@bufbuild/protobuf";
import { getTruckById, getDefaultTruck } from "@/lib/machines";
import { requireRole, requireTruckAccess } from "@/lib/auth-guard";

let _client: RobotClient | null = null;
let _connecting = false;

async function getClient(machineAddress?: string): Promise<RobotClient> {
  const host = machineAddress || process.env.VIAM_MACHINE_ADDRESS;
  const apiKey = process.env.VIAM_API_KEY;
  const apiKeyId = process.env.VIAM_API_KEY_ID;

  if (!host || !apiKey || !apiKeyId) {
    throw new Error("Missing Viam credentials");
  }

  // For default machine, reuse connection
  if (!machineAddress) {
    if (_client) return _client;
    if (_connecting) {
      await new Promise((r) => setTimeout(r, 500));
      if (_client) return _client;
      throw new Error("Connection in progress");
    }
    _connecting = true;
  }

  try {
    const client = await createRobotClient({
      host,
      credentials: { type: "api-key", authEntity: apiKeyId, payload: apiKey },
      signalingAddress: "https://app.viam.com:443",
      iceServers: [{ urls: "stun:global.stun.twilio.com:3478" }],
      reconnectMaxAttempts: 3,
    });
    if (!machineAddress) _client = client;
    return client;
  } finally {
    if (!machineAddress) _connecting = false;
  }
}

export async function POST(request: NextRequest) {
  // Developer role only
  const denied = await requireRole("/api/plc-command"); // Same permission as PLC commands
  if (denied) return denied;

  const truckId = request.nextUrl.searchParams.get("truck_id");

  const truckDenied = await requireTruckAccess(truckId);
  if (truckDenied) return truckDenied;

  const truck = truckId ? await getTruckById(truckId) : await getDefaultTruck();
  if (!truck) {
    return NextResponse.json({ error: "truck_not_found" }, { status: 404 });
  }

  const startTime = Date.now();

  try {
    const body = await request.json();
    const { check, list, status } = body as { check?: string; list?: boolean; status?: boolean };

    // Build the do_command payload
    const command: Record<string, unknown> = { action: "heal" };
    if (check) command.check = check;
    if (list) command.list = true;
    if (status) command.status = true;

    const client = await getClient(truck.tpsMachineAddress || undefined);
    const sensor = new SensorClient(client, "plc-monitor");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await sensor.doCommand(Struct.fromJson(command as any));

    console.log("[HEAL-COMMAND]", check || "status", Date.now() - startTime, "ms");
    return NextResponse.json(result);
  } catch (err) {
    _client = null;
    console.error("[API-ERROR]", "/api/heal-command", err);
    return NextResponse.json(
      { error: "heal_command_failed", message: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
