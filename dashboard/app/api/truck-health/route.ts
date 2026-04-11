/**
 * Truck Engine Health Baseline API
 *
 * GET /api/truck-health?truck=01
 *   Fetches the latest truck-engine reading from Viam Cloud, runs it through
 *   the baseline health assessment, and returns structured health status.
 *
 * GET /api/truck-health?truck=00
 *   Sim mode — generates realistic idle readings and assesses them.
 */

import { NextRequest, NextResponse } from "next/server";
import { getLatestReading, resetDataClient } from "@/lib/viam-data";
import { getTruckById, getDefaultTruck } from "@/lib/machines";
import { requireTruckAccess } from "@/lib/auth-guard";
import { assessTruckHealth } from "@/lib/truck-baseline";

// ── Sim data generator ─────────────────────────────────────────────────

function generateSimReadings(): Record<string, unknown> {
  // Realistic warm-idle readings based on the actual Mack Granite baseline
  const jitter = (base: number, pct: number) =>
    base + base * (pct / 100) * (Math.random() * 2 - 1);

  return {
    engine_rpm: Math.round(jitter(650, 3)),
    coolant_temp_f: round1(jitter(188, 3)),
    oil_pressure_psi: round1(jitter(26, 10)),
    oil_temp_f: round1(jitter(215, 3)),
    battery_voltage_v: round1(jitter(13.85, 1)),
    fuel_rate_gph: round1(jitter(1.0, 15)),
    fuel_level_pct: round1(jitter(25, 8)),
    ambient_temp_f: round1(jitter(78, 5)),
    trans_oil_temp_f: round1(jitter(155, 5)),
    engine_load_pct: round1(jitter(12, 25)),
    boost_pressure_psi: round1(jitter(0.6, 30)),
    intake_manifold_temp_f: round1(jitter(148, 5)),
    engine_hours: round1(5427.3 + Math.random() * 2),
    active_dtc_count: 3,
    vehicle_speed_mph: 0,
    _protocol: "j1939",
    _sim: true,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ── GET handler ────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const truckParam = request.nextUrl.searchParams.get("truck");
  const truckId = truckParam || "01";

  // Auth check
  const denied = await requireTruckAccess(truckId);
  if (denied) return denied;

  // Sim mode for truck 00
  if (truckId === "00") {
    const simReadings = generateSimReadings();
    const health = assessTruckHealth(simReadings);
    return NextResponse.json({
      ...health,
      readings: simReadings,
      _sim: true,
      _timestamp: new Date().toISOString(),
    });
  }

  // Real truck — look up config
  const truck = await getTruckById(truckId);
  if (!truck) {
    // Fall back to default truck if bare "01" isn't in the registry
    const fallback = await getDefaultTruck();
    if (!fallback || !fallback.truckPartId) {
      return NextResponse.json(
        { error: "truck_not_found", truck_id: truckId },
        { status: 404 },
      );
    }
    return fetchAndAssess(fallback.truckPartId, truckId);
  }

  if (!truck.truckPartId) {
    return NextResponse.json(
      { error: "no_part_id", truck_id: truckId, message: "Truck has no Viam Part ID configured" },
      { status: 404 },
    );
  }

  return fetchAndAssess(truck.truckPartId, truckId);
}

// ── Fetch from Viam and assess ─────────────────────────────────────────

async function fetchAndAssess(partId: string, truckId: string) {
  try {
    const result = await getLatestReading(partId, "truck-engine");

    if (!result) {
      // No recent data — return health assessment with all no_data
      const health = assessTruckHealth({});
      return NextResponse.json({
        ...health,
        overall: "no_data",
        overall_summary: "No recent truck-engine data available from Viam Cloud. The truck may be off or out of range.",
        readings: null,
        _offline: true,
        _reason: "no_recent_data",
        _truck_id: truckId,
        _timestamp: new Date().toISOString(),
      });
    }

    const dataAgeSec = Math.round(
      (Date.now() - result.timeCaptured.getTime()) / 1000,
    );

    const readings = result.payload as Record<string, unknown>;
    const health = assessTruckHealth(readings);

    return NextResponse.json({
      ...health,
      readings,
      _truck_id: truckId,
      _data_age_seconds: dataAgeSec,
      _timestamp: new Date().toISOString(),
    });
  } catch (err) {
    resetDataClient();
    console.error("[API-ERROR]", "/api/truck-health", err);
    return NextResponse.json(
      {
        error: "health_check_failed",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }
}
