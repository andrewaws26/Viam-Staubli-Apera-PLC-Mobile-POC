/**
 * API route to get Pi health data via Viam Data API.
 *
 * Uses the shared Viam Data client (lib/viam-data.ts) over HTTPS.
 * No WebRTC, no NEXT_PUBLIC_ env vars — works on Vercel serverless and
 * through CGNAT (iPhone hotspot).
 *
 * GET /api/pi-health?host=tps|truck
 */

import { NextRequest, NextResponse } from "next/server";
import { getLatestReading, resetDataClient } from "@/lib/viam-data";
import { getTruckById } from "@/lib/machines";
import { requireTruckAccess } from "@/lib/auth-guard";

const TPS_PART_ID = process.env.VIAM_PART_ID || "7c24d42f-1d66-4cae-81a4-97e3ff9404b4";
const TRUCK_PART_ID = process.env.TRUCK_VIAM_PART_ID || "ca039781-665c-47e3-9bc5-35f603f3baf1";

const HOST_CONFIGS: Record<string, { partId: string; component: string; hostname: string; tailscaleIp: string; defaultMemTotal: number }> = {
  tps: {
    partId: TPS_PART_ID,
    component: "plc-monitor",
    hostname: "viam-pi",
    tailscaleIp: "100.112.68.52",
    defaultMemTotal: 8192,
  },
  truck: {
    partId: TRUCK_PART_ID,
    component: "truck-engine",
    hostname: "truck-diagnostics",
    tailscaleIp: "100.113.196.68",
    defaultMemTotal: 512,
  },
};

export async function GET(request: NextRequest) {
  const host = request.nextUrl.searchParams.get("host") || "tps";
  const truckId = request.nextUrl.searchParams.get("truck_id");

  const truckDenied = await requireTruckAccess(truckId);
  if (truckDenied) return truckDenied;

  let config: { partId: string; component: string; hostname: string; tailscaleIp: string; defaultMemTotal: number };

  if (truckId) {
    const truck = getTruckById(truckId);
    if (!truck) {
      return NextResponse.json({ error: "truck_not_found", truck_id: truckId }, { status: 404 });
    }
    const isTruck = host === "truck";
    config = {
      partId: isTruck ? truck.truckPartId : truck.tpsPartId,
      component: isTruck ? "truck-engine" : "plc-monitor",
      hostname: isTruck ? `${truck.id}-truck` : `${truck.id}-tps`,
      tailscaleIp: "",
      defaultMemTotal: isTruck ? 512 : 8192,
    };
  } else {
    const c = HOST_CONFIGS[host];
    if (!c) {
      return NextResponse.json({ error: `Unknown host: ${host}` }, { status: 400 });
    }
    config = c;
  }

  try {
    const result = await getLatestReading(config.partId, config.component);

    if (!result) {
      return NextResponse.json({
        hostname: config.hostname,
        online: false,
        error: "No recent data from sensor",
        tailscale_ip: config.tailscaleIp,
      });
    }

    const r = result.payload;
    const dataAgeSec = Math.round((Date.now() - result.timeCaptured.getTime()) / 1000);

    return NextResponse.json({
      hostname: config.hostname,
      cpu_temp_c: r.cpu_temp_c ?? null,
      cpu_usage_pct: r.cpu_usage_pct ?? null,
      memory_used_pct: r.memory_used_pct ?? null,
      memory_used_mb: r.memory_used_mb ?? null,
      memory_total_mb: r.memory_total_mb ?? config.defaultMemTotal,
      disk_used_pct: r.disk_used_pct ?? null,
      disk_free_gb: r.disk_free_gb ?? null,
      uptime_hours: r.uptime_seconds ? (r.uptime_seconds as number) / 3600 : null,
      wifi_ssid: r.wifi_ssid ?? null,
      wifi_signal_dbm: r.wifi_signal_dbm ?? null,
      tailscale_ip: config.tailscaleIp,
      tailscale_online: true,
      internet: true,
      load_1m: r.load_1m ?? null,
      load_5m: r.load_5m ?? null,
      online: true,
      _data_age_seconds: dataAgeSec,
    });
  } catch (err) {
    resetDataClient();
    console.error("[API-ERROR]", "/api/pi-health", err);
    return NextResponse.json({
      hostname: config.hostname,
      online: false,
      error: err instanceof Error ? err.message : "Offline",
      tailscale_ip: config.tailscaleIp,
    }); // 200 so the card shows offline state, not an error
  }
}
