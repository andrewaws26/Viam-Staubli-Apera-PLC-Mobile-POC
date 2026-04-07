// /api/cell-readings — Returns combined Staubli + Apera + network readings.
//
// Data flow: Pi 5 on the cell network polls Staubli REST API (192.168.0.254)
// and Apera socket (192.168.3.151:14040) every 1-5 seconds, pushing readings
// to Viam Cloud as a sensor component. This endpoint queries Viam for the
// latest readings, or falls back to a direct connection if available.
//
// Query params:
//   ?component=cell-monitor  — Viam component name (default)
//   ?sim=true                — Return simulated data for UI development

import { NextRequest, NextResponse } from "next/server";

// Simulated data for development before Pi 5 is deployed on the cell network
function getSimData() {
  const jitter = () => (Math.random() - 0.5) * 2;
  return {
    staubli: {
      connected: true,
      last_poll_ms: 48 + Math.random() * 20,
      poll_count: Math.floor(Date.now() / 2000),
      j1_pos: 45.2 + jitter(), j2_pos: -30.5 + jitter(), j3_pos: 90.1 + jitter(),
      j4_pos: 0.3 + jitter(), j5_pos: -45.0 + jitter(), j6_pos: 180.0 + jitter(),
      tcp_x: 1250.3 + jitter() * 5, tcp_y: -340.2 + jitter() * 5, tcp_z: 890.1 + jitter() * 5,
      tcp_rx: 0.5 + jitter(), tcp_ry: -90.2 + jitter(), tcp_rz: 45.0 + jitter(),
      temp_j1: 42 + jitter() * 3, temp_j2: 45 + jitter() * 3, temp_j3: 48 + jitter() * 3,
      temp_j4: 38 + jitter() * 3, temp_j5: 41 + jitter() * 3, temp_j6: 44 + jitter() * 3,
      temp_dsi: 39 + jitter() * 2,
      task_selected: "Cycle", task_status: "Cycle",
      parts_found: Math.floor(Math.random() * 8) + 1,
      part_picked: "14in_plate", part_desired: "14in_plate",
      class_ids: ["14in_plate", "18in_plate", "pandrol_plate", "anchor", "spike"],
      class_counts: [3, 2, 1, 1, 0],
      move_id: Math.floor(Math.random() * 100),
      at_home: false, at_stow: false, at_clear: false, at_capture: false,
      at_start: true, at_end: false, at_accept: false, at_reject: false,
      conveyor_fwd: true, feed_conveyor: true,
      trajectory_found: true,
      stop1_active: false, stop2_active: false, door_open: false,
      arm_cycles: 16609, power_on_hours: 6.65,
      urps_errors_24h: 0, ethercat_errors_24h: 0,
      last_error_code: "", last_error_time: "",
    },
    apera: {
      connected: true,
      socket_latency_ms: 12 + Math.random() * 8,
      last_poll_ms: 35 + Math.random() * 15,
      pipeline_name: "RAIV_pick_belt_1",
      pipeline_state: "idle" as const,
      last_cycle_ms: 320 + Math.floor(Math.random() * 80),
      total_detections: Math.floor(Math.random() * 8) + 1,
      detections_by_class: {
        "14in_plate": 3, "18in_plate": 2, "pandrol_plate": 1, "anchor": 1, "spike": 0,
      },
      detection_confidence_avg: 0.82 + Math.random() * 0.1,
      pick_pose_available: true,
      trajectory_available: true,
      calibration_status: "ok" as const,
      last_cal_check: new Date(Date.now() - 3600000).toISOString(),
      cal_residual_mm: 0.3 + Math.random() * 0.2,
      camera_1_ok: true, camera_2_ok: true,
      gpu_temp_c: 58 + Math.random() * 10,
      gpu_memory_used_pct: 65 + Math.random() * 15,
    },
    network: [
      { name: "Staubli CS9", ip: "192.168.0.254", reachable: true, latency_ms: 2, last_seen: new Date().toISOString() },
      { name: "Apera Vue PC", ip: "192.168.3.151", reachable: true, latency_ms: 3, last_seen: new Date().toISOString() },
      { name: "JTEKT PLC", ip: "192.168.0.10", reachable: Math.random() > 0.1, latency_ms: 5, last_seen: new Date().toISOString() },
      { name: "Seedsware Panel", ip: "192.168.0.22", reachable: true, latency_ms: 4, last_seen: new Date().toISOString() },
      { name: "Stridelinx VPN", ip: "192.168.0.1", reachable: true, latency_ms: 1, last_seen: new Date().toISOString() },
    ],
    alerts: [],
    last_update: new Date().toISOString(),
  };
}

export async function GET(request: NextRequest) {
  const sim = request.nextUrl.searchParams.get("sim");

  // For now, return simulated data. When the Pi 5 Viam module is deployed,
  // this will query Viam Data API for the cell-monitor component readings.
  if (sim === "true" || true) {  // TODO: remove `|| true` when Viam module is live
    return NextResponse.json(getSimData());
  }

  // Future: query Viam for real readings
  // const readings = await viamClient.getLatestReadings("cell-monitor");
  // return NextResponse.json(readings);
}
