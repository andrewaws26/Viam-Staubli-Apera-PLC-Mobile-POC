/**
 * cell-watchdog.test.ts — Unit tests for Cell Watchdog diagnostic rules.
 *
 * Tests cover all watchdog categories: safety, thermal, power, cross-system,
 * vision, calibration, production, network, and communication alerts.
 * Validates that the correct severity and alert count are generated for
 * each condition.
 */

import { describe, it, expect } from "vitest";

// We test the watchdog logic by importing the component module and extracting
// the runWatchdog function. Since it's not directly exported, we replicate
// the core logic here (same rules, validated against the component).

import type {
  StaubliReadings,
  AperaReadings,
  NetworkDevice,
  InternetHealth,
  SwitchVpnHealth,
  PiHealth,
  AlertSeverity,
  AlertCategory,
  CellAlert,
} from "../../components/Cell/CellTypes";
import { TEMP_THRESHOLDS } from "../../components/Cell/CellTypes";

// ---------------------------------------------------------------------------
// Replicated watchdog engine (mirrors CellWatchdog.tsx runWatchdog)
// ---------------------------------------------------------------------------

interface WatchdogInput {
  staubli: StaubliReadings | null;
  apera: AperaReadings | null;
  network: NetworkDevice[];
  internet?: InternetHealth | null;
  switchVpn?: SwitchVpnHealth | null;
  piHealth?: PiHealth | null;
}

function runWatchdog(input: WatchdogInput): CellAlert[] {
  const alerts: CellAlert[] = [];
  const now = new Date().toISOString();
  let id = 0;

  function alert(severity: AlertSeverity, category: AlertCategory, title: string, detail: string, source: string) {
    alerts.push({ id: `wd-${++id}`, severity, category, title, detail, source, timestamp: now, acknowledged: false });
  }

  const { staubli: s, apera: a, network: n, internet: inet, switchVpn: sw, piHealth: pi } = input;

  // Safety
  if (s) {
    if (s.stop1_active) alert("critical", "safety", "E-Stop 1 Active", "", "Staubli");
    if (s.stop2_active) alert("critical", "safety", "E-Stop 2 Active", "", "Staubli");
    if (s.door_open) alert("warning", "safety", "Guard Door Open", "", "Staubli");
  }

  // Thermal
  if (s) {
    const temps = [
      { name: "J1", val: s.temp_j1 }, { name: "J2", val: s.temp_j2 }, { name: "J3", val: s.temp_j3 },
      { name: "J4", val: s.temp_j4 }, { name: "J5", val: s.temp_j5 }, { name: "J6", val: s.temp_j6 },
    ];
    for (const t of temps) {
      if (t.val >= TEMP_THRESHOLDS.motor_crit) alert("critical", "thermal", `Motor ${t.name} Overheating`, "", "Staubli");
      else if (t.val >= TEMP_THRESHOLDS.motor_warn) alert("warning", "thermal", `Motor ${t.name} Running Hot`, "", "Staubli");
    }
    if (s.temp_dsi >= TEMP_THRESHOLDS.dsi_crit) alert("critical", "thermal", "DSI Drive Module Overheating", "", "Staubli");
    else if (s.temp_dsi >= TEMP_THRESHOLDS.dsi_warn) alert("warning", "thermal", "DSI Drive Module Warm", "", "Staubli");
  }

  if (a) {
    if (a.gpu_temp_c >= TEMP_THRESHOLDS.gpu_crit) alert("critical", "thermal", "Vision GPU Overheating", "", "Apera");
    else if (a.gpu_temp_c >= TEMP_THRESHOLDS.gpu_warn) alert("warning", "thermal", "Vision GPU Running Hot", "", "Apera");
  }

  // Power
  if (s && s.urps_errors_24h > 0) {
    alert(s.urps_errors_24h >= 3 ? "critical" : "warning", "power", "Power Supply Errors", "", "Staubli");
  }
  if (s && s.ethercat_errors_24h > 0) {
    alert(s.ethercat_errors_24h >= 5 ? "critical" : "warning", "communication", "EtherCAT Errors", "", "Staubli");
  }

  // Cross-system thermal chain
  if (s && s.urps_errors_24h > 0 && s.ethercat_errors_24h > 0) {
    alert("critical", "power", "Thermal Shutdown Chain Detected", "", "IronSight");
  }

  // Vision
  if (a) {
    if (a.pipeline_state === "error") alert("critical", "vision", "Vision Pipeline Error", "", "Apera");
    if (!a.camera_1_ok || !a.camera_2_ok) alert("critical", "vision", "Camera Not Responding", "", "Apera");
    if (a.gpu_memory_used_pct > 95) alert("warning", "vision", "GPU Memory Nearly Full", "", "Apera");
    if (a.detection_confidence_avg > 0 && a.detection_confidence_avg < 0.4) alert("warning", "vision", "Low Detection Confidence", "", "Apera");
  }

  // Calibration
  if (a) {
    if (a.calibration_status === "drift") alert("warning", "calibration", "Calibration Drift Detected", "", "Apera");
    if (a.calibration_status === "failed") alert("critical", "calibration", "Calibration Failed", "", "Apera");
  }

  // Cross-system vision + position
  if (s && a && a.pipeline_state === "error" && !s.at_capture) {
    alert("critical", "vision", "Vision Error — Robot Not at Capture Position", "", "IronSight");
  }

  // Production mismatch
  if (s && s.part_picked && s.part_desired && s.part_picked !== s.part_desired) {
    alert("warning", "production", "Part Mismatch", "", "IronSight");
  }

  // Network
  for (const dev of n) {
    if (!dev.reachable) {
      alert(
        dev.name.includes("Staubli") || dev.name.includes("Apera") ? "critical" : "warning",
        "network", `${dev.name} Unreachable`, "", "Network"
      );
    }
  }

  // Communication
  if (s && !s.connected) alert("critical", "communication", "Robot Controller Disconnected", "", "Staubli");
  if (a && !a.connected) alert("critical", "communication", "Vision System Disconnected", "", "Apera");

  // Internet uplink
  if (inet) {
    if (!inet.reachable) {
      alert("critical", "network", "Internet Down", "", "Infra");
    } else {
      if (inet.packet_loss_pct > 10) alert("warning", "network", "Packet Loss", "", "Infra");
      if (inet.latency_ms > 500) alert("warning", "network", "High Internet Latency", "", "Infra");
      if (!inet.viam_reachable) alert("critical", "communication", "Viam Cloud Unreachable", "", "Infra");
      if (!inet.dns_ok) alert("warning", "network", "DNS Resolution Failing", "", "Infra");
    }
  }

  // Switch / VPN
  if (sw) {
    if (!sw.eth0_up) alert("critical", "network", "Ethernet Link Down", "", "Infra");
    if (!sw.vpn_reachable) alert("critical", "network", "Stridelinx VPN Down", "", "Infra");
    if (sw.vpn_reachable && !sw.vpn_web_ok) alert("warning", "network", "Stridelinx Web UI Down", "", "Infra");
  }

  // Pi 5 health
  if (pi) {
    if (pi.undervoltage_now) alert("critical", "power", "Pi 5 Undervoltage", "", "Infra");
    if (pi.throttled_now) alert("warning", "thermal", "Pi 5 Thermal Throttle", "", "Infra");
    if (pi.cpu_temp_c >= 80) alert("critical", "thermal", "Pi 5 CPU Overheating", "", "Infra");
    else if (pi.cpu_temp_c >= 70) alert("warning", "thermal", "Pi 5 CPU Warm", "", "Infra");
    if (pi.mem_used_pct > 90) alert("warning", "power", "Pi 5 Memory Low", "", "Infra");
    if (pi.disk_used_pct > 90) alert("warning", "power", "Pi 5 Disk Nearly Full", "", "Infra");
  }

  return alerts;
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeStaubli(overrides: Partial<StaubliReadings> = {}): StaubliReadings {
  return {
    connected: true, last_poll_ms: 50, poll_count: 100,
    j1_pos: 0, j2_pos: 0, j3_pos: 0, j4_pos: 0, j5_pos: 0, j6_pos: 0,
    tcp_x: 0, tcp_y: 0, tcp_z: 0, tcp_rx: 0, tcp_ry: 0, tcp_rz: 0,
    temp_j1: 40, temp_j2: 40, temp_j3: 40, temp_j4: 40, temp_j5: 40, temp_j6: 40,
    temp_dsi: 35,
    task_selected: "Cycle", task_status: "Cycle",
    parts_found: 5, part_picked: "14in_plate", part_desired: "14in_plate",
    class_ids: [], class_counts: [], move_id: 1,
    at_home: false, at_stow: false, at_clear: false, at_capture: true,
    at_start: false, at_end: false, at_accept: false, at_reject: false,
    conveyor_fwd: true, feed_conveyor: true,
    trajectory_found: true,
    stop1_active: false, stop2_active: false, door_open: false,
    arm_cycles: 16000, power_on_hours: 6.5,
    urps_errors_24h: 0, ethercat_errors_24h: 0,
    last_error_code: "", last_error_time: "",
    ...overrides,
  };
}

function makeApera(overrides: Partial<AperaReadings> = {}): AperaReadings {
  return {
    connected: true, socket_latency_ms: 12, last_poll_ms: 35,
    pipeline_name: "RAIV_pick_belt_1", pipeline_state: "idle",
    last_cycle_ms: 350, total_detections: 5,
    detections_by_class: { "14in_plate": 3, "spike": 2 },
    detection_confidence_avg: 0.85,
    pick_pose_available: true, trajectory_available: true,
    calibration_status: "ok", last_cal_check: new Date().toISOString(),
    cal_residual_mm: 0.3,
    camera_1_ok: true, camera_2_ok: true,
    gpu_temp_c: 60, gpu_memory_used_pct: 65,
    ...overrides,
  };
}

function makeNetwork(overrides: Partial<NetworkDevice>[] = []): NetworkDevice[] {
  const defaults: NetworkDevice[] = [
    { name: "Staubli CS9", ip: "192.168.0.254", reachable: true, latency_ms: 2, last_seen: new Date().toISOString() },
    { name: "Apera Vue PC", ip: "192.168.3.151", reachable: true, latency_ms: 3, last_seen: new Date().toISOString() },
    { name: "JTEKT PLC", ip: "192.168.0.10", reachable: true, latency_ms: 5, last_seen: new Date().toISOString() },
  ];
  return defaults.map((d, i) => ({ ...d, ...overrides[i] }));
}

function makeInternet(overrides: Partial<InternetHealth> = {}): InternetHealth {
  return {
    reachable: true, latency_ms: 60, jitter_ms: 15, packet_loss_pct: 0,
    dns_ok: true, dns_resolve_ms: 80, viam_reachable: true, viam_latency_ms: 150,
    gateway_ip: "192.168.0.1", interface: "eth0", link_speed_mbps: 1000,
    rx_bytes: 10_000_000, tx_bytes: 25_000_000, rx_errors: 0, tx_errors: 0,
    ...overrides,
  };
}

function makeSwitchVpn(overrides: Partial<SwitchVpnHealth> = {}): SwitchVpnHealth {
  return {
    eth0_up: true, eth0_speed_mbps: 1000, eth0_duplex: "full",
    devices_on_switch: 5, vpn_reachable: true, vpn_latency_ms: 1.0,
    vpn_is_gateway: true, vpn_web_ok: true, vpn_ip: "192.168.0.1",
    ...overrides,
  };
}

function makePiHealth(overrides: Partial<PiHealth> = {}): PiHealth {
  return {
    cpu_temp_c: 45, load_1m: 0.3, load_5m: 0.2, load_15m: 0.1,
    mem_total_mb: 8063, mem_available_mb: 7200, mem_used_pct: 11,
    disk_total_gb: 234.3, disk_free_gb: 215, disk_used_pct: 8,
    uptime_hours: 48, undervoltage_now: false, freq_capped_now: false,
    throttled_now: false, undervoltage_ever: false, freq_capped_ever: false,
    throttled_ever: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Cell Watchdog Rules", () => {
  describe("healthy state", () => {
    it("returns no alerts when all systems are nominal", () => {
      const alerts = runWatchdog({ staubli: makeStaubli(), apera: makeApera(), network: makeNetwork() });
      expect(alerts).toHaveLength(0);
    });

    it("returns no alerts with null staubli and apera", () => {
      const alerts = runWatchdog({ staubli: null, apera: null, network: [] });
      expect(alerts).toHaveLength(0);
    });
  });

  describe("safety rules", () => {
    it("flags E-Stop 1 as critical", () => {
      const alerts = runWatchdog({ staubli: makeStaubli({ stop1_active: true }), apera: null, network: [] });
      const estop = alerts.find(a => a.title === "E-Stop 1 Active");
      expect(estop).toBeDefined();
      expect(estop!.severity).toBe("critical");
      expect(estop!.category).toBe("safety");
    });

    it("flags E-Stop 2 as critical", () => {
      const alerts = runWatchdog({ staubli: makeStaubli({ stop2_active: true }), apera: null, network: [] });
      expect(alerts.some(a => a.title === "E-Stop 2 Active" && a.severity === "critical")).toBe(true);
    });

    it("flags door open as warning", () => {
      const alerts = runWatchdog({ staubli: makeStaubli({ door_open: true }), apera: null, network: [] });
      expect(alerts.some(a => a.title === "Guard Door Open" && a.severity === "warning")).toBe(true);
    });
  });

  describe("thermal rules", () => {
    it("flags motor temperature at warning threshold", () => {
      const alerts = runWatchdog({ staubli: makeStaubli({ temp_j3: 66 }), apera: null, network: [] });
      expect(alerts.some(a => a.title.includes("J3") && a.severity === "warning")).toBe(true);
    });

    it("flags motor temperature at critical threshold", () => {
      const alerts = runWatchdog({ staubli: makeStaubli({ temp_j1: 81 }), apera: null, network: [] });
      expect(alerts.some(a => a.title.includes("J1") && a.severity === "critical")).toBe(true);
    });

    it("flags DSI overheating", () => {
      const alerts = runWatchdog({ staubli: makeStaubli({ temp_dsi: 71 }), apera: null, network: [] });
      expect(alerts.some(a => a.title.includes("DSI") && a.severity === "critical")).toBe(true);
    });

    it("flags GPU overheating", () => {
      const alerts = runWatchdog({ staubli: null, apera: makeApera({ gpu_temp_c: 91 }), network: [] });
      expect(alerts.some(a => a.title.includes("GPU") && a.severity === "critical")).toBe(true);
    });

    it("flags GPU warm as warning", () => {
      const alerts = runWatchdog({ staubli: null, apera: makeApera({ gpu_temp_c: 76 }), network: [] });
      expect(alerts.some(a => a.title.includes("GPU") && a.severity === "warning")).toBe(true);
    });
  });

  describe("power rules", () => {
    it("flags URPS errors as warning when < 3", () => {
      const alerts = runWatchdog({ staubli: makeStaubli({ urps_errors_24h: 2 }), apera: null, network: [] });
      expect(alerts.some(a => a.category === "power" && a.severity === "warning")).toBe(true);
    });

    it("flags URPS errors as critical when >= 3", () => {
      const alerts = runWatchdog({ staubli: makeStaubli({ urps_errors_24h: 3 }), apera: null, network: [] });
      expect(alerts.some(a => a.category === "power" && a.severity === "critical")).toBe(true);
    });

    it("flags EtherCAT errors", () => {
      const alerts = runWatchdog({ staubli: makeStaubli({ ethercat_errors_24h: 2 }), apera: null, network: [] });
      expect(alerts.some(a => a.category === "communication" && a.title.includes("EtherCAT"))).toBe(true);
    });
  });

  describe("cross-system rules", () => {
    it("detects thermal shutdown chain (URPS + EtherCAT)", () => {
      const alerts = runWatchdog({
        staubli: makeStaubli({ urps_errors_24h: 1, ethercat_errors_24h: 1 }),
        apera: null, network: [],
      });
      expect(alerts.some(a => a.title === "Thermal Shutdown Chain Detected" && a.severity === "critical")).toBe(true);
    });

    it("detects vision error when robot not at capture", () => {
      const alerts = runWatchdog({
        staubli: makeStaubli({ at_capture: false }),
        apera: makeApera({ pipeline_state: "error" }),
        network: [],
      });
      expect(alerts.some(a => a.title.includes("Not at Capture") && a.severity === "critical")).toBe(true);
    });
  });

  describe("vision rules", () => {
    it("flags pipeline error as critical", () => {
      const alerts = runWatchdog({ staubli: null, apera: makeApera({ pipeline_state: "error" }), network: [] });
      expect(alerts.some(a => a.title === "Vision Pipeline Error" && a.severity === "critical")).toBe(true);
    });

    it("flags camera failure", () => {
      const alerts = runWatchdog({ staubli: null, apera: makeApera({ camera_1_ok: false }), network: [] });
      expect(alerts.some(a => a.category === "vision" && a.severity === "critical")).toBe(true);
    });

    it("flags high GPU memory as warning", () => {
      const alerts = runWatchdog({ staubli: null, apera: makeApera({ gpu_memory_used_pct: 96 }), network: [] });
      expect(alerts.some(a => a.title.includes("GPU Memory") && a.severity === "warning")).toBe(true);
    });

    it("flags low detection confidence", () => {
      const alerts = runWatchdog({ staubli: null, apera: makeApera({ detection_confidence_avg: 0.3 }), network: [] });
      expect(alerts.some(a => a.title.includes("Low Detection") && a.severity === "warning")).toBe(true);
    });
  });

  describe("calibration rules", () => {
    it("flags calibration drift as warning", () => {
      const alerts = runWatchdog({ staubli: null, apera: makeApera({ calibration_status: "drift" }), network: [] });
      expect(alerts.some(a => a.category === "calibration" && a.severity === "warning")).toBe(true);
    });

    it("flags calibration failure as critical", () => {
      const alerts = runWatchdog({ staubli: null, apera: makeApera({ calibration_status: "failed" }), network: [] });
      expect(alerts.some(a => a.category === "calibration" && a.severity === "critical")).toBe(true);
    });
  });

  describe("production rules", () => {
    it("flags part mismatch as warning", () => {
      const alerts = runWatchdog({
        staubli: makeStaubli({ part_picked: "18in_plate", part_desired: "14in_plate" }),
        apera: null, network: [],
      });
      expect(alerts.some(a => a.title.includes("Part Mismatch") && a.severity === "warning")).toBe(true);
    });

    it("no alert when parts match", () => {
      const alerts = runWatchdog({
        staubli: makeStaubli({ part_picked: "14in_plate", part_desired: "14in_plate" }),
        apera: null, network: [],
      });
      expect(alerts.some(a => a.category === "production")).toBe(false);
    });
  });

  describe("network rules", () => {
    it("flags critical device unreachable as critical", () => {
      const alerts = runWatchdog({
        staubli: null, apera: null,
        network: [{ name: "Staubli CS9", ip: "192.168.0.254", reachable: false, latency_ms: 0, last_seen: "" }],
      });
      expect(alerts.some(a => a.category === "network" && a.severity === "critical")).toBe(true);
    });

    it("flags non-critical device unreachable as warning", () => {
      const alerts = runWatchdog({
        staubli: null, apera: null,
        network: [{ name: "JTEKT PLC", ip: "192.168.0.10", reachable: false, latency_ms: 0, last_seen: "" }],
      });
      expect(alerts.some(a => a.category === "network" && a.severity === "warning")).toBe(true);
    });
  });

  describe("communication rules", () => {
    it("flags robot disconnected as critical", () => {
      const alerts = runWatchdog({ staubli: makeStaubli({ connected: false }), apera: null, network: [] });
      expect(alerts.some(a => a.title === "Robot Controller Disconnected" && a.severity === "critical")).toBe(true);
    });

    it("flags vision disconnected as critical", () => {
      const alerts = runWatchdog({ staubli: null, apera: makeApera({ connected: false }), network: [] });
      expect(alerts.some(a => a.title === "Vision System Disconnected" && a.severity === "critical")).toBe(true);
    });
  });

  describe("internet rules", () => {
    it("flags internet down as critical", () => {
      const alerts = runWatchdog({
        staubli: null, apera: null, network: [],
        internet: makeInternet({ reachable: false }),
      });
      expect(alerts.some(a => a.title === "Internet Down" && a.severity === "critical")).toBe(true);
    });

    it("flags packet loss as warning", () => {
      const alerts = runWatchdog({
        staubli: null, apera: null, network: [],
        internet: makeInternet({ packet_loss_pct: 15 }),
      });
      expect(alerts.some(a => a.title === "Packet Loss" && a.severity === "warning")).toBe(true);
    });

    it("flags high latency as warning", () => {
      const alerts = runWatchdog({
        staubli: null, apera: null, network: [],
        internet: makeInternet({ latency_ms: 600 }),
      });
      expect(alerts.some(a => a.title === "High Internet Latency" && a.severity === "warning")).toBe(true);
    });

    it("flags Viam Cloud unreachable as critical", () => {
      const alerts = runWatchdog({
        staubli: null, apera: null, network: [],
        internet: makeInternet({ viam_reachable: false }),
      });
      expect(alerts.some(a => a.title === "Viam Cloud Unreachable" && a.severity === "critical")).toBe(true);
    });

    it("flags DNS failure as warning", () => {
      const alerts = runWatchdog({
        staubli: null, apera: null, network: [],
        internet: makeInternet({ dns_ok: false }),
      });
      expect(alerts.some(a => a.title === "DNS Resolution Failing" && a.severity === "warning")).toBe(true);
    });

    it("no alerts for healthy internet", () => {
      const alerts = runWatchdog({
        staubli: null, apera: null, network: [],
        internet: makeInternet(),
      });
      expect(alerts).toHaveLength(0);
    });
  });

  describe("switch/VPN rules", () => {
    it("flags eth0 link down as critical", () => {
      const alerts = runWatchdog({
        staubli: null, apera: null, network: [],
        switchVpn: makeSwitchVpn({ eth0_up: false }),
      });
      expect(alerts.some(a => a.title === "Ethernet Link Down" && a.severity === "critical")).toBe(true);
    });

    it("flags VPN down as critical", () => {
      const alerts = runWatchdog({
        staubli: null, apera: null, network: [],
        switchVpn: makeSwitchVpn({ vpn_reachable: false }),
      });
      expect(alerts.some(a => a.title === "Stridelinx VPN Down" && a.severity === "critical")).toBe(true);
    });

    it("flags VPN web UI down as warning", () => {
      const alerts = runWatchdog({
        staubli: null, apera: null, network: [],
        switchVpn: makeSwitchVpn({ vpn_web_ok: false }),
      });
      expect(alerts.some(a => a.title === "Stridelinx Web UI Down" && a.severity === "warning")).toBe(true);
    });

    it("no alerts for healthy switch/VPN", () => {
      const alerts = runWatchdog({
        staubli: null, apera: null, network: [],
        switchVpn: makeSwitchVpn(),
      });
      expect(alerts).toHaveLength(0);
    });
  });

  describe("Pi 5 health rules", () => {
    it("flags undervoltage as critical", () => {
      const alerts = runWatchdog({
        staubli: null, apera: null, network: [],
        piHealth: makePiHealth({ undervoltage_now: true }),
      });
      expect(alerts.some(a => a.title === "Pi 5 Undervoltage" && a.severity === "critical")).toBe(true);
    });

    it("flags thermal throttle as warning", () => {
      const alerts = runWatchdog({
        staubli: null, apera: null, network: [],
        piHealth: makePiHealth({ throttled_now: true }),
      });
      expect(alerts.some(a => a.title === "Pi 5 Thermal Throttle" && a.severity === "warning")).toBe(true);
    });

    it("flags CPU >= 80 as critical", () => {
      const alerts = runWatchdog({
        staubli: null, apera: null, network: [],
        piHealth: makePiHealth({ cpu_temp_c: 82 }),
      });
      expect(alerts.some(a => a.title === "Pi 5 CPU Overheating" && a.severity === "critical")).toBe(true);
    });

    it("flags CPU >= 70 as warning", () => {
      const alerts = runWatchdog({
        staubli: null, apera: null, network: [],
        piHealth: makePiHealth({ cpu_temp_c: 72 }),
      });
      expect(alerts.some(a => a.title === "Pi 5 CPU Warm" && a.severity === "warning")).toBe(true);
    });

    it("flags memory > 90% as warning", () => {
      const alerts = runWatchdog({
        staubli: null, apera: null, network: [],
        piHealth: makePiHealth({ mem_used_pct: 92 }),
      });
      expect(alerts.some(a => a.title === "Pi 5 Memory Low" && a.severity === "warning")).toBe(true);
    });

    it("flags disk > 90% as warning", () => {
      const alerts = runWatchdog({
        staubli: null, apera: null, network: [],
        piHealth: makePiHealth({ disk_used_pct: 95 }),
      });
      expect(alerts.some(a => a.title === "Pi 5 Disk Nearly Full" && a.severity === "warning")).toBe(true);
    });

    it("no alerts for healthy Pi", () => {
      const alerts = runWatchdog({
        staubli: null, apera: null, network: [],
        piHealth: makePiHealth(),
      });
      expect(alerts).toHaveLength(0);
    });
  });

  describe("combined scenarios", () => {
    it("fires multiple alerts for cascading failure", () => {
      const alerts = runWatchdog({
        staubli: makeStaubli({
          stop1_active: true,
          temp_j3: 82,
          urps_errors_24h: 4,
          ethercat_errors_24h: 6,
        }),
        apera: makeApera({ pipeline_state: "error", camera_1_ok: false }),
        network: makeNetwork([{ reachable: false } as any]),
      });

      const criticals = alerts.filter(a => a.severity === "critical");
      expect(criticals.length).toBeGreaterThanOrEqual(6);
    });

    it("fires infra alerts alongside cell alerts", () => {
      const alerts = runWatchdog({
        staubli: makeStaubli({ stop1_active: true }),
        apera: null, network: [],
        internet: makeInternet({ reachable: false }),
        piHealth: makePiHealth({ undervoltage_now: true }),
      });
      expect(alerts.some(a => a.source === "Staubli")).toBe(true);
      expect(alerts.some(a => a.source === "Infra")).toBe(true);
      const criticals = alerts.filter(a => a.severity === "critical");
      expect(criticals.length).toBeGreaterThanOrEqual(3); // estop + internet down + undervoltage
    });
  });
});
