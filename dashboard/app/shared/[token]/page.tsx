"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import dynamic from "next/dynamic";

const SnapshotMap = dynamic(() => import("@/components/SnapshotMap"), { ssr: false });

// ── Types (self-contained for public page — no auth imports) ────────

interface SharedData {
  entity_type: string;
  title: string;
  shared_by: string;
  shared_at: string;
  message: string | null;
  data: Record<string, unknown> | null;
}

interface Field { key: string; label: string }
interface SectionDef { title: string; icon: string; fields: Field[]; system: string }

const AVAILABLE_SYSTEMS = [
  { id: "truck_engine", label: "Truck Engine", icon: "\uD83D\uDE9B" },
  { id: "tps_buggy", label: "TPS Buggy", icon: "\uD83D\uDEE4\uFE0F" },
  { id: "robot_cell", label: "Robot Cell", icon: "\uD83E\uDD16" },
];

const SYSTEM_HEADER_CLASSES: Record<string, string> = {
  truck_engine: "text-blue-400",
  tps_buggy: "text-amber-400",
  robot_cell: "text-violet-400",
};

const SYSTEM_BADGE_CLASSES: Record<string, string> = {
  truck_engine: "bg-blue-900/40 text-blue-300",
  tps_buggy: "bg-amber-900/40 text-amber-300",
  robot_cell: "bg-violet-900/40 text-violet-300",
};

const SECTIONS: SectionDef[] = [
  // ── Truck Engine (no prefix) ───────────────────────────────────
  { title: "Engine", icon: "\u2699\uFE0F", system: "truck_engine", fields: [
    { key: "engine_rpm", label: "Engine RPM" }, { key: "engine_load_pct", label: "Engine Load" },
    { key: "accel_pedal_pos_pct", label: "Accelerator" }, { key: "driver_demand_torque_pct", label: "Demand Torque" },
    { key: "actual_engine_torque_pct", label: "Actual Torque" },
  ]},
  { title: "Temperatures", icon: "\uD83C\uDF21\uFE0F", system: "truck_engine", fields: [
    { key: "coolant_temp_f", label: "Coolant" }, { key: "oil_temp_f", label: "Oil" },
    { key: "fuel_temp_f", label: "Fuel" }, { key: "intake_manifold_temp_f", label: "Intake" },
    { key: "trans_oil_temp_f", label: "Trans Oil" }, { key: "ambient_temp_f", label: "Ambient" },
  ]},
  { title: "Pressures", icon: "\uD83D\uDCCA", system: "truck_engine", fields: [
    { key: "oil_pressure_psi", label: "Oil Pressure" }, { key: "fuel_pressure_psi", label: "Fuel" },
    { key: "boost_pressure_psi", label: "Boost" }, { key: "barometric_pressure_psi", label: "Baro" },
  ]},
  { title: "Vehicle", icon: "\uD83D\uDE98", system: "truck_engine", fields: [
    { key: "vehicle_speed_mph", label: "Speed" }, { key: "current_gear", label: "Gear" },
    { key: "fuel_rate_gph", label: "Fuel Rate" }, { key: "fuel_economy_mpg", label: "Fuel Economy" },
    { key: "fuel_level_pct", label: "Fuel Level" }, { key: "battery_voltage_v", label: "Battery" },
  ]},
  { title: "Aftertreatment", icon: "\u2601\uFE0F", system: "truck_engine", fields: [
    { key: "def_level_pct", label: "DEF Level" }, { key: "def_temp_f", label: "DEF Temp" },
    { key: "dpf_soot_load_pct", label: "DPF Soot Load" }, { key: "dpf_regen_status", label: "DPF Regen" },
    { key: "dpf_diff_pressure_psi", label: "DPF Diff Pressure" },
    { key: "protect_lamp_engine", label: "Protect (Engine)" }, { key: "protect_lamp_acm", label: "Protect (ACM)" },
  ]},
  { title: "Brakes & Safety", icon: "\uD83D\uDED1", system: "truck_engine", fields: [
    { key: "brake_pedal_pos_pct", label: "Brake Pedal" }, { key: "abs_active", label: "ABS Active" },
    { key: "brake_air_pressure_psi", label: "Brake Air" },
  ]},
  { title: "PTO / Hydraulics", icon: "\uD83D\uDD27", system: "truck_engine", fields: [
    { key: "retarder_torque_pct", label: "Retarder Torque" }, { key: "pto_engaged", label: "PTO Status" },
    { key: "pto_rpm", label: "PTO Speed" }, { key: "hydraulic_oil_temp_f", label: "Hydraulic Temp" },
    { key: "hydraulic_oil_pressure_psi", label: "Hydraulic Pressure" },
  ]},
  { title: "Idle / Trip / Service", icon: "\u23F1\uFE0F", system: "truck_engine", fields: [
    { key: "idle_fuel_used_gal", label: "Idle Fuel Used" }, { key: "idle_engine_hours", label: "Idle Hours" },
    { key: "trip_fuel_gal", label: "Trip Fuel" }, { key: "service_distance_mi", label: "Next Service" },
  ]},
  { title: "Air / Wheel Speed", icon: "\uD83D\uDEDE\uFE0F", system: "truck_engine", fields: [
    { key: "air_supply_pressure_psi", label: "Air Supply" },
    { key: "air_pressure_circuit1_psi", label: "Circuit 1" }, { key: "air_pressure_circuit2_psi", label: "Circuit 2" },
    { key: "front_axle_speed_mph", label: "Front Axle Speed" },
  ]},
  { title: "Navigation / GPS", icon: "\uD83D\uDCCD", system: "truck_engine", fields: [
    { key: "gps_latitude", label: "Latitude" }, { key: "gps_longitude", label: "Longitude" },
    { key: "compass_bearing_deg", label: "Heading" }, { key: "altitude_ft", label: "Altitude" },
    { key: "nav_speed_mph", label: "GPS Speed" }, { key: "vehicle_pitch_deg", label: "Pitch" },
  ]},
  { title: "Extended Engine", icon: "\uD83D\uDD0C", system: "truck_engine", fields: [
    { key: "exhaust_gas_pressure_psi", label: "Exhaust Pressure" },
    { key: "vehicle_distance_mi", label: "Odometer" }, { key: "vehicle_distance_hr_mi", label: "Odometer (HR)" },
    { key: "cruise_control_active", label: "Cruise" }, { key: "trans_output_rpm", label: "Trans Output RPM" },
  ]},
  { title: "Fuel Cost", icon: "\u26FD", system: "truck_engine", fields: [
    { key: "fuel_cost_per_hour", label: "Burn Rate" }, { key: "fuel_cost_per_mile", label: "Cost/Mile" },
  ]},
  { title: "System Health", icon: "\uD83D\uDEA8", system: "truck_engine", fields: [
    { key: "dpf_health", label: "DPF Filter" }, { key: "battery_health", label: "Battery" },
    { key: "def_low", label: "DEF Fluid Low" }, { key: "idle_pct", label: "Lifetime Idle %" },
    { key: "idle_fuel_pct", label: "Idle Fuel %" },
  ]},
  { title: "Lifetime / Identity", icon: "\uD83D\uDCC8", system: "truck_engine", fields: [
    { key: "vin", label: "VIN" },
    { key: "engine_hours", label: "Engine Hours" }, { key: "total_fuel_used_gal", label: "Total Fuel" },
    { key: "idle_fuel_used_gal", label: "Idle Fuel" }, { key: "idle_engine_hours", label: "Idle Hours" },
    { key: "vehicle_distance_mi", label: "Odometer" },
    { key: "prop_start_counter_a", label: "Start Count A" }, { key: "prop_start_counter_b", label: "Start Count B" },
  ]},
  { title: "Warning Lamps", icon: "\uD83D\uDEA6", system: "truck_engine", fields: [
    { key: "mil_engine", label: "MIL Engine" }, { key: "amber_lamp_engine", label: "Amber Engine" },
    { key: "red_stop_lamp_engine", label: "Red Stop Engine" },
    { key: "mil_acm", label: "MIL ACM" }, { key: "amber_lamp_acm", label: "Amber ACM" },
    { key: "mil_trans", label: "MIL Trans" }, { key: "amber_lamp_trans", label: "Amber Trans" },
    { key: "mil_abs", label: "MIL ABS" }, { key: "amber_lamp_abs", label: "Amber ABS" },
  ]},
  { title: "DTC Summary", icon: "\u26A0\uFE0F", system: "truck_engine", fields: [
    { key: "active_dtc_count", label: "Active DTCs" },
    { key: "dtc_engine_count", label: "Engine DTCs" }, { key: "dtc_trans_count", label: "Trans DTCs" },
    { key: "dtc_abs_count", label: "ABS DTCs" }, { key: "dtc_acm_count", label: "ACM DTCs" },
    { key: "prev_dtc_count", label: "Previous DTCs" },
  ]},
  { title: "Pi System", icon: "\uD83E\uDD16", system: "truck_engine", fields: [
    { key: "cpu_temp_c", label: "CPU Temp" }, { key: "cpu_usage_pct", label: "CPU Usage" },
    { key: "memory_used_pct", label: "Memory Used" }, { key: "disk_used_pct", label: "Disk Used" },
    { key: "wifi_ssid", label: "WiFi SSID" }, { key: "wifi_signal_pct", label: "WiFi Signal" },
    { key: "tailscale_online", label: "Tailscale" }, { key: "internet", label: "Internet" },
    { key: "_bus_connected", label: "CAN Bus" }, { key: "_frame_count", label: "CAN Frames" },
  ]},

  // ── TPS Buggy (plc_ prefix) ────────────────────────────────────
  { title: "TPS Production", icon: "\uD83C\uDFED", system: "tps_buggy", fields: [
    { key: "plc_plate_drop_count", label: "Plate Count" },
    { key: "plc_camera_detections_per_min", label: "Camera Det/min" },
    { key: "plc_eject_rate_per_min", label: "Eject Rate/min" },
    { key: "plc_detector_eject_rate_per_min", label: "Detector Eject/min" },
    { key: "plc_shift_hours", label: "Shift Hours" },
    { key: "plc_total_reads", label: "Total Reads" },
  ]},
  { title: "TPS Encoder & Track", icon: "\uD83D\uDCCF", system: "tps_buggy", fields: [
    { key: "plc_encoder_count", label: "Encoder Count" },
    { key: "plc_encoder_distance_ft", label: "Distance (ft)" },
    { key: "plc_encoder_speed_ftpm", label: "Speed (ft/min)" },
    { key: "plc_encoder_revolutions", label: "Revolutions" },
    { key: "plc_encoder_direction", label: "Direction" },
    { key: "plc_encoder_enabled", label: "Encoder On" },
  ]},
  { title: "TPS Operating Mode", icon: "\uD83C\uDF9B\uFE0F", system: "tps_buggy", fields: [
    { key: "plc_operating_mode", label: "Mode" },
    { key: "plc_mode_tps1_single", label: "TPS1 Single" },
    { key: "plc_mode_tps1_double", label: "TPS1 Double" },
    { key: "plc_mode_tps2_both", label: "TPS2 Both" },
    { key: "plc_mode_tps2_left", label: "TPS2 Left" },
    { key: "plc_mode_tps2_right", label: "TPS2 Right" },
    { key: "plc_mode_tie_team", label: "Tie Team" },
    { key: "plc_mode_2nd_pass", label: "2nd Pass" },
  ]},
  { title: "TPS Drop System", icon: "\u2B07\uFE0F", system: "tps_buggy", fields: [
    { key: "plc_drop_enable", label: "Drop Enable" },
    { key: "plc_first_tie_detected", label: "First Tie" },
    { key: "plc_last_drop_spacing_in", label: "Last Spacing (in)" },
    { key: "plc_avg_drop_spacing_in", label: "Avg Spacing (in)" },
    { key: "plc_min_drop_spacing_in", label: "Min Spacing (in)" },
    { key: "plc_max_drop_spacing_in", label: "Max Spacing (in)" },
    { key: "plc_drop_count_in_window", label: "Drops in Window" },
  ]},
  { title: "TPS Camera", icon: "\uD83D\uDCF7", system: "tps_buggy", fields: [
    { key: "plc_camera_signal", label: "Camera Signal" },
    { key: "plc_camera_positive", label: "Detection" },
    { key: "plc_camera_signal_duration_s", label: "Signal Duration (s)" },
    { key: "plc_camera_rate_trend", label: "Rate Trend" },
  ]},
  { title: "TPS Machine Health", icon: "\uD83D\uDD27", system: "tps_buggy", fields: [
    { key: "plc_connected", label: "PLC Connected" },
    { key: "plc_fault", label: "Fault" },
    { key: "plc_system_state", label: "State" },
    { key: "plc_tps_power_loop", label: "Power Loop" },
    { key: "plc_tps_power_duration_s", label: "Power Duration (s)" },
    { key: "plc_diagnostics_count", label: "Diagnostics" },
    { key: "plc_diagnostics_critical", label: "Critical" },
    { key: "plc_diagnostics_warning", label: "Warnings" },
    { key: "plc_modbus_response_time_ms", label: "Modbus Latency (ms)" },
    { key: "plc_eth0_status", label: "Ethernet" },
  ]},
  { title: "TPS Eject", icon: "\uD83D\uDCA8", system: "tps_buggy", fields: [
    { key: "plc_eject_tps_1", label: "TPS 1 Eject" },
    { key: "plc_eject_left_tps_2", label: "TPS 2 Left" },
    { key: "plc_eject_right_tps_2", label: "TPS 2 Right" },
    { key: "plc_air_eagle_1_feedback", label: "Air Eagle 1" },
    { key: "plc_air_eagle_2_feedback", label: "Air Eagle 2" },
    { key: "plc_air_eagle_3_enable", label: "Air Eagle 3" },
  ]},
  { title: "TPS Weather", icon: "\uD83C\uDF24\uFE0F", system: "tps_buggy", fields: [
    { key: "plc_weather", label: "Conditions" },
    { key: "plc_weather_temp", label: "Temperature" },
    { key: "plc_weather_humidity", label: "Humidity" },
    { key: "plc_weather_wind", label: "Wind" },
    { key: "plc_location_city", label: "Location" },
  ]},

  // ── Robot Cell (cell_ prefix) ──────────────────────────────────
  { title: "Staubli Joints", icon: "\uD83E\uDDBE", system: "robot_cell", fields: [
    { key: "cell_staubli_j1_pos", label: "J1" }, { key: "cell_staubli_j2_pos", label: "J2" },
    { key: "cell_staubli_j3_pos", label: "J3" }, { key: "cell_staubli_j4_pos", label: "J4" },
    { key: "cell_staubli_j5_pos", label: "J5" }, { key: "cell_staubli_j6_pos", label: "J6" },
  ]},
  { title: "Staubli TCP Position", icon: "\uD83C\uDFAF", system: "robot_cell", fields: [
    { key: "cell_staubli_tcp_x", label: "TCP X (mm)" }, { key: "cell_staubli_tcp_y", label: "TCP Y (mm)" },
    { key: "cell_staubli_tcp_z", label: "TCP Z (mm)" },
    { key: "cell_staubli_tcp_rx", label: "Rx" }, { key: "cell_staubli_tcp_ry", label: "Ry" },
    { key: "cell_staubli_tcp_rz", label: "Rz" },
  ]},
  { title: "Staubli Temperatures", icon: "\uD83C\uDF21\uFE0F", system: "robot_cell", fields: [
    { key: "cell_staubli_temp_j1", label: "J1 Temp" }, { key: "cell_staubli_temp_j2", label: "J2 Temp" },
    { key: "cell_staubli_temp_j3", label: "J3 Temp" }, { key: "cell_staubli_temp_j4", label: "J4 Temp" },
    { key: "cell_staubli_temp_j5", label: "J5 Temp" }, { key: "cell_staubli_temp_j6", label: "J6 Temp" },
    { key: "cell_staubli_temp_dsi", label: "DSI Temp" },
  ]},
  { title: "Staubli Task", icon: "\uD83D\uDCCB", system: "robot_cell", fields: [
    { key: "cell_staubli_task_selected", label: "Task" },
    { key: "cell_staubli_task_status", label: "Status" },
    { key: "cell_staubli_move_id", label: "Move ID" },
    { key: "cell_staubli_parts_found", label: "Parts Found" },
    { key: "cell_staubli_part_picked", label: "Part Picked" },
    { key: "cell_staubli_part_desired", label: "Part Desired" },
  ]},
  { title: "Staubli Safety", icon: "\uD83D\uDEE1\uFE0F", system: "robot_cell", fields: [
    { key: "cell_staubli_stop1_active", label: "E-Stop 1" },
    { key: "cell_staubli_stop2_active", label: "E-Stop 2" },
    { key: "cell_staubli_door_open", label: "Door Open" },
    { key: "cell_staubli_at_home", label: "At Home" },
    { key: "cell_staubli_at_stow", label: "At Stow" },
    { key: "cell_staubli_at_clear", label: "At Clear" },
    { key: "cell_staubli_trajectory_found", label: "Trajectory" },
  ]},
  { title: "Staubli Lifetime", icon: "\uD83D\uDCCA", system: "robot_cell", fields: [
    { key: "cell_staubli_arm_cycles", label: "Arm Cycles" },
    { key: "cell_staubli_power_on_hours", label: "Power-On Hours" },
    { key: "cell_staubli_urps_errors_24h", label: "URPS Errors/24h" },
    { key: "cell_staubli_ethercat_errors_24h", label: "EtherCAT Err/24h" },
    { key: "cell_staubli_conveyor_fwd", label: "Conveyor Fwd" },
    { key: "cell_staubli_feed_conveyor", label: "Feed Conveyor" },
  ]},
  { title: "Apera Vision", icon: "\uD83D\uDC41\uFE0F", system: "robot_cell", fields: [
    { key: "cell_apera_pipeline_name", label: "Pipeline" },
    { key: "cell_apera_pipeline_state", label: "State" },
    { key: "cell_apera_last_cycle_ms", label: "Cycle Time (ms)" },
    { key: "cell_apera_total_detections", label: "Total Detections" },
    { key: "cell_apera_detection_confidence_avg", label: "Avg Confidence" },
    { key: "cell_apera_pick_pose_available", label: "Pick Pose" },
    { key: "cell_apera_trajectory_available", label: "Trajectory" },
  ]},
  { title: "Apera Calibration", icon: "\uD83D\uDD2C", system: "robot_cell", fields: [
    { key: "cell_apera_calibration_status", label: "Cal Status" },
    { key: "cell_apera_cal_residual_mm", label: "Cal Residual (mm)" },
    { key: "cell_apera_system_status", label: "System Status" },
    { key: "cell_apera_app_manager_ok", label: "App Manager" },
  ]},
  { title: "Cell Network", icon: "\uD83C\uDF10", system: "robot_cell", fields: [
    { key: "cell_net_staubli_cs9_reachable", label: "Staubli CS9" },
    { key: "cell_net_staubli_cs9_latency_ms", label: "CS9 Latency (ms)" },
    { key: "cell_net_apera_vue_pc_reachable", label: "Apera PC" },
    { key: "cell_net_apera_vue_pc_latency_ms", label: "Apera Latency (ms)" },
    { key: "cell_inet_reachable", label: "Internet" },
    { key: "cell_inet_latency_ms", label: "Internet Latency" },
  ]},
  { title: "Cell System", icon: "\uD83D\uDCBB", system: "robot_cell", fields: [
    { key: "cell_pi_cpu_temp_c", label: "CPU Temp" },
    { key: "cell_pi_mem_used_pct", label: "Memory" },
    { key: "cell_pi_disk_used_pct", label: "Disk" },
    { key: "cell_pi_load_1m", label: "Load 1m" },
    { key: "cell_cell_uptime_s", label: "Uptime (s)" },
    { key: "cell_cell_total_reads", label: "Total Reads" },
  ]},
];

function formatValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return "--";
  if (typeof value === "boolean") return value ? "ON" : "OFF";
  if (typeof value === "string") return value;
  if (typeof value === "number") {
    if (key.includes("_pct") || (key.includes("_pos") && !key.includes("staubli"))) return `${value.toFixed(1)}%`;
    if (key.endsWith("_f")) return `${value.toFixed(0)}\u00B0F`;
    if (key.endsWith("_c")) return `${value.toFixed(1)}\u00B0C`;
    if (key.endsWith("_v")) return `${value.toFixed(1)}V`;
    if (key.endsWith("_psi")) return `${value.toFixed(1)} PSI`;
    if (key.endsWith("_mph")) return `${value.toFixed(1)} mph`;
    if (key.endsWith("_gph")) return `${value.toFixed(2)} gph`;
    if (key.endsWith("_mpg")) return `${value.toFixed(1)} mpg`;
    if (key.endsWith("_mi")) return `${value.toFixed(1)} mi`;
    if (key.endsWith("_gal")) return `${value.toFixed(1)} gal`;
    if (key.endsWith("_hrs") || key === "idle_engine_hours" || key === "engine_hours") return `${value.toFixed(1)} hrs`;
    if (key.endsWith("_deg")) return `${value.toFixed(0)}\u00B0`;
    if (key.endsWith("_ft")) return `${value.toFixed(0)} ft`;
    if (key.endsWith("_ms")) return `${value.toFixed(0)} ms`;
    if (key.endsWith("_s") && !key.endsWith("_pos")) return `${value.toFixed(1)}s`;
    if (key.endsWith("_mm")) return `${value.toFixed(2)} mm`;
    if (key.endsWith("_ftpm")) return `${value.toFixed(0)} ft/min`;
    if (key.endsWith("_in")) return `${value.toFixed(1)}"`;
    if (key === "engine_rpm" || key === "pto_rpm" || key === "trans_output_rpm") return `${Math.round(value)}`;
    if (key === "fuel_cost_per_hour") return `$${value.toFixed(2)}/hr`;
    if (key === "fuel_cost_per_mile") return `$${value.toFixed(3)}/mi`;
    if (key === "gps_latitude" || key === "gps_longitude") return value.toFixed(6);
    if (key === "_frame_count") return String(Math.round(value));
    if (key.includes("staubli") && key.includes("_pos")) return `${value.toFixed(2)}\u00B0`;
    if (key.includes("staubli_tcp_")) return value.toFixed(2);
    return value % 1 === 0 ? String(value) : value.toFixed(2);
  }
  return String(value);
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

// ── Snapshot Viewer ─────────────────────────────────────────────────

function SnapshotViewer({ data, meta }: { data: Record<string, unknown>; meta: SharedData }) {
  const readingData = (data.reading_data as Record<string, unknown>) || data;
  const visibleFields = readingData._visible_fields as string[] | undefined;

  const capturedSystems: string[] =
    (readingData._captured_systems as string[]) || (readingData._systems as string[]) || ["truck_engine"];

  const systemGroups = capturedSystems
    .map(sys => {
      const info = AVAILABLE_SYSTEMS.find(s => s.id === sys);
      return {
        system: sys,
        label: info?.label || sys,
        icon: info?.icon || "",
        sections: SECTIONS.filter(s => s.system === sys),
      };
    })
    .filter(g => g.sections.some(s =>
      s.fields.some(f => readingData[f.key] !== undefined && readingData[f.key] !== null)
    ));

  return (
    <div>
      {/* Title banner */}
      <div className="bg-gradient-to-r from-blue-900/40 to-purple-900/40 border border-blue-800/50 rounded-xl p-6 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-white">
              {(data.truck_name as string) || `Truck ${data.truck_id || ""}`}
            </h1>
            <p className="text-blue-300 text-sm mt-1">
              Digital Twin Snapshot &mdash; {data.captured_at ? fmtDate(data.captured_at as string) : ""}
            </p>
            {typeof data.label === "string" && data.label && <p className="text-yellow-300 font-semibold text-sm mt-1">{data.label}</p>}
            {typeof data.notes === "string" && data.notes && <p className="text-gray-400 text-sm mt-1">{data.notes}</p>}
            {/* System badges */}
            <div className="flex flex-wrap gap-1.5 mt-2">
              {capturedSystems.map(sys => {
                const info = AVAILABLE_SYSTEMS.find(a => a.id === sys);
                return info ? (
                  <span key={sys} className={`text-xs px-2 py-0.5 rounded-full font-semibold ${SYSTEM_BADGE_CLASSES[sys] || "bg-gray-800 text-gray-400"}`}>
                    {info.icon} {info.label}
                  </span>
                ) : null;
              })}
            </div>
          </div>
          <div className="text-right text-xs text-gray-400 space-y-1">
            <p>Source: {data.source === "historical" ? "Historical" : "Live"}</p>
            <p>Shared by: {meta.shared_by}</p>
            {typeof data.vin === "string" && data.vin && <p className="font-mono text-gray-300">{data.vin}</p>}
          </div>
        </div>

        {/* Key metrics — Truck Engine */}
        {capturedSystems.includes("truck_engine") && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-4 border-t border-blue-800/40">
            <KeyMetric label="Engine RPM" value={data.engine_rpm != null ? `${Math.round(data.engine_rpm as number)}` : "--"} />
            <KeyMetric label="Speed" value={data.vehicle_speed_mph != null ? `${Math.round(data.vehicle_speed_mph as number)} mph` : "--"} />
            <KeyMetric label="Coolant" value={data.coolant_temp_f != null ? `${Math.round(data.coolant_temp_f as number)}\u00B0F` : "--"} />
            <KeyMetric label="Battery" value={data.battery_voltage_v != null ? `${(data.battery_voltage_v as number).toFixed(1)}V` : "--"} />
          </div>
        )}

        {/* Key metrics — TPS Buggy */}
        {capturedSystems.includes("tps_buggy") && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-4 border-t border-amber-800/40">
            <KeyMetric label="Plate Count" value={readingData.plc_plate_drop_count != null ? String(readingData.plc_plate_drop_count) : "--"} />
            <KeyMetric label="Track Speed" value={readingData.plc_encoder_speed_ftpm != null ? `${Number(readingData.plc_encoder_speed_ftpm).toFixed(0)} ft/min` : "--"} />
            <KeyMetric label="Camera Det/min" value={readingData.plc_camera_detections_per_min != null ? `${Number(readingData.plc_camera_detections_per_min).toFixed(1)}` : "--"} />
            <KeyMetric label="Mode" value={readingData.plc_operating_mode != null ? String(readingData.plc_operating_mode) : "--"} />
          </div>
        )}

        {/* Key metrics — Robot Cell */}
        {capturedSystems.includes("robot_cell") && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-4 border-t border-violet-800/40">
            <KeyMetric label="Arm Cycles" value={readingData.cell_staubli_arm_cycles != null ? String(readingData.cell_staubli_arm_cycles) : "--"} />
            <KeyMetric label="Task Status" value={readingData.cell_staubli_task_status != null ? String(readingData.cell_staubli_task_status) : "--"} />
            <KeyMetric label="Detections" value={readingData.cell_apera_total_detections != null ? String(readingData.cell_apera_total_detections) : "--"} />
            <KeyMetric label="Confidence" value={readingData.cell_apera_detection_confidence_avg != null ? `${Number(readingData.cell_apera_detection_confidence_avg).toFixed(0)}%` : "--"} />
          </div>
        )}
      </div>

      {/* Location map — show if GPS data present */}
      {typeof readingData.gps_latitude === "number" && typeof readingData.gps_longitude === "number" &&
       readingData.gps_latitude !== 0 && readingData.gps_longitude !== 0 && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-lg">&#x1F4CD;</span>
            <h2 className="text-sm font-bold uppercase tracking-wider text-blue-400">Location at Capture</h2>
            <div className="flex-1 h-px bg-gray-800" />
          </div>
          <SnapshotMap
            latitude={readingData.gps_latitude as number}
            longitude={readingData.gps_longitude as number}
            heading={readingData.compass_bearing_deg as number | null}
            speed={readingData.nav_speed_mph as number | null}
            altitude={readingData.altitude_ft as number | null}
          />
        </div>
      )}

      {/* Data grid — grouped by system */}
      {systemGroups.map(group => (
        <div key={group.system} className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-lg">{group.icon}</span>
            <h2 className={`text-sm font-bold uppercase tracking-wider ${SYSTEM_HEADER_CLASSES[group.system] || "text-gray-400"}`}>
              {group.label}
            </h2>
            <div className="flex-1 h-px bg-gray-800" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {group.sections.map((section) => {
              const available = section.fields.filter(f =>
                readingData[f.key] !== undefined && readingData[f.key] !== null &&
                (!visibleFields || visibleFields.includes(f.key))
              );
              if (available.length === 0) return null;
              return (
                <div key={section.title} className="bg-gray-900/50 rounded-xl p-4 border border-gray-800/50">
                  <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">
                    {section.icon} {section.title}
                  </h3>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                    {available.map(f => (
                      <div key={f.key} className="flex justify-between items-baseline">
                        <span className="text-xs text-gray-500 truncate mr-2">{f.label}</span>
                        <span className="text-xs font-mono font-bold text-gray-100">
                          {formatValue(f.key, readingData[f.key])}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* Active DTC Details */}
      {Object.keys(readingData).some(k => k.startsWith("dtc_0_")) && (
        <div className="mt-4 bg-gray-900/50 rounded-xl p-4 border border-gray-800/50">
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">
            {"\u26A0\uFE0F"} Active DTC Details
          </h3>
          <div className="space-y-1">
            {Array.from({ length: 20 }).map((_, i) => {
              const spn = readingData[`dtc_${i}_spn`];
              const fmi = readingData[`dtc_${i}_fmi`];
              if (spn === undefined) return null;
              return (
                <div key={i} className="flex items-center gap-3 text-sm">
                  <span className="font-mono text-red-400">SPN {String(spn)} / FMI {String(fmi)}</span>
                  {readingData[`dtc_${i}_occurrence`] !== undefined && (
                    <span className="text-gray-500 text-xs">({String(readingData[`dtc_${i}_occurrence`])} occurrences)</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Shift Report Viewer ────────────────────────────────────────────

function ShiftReportViewer({ data, meta }: { data: Record<string, unknown>; meta: SharedData }) {
  const r = data;
  return (
    <div>
      <div className="bg-gradient-to-r from-emerald-900/40 to-blue-900/40 border border-emerald-800/50 rounded-xl p-6 mb-6">
        <h1 className="text-2xl font-bold text-white">{meta.title}</h1>
        <p className="text-emerald-300 text-sm mt-1">
          {r.date as string} &mdash; {r.periodStart as string} to {r.periodEnd as string}
        </p>
        <p className="text-gray-400 text-xs mt-1">Shared by {meta.shared_by}</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatCard label="Engine Hours" value={r.engineHours != null ? `${(r.engineHours as number).toFixed(1)}h` : "--"} />
        <StatCard label="Idle %" value={r.idlePercent != null ? `${(r.idlePercent as number).toFixed(0)}%` : "--"} />
        <StatCard label="Total Plates" value={r.totalPlates != null ? `${r.totalPlates}` : "--"} />
        <StatCard label="Plates/Hour" value={r.platesPerHour != null ? `${(r.platesPerHour as number).toFixed(1)}` : "--"} />
      </div>

      {(r.alerts as Array<{ level: string; message: string }> || []).length > 0 && (
        <div className="mb-6 space-y-2">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Alerts</h3>
          {(r.alerts as Array<{ level: string; message: string }>).map((a, i) => (
            <div key={i} className={`px-3 py-2 rounded-lg text-sm ${a.level === "critical" ? "bg-red-900/30 text-red-300 border border-red-800/50" : "bg-yellow-900/30 text-yellow-300 border border-yellow-800/50"}`}>
              {a.message}
            </div>
          ))}
        </div>
      )}

      {(r.dtcEvents as Array<{ code: string; firstSeen: string }> || []).length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-2">DTC Events</h3>
          <div className="space-y-1">
            {(r.dtcEvents as Array<{ code: string; firstSeen: string }>).map((d, i) => (
              <div key={i} className="flex justify-between text-sm bg-gray-900/50 rounded-lg px-3 py-2 border border-gray-800/50">
                <span className="font-mono text-red-400">{d.code}</span>
                <span className="text-gray-500">{fmtDate(d.firstSeen)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {(r.dataQuality as Array<{ message: string }> || []).length > 0 && (
        <div className="text-xs text-gray-600 space-y-1">
          {(r.dataQuality as Array<{ message: string }>).map((w, i) => (
            <p key={i}>{w.message}</p>
          ))}
        </div>
      )}
    </div>
  );
}

function KeyMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <p className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</p>
      <p className="text-lg font-bold text-white font-mono">{value}</p>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-900/50 rounded-xl p-4 border border-gray-800/50 text-center">
      <p className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</p>
      <p className="text-xl font-bold text-white font-mono mt-1">{value}</p>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────

export default function SharedViewPage() {
  const { token } = useParams<{ token: string }>();
  const [shared, setShared] = useState<SharedData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/share/${token}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: res.statusText }));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        setShared(await res.json());
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-gray-500">Loading shared content...</div>
      </div>
    );
  }

  if (error || !shared) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
        <div className="text-center">
          <div className="text-4xl mb-4">
            {error === "This link has expired" ? "\u23F3" : "\uD83D\uDD17"}
          </div>
          <h1 className="text-xl font-bold text-white mb-2">
            {error === "This link has expired" ? "Link Expired" : "Link Not Found"}
          </h1>
          <p className="text-gray-500 text-sm">
            {error === "This link has expired"
              ? "This shared link has expired. Ask the sender to share it again."
              : "This link may have been removed or the URL is incorrect."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Shared banner */}
      <div className="bg-blue-950/50 border-b border-blue-900/50 px-4 py-3">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-blue-400 font-bold text-sm">IronSight</span>
            <span className="text-gray-600 text-xs">|</span>
            <span className="text-gray-400 text-xs">
              Shared by {shared.shared_by} &mdash; {fmtDate(shared.shared_at)}
            </span>
          </div>
          <button
            onClick={() => window.print()}
            className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-xs font-semibold transition-colors"
          >
            Print / PDF
          </button>
        </div>
      </div>

      {/* Personal message */}
      {shared.message && (
        <div className="max-w-5xl mx-auto px-4 pt-4">
          <div className="bg-gray-900/50 border border-gray-800/50 rounded-xl px-4 py-3">
            <p className="text-sm text-gray-300 italic">&ldquo;{shared.message}&rdquo;</p>
            <p className="text-xs text-gray-600 mt-1">&mdash; {shared.shared_by}</p>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="max-w-5xl mx-auto px-4 py-6">
        {shared.data ? (
          shared.entity_type === "snapshot" ? (
            <SnapshotViewer data={shared.data} meta={shared} />
          ) : shared.entity_type === "shift_report" ? (
            <ShiftReportViewer data={shared.data} meta={shared} />
          ) : (
            <div className="text-gray-500 text-center py-20">
              Unsupported content type
            </div>
          )
        ) : (
          <div className="text-gray-500 text-center py-20">
            No data available
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="text-center text-xs text-gray-700 py-6 border-t border-gray-900">
        IronSight Fleet Monitoring &mdash; Shared Report
      </div>
    </div>
  );
}
