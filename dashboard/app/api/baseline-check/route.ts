// /api/baseline-check — Query Viam Cloud to see how much historical data
// exists for each sensor component. Reports data points, time range, and
// key field availability for baseline building.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { fetchSensorData, resetDataClient } from "@/lib/viam-data";
import { getDefaultTruck, getTruckById } from "@/lib/machines";

const COMPONENTS = [
  { name: "plc-monitor", label: "TPS Production (PLC)", keyFields: ["encoder_distance_ft", "plate_drop_count", "ds7", "ds8", "tps_power_loop"] },
  { name: "truck-engine", label: "Truck Engine (J1939)", keyFields: ["engine_rpm", "coolant_temp_f", "oil_pressure_psi", "battery_voltage_v", "fuel_rate_gph", "alternator_voltage_v", "alternator_current_a", "vehicle_speed_mph"] },
  { name: "cell-monitor", label: "Robot Cell (Staubli/Apera)", keyFields: ["staubli_connected", "staubli_temp_j1", "staubli_torque_j1", "apera_connected", "staubli_temp_dsi"] },
];

// Time windows to check (hours)
const WINDOWS = [1, 24, 168]; // 1h, 24h, 7 days

export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const truckId = request.nextUrl.searchParams.get("truck") || "01";
  const truck = truckId ? await getTruckById(truckId) : await getDefaultTruck();

  if (!truck?.tpsPartId) {
    return NextResponse.json({
      error: "No Part ID configured for this truck",
      truck_id: truckId,
    });
  }

  const results: Record<string, any> = {
    truck_id: truckId,
    truck_name: truck.name,
    part_id: truck.tpsPartId,
    checked_at: new Date().toISOString(),
    components: {},
  };

  for (const comp of COMPONENTS) {
    const compResult: any = {
      label: comp.label,
      windows: {},
      status: "no_data",
      baseline_ready: false,
    };

    for (const hours of WINDOWS) {
      const windowLabel = hours === 1 ? "1h" : hours === 24 ? "24h" : "7d";
      try {
        const data = await fetchSensorData(truck.tpsPartId, comp.name, hours);

        if (data.length === 0) {
          compResult.windows[windowLabel] = { points: 0, status: "empty" };
          continue;
        }

        // Analyze the data
        const oldest = data[0].timeCaptured;
        const newest = data[data.length - 1].timeCaptured;
        const spanMinutes = Math.round((newest.getTime() - oldest.getTime()) / 60000);

        // Check which key fields are present
        const fieldsPresent: Record<string, { present: boolean; sample: any; min?: number; max?: number; avg?: number }> = {};
        for (const field of comp.keyFields) {
          const values = data
            .map((d) => d.payload[field])
            .filter((v) => v !== undefined && v !== null);

          if (values.length > 0) {
            const numVals = values.filter((v) => typeof v === "number") as number[];
            fieldsPresent[field] = {
              present: true,
              sample: values[values.length - 1],
              ...(numVals.length > 0 ? {
                min: Math.round(Math.min(...numVals) * 100) / 100,
                max: Math.round(Math.max(...numVals) * 100) / 100,
                avg: Math.round((numVals.reduce((a, b) => a + b, 0) / numVals.length) * 100) / 100,
              } : {}),
            };
          } else {
            fieldsPresent[field] = { present: false, sample: null };
          }
        }

        // Count all unique fields in the data
        const allFields = new Set<string>();
        for (const d of data.slice(0, 100)) { // sample first 100 for speed
          for (const k of Object.keys(d.payload)) {
            allFields.add(k);
          }
        }

        compResult.windows[windowLabel] = {
          points: data.length,
          oldest: oldest.toISOString(),
          newest: newest.toISOString(),
          span_minutes: spanMinutes,
          points_per_minute: spanMinutes > 0 ? Math.round((data.length / spanMinutes) * 10) / 10 : 0,
          total_fields: allFields.size,
          key_fields: fieldsPresent,
        };
      } catch (err) {
        compResult.windows[windowLabel] = {
          points: 0,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }

    // Determine baseline readiness
    const best = compResult.windows["7d"] || compResult.windows["24h"] || compResult.windows["1h"];
    if (best && best.points > 0) {
      compResult.status = best.points > 3600 ? "good" : best.points > 300 ? "partial" : "minimal";
      compResult.baseline_ready = best.points > 1800; // 30+ minutes at 1Hz
      compResult.total_points = best.points;
      compResult.data_span_minutes = best.span_minutes;
    }

    results.components[comp.name] = compResult;
  }

  // Overall summary
  const statuses = Object.values(results.components).map((c: any) => c.status);
  results.summary = {
    components_with_data: statuses.filter((s: string) => s !== "no_data").length,
    components_total: COMPONENTS.length,
    baseline_ready_count: Object.values(results.components).filter((c: any) => c.baseline_ready).length,
    overall: statuses.every((s: string) => s === "good") ? "READY" :
             statuses.some((s: string) => s !== "no_data") ? "PARTIAL" : "NO_DATA",
  };

  return NextResponse.json(results);
}
