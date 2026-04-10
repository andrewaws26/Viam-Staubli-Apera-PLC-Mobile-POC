// /api/cell-readings — Returns combined Staubli + Apera + network readings.
//
// Data flow: Pi 5 on the cell network polls Staubli REST API (192.168.0.254)
// and Apera socket (192.168.3.151:14040) every 1-5 seconds, pushing readings
// to Viam Cloud as a sensor component. This endpoint queries Viam for the
// latest readings and transforms the flat key format back to nested CellState.
//
// Query params:
//   ?component=cell-monitor  — Viam component name (default)
//   ?sim=true                — Return simulated data for UI development

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getLatestReading, resetDataClient } from "@/lib/viam-data";
import { getDefaultTruck, getTruckById } from "@/lib/machines";

// ---------------------------------------------------------------------------
// Flat → Nested transformer
// ---------------------------------------------------------------------------
// The cell-sensor Viam module stores readings as a flat dict with prefixed keys.
// This function reconstructs the nested CellState the dashboard components expect.

/** Known device display names (must match DEFAULT_DEVICES in network_monitor.py) */
const DEVICE_NAMES: Record<string, string> = {
  staubli_cs9: "Staubli CS9",
  apera_vue_pc: "Apera Vue PC",
  jtekt_plc: "JTEKT PLC",
  seedsware_panel: "Seedsware Panel",
  stridelinx_vpn: "Stridelinx VPN",
};

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" ? v : fallback;
}
function bool(v: unknown, fallback = false): boolean {
  return typeof v === "boolean" ? v : fallback;
}
function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function transformReadings(flat: Record<string, unknown>) {
  // -- Staubli --
  const staubli = {
    connected: bool(flat.staubli_connected),
    last_poll_ms: num(flat.staubli_last_poll_ms),
    poll_count: num(flat.staubli_poll_count),
    j1_pos: num(flat.staubli_j1_pos), j2_pos: num(flat.staubli_j2_pos), j3_pos: num(flat.staubli_j3_pos),
    j4_pos: num(flat.staubli_j4_pos), j5_pos: num(flat.staubli_j5_pos), j6_pos: num(flat.staubli_j6_pos),
    tcp_x: num(flat.staubli_tcp_x), tcp_y: num(flat.staubli_tcp_y), tcp_z: num(flat.staubli_tcp_z),
    tcp_rx: num(flat.staubli_tcp_rx), tcp_ry: num(flat.staubli_tcp_ry), tcp_rz: num(flat.staubli_tcp_rz),
    temp_j1: num(flat.staubli_temp_j1), temp_j2: num(flat.staubli_temp_j2), temp_j3: num(flat.staubli_temp_j3),
    temp_j4: num(flat.staubli_temp_j4), temp_j5: num(flat.staubli_temp_j5), temp_j6: num(flat.staubli_temp_j6),
    temp_dsi: num(flat.staubli_temp_dsi),
    // Extended temperatures
    temp_encoder_j1: num(flat.staubli_temp_encoder_j1), temp_encoder_j2: num(flat.staubli_temp_encoder_j2),
    temp_encoder_j3: num(flat.staubli_temp_encoder_j3), temp_encoder_j4: num(flat.staubli_temp_encoder_j4),
    temp_encoder_j5: num(flat.staubli_temp_encoder_j5), temp_encoder_j6: num(flat.staubli_temp_encoder_j6),
    temp_drive_case_j1: num(flat.staubli_temp_drive_case_j1), temp_drive_case_j2: num(flat.staubli_temp_drive_case_j2),
    temp_drive_case_j3: num(flat.staubli_temp_drive_case_j3), temp_drive_case_j4: num(flat.staubli_temp_drive_case_j4),
    temp_drive_case_j5: num(flat.staubli_temp_drive_case_j5), temp_drive_case_j6: num(flat.staubli_temp_drive_case_j6),
    temp_winding_j1: num(flat.staubli_temp_winding_j1), temp_winding_j2: num(flat.staubli_temp_winding_j2),
    temp_winding_j3: num(flat.staubli_temp_winding_j3), temp_winding_j4: num(flat.staubli_temp_winding_j4),
    temp_winding_j5: num(flat.staubli_temp_winding_j5), temp_winding_j6: num(flat.staubli_temp_winding_j6),
    temp_junction_j1: num(flat.staubli_temp_junction_j1), temp_junction_j2: num(flat.staubli_temp_junction_j2),
    temp_junction_j3: num(flat.staubli_temp_junction_j3), temp_junction_j4: num(flat.staubli_temp_junction_j4),
    temp_junction_j5: num(flat.staubli_temp_junction_j5), temp_junction_j6: num(flat.staubli_temp_junction_j6),
    temp_cpu: num(flat.staubli_temp_cpu), temp_cpu_board: num(flat.staubli_temp_cpu_board),
    temp_rsi: num(flat.staubli_temp_rsi), temp_starc_board: num(flat.staubli_temp_starc_board),
    // Joint torques
    torque_j1: num(flat.staubli_torque_j1), torque_j2: num(flat.staubli_torque_j2), torque_j3: num(flat.staubli_torque_j3),
    torque_j4: num(flat.staubli_torque_j4), torque_j5: num(flat.staubli_torque_j5), torque_j6: num(flat.staubli_torque_j6),
    // I/O board
    ioboard_connected: bool(flat.staubli_ioboard_connected), ioboard_bus_state: str(flat.staubli_ioboard_bus_state),
    ioboard_slave_count: num(flat.staubli_ioboard_slave_count), ioboard_op_state: bool(flat.staubli_ioboard_op_state),
    task_selected: str(flat.staubli_task_selected), task_status: str(flat.staubli_task_status),
    parts_found: num(flat.staubli_parts_found),
    part_picked: str(flat.staubli_part_picked), part_desired: str(flat.staubli_part_desired),
    class_ids: collectIndexed(flat, "staubli_class_ids_") as string[],
    class_counts: collectIndexed(flat, "staubli_class_counts_") as number[],
    move_id: num(flat.staubli_move_id),
    at_home: bool(flat.staubli_at_home), at_stow: bool(flat.staubli_at_stow),
    at_clear: bool(flat.staubli_at_clear), at_capture: bool(flat.staubli_at_capture),
    at_start: bool(flat.staubli_at_start), at_end: bool(flat.staubli_at_end),
    at_accept: bool(flat.staubli_at_accept), at_reject: bool(flat.staubli_at_reject),
    conveyor_fwd: bool(flat.staubli_conveyor_fwd), feed_conveyor: bool(flat.staubli_feed_conveyor),
    trajectory_found: bool(flat.staubli_trajectory_found),
    stop1_active: bool(flat.staubli_stop1_active), stop2_active: bool(flat.staubli_stop2_active),
    door_open: bool(flat.staubli_door_open),
    arm_cycles: num(flat.staubli_arm_cycles), power_on_hours: num(flat.staubli_power_on_hours),
    urps_errors_24h: num(flat.staubli_urps_errors_24h), ethercat_errors_24h: num(flat.staubli_ethercat_errors_24h),
    last_error_code: str(flat.staubli_last_error_code), last_error_time: str(flat.staubli_last_error_time),
  };

  // -- Apera --
  const apera = {
    connected: bool(flat.apera_connected),
    socket_latency_ms: num(flat.apera_socket_latency_ms),
    last_poll_ms: num(flat.apera_last_poll_ms),
    pipeline_name: str(flat.apera_pipeline_name),
    pipeline_state: str(flat.apera_pipeline_state, "unknown"),
    last_cycle_ms: num(flat.apera_last_cycle_ms),
    total_detections: num(flat.apera_total_detections),
    detections_by_class: collectPrefixed(flat, "apera_detections_by_class_"),
    detection_confidence_avg: num(flat.apera_detection_confidence_avg),
    pick_pose_available: bool(flat.apera_pick_pose_available),
    trajectory_available: bool(flat.apera_trajectory_available),
    calibration_status: str(flat.apera_calibration_status, "unchecked"),
    last_cal_check: str(flat.apera_last_cal_check),
    cal_residual_mm: num(flat.apera_cal_residual_mm),
    system_status: str(flat.apera_system_status, "unknown"),
    app_manager_ok: bool(flat.apera_app_manager_ok),
  };

  // -- Network devices --
  // Keys are like: net_staubli_cs9_ip, net_staubli_cs9_reachable, net_staubli_cs9_latency_ms
  const network = reconstructNetworkDevices(flat);

  // -- Internet uplink --
  const internet = {
    reachable: bool(flat.inet_reachable),
    latency_ms: num(flat.inet_latency_ms),
    jitter_ms: num(flat.inet_jitter_ms),
    packet_loss_pct: num(flat.inet_packet_loss_pct),
    dns_ok: bool(flat.inet_dns_ok),
    dns_resolve_ms: num(flat.inet_dns_resolve_ms),
    viam_reachable: bool(flat.inet_viam_reachable),
    viam_latency_ms: num(flat.inet_viam_latency_ms),
    gateway_ip: str(flat.inet_gateway_ip),
    interface: str(flat.inet_interface),
    link_speed_mbps: num(flat.inet_link_speed_mbps),
    rx_bytes: num(flat.inet_rx_bytes),
    tx_bytes: num(flat.inet_tx_bytes),
    rx_errors: num(flat.inet_rx_errors),
    tx_errors: num(flat.inet_tx_errors),
  };

  // -- Switch / VPN --
  const switchVpn = {
    eth0_up: bool(flat.switch_eth0_up),
    eth0_speed_mbps: num(flat.switch_eth0_speed_mbps),
    eth0_duplex: str(flat.switch_eth0_duplex),
    devices_on_switch: num(flat.switch_devices_on_switch),
    vpn_reachable: bool(flat.vpn_reachable),
    vpn_latency_ms: num(flat.vpn_latency_ms),
    vpn_is_gateway: bool(flat.vpn_is_gateway),
    vpn_web_ok: bool(flat.vpn_web_ok),
    vpn_ip: str(flat.vpn_ip),
  };

  // -- Staubli Logs (from FTP scraping) --
  const staubliLogs = {
    log_connected: bool(flat.staubli_log_log_connected),
    urps_events_24h: num(flat.staubli_log_urps_events_24h),
    urps_last_time: str(flat.staubli_log_urps_last_time),
    urps_last_code: str(flat.staubli_log_urps_last_code),
    ethercat_events_24h: num(flat.staubli_log_ethercat_events_24h),
    ethercat_frame_loss_24h: num(flat.staubli_log_ethercat_frame_loss_24h),
    safety_stops_24h: num(flat.staubli_log_safety_stops_24h),
    safety_last_cause: str(flat.staubli_log_safety_last_cause),
    servo_disable_count_24h: num(flat.staubli_log_servo_disable_count_24h),
    servo_enable_count_24h: num(flat.staubli_log_servo_enable_count_24h),
    app_restarts_24h: num(flat.staubli_log_app_restarts_24h),
    arm_total_cycles: num(flat.staubli_log_arm_total_cycles),
    arm_power_on_hours: num(flat.staubli_log_arm_power_on_hours),
    controller_cpu_load_pct: num(flat.staubli_log_controller_cpu_load_pct),
  };

  // -- Pi 5 health --
  const piHealth = {
    cpu_temp_c: num(flat.pi_cpu_temp_c),
    load_1m: num(flat.pi_load_1m),
    load_5m: num(flat.pi_load_5m),
    load_15m: num(flat.pi_load_15m),
    mem_total_mb: num(flat.pi_mem_total_mb),
    mem_available_mb: num(flat.pi_mem_available_mb),
    mem_used_pct: num(flat.pi_mem_used_pct),
    disk_total_gb: num(flat.pi_disk_total_gb),
    disk_free_gb: num(flat.pi_disk_free_gb),
    disk_used_pct: num(flat.pi_disk_used_pct),
    uptime_hours: num(flat.pi_uptime_hours),
    undervoltage_now: bool(flat.pi_undervoltage_now),
    freq_capped_now: bool(flat.pi_freq_capped_now),
    throttled_now: bool(flat.pi_throttled_now),
    undervoltage_ever: bool(flat.pi_undervoltage_ever),
    freq_capped_ever: bool(flat.pi_freq_capped_ever),
    throttled_ever: bool(flat.pi_throttled_ever),
  };

  return {
    staubli,
    staubliLogs,
    apera,
    network,
    internet,
    switchVpn,
    piHealth,
    alerts: [],
    last_update: new Date().toISOString(),
  };
}

/** Collect indexed flat keys like staubli_class_ids_0, _1, _2 into an array. */
function collectIndexed(flat: Record<string, unknown>, prefix: string): unknown[] {
  const arr: unknown[] = [];
  for (let i = 0; i < 20; i++) {
    const key = `${prefix}${i}`;
    if (key in flat) arr.push(flat[key]);
    else break;
  }
  return arr;
}

/** Collect prefixed keys into a Record (e.g. apera_detections_by_class_14in_plate). */
function collectPrefixed(flat: Record<string, unknown>, prefix: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(flat)) {
    if (k.startsWith(prefix)) {
      out[k.slice(prefix.length)] = num(v);
    }
  }
  return out;
}

/** Reconstruct NetworkDevice[] from flat net_* keys. */
function reconstructNetworkDevices(flat: Record<string, unknown>) {
  // Find all device slugs by scanning for net_*_ip keys
  const slugs = new Set<string>();
  for (const key of Object.keys(flat)) {
    if (key.startsWith("net_") && key.endsWith("_ip")) {
      slugs.add(key.slice(4, -3)); // strip "net_" and "_ip"
    }
  }

  return Array.from(slugs).map((slug) => ({
    name: DEVICE_NAMES[slug] || slug.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    ip: str(flat[`net_${slug}_ip`]),
    reachable: bool(flat[`net_${slug}_reachable`]),
    latency_ms: num(flat[`net_${slug}_latency_ms`]),
    last_seen: new Date().toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// Simulated data for development/demo
// ---------------------------------------------------------------------------

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
      // Extended temperatures (realistic sim values)
      temp_encoder_j1: 35 + jitter() * 2, temp_encoder_j2: 36 + jitter() * 2, temp_encoder_j3: 35 + jitter() * 2,
      temp_encoder_j4: 34 + jitter() * 2, temp_encoder_j5: 35 + jitter() * 2, temp_encoder_j6: 36 + jitter() * 2,
      temp_drive_case_j1: 25 + jitter() * 3, temp_drive_case_j2: 27 + jitter() * 3, temp_drive_case_j3: 30 + jitter() * 3,
      temp_drive_case_j4: 24 + jitter() * 3, temp_drive_case_j5: 26 + jitter() * 3, temp_drive_case_j6: 28 + jitter() * 3,
      temp_winding_j1: 38 + jitter() * 4, temp_winding_j2: 42 + jitter() * 4, temp_winding_j3: 55 + jitter() * 4,
      temp_winding_j4: 35 + jitter() * 4, temp_winding_j5: 40 + jitter() * 4, temp_winding_j6: 44 + jitter() * 4,
      temp_junction_j1: 30 + jitter() * 3, temp_junction_j2: 33 + jitter() * 3, temp_junction_j3: 38 + jitter() * 3,
      temp_junction_j4: 28 + jitter() * 3, temp_junction_j5: 31 + jitter() * 3, temp_junction_j6: 35 + jitter() * 3,
      temp_cpu: 55 + jitter() * 3, temp_cpu_board: 38 + jitter() * 2, temp_rsi: 38 + jitter() * 2, temp_starc_board: 46 + jitter() * 2,
      // Joint torques (realistic sim — static load at home position)
      torque_j1: 12.3 + jitter() * 2, torque_j2: -45.8 + jitter() * 3, torque_j3: 28.1 + jitter() * 2,
      torque_j4: 3.2 + jitter(), torque_j5: -8.5 + jitter(), torque_j6: 1.1 + jitter() * 0.5,
      // I/O board (sim = connected, all 3 slaves in OP)
      ioboard_connected: true, ioboard_bus_state: "OP", ioboard_slave_count: 3, ioboard_op_state: true,
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
    staubliLogs: {
      log_connected: true,
      urps_events_24h: 2, urps_last_time: new Date(Date.now() - 7200000).toISOString(), urps_last_code: "0x168D",
      ethercat_events_24h: 3, ethercat_frame_loss_24h: 1,
      safety_stops_24h: 1, safety_last_cause: "Door interlock opened during cycle",
      servo_disable_count_24h: 4, servo_enable_count_24h: 5,
      app_restarts_24h: 0, arm_total_cycles: 17157, arm_power_on_hours: 6.65,
      controller_cpu_load_pct: 42.3,
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
      system_status: "alive" as const,
      app_manager_ok: true,
    },
    network: [
      { name: "Staubli CS9", ip: "192.168.0.254", reachable: true, latency_ms: 2, last_seen: new Date().toISOString() },
      { name: "Apera Vue PC", ip: "192.168.3.151", reachable: true, latency_ms: 3, last_seen: new Date().toISOString() },
      { name: "JTEKT PLC", ip: "192.168.0.10", reachable: Math.random() > 0.1, latency_ms: 5, last_seen: new Date().toISOString() },
      { name: "Seedsware Panel", ip: "192.168.0.22", reachable: true, latency_ms: 4, last_seen: new Date().toISOString() },
      { name: "Stridelinx VPN", ip: "192.168.0.1", reachable: true, latency_ms: 1, last_seen: new Date().toISOString() },
    ],
    internet: {
      reachable: true,
      latency_ms: 55 + Math.random() * 80,
      jitter_ms: 15 + Math.random() * 30,
      packet_loss_pct: Math.random() > 0.9 ? 20 : 0,
      dns_ok: true,
      dns_resolve_ms: 80 + Math.random() * 100,
      viam_reachable: true,
      viam_latency_ms: 150 + Math.random() * 100,
      gateway_ip: "192.168.0.1",
      interface: "eth0",
      link_speed_mbps: 1000,
      rx_bytes: 10_000_000 + Math.floor(Math.random() * 50_000_000),
      tx_bytes: 25_000_000 + Math.floor(Math.random() * 50_000_000),
      rx_errors: 0,
      tx_errors: 0,
    },
    switchVpn: {
      eth0_up: true,
      eth0_speed_mbps: 1000,
      eth0_duplex: "full",
      devices_on_switch: 4 + Math.floor(Math.random() * 2),
      vpn_reachable: true,
      vpn_latency_ms: 0.5 + Math.random() * 1.5,
      vpn_is_gateway: true,
      vpn_web_ok: true,
      vpn_ip: "192.168.0.1",
    },
    piHealth: {
      cpu_temp_c: 40 + Math.random() * 10,
      load_1m: 0.2 + Math.random() * 0.5,
      load_5m: 0.15 + Math.random() * 0.3,
      load_15m: 0.1 + Math.random() * 0.2,
      mem_total_mb: 8063,
      mem_available_mb: 6800 + Math.floor(Math.random() * 500),
      mem_used_pct: 10 + Math.random() * 8,
      disk_total_gb: 234.3,
      disk_free_gb: 210 + Math.random() * 10,
      disk_used_pct: 8 + Math.random() * 3,
      uptime_hours: 24.5 + Math.random() * 200,
      undervoltage_now: false,
      freq_capped_now: false,
      throttled_now: false,
      undervoltage_ever: false,
      freq_capped_ever: false,
      throttled_ever: false,
    },
    alerts: [],
    last_update: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

const COMPONENT_NAME = "cell-monitor";

export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sim = request.nextUrl.searchParams.get("sim");
  const truckId = request.nextUrl.searchParams.get("truck");
  const component = request.nextUrl.searchParams.get("component") || COMPONENT_NAME;

  // Sim mode — return fake data for UI development (only allowed for truck "00")
  if (sim === "true" && (!truckId || truckId === "00")) {
    return NextResponse.json({ ...getSimData(), _is_sim: true });
  }

  // Resolve the truck config — use specific truck if provided, else default
  const truck = truckId ? await getTruckById(truckId) : await getDefaultTruck();

  if (!truck?.tpsPartId) {
    // Truck has no Part ID → no cell data available (NOT sim fallback)
    return NextResponse.json({
      _no_cell: true,
      _reason: truckId
        ? `Truck "${truckId}" has no cell-monitor configured`
        : "No VIAM_PART_ID configured",
    });
  }

  try {
    const result = await getLatestReading(truck.tpsPartId, component);

    if (!result) {
      // No recent data in Viam — cell is offline
      return NextResponse.json({
        _no_cell: true,
        _offline: true,
        _reason: "no_recent_data",
      });
    }

    const dataAgeSec = Math.round((Date.now() - result.timeCaptured.getTime()) / 1000);
    const cellState = transformReadings(result.payload);

    return NextResponse.json({
      ...cellState,
      _is_sim: false,
      _data_age_seconds: dataAgeSec,
      _source: "viam",
    });
  } catch (err) {
    resetDataClient();
    console.error("[cell-readings] Viam query failed:", err);

    // Return error state — NOT sim data
    return NextResponse.json({
      _no_cell: true,
      _offline: true,
      _reason: "viam_error",
      _error: err instanceof Error ? err.message : String(err),
    });
  }
}
