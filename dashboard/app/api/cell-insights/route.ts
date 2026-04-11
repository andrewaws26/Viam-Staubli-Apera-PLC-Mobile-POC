// /api/cell-insights — Returns analyzed insights and shift summary for the robot cell.
//
// Fetches the current cell readings (from /api/cell-readings logic or sim data),
// runs the insights engine, and returns actionable analysis.
//
// Query params:
//   ?sim=true   — Use simulated cell data (for UI development)
//   ?truck=00   — Truck ID (sim only uses "00")

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { analyzeCell } from "@/lib/insights-engine";
import type { CellState } from "@/components/Cell/CellTypes";

export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sim = request.nextUrl.searchParams.get("sim");
  const truckId = request.nextUrl.searchParams.get("truck");

  // Fetch cell readings from the existing endpoint (same origin)
  const baseUrl = request.nextUrl.origin;
  const params = new URLSearchParams();
  if (sim) params.set("sim", sim);
  if (truckId) params.set("truck", truckId);

  try {
    const readingsRes = await fetch(
      `${baseUrl}/api/cell-readings?${params.toString()}`,
      {
        headers: {
          // Forward auth cookies so the internal request is authenticated
          cookie: request.headers.get("cookie") || "",
        },
      },
    );

    if (!readingsRes.ok) {
      const errBody = await readingsRes.json().catch(() => ({}));
      return NextResponse.json(
        { error: "Failed to fetch cell readings", detail: errBody },
        { status: readingsRes.status },
      );
    }

    const data = await readingsRes.json();

    // If the cell is offline or has no data, return early
    if (data._no_cell || data._offline) {
      return NextResponse.json({
        insights: [],
        shift: null,
        _no_cell: true,
        _reason: data._reason,
      });
    }

    // Build a CellState from the readings response
    const cellState: CellState = {
      staubli: data.staubli ?? null,
      staubliLogs: data.staubliLogs ?? null,
      apera: data.apera ?? null,
      network: data.network ?? [],
      internet: data.internet ?? null,
      switchVpn: data.switchVpn ?? null,
      piHealth: data.piHealth ?? null,
      alerts: data.alerts ?? [],
      last_update: data.last_update ?? new Date().toISOString(),
    };

    const result = analyzeCell(cellState);

    return NextResponse.json({
      ...result,
      _is_sim: !!data._is_sim,
      _analyzed_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[cell-insights] Analysis failed:", err);
    return NextResponse.json(
      {
        error: "Insights analysis failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
