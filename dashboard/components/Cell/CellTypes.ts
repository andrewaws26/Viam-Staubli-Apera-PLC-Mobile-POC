// CellTypes.ts — Type definitions for Staubli robot, Apera vision, and cell
// watchdog panels. All metrics are documented with source and poll method.

// ---------------------------------------------------------------------------
// Staubli Robot Readings
// ---------------------------------------------------------------------------
export interface StaubliReadings {
  // Connection
  connected: boolean;
  last_poll_ms: number;
  poll_count: number;

  // Joint positions (degrees)
  j1_pos: number;
  j2_pos: number;
  j3_pos: number;
  j4_pos: number;
  j5_pos: number;
  j6_pos: number;

  // Cartesian TCP (mm and degrees)
  tcp_x: number;
  tcp_y: number;
  tcp_z: number;
  tcp_rx: number;
  tcp_ry: number;
  tcp_rz: number;

  // Motor temperatures (from HMI sTextTemp)
  temp_j1: number;
  temp_j2: number;
  temp_j3: number;
  temp_j4: number;
  temp_j5: number;
  temp_j6: number;
  temp_dsi: number;

  // Production (from HMI variables)
  task_selected: string;       // bTskSelected active key
  task_status: string;         // bTskStatus active key
  parts_found: number;         // nPartsFound[0]
  part_picked: string;         // sPart["Picked"]
  part_desired: string;        // sPart["Desired"]
  class_ids: string[];         // sClassID[0-4]
  class_counts: number[];      // nObjectCount[0-4]
  move_id: number;             // nMoveID[0]

  // Position flags (from HMI bRobotAT)
  at_home: boolean;
  at_stow: boolean;
  at_clear: boolean;
  at_capture: boolean;
  at_start: boolean;
  at_end: boolean;
  at_accept: boolean;
  at_reject: boolean;

  // Conveyor
  conveyor_fwd: boolean;       // bConveyorON["FWD"]
  feed_conveyor: boolean;      // bPlace_FeedConv[0] (read-write)

  // Safety
  trajectory_found: boolean;   // bTrajectoryFound[0]
  stop1_active: boolean;       // diServo["Disable1"]
  stop2_active: boolean;       // diServo["Disable2"]
  door_open: boolean;          // diServo["DoorSwitch"]

  // System health (from log parsing)
  arm_cycles: number;
  power_on_hours: number;
  urps_errors_24h: number;
  ethercat_errors_24h: number;
  last_error_code: string;
  last_error_time: string;
}

// ---------------------------------------------------------------------------
// Apera Vision Readings
// ---------------------------------------------------------------------------
export interface AperaReadings {
  // Connection
  connected: boolean;
  socket_latency_ms: number;
  last_poll_ms: number;

  // Pipeline status
  pipeline_name: string;       // e.g. "RAIV_pick_belt_1"
  pipeline_state: "idle" | "capturing" | "detecting" | "planning" | "error";
  last_cycle_ms: number;       // vision cycle time

  // Detection results
  total_detections: number;
  detections_by_class: Record<string, number>;  // { "14in_plate": 3, "spike": 1, ... }
  detection_confidence_avg: number;

  // Pick planning
  pick_pose_available: boolean;
  trajectory_available: boolean;

  // Calibration
  calibration_status: "ok" | "drift" | "failed" | "unchecked";
  last_cal_check: string;      // ISO timestamp
  cal_residual_mm: number;     // avg translation error

  // System health (from management ports)
  system_status: "alive" | "busy" | "down" | "unreachable" | "unknown";
  app_manager_ok: boolean;
}

// ---------------------------------------------------------------------------
// Network Device Status
// ---------------------------------------------------------------------------
export interface NetworkDevice {
  name: string;
  ip: string;
  reachable: boolean;
  latency_ms: number;
  last_seen: string;           // ISO timestamp
}

// ---------------------------------------------------------------------------
// Cell Watchdog Alert
// ---------------------------------------------------------------------------
export type AlertSeverity = "critical" | "warning" | "info";
export type AlertCategory =
  | "safety" | "thermal" | "communication" | "vision"
  | "production" | "power" | "calibration" | "network";

export interface CellAlert {
  id: string;
  severity: AlertSeverity;
  category: AlertCategory;
  title: string;
  detail: string;
  source: string;              // which subsystem detected it
  timestamp: string;           // ISO
  acknowledged: boolean;
}

// ---------------------------------------------------------------------------
// Internet Uplink Health
// ---------------------------------------------------------------------------
export interface InternetHealth {
  reachable: boolean;
  latency_ms: number;
  jitter_ms: number;
  packet_loss_pct: number;
  dns_ok: boolean;
  dns_resolve_ms: number;
  viam_reachable: boolean;
  viam_latency_ms: number;
  gateway_ip: string;
  interface: string;
  link_speed_mbps: number;
  rx_bytes: number;
  tx_bytes: number;
  rx_errors: number;
  tx_errors: number;
}

// ---------------------------------------------------------------------------
// Switch & VPN Gateway Health
// ---------------------------------------------------------------------------
export interface SwitchVpnHealth {
  eth0_up: boolean;
  eth0_speed_mbps: number;
  eth0_duplex: string;
  devices_on_switch: number;
  vpn_reachable: boolean;
  vpn_latency_ms: number;
  vpn_is_gateway: boolean;
  vpn_web_ok: boolean;
  vpn_ip: string;
}

// ---------------------------------------------------------------------------
// Pi 5 System Health
// ---------------------------------------------------------------------------
export interface PiHealth {
  cpu_temp_c: number;
  load_1m: number;
  load_5m: number;
  load_15m: number;
  mem_total_mb: number;
  mem_available_mb: number;
  mem_used_pct: number;
  disk_total_gb: number;
  disk_free_gb: number;
  disk_used_pct: number;
  uptime_hours: number;
  undervoltage_now: boolean;
  freq_capped_now: boolean;
  throttled_now: boolean;
  undervoltage_ever: boolean;
  freq_capped_ever: boolean;
  throttled_ever: boolean;
}

// ---------------------------------------------------------------------------
// Combined Cell State
// ---------------------------------------------------------------------------
export interface CellState {
  staubli: StaubliReadings | null;
  apera: AperaReadings | null;
  network: NetworkDevice[];
  internet: InternetHealth | null;
  switchVpn: SwitchVpnHealth | null;
  piHealth: PiHealth | null;
  alerts: CellAlert[];
  last_update: string;
}

// ---------------------------------------------------------------------------
// Temperature thresholds (degrees C)
// ---------------------------------------------------------------------------
export const TEMP_THRESHOLDS = {
  motor_warn: 65,
  motor_crit: 80,
  dsi_warn: 55,
  dsi_crit: 70,
  gpu_warn: 75,
  gpu_crit: 90,
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
export function tempColor(val: number, warn: number, crit: number): string {
  if (val >= crit) return "text-red-400";
  if (val >= warn) return "text-orange-400";
  return "text-gray-300";
}

export function tempBg(val: number, warn: number, crit: number): string {
  if (val >= crit) return "bg-red-950/40 border-red-900/50";
  if (val >= warn) return "bg-orange-950/30 border-orange-900/50";
  return "bg-gray-900/50 border-gray-800/50";
}

export function alertColor(severity: AlertSeverity): string {
  switch (severity) {
    case "critical": return "text-red-400 bg-red-950/30 border-red-900/50";
    case "warning": return "text-orange-400 bg-orange-950/30 border-orange-900/50";
    case "info": return "text-blue-400 bg-blue-950/30 border-blue-900/50";
  }
}
