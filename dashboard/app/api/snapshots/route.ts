/**
 * POST /api/snapshots — Capture a truck snapshot (live or historical)
 * GET  /api/snapshots — List all snapshots
 *
 * Supports multi-system capture: truck_engine, tps_buggy, robot_cell.
 * Each system queries a different Viam component and merges into reading_data.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { requireRole } from "@/lib/auth-guard";
import { logAudit } from "@/lib/audit";
import { getSupabase } from "@/lib/supabase";
import { getTruckById } from "@/lib/machines";
import { getDataClient, unwrapPayload, normalizeTimestamp } from "@/lib/viam-data";

// ── System → Viam component mapping ─────────────────────────────────

const SYSTEM_COMPONENTS: Record<string, string> = {
  truck_engine: "truck-engine",
  tps_buggy: "plc-monitor",
  robot_cell: "cell-monitor",
};

const SYSTEM_PREFIXES: Record<string, string> = {
  truck_engine: "",        // no prefix — backward compatible
  tps_buggy: "plc_",
  robot_cell: "cell_",
};

const VALID_SYSTEMS = Object.keys(SYSTEM_COMPONENTS);

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

async function queryComponent(
  dc: Awaited<ReturnType<typeof getDataClient>>,
  partId: string,
  componentName: string,
  windowStart: Date,
  windowEnd: Date,
  targetTime: Date | null,
): Promise<Record<string, unknown> | null> {
  try {
    const rows = await dc.exportTabularData(
      partId, componentName, "rdk:component:sensor", "Readings",
      windowStart, windowEnd,
    );
    if (rows.length === 0) return null;

    if (targetTime) {
      // Historical: find closest reading to target
      let closest = rows[0];
      let minDiff = Math.abs(normalizeTimestamp(rows[0].timeCaptured).getTime() - targetTime.getTime());
      for (let i = 1; i < rows.length; i++) {
        const diff = Math.abs(normalizeTimestamp(rows[i].timeCaptured).getTime() - targetTime.getTime());
        if (diff < minDiff) { closest = rows[i]; minDiff = diff; }
      }
      return unwrapPayload(closest.payload);
    } else {
      // Live: newest reading
      rows.sort((a, b) =>
        normalizeTimestamp(b.timeCaptured).getTime() - normalizeTimestamp(a.timeCaptured).getTime()
      );
      return unwrapPayload(rows[0].payload);
    }
  } catch (err) {
    console.error(`[SNAPSHOT] Failed to query ${componentName}:`, err);
    return null;
  }
}

// ── POST: Capture snapshot ───────────────────────────────────────────

export async function POST(request: NextRequest) {
  const denied = await requireRole("/api/snapshots");
  if (denied) return denied;

  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: {
    truck_id: string;
    timestamp?: string;
    label?: string;
    notes?: string;
    systems?: string[];
    visible_fields?: string[];
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { truck_id, timestamp, label, notes } = body;
  if (!truck_id) {
    return NextResponse.json({ error: "truck_id is required" }, { status: 400 });
  }

  // Default to truck_engine if no systems specified (backward compat)
  const systems = (body.systems || ["truck_engine"]).filter(s => VALID_SYSTEMS.includes(s));
  if (systems.length === 0) {
    return NextResponse.json({ error: "At least one valid system is required" }, { status: 400 });
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

    let windowStart: Date;
    let windowEnd: Date;
    let targetTime: Date | null = null;

    if (timestamp) {
      const target = new Date(timestamp);
      targetTime = target;
      windowStart = new Date(target.getTime() - 60_000);
      windowEnd = new Date(target.getTime() + 60_000);
    } else {
      windowEnd = new Date();
      windowStart = new Date(windowEnd.getTime() - 300_000);
    }

    // Query all selected systems in parallel
    const results = await Promise.all(
      systems.map(async (sys) => ({
        system: sys,
        data: await queryComponent(dc, partId, SYSTEM_COMPONENTS[sys], windowStart, windowEnd, targetTime),
      }))
    );

    // Check that at least one system returned data
    const successful = results.filter(r => r.data !== null);
    if (successful.length === 0) {
      const systemNames = systems.join(", ");
      return NextResponse.json(
        { error: `No data found for any selected system (${systemNames}). Equipment may be offline.` },
        { status: 404 },
      );
    }

    // Merge all readings into a flat object with prefixes
    const merged: Record<string, unknown> = { _systems: systems };
    const capturedSystems: string[] = [];

    for (const { system, data } of results) {
      if (!data) continue;
      capturedSystems.push(system);
      const prefix = SYSTEM_PREFIXES[system];
      for (const [key, value] of Object.entries(data)) {
        merged[`${prefix}${key}`] = value;
      }
    }

    merged._captured_systems = capturedSystems;

    if (body.visible_fields && body.visible_fields.length > 0) {
      merged._visible_fields = body.visible_fields;
    }

    // Use truck engine data for indexed columns (if available)
    const truckData = results.find(r => r.system === "truck_engine")?.data;

    const userName = await getUserName(userId);
    const source = timestamp ? "historical" : "live";
    const capturedAt = timestamp ? new Date(timestamp) : new Date();

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
      systems: capturedSystems,
      reading_data: merged,
      engine_rpm: truckData ? num(truckData.engine_rpm) : null,
      vehicle_speed_mph: truckData ? num(truckData.vehicle_speed_mph) : null,
      coolant_temp_f: truckData ? num(truckData.coolant_temp_f) : null,
      battery_voltage_v: truckData ? num(truckData.battery_voltage_v) : null,
      engine_hours: truckData ? num(truckData.engine_hours) : null,
      vehicle_distance_mi: truckData ? num(truckData.vehicle_distance_mi) : null,
      vin: truckData ? (truckData.vin ?? truckData.vehicle_vin ?? null) : null,
      active_dtc_count: truckData ? (num(truckData.active_dtc_count) ?? 0) : 0,
    }).select().single();

    if (error) {
      console.error("[SNAPSHOT-ERROR]", error.message);
      return NextResponse.json({ error: "Failed to save snapshot" }, { status: 500 });
    }

    await logAudit({
      action: "snapshot_captured",
      truckId: truck_id,
      details: {
        snapshot_id: data.id,
        label,
        source,
        systems: capturedSystems,
        captured_at: capturedAt.toISOString(),
      },
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
    .select("id, truck_id, truck_name, captured_at, created_at, created_by_name, label, notes, source, systems, engine_rpm, vehicle_speed_mph, coolant_temp_f, battery_voltage_v, engine_hours, vehicle_distance_mi, vin, active_dtc_count")
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
