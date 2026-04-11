/**
 * demo-engine.ts — Timeline engine for the IronSight interactive demo.
 *
 * Produces scripted simulation data for each phase, matching the flat
 * CellState shape returned by /api/cell-readings in sim mode. The demo
 * page consumes this instead of polling the real API.
 */

// ---------------------------------------------------------------------------
// Phase & Event types
// ---------------------------------------------------------------------------

export type DemoPhase =
  | "intro"
  | "normal"
  | "temp_rising"
  | "warning"
  | "shutdown"
  | "response"
  | "recovery"
  | "resolved"
  | "shift_end"
  | "complete";

export interface DemoEvent {
  time: number;          // seconds from start (0 = waits for interactive tap)
  phase: DemoPhase;
  title: string;
  narration: string;
  chatMessage?: string;
  chatFrom?: string;
  interactive?: boolean;       // if true, pauses until viewer taps
  interactivePrompt?: string;  // CTA text shown during pause
  image?: string;              // path to photo in /public/demo/
  imageCaption?: string;       // caption shown below image
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

export const DEMO_TIMELINE: DemoEvent[] = [
  // HOOK: Problem statement in first 5 seconds (research: viewers decide relevance in 5s)
  {
    time: 0,
    phase: "intro",
    title: "The Robot Just Stopped",
    narration:
      "Your robot stopped. Production is down. Nobody knows why. What do you do?",
    interactive: true,
    interactivePrompt: "Tap to see what IronSight shows you",
    image: "/demo/comic-not-your-saturday.jpg",
  },

  // ACT 1: The calm before (short — establish the baseline fast)
  {
    time: 0,  // starts on tap
    phase: "normal",
    title: "30 Minutes Earlier",
    narration:
      "Everything was green. 14 plates per minute. Robot cycling. Vision at 91% confidence.",
    image: "/demo/robot-arm.jpg",
    imageCaption: "RAIV 3 — Staubli TX2-140 sorting tie plates",
  },

  // ACT 2: Escalation (fast beats — tension building)
  {
    time: 10,
    phase: "temp_rising",
    title: "Then This Happened",
    narration:
      "Cabinet temperature started climbing. IronSight caught it before anyone on the truck noticed.",
    image: "/demo/comic-before-after.jpg",
  },
  {
    time: 18,
    phase: "warning",
    title: "131\u00B0F and Rising",
    narration:
      "Without monitoring, nothing happens here. The robot just\u2026 stops. But you're watching.",
  },

  // ACT 3: The crisis (instant, punchy)
  {
    time: 26,
    phase: "shutdown",
    title: "Down",
    narration:
      "Robot locked. Bus down. Production halted. But the diagnosis is already on your screen.",
    chatMessage:
      "RAIV 3 down \u2014 URPS thermal shutdown. Cabinet overheating. Root cause: insufficient ventilation.",
    chatFrom: "IronSight",
    interactive: true,
    interactivePrompt: "Tap the diagnosis to see the root cause",
  },

  // ACT 4: The VALUE moment (interactive — viewer participates)
  {
    time: 0,  // starts on tap
    phase: "response",
    title: "The Old Way Takes an Hour",
    narration:
      "Before: phone call, 30-minute drive, open panels, guess. Now: one message.",
    chatMessage:
      "Jake \u2014 open the cabinet panels and point the shop fan at the drive module. It's thermal, not electrical.",
    chatFrom: "You",
    image: "/demo/comic-the-drive.jpg",
  },

  // ACT 5: Resolution (let it breathe)
  {
    time: 14,
    phase: "recovery",
    title: "Already Fixing It",
    narration:
      "You never left your desk. You never opened a panel. You never guessed.",
    chatMessage: "Fan running. Temp is dropping.",
    chatFrom: "Jake",
  },
  {
    time: 24,
    phase: "resolved",
    title: "12 Minutes. Done.",
    narration:
      "Green. Back online. Every reading, every timestamp, every message \u2014 logged automatically.",
    chatMessage: "Back up. 8 more plates sorted already.",
    chatFrom: "Jake",
    interactive: true,
    interactivePrompt: "Tap to see how the shift ends",
    image: "/demo/comic-shift-report.jpg",
  },

  // ACT 6: Payoff
  {
    time: 0,  // starts on tap
    phase: "shift_end",
    title: "5:00 PM",
    narration:
      "Jake logs 10 hours from his phone. You approve with one tap. Shift report generates itself. 312 plates, 92% uptime, 1 thermal event fully documented.",
  },

  // ACT 7: Close (mic drop)
  {
    time: 12,
    phase: "complete",
    title: "That's One Shift",
    narration:
      "Caught before it happened. Diagnosed instantly. Fixed in 12 minutes. Documented automatically.\n\nEvery truck. Every shift. Every day.",
  },
];

// ---------------------------------------------------------------------------
// Simulated sensor data per phase
// ---------------------------------------------------------------------------

/** Small random jitter for realism */
function jitter(range = 1): number {
  return (Math.random() - 0.5) * 2 * range;
}

/** Celsius to Fahrenheit display */
export function cToF(c: number): number {
  return Math.round(c * 9 / 5 + 32);
}

/**
 * Returns a flat data blob that mirrors the shape of the CellState returned
 * by /api/cell-readings sim mode. Each phase produces different values to
 * drive the dashboard display.
 */
export function getDemoSimData(phase: DemoPhase): Record<string, unknown> {
  // Base healthy readings — everything green
  const base: Record<string, unknown> = {
    // Staubli — connected, cycling, normal temps
    staubli_connected: true,
    staubli_last_poll_ms: 48 + Math.random() * 20,
    staubli_poll_count: Math.floor(Date.now() / 2000),
    staubli_j1_pos: 45.2 + jitter(),
    staubli_j2_pos: -30.5 + jitter(),
    staubli_j3_pos: 90.1 + jitter(),
    staubli_j4_pos: 0.3 + jitter(),
    staubli_j5_pos: -45.0 + jitter(),
    staubli_j6_pos: 180.0 + jitter(),
    staubli_tcp_x: 1250.3 + jitter(5),
    staubli_tcp_y: -340.2 + jitter(5),
    staubli_tcp_z: 890.1 + jitter(5),
    staubli_temp_j1: 42 + jitter(2),
    staubli_temp_j2: 45 + jitter(2),
    staubli_temp_j3: 48 + jitter(2),
    staubli_temp_j4: 38 + jitter(2),
    staubli_temp_j5: 41 + jitter(2),
    staubli_temp_j6: 44 + jitter(2),
    staubli_temp_dsi: 39 + jitter(2),
    staubli_temp_cpu: 55 + jitter(2),
    staubli_temp_cpu_board: 38 + jitter(1),
    staubli_ioboard_connected: true,
    staubli_ioboard_bus_state: "OP",
    staubli_ioboard_slave_count: 3,
    staubli_ioboard_op_state: true,
    staubli_task_selected: "Cycle",
    staubli_task_status: "Cycle",
    staubli_parts_found: Math.floor(Math.random() * 8) + 1,
    staubli_part_picked: "14in_plate",
    staubli_part_desired: "14in_plate",
    staubli_arm_cycles: 16609,
    staubli_power_on_hours: 6.65,
    staubli_urps_errors_24h: 0,
    staubli_ethercat_errors_24h: 0,
    staubli_last_error_code: "",
    staubli_last_error_time: "",
    staubli_stop1_active: false,
    staubli_stop2_active: false,
    staubli_door_open: false,
    staubli_conveyor_fwd: true,
    staubli_feed_conveyor: true,
    staubli_trajectory_found: true,
    staubli_at_home: false,
    staubli_at_start: true,

    // Staubli Logs — clean
    staubli_log_log_connected: true,
    staubli_log_urps_events_24h: 0,
    staubli_log_urps_last_time: "",
    staubli_log_urps_last_code: "",
    staubli_log_ethercat_events_24h: 0,
    staubli_log_ethercat_frame_loss_24h: 0,
    staubli_log_safety_stops_24h: 0,
    staubli_log_safety_last_cause: "",
    staubli_log_servo_disable_count_24h: 0,
    staubli_log_servo_enable_count_24h: 1,
    staubli_log_app_restarts_24h: 0,
    staubli_log_arm_total_cycles: 17157,
    staubli_log_arm_power_on_hours: 6.65,
    staubli_log_controller_cpu_load_pct: 42.3,

    // Apera — connected, detecting
    apera_connected: true,
    apera_socket_latency_ms: 12 + Math.random() * 8,
    apera_last_poll_ms: 35 + Math.random() * 15,
    apera_pipeline_name: "RAIV_pick_belt_1",
    apera_pipeline_state: "idle",
    apera_last_cycle_ms: 320 + Math.floor(Math.random() * 80),
    apera_total_detections: 7,
    apera_detection_confidence_avg: 0.91 + Math.random() * 0.05,
    apera_pick_pose_available: true,
    apera_trajectory_available: true,
    apera_calibration_status: "ok",
    apera_system_status: "alive",
    apera_app_manager_ok: true,

    // Network — all reachable
    net_staubli_cs9_ip: "192.168.0.254",
    net_staubli_cs9_reachable: true,
    net_staubli_cs9_latency_ms: 2,
    net_apera_vue_pc_ip: "192.168.3.151",
    net_apera_vue_pc_reachable: true,
    net_apera_vue_pc_latency_ms: 3,

    // Internet
    inet_reachable: true,
    inet_latency_ms: 55 + Math.random() * 40,
    inet_dns_ok: true,
    inet_viam_reachable: true,

    // Pi health
    pi_cpu_temp_c: 42 + jitter(3),
    pi_load_1m: 0.3 + Math.random() * 0.2,
    pi_mem_used_pct: 14 + Math.random() * 4,
    pi_disk_used_pct: 9 + Math.random() * 2,
    pi_uptime_hours: 48.5,
    pi_undervoltage_now: false,
    pi_throttled_now: false,
  };

  switch (phase) {
    case "intro":
    case "normal":
      // Everything healthy — base is fine as-is
      return base;

    case "temp_rising":
      return {
        ...base,
        staubli_temp_dsi: 48 + jitter(2),      // ~118F, climbing
        staubli_temp_cpu: 60 + jitter(2),       // CPU warming too
        staubli_temp_j3: 52 + jitter(2),        // Hottest motor warming
        staubli_log_controller_cpu_load_pct: 55 + jitter(3),
      };

    case "warning":
      return {
        ...base,
        staubli_temp_dsi: 55 + jitter(1),       // ~131F — DSI warn threshold
        staubli_temp_cpu: 65 + jitter(2),
        staubli_temp_j3: 58 + jitter(2),
        staubli_urps_errors_24h: 1,
        staubli_log_urps_events_24h: 1,
        staubli_log_urps_last_time: new Date().toISOString(),
        staubli_log_urps_last_code: "0x168D",
        staubli_log_controller_cpu_load_pct: 62 + jitter(3),
      };

    case "shutdown":
      return {
        ...base,
        staubli_connected: false,                // Robot stopped
        staubli_temp_dsi: 61 + jitter(1),        // ~142F — above crit
        staubli_temp_cpu: 72 + jitter(2),
        staubli_temp_j3: 62 + jitter(2),
        staubli_urps_errors_24h: 2,
        staubli_ethercat_errors_24h: 3,
        staubli_ioboard_slave_count: 0,          // EtherCAT bus down
        staubli_ioboard_bus_state: "INIT",
        staubli_ioboard_op_state: false,
        staubli_task_status: "Stopped",
        staubli_conveyor_fwd: false,
        staubli_feed_conveyor: false,
        staubli_trajectory_found: false,
        staubli_last_error_code: "URPS_THERMAL",
        staubli_last_error_time: new Date().toISOString(),
        staubli_log_urps_events_24h: 2,
        staubli_log_urps_last_time: new Date().toISOString(),
        staubli_log_urps_last_code: "0x168D",
        staubli_log_ethercat_events_24h: 3,
        staubli_log_ethercat_frame_loss_24h: 12,
        staubli_log_servo_disable_count_24h: 1,
        staubli_log_controller_cpu_load_pct: 78 + jitter(3),
        // Apera still connected but no trajectory
        apera_pick_pose_available: false,
        apera_trajectory_available: false,
        apera_pipeline_state: "error",
      };

    case "response":
      return {
        ...base,
        staubli_connected: false,                // Still down
        staubli_temp_dsi: 58 + jitter(1),        // Starting to drop
        staubli_temp_cpu: 68 + jitter(2),
        staubli_urps_errors_24h: 2,
        staubli_ethercat_errors_24h: 3,
        staubli_ioboard_slave_count: 0,
        staubli_ioboard_bus_state: "INIT",
        staubli_ioboard_op_state: false,
        staubli_task_status: "Stopped",
        staubli_conveyor_fwd: false,
        staubli_feed_conveyor: false,
        staubli_last_error_code: "URPS_THERMAL",
        staubli_last_error_time: new Date().toISOString(),
        staubli_log_urps_events_24h: 2,
        staubli_log_ethercat_events_24h: 3,
        staubli_log_servo_disable_count_24h: 1,
        staubli_log_controller_cpu_load_pct: 70 + jitter(3),
        apera_pick_pose_available: false,
        apera_trajectory_available: false,
        apera_pipeline_state: "error",
      };

    case "recovery":
      return {
        ...base,
        staubli_connected: true,                 // Reconnecting
        staubli_temp_dsi: 48 + jitter(2),        // Dropping fast
        staubli_temp_cpu: 58 + jitter(2),
        staubli_urps_errors_24h: 2,              // History preserved
        staubli_ethercat_errors_24h: 3,
        staubli_ioboard_slave_count: 2,          // Coming back — 2 of 3
        staubli_ioboard_bus_state: "PREOP",
        staubli_ioboard_op_state: false,
        staubli_task_status: "Idle",
        staubli_conveyor_fwd: false,
        staubli_last_error_code: "URPS_THERMAL",
        staubli_log_urps_events_24h: 2,
        staubli_log_ethercat_events_24h: 3,
        staubli_log_servo_disable_count_24h: 1,
        staubli_log_servo_enable_count_24h: 2,
        staubli_log_controller_cpu_load_pct: 50 + jitter(3),
        apera_pipeline_state: "idle",
      };

    case "resolved":
      return {
        ...base,
        // Everything healthy again but history preserved
        staubli_temp_dsi: 42 + jitter(2),
        staubli_urps_errors_24h: 2,
        staubli_ethercat_errors_24h: 3,
        staubli_last_error_code: "URPS_THERMAL",
        staubli_log_urps_events_24h: 2,
        staubli_log_urps_last_time: new Date(Date.now() - 720000).toISOString(),
        staubli_log_urps_last_code: "0x168D",
        staubli_log_ethercat_events_24h: 3,
        staubli_log_servo_disable_count_24h: 1,
        staubli_log_servo_enable_count_24h: 2,
      };

    case "shift_end":
      return {
        ...base,
        staubli_arm_cycles: 16921,               // 312 more plates
        staubli_power_on_hours: 16.65,           // Full shift
        staubli_urps_errors_24h: 2,
        staubli_ethercat_errors_24h: 3,
        staubli_log_urps_events_24h: 2,
        staubli_log_ethercat_events_24h: 3,
        staubli_log_arm_total_cycles: 17469,
        staubli_log_arm_power_on_hours: 16.65,
      };

    case "complete":
      return base;

    default:
      return base;
  }
}

// ---------------------------------------------------------------------------
// Derived status helpers for the demo UI
// ---------------------------------------------------------------------------

export type OverallStatus = "green" | "orange" | "red";

export function getOverallStatus(phase: DemoPhase): OverallStatus {
  switch (phase) {
    case "intro":
    case "normal":
    case "resolved":
    case "shift_end":
    case "complete":
      return "green";
    case "temp_rising":
    case "warning":
    case "recovery":
      return "orange";
    case "shutdown":
    case "response":
      return "red";
    default:
      return "green";
  }
}

export interface ActiveIssue {
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
}

export function getActiveIssues(phase: DemoPhase): ActiveIssue[] {
  switch (phase) {
    case "temp_rising":
      return [
        {
          severity: "warning",
          title: "DSI Drive Module Warm",
          detail: "Drive module at 118\u00B0F \u2014 trending toward thermal protection threshold. Check cabinet fans.",
        },
      ];
    case "warning":
      return [
        {
          severity: "warning",
          title: "URPS Thermal Warning",
          detail: "DSI drive module at 131\u00B0F \u2014 approaching shutdown threshold. URPS power supply event logged.",
        },
      ];
    case "shutdown":
      return [
        {
          severity: "critical",
          title: "URPS Thermal Shutdown",
          detail: "Robot arm stopped. EtherCAT bus down. Cabinet temperature exceeded safe limit.",
        },
        {
          severity: "critical",
          title: "EtherCAT Bus Failure",
          detail: "0 of 3 slaves connected. I/O board in INIT state.",
        },
      ];
    case "response":
      return [
        {
          severity: "critical",
          title: "URPS Thermal Shutdown",
          detail: "Robot arm stopped. Team responding \u2014 cabinet panels opened, fan directed at enclosure.",
        },
        {
          severity: "critical",
          title: "EtherCAT Bus Offline",
          detail: "0 of 3 slaves connected. Awaiting thermal recovery.",
        },
      ];
    case "recovery":
      return [
        {
          severity: "warning",
          title: "Thermal Recovery In Progress",
          detail: "Cabinet temp dropping. 2 of 3 EtherCAT slaves reconnected. Bus in PREOP state.",
        },
      ];
    default:
      return [];
  }
}

export interface SubsystemStatus {
  name: string;
  status: "online" | "warning" | "offline" | "recovering";
}

export function getSubsystems(phase: DemoPhase): SubsystemStatus[] {
  const base: SubsystemStatus[] = [
    { name: "Robot Arm", status: "online" },
    { name: "Vision", status: "online" },
    { name: "EtherCAT", status: "online" },
    { name: "Conveyor", status: "online" },
    { name: "Network", status: "online" },
  ];

  switch (phase) {
    case "temp_rising":
      return base.map((s) =>
        s.name === "Robot Arm" ? { ...s, status: "warning" as const } : s
      );
    case "warning":
      return base.map((s) => {
        if (s.name === "Robot Arm") return { ...s, status: "warning" as const };
        if (s.name === "EtherCAT") return { ...s, status: "warning" as const };
        return s;
      });
    case "shutdown":
    case "response":
      return [
        { name: "Robot Arm", status: "offline" },
        { name: "Vision", status: "warning" },
        { name: "EtherCAT", status: "offline" },
        { name: "Conveyor", status: "offline" },
        { name: "Network", status: "online" },
      ];
    case "recovery":
      return [
        { name: "Robot Arm", status: "recovering" },
        { name: "Vision", status: "online" },
        { name: "EtherCAT", status: "recovering" },
        { name: "Conveyor", status: "offline" },
        { name: "Network", status: "online" },
      ];
    default:
      return base;
  }
}

export interface DiagnosisStep {
  label: string;
  detail: string;
  status: "detected" | "confirmed" | "root_cause";
}

export function getDiagnosis(phase: DemoPhase): DiagnosisStep[] | null {
  if (phase !== "shutdown" && phase !== "response") return null;

  return [
    {
      label: "Cabinet Overheating",
      detail: "DSI drive module at 143\u00B0F \u2014 exceeded 140\u00B0F thermal protection threshold",
      status: "detected",
    },
    {
      label: "EtherCAT Bus Degraded",
      detail: "Frame loss detected before shutdown. 0 of 3 slaves responding.",
      status: "confirmed",
    },
    {
      label: "URPS Power Cut",
      detail: "Uninterruptible Robot Power Supply triggered emergency stop to protect servo drives.",
      status: "confirmed",
    },
    {
      label: "Insufficient Ventilation",
      detail: "Cabinet intake temperature 15\u00B0F above ambient. Fan filter likely clogged or airflow blocked.",
      status: "root_cause",
    },
  ];
}

export interface ShiftSummary {
  uptime: string;
  thermalEvents: number;
  platesSorted: number;
  downtime: string;
  hoursWorked: number;
  jobCode: string;
}

export function getShiftSummary(phase: DemoPhase): ShiftSummary | null {
  if (phase !== "shift_end" && phase !== "complete") return null;
  return {
    uptime: "92%",
    thermalEvents: 1,
    platesSorted: 312,
    downtime: "12 min",
    hoursWorked: 10,
    jobCode: "NS Track Repair",
  };
}
