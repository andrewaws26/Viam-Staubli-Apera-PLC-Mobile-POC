"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { formatValue } from "@/components/GaugeGrid";
import { ShareModal } from "@/components/Share/ShareModal";

const SnapshotMap = dynamic(() => import("@/components/SnapshotMap"), { ssr: false });

// ── Types ────────────────────────────────────────────────────────────

interface SnapshotSummary {
  id: string;
  truck_id: string;
  truck_name: string;
  captured_at: string;
  created_at: string;
  created_by_name: string;
  label: string | null;
  notes: string | null;
  source: "live" | "historical";
  systems: string[] | null;
  engine_rpm: number | null;
  vehicle_speed_mph: number | null;
  coolant_temp_f: number | null;
  battery_voltage_v: number | null;
  engine_hours: number | null;
  vehicle_distance_mi: number | null;
  vin: string | null;
  active_dtc_count: number | null;
}

interface SnapshotFull extends SnapshotSummary {
  reading_data: Record<string, unknown>;
}

// ── System definitions ──────────────────────────────────────────────

interface Field { key: string; label: string }
interface SectionDef { title: string; icon: string; fields: Field[]; system: string }

const AVAILABLE_SYSTEMS = [
  { id: "truck_engine", label: "Truck Engine", icon: "\uD83D\uDE9B", desc: "J1939 CAN bus diagnostics", color: "blue" },
  { id: "tps_buggy", label: "TPS Buggy", icon: "\uD83D\uDEE4\uFE0F", desc: "PLC production monitoring", color: "amber" },
  { id: "robot_cell", label: "Robot Cell", icon: "\uD83E\uDD16", desc: "Staubli + Apera vision", color: "violet" },
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

const SYSTEM_BTN_ACTIVE: Record<string, string> = {
  truck_engine: "bg-blue-900/30 border-blue-600/50 text-blue-300",
  tps_buggy: "bg-amber-900/30 border-amber-600/50 text-amber-300",
  robot_cell: "bg-violet-900/30 border-violet-600/50 text-violet-300",
};

// ── Section definitions (grouped by system) ─────────────────────────

const SECTIONS: SectionDef[] = [
  // ── Truck Engine (no prefix — backward compatible) ──────────────
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

// ── Helpers ──────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", second: "2-digit",
  });
}

// ── Snapshot Detail View ─────────────────────────────────────────────

function SnapshotDetail({ snapshot, onBack }: { snapshot: SnapshotFull; onBack: () => void }) {
  const [showShare, setShowShare] = useState(false);
  const data = { ...snapshot.reading_data };

  if ((!data.vin || data.vin === "UNKNOWN") && data.vehicle_vin && data.vehicle_vin !== "UNKNOWN") {
    data.vin = data.vehicle_vin;
  }

  const visibleFields = data._visible_fields as string[] | undefined;
  const fieldCount = Object.keys(data).filter(k => !k.startsWith("_") || k === "_bus_connected" || k === "_frame_count").length;

  const capturedSystems: string[] =
    (data._captured_systems as string[]) || (data._systems as string[]) || ["truck_engine"];

  // Group sections by system, only include systems with data
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
      s.fields.some(f => data[f.key] !== undefined && data[f.key] !== null)
    ));

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-6 no-print">
        <button onClick={onBack} className="text-sm text-gray-400 hover:text-white transition-colors">
          &larr; Back to list
        </button>
        <div className="flex gap-2">
          <button onClick={() => setShowShare(true)} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-semibold transition-colors">
            Share
          </button>
          <button onClick={() => window.print()} className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm font-semibold transition-colors">
            Print / PDF
          </button>
        </div>
      </div>
      <ShareModal
        open={showShare}
        onClose={() => setShowShare(false)}
        entityType="snapshot"
        entityId={snapshot.id}
        title={`${snapshot.truck_name || `Truck ${snapshot.truck_id}`} — ${fmtDate(snapshot.captured_at)}`}
      />

      {/* Title banner */}
      <div className="bg-gradient-to-r from-blue-900/40 to-purple-900/40 border border-blue-800/50 rounded-xl p-6 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-white">{snapshot.truck_name || `Truck ${snapshot.truck_id}`}</h1>
            <p className="text-blue-300 text-sm mt-1">
              Digital Twin Snapshot &mdash; {fmtDate(snapshot.captured_at)}
            </p>
            {snapshot.label && <p className="text-yellow-300 font-semibold text-sm mt-1">{snapshot.label}</p>}
            {snapshot.notes && <p className="text-gray-400 text-sm mt-1">{snapshot.notes}</p>}
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
            <p>{fieldCount} data points captured</p>
            <p>Source: {snapshot.source === "historical" ? "Historical" : "Live"}</p>
            <p>By: {snapshot.created_by_name}</p>
            {snapshot.vin && <p className="font-mono text-gray-300">{snapshot.vin}</p>}
          </div>
        </div>

        {/* Key metrics — Truck Engine */}
        {capturedSystems.includes("truck_engine") && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-4 border-t border-blue-800/40">
            <KeyMetric label="Engine RPM" value={snapshot.engine_rpm != null ? `${Math.round(snapshot.engine_rpm)}` : "--"} />
            <KeyMetric label="Speed" value={snapshot.vehicle_speed_mph != null ? `${Math.round(snapshot.vehicle_speed_mph)} mph` : "--"} />
            <KeyMetric label="Coolant" value={snapshot.coolant_temp_f != null ? `${Math.round(snapshot.coolant_temp_f)}\u00B0F` : "--"} />
            <KeyMetric label="Battery" value={snapshot.battery_voltage_v != null ? `${snapshot.battery_voltage_v.toFixed(1)}V` : "--"} />
          </div>
        )}

        {/* Key metrics — TPS Buggy */}
        {capturedSystems.includes("tps_buggy") && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-4 border-t border-amber-800/40">
            <KeyMetric label="Plate Count" value={data.plc_plate_drop_count != null ? String(data.plc_plate_drop_count) : "--"} />
            <KeyMetric label="Track Speed" value={data.plc_encoder_speed_ftpm != null ? `${Number(data.plc_encoder_speed_ftpm).toFixed(0)} ft/min` : "--"} />
            <KeyMetric label="Camera Det/min" value={data.plc_camera_detections_per_min != null ? `${Number(data.plc_camera_detections_per_min).toFixed(1)}` : "--"} />
            <KeyMetric label="Operating Mode" value={data.plc_operating_mode != null ? String(data.plc_operating_mode) : "--"} />
          </div>
        )}

        {/* Key metrics — Robot Cell */}
        {capturedSystems.includes("robot_cell") && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-4 border-t border-violet-800/40">
            <KeyMetric label="Arm Cycles" value={data.cell_staubli_arm_cycles != null ? String(data.cell_staubli_arm_cycles) : "--"} />
            <KeyMetric label="Task Status" value={data.cell_staubli_task_status != null ? String(data.cell_staubli_task_status) : "--"} />
            <KeyMetric label="Detections" value={data.cell_apera_total_detections != null ? String(data.cell_apera_total_detections) : "--"} />
            <KeyMetric label="Confidence" value={data.cell_apera_detection_confidence_avg != null ? `${Number(data.cell_apera_detection_confidence_avg).toFixed(0)}%` : "--"} />
          </div>
        )}
      </div>

      {/* Location map — show if GPS data present */}
      {typeof data.gps_latitude === "number" && typeof data.gps_longitude === "number" &&
       data.gps_latitude !== 0 && data.gps_longitude !== 0 && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-lg">&#x1F4CD;</span>
            <h2 className="text-sm font-bold uppercase tracking-wider text-blue-400">Location at Capture</h2>
            <div className="flex-1 h-px bg-gray-800" />
          </div>
          <SnapshotMap
            latitude={data.gps_latitude as number}
            longitude={data.gps_longitude as number}
            heading={data.compass_bearing_deg as number | null}
            speed={data.nav_speed_mph as number | null}
            altitude={data.altitude_ft as number | null}
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
                data[f.key] !== undefined && data[f.key] !== null &&
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
                          {formatValue(f.key, data[f.key])}
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

      {/* Raw data for DTCs */}
      {Object.keys(data).some(k => k.startsWith("dtc_0_")) && (
        <div className="mt-4 bg-gray-900/50 rounded-xl p-4 border border-gray-800/50">
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">
            {"\u26A0\uFE0F"} Active DTC Details
          </h3>
          <div className="space-y-1">
            {Array.from({ length: 20 }).map((_, i) => {
              const spn = data[`dtc_${i}_spn`];
              const fmi = data[`dtc_${i}_fmi`];
              if (spn === undefined) return null;
              return (
                <div key={i} className="flex items-center gap-3 text-sm">
                  <span className="font-mono text-red-400">SPN {String(spn)} / FMI {String(fmi)}</span>
                  {data[`dtc_${i}_occurrence`] !== undefined && (
                    <span className="text-gray-500 text-xs">({String(data[`dtc_${i}_occurrence`])} occurrences)</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="text-center text-xs text-gray-600 mt-6 pt-4 border-t border-gray-800">
        IronSight Digital Twin Snapshot &mdash; Captured {fmtDate(snapshot.captured_at)} &mdash; {fieldCount} data points
      </div>
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

// ── Capture Form ─────────────────────────────────────────────────────

function CaptureForm({ onCapture, onCancel }: {
  onCapture: (snapshot: SnapshotFull) => void;
  onCancel: () => void;
}) {
  const [truckId, setTruckId] = useState("01");
  const [mode, setMode] = useState<"live" | "historical">("historical");
  const [date, setDate] = useState("2026-04-08");
  const [time, setTime] = useState("15:30");
  const [label, setLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [selectedSystems, setSelectedSystems] = useState<string[]>([]);
  const [excludedFields, setExcludedFields] = useState<Set<string>>(new Set());
  const [metricSearch, setMetricSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleSystem = (sysId: string) => {
    setSelectedSystems(prev =>
      prev.includes(sysId)
        ? prev.filter(s => s !== sysId)
        : [...prev, sysId]
    );
  };

  // Available sections for selected systems
  const availableSections = SECTIONS.filter(s => selectedSystems.includes(s.system));
  const allFieldKeys = availableSections.flatMap(s => s.fields.map(f => f.key));
  const includedCount = allFieldKeys.length - excludedFields.size;

  // Search-filtered sections
  const query = metricSearch.toLowerCase();
  const filteredSections = query
    ? availableSections.map(s => ({
        ...s,
        fields: s.fields.filter(f =>
          f.label.toLowerCase().includes(query) || f.key.toLowerCase().includes(query)
        ),
      })).filter(s => s.fields.length > 0)
    : availableSections;

  async function handleCapture() {
    if (selectedSystems.length === 0) {
      setError("Select at least one system");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const visibleFields = allFieldKeys.filter(k => !excludedFields.has(k));
      const body: Record<string, unknown> = {
        truck_id: truckId,
        systems: selectedSystems,
        visible_fields: excludedFields.size > 0 ? visibleFields : undefined,
      };
      if (mode === "historical") {
        body.timestamp = new Date(`${date}T${time}:00`).toISOString();
      }
      if (label) body.label = label;
      if (notes) body.notes = notes;

      const res = await fetch("/api/snapshots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      const snapshot = await res.json();
      onCapture(snapshot);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to capture");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 max-w-5xl">
      <h2 className="text-lg font-bold text-white mb-4">Capture Snapshot</h2>

      <div className="space-y-4">
        <div>
          <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">Truck ID</label>
          <input type="text" value={truckId} onChange={e => setTruckId(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
        </div>

        {/* Systems + inline metric pickers */}
        <div>
          <label className="block text-xs text-gray-500 uppercase tracking-wider mb-2">Systems to Capture</label>
          {selectedSystems.length === 0 && (
            <p className="text-red-400 text-xs mb-2">Select at least one system</p>
          )}

          {/* Search bar — visible when any system is selected */}
          {selectedSystems.length > 0 && (
            <div className="mb-3">
              <input
                type="text"
                value={metricSearch}
                onChange={e => setMetricSearch(e.target.value)}
                placeholder="Search metrics across all systems..."
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-600"
              />
            </div>
          )}

          <div className="space-y-3">
            {AVAILABLE_SYSTEMS.map(sys => {
              const active = selectedSystems.includes(sys.id);
              const sysSections = active ? filteredSections.filter(s => s.system === sys.id) : [];
              const sysFieldKeys = SECTIONS.filter(s => s.system === sys.id).flatMap(s => s.fields.map(f => f.key));
              const sysIncluded = sysFieldKeys.filter(k => !excludedFields.has(k)).length;

              return (
                <div key={sys.id} className={`rounded-xl border transition-all ${
                  active
                    ? `${SYSTEM_BTN_ACTIVE[sys.id]} border-opacity-100`
                    : "bg-gray-800/30 border-gray-700/50"
                }`}>
                  {/* System toggle header */}
                  <button
                    type="button"
                    onClick={() => toggleSystem(sys.id)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left"
                  >
                    <span className="text-xl">{sys.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-semibold ${active ? "text-white" : "text-gray-500"}`}>{sys.label}</p>
                      <p className={`text-[10px] ${active ? "opacity-60" : "text-gray-600"}`}>{sys.desc}</p>
                    </div>
                    {active && (
                      <span className="text-xs text-gray-400">{sysIncluded}/{sysFieldKeys.length} metrics</span>
                    )}
                    <div className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 ${
                      active ? "border-current bg-current/20" : "border-gray-600"
                    }`}>
                      {active && (
                        <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      )}
                    </div>
                  </button>

                  {/* Expanded metric picker for this system */}
                  {active && (
                    <div className="px-4 pb-4 pt-1 border-t border-gray-700/30">
                      <div className="flex gap-3 text-xs mb-2">
                        <button type="button" onClick={() => {
                          setExcludedFields(prev => { const next = new Set(prev); sysFieldKeys.forEach(k => next.delete(k)); return next; });
                        }} className="text-blue-400 hover:text-blue-300">Select All</button>
                        <button type="button" onClick={() => {
                          setExcludedFields(prev => { const next = new Set(prev); sysFieldKeys.forEach(k => next.add(k)); return next; });
                        }} className="text-gray-500 hover:text-gray-300">Select None</button>
                      </div>
                      <div className="space-y-2 max-h-[350px] overflow-y-auto">
                        {sysSections.map(section => {
                          const sectionKeys = section.fields.map(f => f.key);
                          const allIncluded = sectionKeys.every(k => !excludedFields.has(k));
                          const noneIncluded = sectionKeys.every(k => excludedFields.has(k));
                          return (
                            <div key={section.title}>
                              <label className="flex items-center gap-2 cursor-pointer mb-0.5">
                                <input
                                  type="checkbox"
                                  checked={allIncluded}
                                  ref={el => { if (el) el.indeterminate = !allIncluded && !noneIncluded; }}
                                  onChange={() => {
                                    setExcludedFields(prev => {
                                      const next = new Set(prev);
                                      if (allIncluded) sectionKeys.forEach(k => next.add(k));
                                      else sectionKeys.forEach(k => next.delete(k));
                                      return next;
                                    });
                                  }}
                                  className="rounded border-gray-600 text-blue-500"
                                />
                                <span className="text-xs font-semibold text-gray-300">{section.icon} {section.title}</span>
                              </label>
                              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-0.5 ml-5">
                                {section.fields.map(f => (
                                  <label key={f.key} className="flex items-center gap-1.5 text-[11px] text-gray-400 cursor-pointer py-0.5 hover:text-gray-200">
                                    <input
                                      type="checkbox"
                                      checked={!excludedFields.has(f.key)}
                                      onChange={() => {
                                        setExcludedFields(prev => {
                                          const next = new Set(prev);
                                          next.has(f.key) ? next.delete(f.key) : next.add(f.key);
                                          return next;
                                        });
                                      }}
                                      className="rounded border-gray-700 text-blue-500 w-3 h-3"
                                    />
                                    {f.label}
                                  </label>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                        {sysSections.length === 0 && query && (
                          <p className="text-xs text-gray-600 py-2">No metrics match &quot;{metricSearch}&quot;</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <label className="block text-xs text-gray-500 uppercase tracking-wider mb-2">Source</label>
          <div className="flex gap-2">
            <button onClick={() => setMode("live")}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${mode === "live" ? "bg-green-600 text-white" : "bg-gray-800 text-gray-400 hover:text-white"}`}>
              Live (Now)
            </button>
            <button onClick={() => setMode("historical")}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${mode === "historical" ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:text-white"}`}>
              Historical
            </button>
          </div>
        </div>

        {mode === "historical" && (
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">Date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">Time</label>
              <input type="time" value={time} onChange={e => setTime(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
            </div>
          </div>
        )}

        <div>
          <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">Label (optional)</label>
          <input type="text" value={label} onChange={e => setLabel(e.target.value)}
            placeholder="e.g. Test Run, Pre-Maintenance, Shift Start"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-600" />
        </div>

        <div>
          <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">Notes (optional)</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
            placeholder="Additional context..."
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-600 resize-none" />
        </div>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <div className="flex gap-3 pt-2">
          <button onClick={handleCapture} disabled={saving || selectedSystems.length === 0}
            className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-sm font-semibold transition-colors">
            {saving ? "Capturing..." : `Capture ${selectedSystems.length} System${selectedSystems.length !== 1 ? "s" : ""}`}
          </button>
          <button onClick={onCancel}
            className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm font-semibold transition-colors">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────

export default function SnapshotsPage() {
  const [snapshots, setSnapshots] = useState<SnapshotSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedFull, setSelectedFull] = useState<SnapshotFull | null>(null);
  const [showCapture, setShowCapture] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchList = useCallback(async () => {
    try {
      const res = await fetch("/api/snapshots");
      if (res.ok) setSnapshots(await res.json());
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchList(); }, [fetchList]);

  async function openSnapshot(id: string) {
    setSelectedId(id);
    setSelectedFull(null);
    try {
      const res = await fetch(`/api/snapshots/${id}`);
      if (res.ok) setSelectedFull(await res.json());
    } catch { /* ignore */ }
  }

  async function deleteSnapshot(id: string) {
    await fetch(`/api/snapshots/${id}`, { method: "DELETE" });
    setSnapshots(prev => prev.filter(s => s.id !== id));
    if (selectedId === id) { setSelectedId(null); setSelectedFull(null); }
  }

  // Detail view
  if (selectedFull) {
    return (
      <div className="min-h-screen bg-gray-950 text-white px-4 sm:px-6 py-6">
        <SnapshotDetail snapshot={selectedFull} onBack={() => { setSelectedId(null); setSelectedFull(null); }} />
      </div>
    );
  }

  // Loading detail
  if (selectedId) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
        <div className="text-gray-500">Loading snapshot...</div>
      </div>
    );
  }

  // List + capture view
  return (
    <div className="min-h-screen bg-gray-950 text-white px-4 sm:px-6 py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Digital Twin Snapshots</h1>
          <p className="text-sm text-gray-500 mt-1">Capture and review the complete state of any truck at any point in time</p>
        </div>
        <button onClick={() => setShowCapture(true)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-semibold transition-colors">
          + Capture Snapshot
        </button>
      </div>

      {showCapture && (
        <div className="mb-6">
          <CaptureForm
            onCapture={(s) => { setSnapshots(prev => [s, ...prev]); setShowCapture(false); setSelectedFull(s); setSelectedId(s.id); }}
            onCancel={() => setShowCapture(false)}
          />
        </div>
      )}

      {loading ? (
        <div className="text-gray-500 text-center py-20">Loading...</div>
      ) : snapshots.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-gray-500 text-lg">No snapshots yet</p>
          <p className="text-gray-600 text-sm mt-2">
            Capture your first snapshot to see the complete state of a truck at a specific moment
          </p>
        </div>
      ) : (
        <div className="grid gap-3">
          {snapshots.map(s => (
            <div key={s.id}
              className="bg-gray-900 border border-gray-800 rounded-xl p-4 hover:border-gray-700 transition-colors cursor-pointer"
              onClick={() => openSnapshot(s.id)}
            >
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-white">{s.truck_name || `Truck ${s.truck_id}`}</span>
                    {s.label && <span className="px-2 py-0.5 bg-yellow-900/40 text-yellow-300 text-xs font-semibold rounded-full">{s.label}</span>}
                    <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${s.source === "live" ? "bg-green-900/40 text-green-300" : "bg-blue-900/40 text-blue-300"}`}>
                      {s.source === "live" ? "Live" : "Historical"}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    {fmtDate(s.captured_at)} &mdash; by {s.created_by_name}
                  </p>
                  {/* System badges */}
                  {s.systems && s.systems.length > 0 && (
                    <div className="flex gap-1 mt-1.5">
                      {s.systems.map(sys => {
                        const info = AVAILABLE_SYSTEMS.find(a => a.id === sys);
                        return info ? (
                          <span key={sys} className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${SYSTEM_BADGE_CLASSES[sys] || "bg-gray-800 text-gray-500"}`}>
                            {info.icon} {info.label}
                          </span>
                        ) : null;
                      })}
                    </div>
                  )}
                  {s.notes && <p className="text-xs text-gray-600 mt-1">{s.notes}</p>}
                </div>
                <div className="flex items-center gap-4 text-xs text-gray-400">
                  {s.engine_rpm != null && <span>RPM: <b className="text-gray-200">{Math.round(s.engine_rpm)}</b></span>}
                  {s.vehicle_speed_mph != null && <span>Speed: <b className="text-gray-200">{Math.round(s.vehicle_speed_mph)} mph</b></span>}
                  {s.coolant_temp_f != null && <span>Coolant: <b className="text-gray-200">{Math.round(s.coolant_temp_f)}&deg;F</b></span>}
                  {s.battery_voltage_v != null && <span>Batt: <b className="text-gray-200">{s.battery_voltage_v.toFixed(1)}V</b></span>}
                  {(s.active_dtc_count ?? 0) > 0 && <span className="text-red-400">{s.active_dtc_count} DTCs</span>}
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteSnapshot(s.id); }}
                    className="text-gray-600 hover:text-red-400 transition-colors ml-2"
                    title="Delete snapshot"
                  >
                    &times;
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
