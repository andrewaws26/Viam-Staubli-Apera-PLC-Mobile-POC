/**
 * POST /api/snapshots — Capture a truck snapshot (live or historical)
 * GET  /api/snapshots — List all snapshots
 */

import { NextRequest, NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { requireRole } from "@/lib/auth-guard";
import { logAudit } from "@/lib/audit";
import { getSupabase } from "@/lib/supabase";
import { getTruckById } from "@/lib/machines";
import { getDataClient, unwrapPayload, normalizeTimestamp } from "@/lib/viam-data";

// ── Helpers ──────────────────────────────────────────────────────────

async function getUserName(userId: string): Promise<string> {
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    return user.firstName
      ? `${user.firstName} ${user.lastName ?? ""}`.trim()
      : user.emailAddresses?.[0]?.emailAddress ?? "Unknown";
  } catch {
    return "Unknown";
  }
}

function num(val: unknown): number | null {
  if (typeof val === "number" && !isNaN(val)) return val;
  if (typeof val === "string") { const n = parseFloat(val); return isNaN(n) ? null : n; }
  return null;
}

// ── POST: Capture snapshot ───────────────────────────────────────────

export async function POST(request: NextRequest) {
  const denied = await requireRole("/api/snapshots");
  if (denied) return denied;

  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { truck_id: string; timestamp?: string; label?: string; notes?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { truck_id, timestamp, label, notes } = body;
  if (!truck_id) {
    return NextResponse.json({ error: "truck_id is required" }, { status: 400 });
  }

  const truck = await getTruckById(truck_id);
  if (!truck) {
    return NextResponse.json({ error: "Truck not found" }, { status: 404 });
  }

  if (!truck.tpsPartId) {
    return NextResponse.json({ error: "Truck has no Viam Part ID configured" }, { status: 422 });
  }

  try {
    const dc = await getDataClient();
    const partId = truck.tpsPartId;

    let reading: Record<string, unknown> | null = null;
    let capturedAt: Date;

    if (timestamp) {
      // Historical: query a 2-minute window around the target time
      const target = new Date(timestamp);
      const windowStart = new Date(target.getTime() - 60_000);
      const windowEnd = new Date(target.getTime() + 60_000);

      const rows = await dc.exportTabularData(
        partId, "truck-engine", "rdk:component:sensor", "Readings",
        windowStart, windowEnd,
      );

      if (rows.length === 0) {
        return NextResponse.json(
          { error: "No truck data found near that timestamp" },
          { status: 404 },
        );
      }

      // Find the closest reading to the target
      let closest = rows[0];
      let minDiff = Math.abs(normalizeTimestamp(rows[0].timeCaptured).getTime() - target.getTime());
      for (let i = 1; i < rows.length; i++) {
        const diff = Math.abs(normalizeTimestamp(rows[i].timeCaptured).getTime() - target.getTime());
        if (diff < minDiff) { closest = rows[i]; minDiff = diff; }
      }

      reading = unwrapPayload(closest.payload);
      capturedAt = normalizeTimestamp(closest.timeCaptured);
    } else {
      // Live: query the last 5 minutes and take the newest
      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - 300_000);

      const rows = await dc.exportTabularData(
        partId, "truck-engine", "rdk:component:sensor", "Readings",
        startTime, endTime,
      );

      if (rows.length === 0) {
        return NextResponse.json(
          { error: "No live truck data available (truck may be offline)" },
          { status: 404 },
        );
      }

      rows.sort((a, b) =>
        normalizeTimestamp(b.timeCaptured).getTime() - normalizeTimestamp(a.timeCaptured).getTime()
      );
      reading = unwrapPayload(rows[0].payload);
      capturedAt = normalizeTimestamp(rows[0].timeCaptured);
    }

    const userName = await getUserName(userId);
    const source = timestamp ? "historical" : "live";

    const sb = getSupabase();
    const { data, error } = await sb.from("truck_snapshots").insert({
      truck_id,
      truck_name: truck.name,
      captured_at: capturedAt.toISOString(),
      created_by: userId,
      created_by_name: userName,
      label: label || null,
      notes: notes || null,
      source,
      reading_data: reading,
      engine_rpm: num(reading.engine_rpm),
      vehicle_speed_mph: num(reading.vehicle_speed_mph),
      coolant_temp_f: num(reading.coolant_temp_f),
      battery_voltage_v: num(reading.battery_voltage_v),
      engine_hours: num(reading.engine_hours),
      vehicle_distance_mi: num(reading.vehicle_distance_mi),
      vin: reading.vin ?? reading.vehicle_vin ?? null,
      active_dtc_count: num(reading.active_dtc_count) ?? 0,
    }).select().single();

    if (error) {
      console.error("[SNAPSHOT-ERROR]", error.message);
      return NextResponse.json({ error: "Failed to save snapshot" }, { status: 500 });
    }

    logAudit({
      action: "snapshot_captured",
      truckId: truck_id,
      details: { snapshot_id: data.id, label, source, captured_at: capturedAt.toISOString() },
    });

    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    console.error("[SNAPSHOT-ERROR]", err);
    return NextResponse.json(
      { error: "Failed to capture snapshot", details: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

// ── GET: List snapshots ──────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const denied = await requireRole("/api/snapshots");
  if (denied) return denied;

  const params = request.nextUrl.searchParams;
  const truckId = params.get("truck_id");
  const limit = Math.min(parseInt(params.get("limit") || "50", 10), 200);

  const sb = getSupabase();
  let query = sb.from("truck_snapshots")
    .select("id, truck_id, truck_name, captured_at, created_at, created_by_name, label, notes, source, engine_rpm, vehicle_speed_mph, coolant_temp_f, battery_voltage_v, engine_hours, vehicle_distance_mi, vin, active_dtc_count")
    .order("captured_at", { ascending: false })
    .limit(limit);

  if (truckId) query = query.eq("truck_id", truckId);

  const { data, error } = await query;
  if (error) {
    console.error("[SNAPSHOT-ERROR]", error.message);
    return NextResponse.json({ error: "Failed to list snapshots" }, { status: 500 });
  }

  return NextResponse.json(data);
}
