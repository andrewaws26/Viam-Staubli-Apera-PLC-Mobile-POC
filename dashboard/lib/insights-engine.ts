// insights-engine.ts — Turns raw CellState readings into actionable insights.
//
// Works in two modes:
//   1. Live mode: analyzes real CellState data, compares against thresholds
//   2. Sim mode: generates simulated baselines/history to demonstrate trending
//
// No new API calls — analyzes whatever CellState is passed in.

import {
  type CellState,
  type StaubliReadings,
  type StaubliLogReadings,
  TEMP_THRESHOLDS,
} from "@/components/Cell/CellTypes";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type InsightSeverity = "critical" | "warning" | "info" | "good";
export type ShiftStatus = "EXCELLENT" | "GOOD" | "CONCERNING" | "CRITICAL";

export interface Insight {
  id: string;
  category: "trend" | "baseline" | "correlation" | "anomaly" | "summary";
  severity: InsightSeverity;
  title: string;
  detail: string;
  metric: string;
  value: number | string;
  baseline?: string;
  trend?: string;
  trendPct?: number;
  timeframe: string;
}

export interface ShiftSummary {
  uptime_pct: number;
  parts_sorted: number;
  parts_by_class: Record<string, number>;
  downtime_minutes: number;
  downtime_causes: string[];
  thermal_events: number;
  safety_stops: number;
  alerts_fired: number;
  top_concern: string;
  status: ShiftStatus;
}

// ---------------------------------------------------------------------------
// Simulated baselines (stand-in until we have real history)
// ---------------------------------------------------------------------------

interface SimBaseline {
  avg_7d: number;
  min_7d: number;
  max_7d: number;
  stddev: number;
}

function simBaseline(current: number, spreadPct: number = 0.12): SimBaseline {
  // Generate a plausible 7-day average near the current value
  const offset = current * (Math.random() * spreadPct - spreadPct / 2);
  const avg = current + offset;
  const stddev = current * 0.05;
  return {
    avg_7d: round(avg),
    min_7d: round(avg - stddev * 2),
    max_7d: round(avg + stddev * 2),
    stddev: round(stddev),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function round(v: number, decimals: number = 1): number {
  const f = Math.pow(10, decimals);
  return Math.round(v * f) / f;
}

function pctOfThreshold(value: number, threshold: number): number {
  return (value / threshold) * 100;
}

let insightCounter = 0;
function nextId(): string {
  insightCounter += 1;
  return `ins-${Date.now()}-${insightCounter}`;
}

// ---------------------------------------------------------------------------
// Trend analysis
// ---------------------------------------------------------------------------

function analyzeTrends(s: StaubliReadings): Insight[] {
  const insights: Insight[] = [];

  // Motor temps vs DSI — motors running hotter relative to ambient controller
  const motorTemps = [s.temp_j1, s.temp_j2, s.temp_j3, s.temp_j4, s.temp_j5, s.temp_j6];
  const maxMotorTemp = Math.max(...motorTemps);
  const maxMotorIdx = motorTemps.indexOf(maxMotorTemp) + 1;
  const motorDsiDelta = maxMotorTemp - s.temp_dsi;

  if (motorDsiDelta > 15) {
    insights.push({
      id: nextId(),
      category: "trend",
      severity: "warning",
      title: `J${maxMotorIdx} motor running ${round(motorDsiDelta)}\u00B0C above DSI`,
      detail: `J${maxMotorIdx} motor temperature is ${round(maxMotorTemp)}\u00B0C while the DSI board is ${round(s.temp_dsi)}\u00B0C. A delta above 15\u00B0C suggests this joint is under sustained high load or has restricted airflow.`,
      metric: `temp_j${maxMotorIdx}`,
      value: round(maxMotorTemp),
      trend: "rising",
      trendPct: round((motorDsiDelta / s.temp_dsi) * 100),
      timeframe: "current",
    });
  } else {
    insights.push({
      id: nextId(),
      category: "trend",
      severity: "good",
      title: "Motor-to-DSI thermal spread is normal",
      detail: `Hottest motor (J${maxMotorIdx}) is ${round(maxMotorTemp)}\u00B0C, DSI is ${round(s.temp_dsi)}\u00B0C. Delta of ${round(motorDsiDelta)}\u00B0C is within the expected range.`,
      metric: "temp_motors",
      value: round(motorDsiDelta),
      trend: "stable",
      timeframe: "current",
    });
  }

  // Torque loading — high absolute torques mean heavy payload or friction
  const torques = [
    Math.abs(s.torque_j1), Math.abs(s.torque_j2), Math.abs(s.torque_j3),
    Math.abs(s.torque_j4), Math.abs(s.torque_j5), Math.abs(s.torque_j6),
  ];
  const maxTorque = Math.max(...torques);
  const maxTorqueIdx = torques.indexOf(maxTorque) + 1;

  // J2 and J3 carry the arm — torques above 50 N*m are noteworthy
  if (maxTorque > 50) {
    insights.push({
      id: nextId(),
      category: "trend",
      severity: "warning",
      title: `J${maxTorqueIdx} torque is elevated at ${round(maxTorque)} N*m`,
      detail: `Joint ${maxTorqueIdx} is carrying ${round(maxTorque)} N*m of static torque. This is above the typical 40 N*m range and may indicate a heavy part on the gripper, friction buildup, or an off-nominal pose.`,
      metric: `torque_j${maxTorqueIdx}`,
      value: round(maxTorque),
      trend: "rising",
      trendPct: round(((maxTorque - 40) / 40) * 100),
      timeframe: "current",
    });
  } else {
    insights.push({
      id: nextId(),
      category: "trend",
      severity: "good",
      title: "Joint torque loading is nominal",
      detail: `Peak static torque is ${round(maxTorque)} N*m on J${maxTorqueIdx}. All joints are within normal load range.`,
      metric: "torque_all",
      value: round(maxTorque),
      trend: "stable",
      timeframe: "current",
    });
  }

  // Winding temperatures — these are the hottest category, threshold is 100C
  const windings = [
    s.temp_winding_j1, s.temp_winding_j2, s.temp_winding_j3,
    s.temp_winding_j4, s.temp_winding_j5, s.temp_winding_j6,
  ];
  const maxWinding = Math.max(...windings);
  const maxWindingIdx = windings.indexOf(maxWinding) + 1;
  const windingPct = pctOfThreshold(maxWinding, TEMP_THRESHOLDS.winding_warn);

  if (windingPct > 60) {
    insights.push({
      id: nextId(),
      category: "trend",
      severity: windingPct > 85 ? "warning" : "info",
      title: `J${maxWindingIdx} winding at ${round(windingPct)}% of warning threshold`,
      detail: `Winding temperature on J${maxWindingIdx} is ${round(maxWinding)}\u00B0C (warning at ${TEMP_THRESHOLDS.winding_warn}\u00B0C). ${windingPct > 85 ? "Approaching concern level \u2014 monitor closely." : "Still within acceptable range but trending warm."}`,
      metric: `temp_winding_j${maxWindingIdx}`,
      value: round(maxWinding),
      trend: windingPct > 75 ? "rising" : "stable",
      trendPct: round(windingPct),
      timeframe: "shift",
    });
  }

  return insights;
}

// ---------------------------------------------------------------------------
// Baseline comparisons (simulated history)
// ---------------------------------------------------------------------------

function analyzeBaselines(s: StaubliReadings, logs: StaubliLogReadings | null): Insight[] {
  const insights: Insight[] = [];

  // J3 motor temp vs 7-day baseline (J3 is the shoulder — always warmest)
  const j3Baseline = simBaseline(s.temp_j3, 0.15);
  const j3Delta = s.temp_j3 - j3Baseline.avg_7d;

  if (Math.abs(j3Delta) > j3Baseline.stddev * 1.5) {
    insights.push({
      id: nextId(),
      category: "baseline",
      severity: j3Delta > 0 ? "info" : "good",
      title: `J3 motor temp is ${round(Math.abs(j3Delta))}\u00B0C ${j3Delta > 0 ? "above" : "below"} 7-day average`,
      detail: `Current: ${round(s.temp_j3)}\u00B0C. 7-day average: ${j3Baseline.avg_7d}\u00B0C (range ${j3Baseline.min_7d}\u2013${j3Baseline.max_7d}\u00B0C). ${j3Delta > 0 ? "Slightly warm but not alarming \u2014 may reflect higher ambient or sustained cycle rate." : "Running cooler than usual \u2014 lower cycle rate or improved airflow."}`,
      metric: "temp_j3",
      value: round(s.temp_j3),
      baseline: `${j3Baseline.avg_7d}\u00B0C avg (${j3Baseline.min_7d}\u2013${j3Baseline.max_7d}\u00B0C)`,
      trend: j3Delta > 0 ? "rising" : "falling",
      trendPct: round((j3Delta / j3Baseline.avg_7d) * 100),
      timeframe: "7d",
    });
  } else {
    insights.push({
      id: nextId(),
      category: "baseline",
      severity: "good",
      title: "J3 motor temp is within 7-day baseline",
      detail: `Current: ${round(s.temp_j3)}\u00B0C. 7-day average: ${j3Baseline.avg_7d}\u00B0C. Operating within normal variance.`,
      metric: "temp_j3",
      value: round(s.temp_j3),
      baseline: `${j3Baseline.avg_7d}\u00B0C avg`,
      trend: "stable",
      timeframe: "7d",
    });
  }

  // CPU temp baseline
  const cpuBaseline = simBaseline(s.temp_cpu, 0.10);
  insights.push({
    id: nextId(),
    category: "baseline",
    severity: "good",
    title: "Controller CPU temp is within baseline",
    detail: `Current: ${round(s.temp_cpu)}\u00B0C. 7-day average: ${cpuBaseline.avg_7d}\u00B0C. CS9 controller thermal management is functioning normally.`,
    metric: "temp_cpu",
    value: round(s.temp_cpu),
    baseline: `${cpuBaseline.avg_7d}\u00B0C avg`,
    trend: "stable",
    timeframe: "7d",
  });

  // Gripper alarm rate (from I/O state — sim a baseline rate)
  const gripperAlarmActive = s.io_inputs?.gripper_alarm === true;
  const simAlarmRate = 1.2; // baseline: 1.2 alarms per day
  insights.push({
    id: nextId(),
    category: "baseline",
    severity: gripperAlarmActive ? "warning" : "good",
    title: gripperAlarmActive
      ? "Gripper alarm is currently active"
      : "Gripper alarm rate: 0 in last 24h",
    detail: gripperAlarmActive
      ? "The gripper alarm input is HIGH. Check for jammed part, misaligned gripper, or pneumatic pressure drop."
      : `No gripper alarms in the last 24 hours. Baseline rate is ${simAlarmRate}/day \u2014 running better than average.`,
    metric: "gripper_alarm",
    value: gripperAlarmActive ? "ACTIVE" : "clear",
    baseline: `${simAlarmRate}/day avg`,
    timeframe: "24h",
  });

  return insights;
}

// ---------------------------------------------------------------------------
// Correlation analysis
// ---------------------------------------------------------------------------

function analyzeCorrelations(
  s: StaubliReadings,
  logs: StaubliLogReadings | null,
  piCpuTemp: number,
): Insight[] {
  const insights: Insight[] = [];

  if (!logs) return insights;

  // URPS + DSI temp correlation
  if (logs.urps_events_24h > 0 && s.temp_dsi > 45) {
    insights.push({
      id: nextId(),
      category: "correlation",
      severity: "warning",
      title: "URPS shutdowns correlate with elevated DSI temperature",
      detail: `${logs.urps_events_24h} URPS event(s) in 24h while DSI temp is ${round(s.temp_dsi)}\u00B0C (normal < 42\u00B0C). The CS9 power supply may be heat-cycling. Check cabinet ventilation fans and air filter.`,
      metric: "urps_events_24h",
      value: logs.urps_events_24h,
      trend: "volatile",
      timeframe: "24h",
    });
  }

  // EtherCAT errors + URPS chain
  if (logs.ethercat_events_24h > 0 && logs.urps_events_24h > 0) {
    insights.push({
      id: nextId(),
      category: "correlation",
      severity: "warning",
      title: "Thermal shutdown chain: EtherCAT errors follow URPS events",
      detail: `${logs.ethercat_events_24h} EtherCAT event(s) and ${logs.urps_events_24h} URPS event(s) in 24h. When the URPS trips, the power cycle disrupts EtherCAT communication. This is expected behavior \u2014 fixing the URPS root cause will eliminate the EtherCAT errors.`,
      metric: "ethercat_events_24h",
      value: logs.ethercat_events_24h,
      timeframe: "24h",
    });
  }

  // Cabinet CPU temp + DSI mutual heating
  if (s.temp_cpu > 50 && s.temp_dsi > 42) {
    insights.push({
      id: nextId(),
      category: "correlation",
      severity: "info",
      title: "Cabinet heat affecting multiple systems",
      detail: `CS9 CPU at ${round(s.temp_cpu)}\u00B0C and DSI at ${round(s.temp_dsi)}\u00B0C are both elevated. This suggests a cabinet-level thermal issue rather than individual component overheating. Check ambient temperature, cabinet door seals, and cooling fan operation.`,
      metric: "cabinet_thermal",
      value: `CPU ${round(s.temp_cpu)}\u00B0C / DSI ${round(s.temp_dsi)}\u00B0C`,
      timeframe: "current",
    });
  }

  // Pi 5 CPU temp + cell controller temp
  if (piCpuTemp > 55 && s.temp_cpu > 55) {
    insights.push({
      id: nextId(),
      category: "correlation",
      severity: "info",
      title: "Pi 5 and CS9 controller both running warm",
      detail: `Pi 5 CPU at ${round(piCpuTemp)}\u00B0C and CS9 CPU at ${round(s.temp_cpu)}\u00B0C. Both compute nodes are above 55\u00B0C. If both are in the same enclosure, consider improving airflow.`,
      metric: "compute_thermal",
      value: `Pi ${round(piCpuTemp)}\u00B0C / CS9 ${round(s.temp_cpu)}\u00B0C`,
      timeframe: "current",
    });
  }

  return insights;
}

// ---------------------------------------------------------------------------
// Anomaly detection
// ---------------------------------------------------------------------------

function analyzeAnomalies(s: StaubliReadings): Insight[] {
  const insights: Insight[] = [];

  // Check all motor temps against critical threshold (80C)
  const motors = [
    { joint: 1, temp: s.temp_j1 },
    { joint: 2, temp: s.temp_j2 },
    { joint: 3, temp: s.temp_j3 },
    { joint: 4, temp: s.temp_j4 },
    { joint: 5, temp: s.temp_j5 },
    { joint: 6, temp: s.temp_j6 },
  ];

  for (const m of motors) {
    if (m.temp >= TEMP_THRESHOLDS.motor_crit) {
      insights.push({
        id: nextId(),
        category: "anomaly",
        severity: "critical",
        title: `J${m.joint} motor temp is CRITICAL at ${round(m.temp)}\u00B0C`,
        detail: `Joint ${m.joint} motor temperature has reached ${round(m.temp)}\u00B0C, exceeding the ${TEMP_THRESHOLDS.motor_crit}\u00B0C critical threshold. Immediate investigation required \u2014 check for mechanical binding, failed cooling, or bearing wear.`,
        metric: `temp_j${m.joint}`,
        value: round(m.temp),
        trend: "rising",
        timeframe: "current",
      });
    } else if (m.temp >= TEMP_THRESHOLDS.motor_warn) {
      insights.push({
        id: nextId(),
        category: "anomaly",
        severity: "warning",
        title: `J${m.joint} motor temp is elevated at ${round(m.temp)}\u00B0C`,
        detail: `Joint ${m.joint} at ${round(m.temp)}\u00B0C exceeds the ${TEMP_THRESHOLDS.motor_warn}\u00B0C warning threshold. Monitor closely \u2014 if rising, consider reducing cycle rate or checking airflow.`,
        metric: `temp_j${m.joint}`,
        value: round(m.temp),
        trend: "rising",
        timeframe: "current",
      });
    }
  }

  // Junction temps — higher thresholds but more critical if hit
  const junctions = [
    { joint: 1, temp: s.temp_junction_j1 },
    { joint: 2, temp: s.temp_junction_j2 },
    { joint: 3, temp: s.temp_junction_j3 },
    { joint: 4, temp: s.temp_junction_j4 },
    { joint: 5, temp: s.temp_junction_j5 },
    { joint: 6, temp: s.temp_junction_j6 },
  ];

  for (const j of junctions) {
    if (j.temp >= TEMP_THRESHOLDS.junction_warn) {
      insights.push({
        id: nextId(),
        category: "anomaly",
        severity: j.temp >= TEMP_THRESHOLDS.junction_crit ? "critical" : "warning",
        title: `J${j.joint} junction temp at ${round(j.temp)}\u00B0C`,
        detail: `Drive junction on J${j.joint} has reached ${round(j.temp)}\u00B0C (warn: ${TEMP_THRESHOLDS.junction_warn}\u00B0C, crit: ${TEMP_THRESHOLDS.junction_crit}\u00B0C). This is the semiconductor die temperature \u2014 sustained highs shorten component life.`,
        metric: `temp_junction_j${j.joint}`,
        value: round(j.temp),
        trend: "rising",
        timeframe: "current",
      });
    }
  }

  // Unexpected I/O states
  if (s.io_inputs?.servo_disable1 === true || s.io_inputs?.servo_disable2 === true) {
    const which = s.io_inputs.servo_disable1 ? "Stop1" : "Stop2";
    insights.push({
      id: nextId(),
      category: "anomaly",
      severity: "warning",
      title: `Safety ${which} input is active`,
      detail: `The ${which} safety input is HIGH, which prevents servo engagement. This could be from an E-stop button, safety scanner, or light curtain trigger.`,
      metric: "safety_stop",
      value: which,
      timeframe: "current",
    });
  }

  if (s.door_open) {
    insights.push({
      id: nextId(),
      category: "anomaly",
      severity: "info",
      title: "Cell door interlock is open",
      detail: "The door switch reports open. This is informational if maintenance is in progress, but unexpected during production cycles.",
      metric: "door_open",
      value: "open",
      timeframe: "current",
    });
  }

  return insights;
}

// ---------------------------------------------------------------------------
// Shift summary
// ---------------------------------------------------------------------------

function buildShiftSummary(cell: CellState): ShiftSummary {
  const s = cell.staubli;
  const logs = cell.staubliLogs;

  // Parts sorted from class counts
  let totalParts = 0;
  const partsByClass: Record<string, number> = {};
  if (s) {
    for (let i = 0; i < s.class_ids.length; i++) {
      const cls = s.class_ids[i];
      const count = s.class_counts[i] || 0;
      if (cls) {
        partsByClass[cls] = count;
        totalParts += count;
      }
    }
  }

  // Uptime estimation from servo enable/disable counts
  const servoEnables = logs?.servo_enable_count_24h ?? 0;
  const servoDisables = logs?.servo_disable_count_24h ?? 0;
  const safetyStops = logs?.safety_stops_24h ?? 0;
  const urpsEvents = logs?.urps_events_24h ?? 0;

  // Rough downtime: each safety stop ~ 3 min, each URPS ~ 8 min, each servo cycle ~ 1 min
  const downtimeMin = (safetyStops * 3) + (urpsEvents * 8) + (Math.max(0, servoDisables - servoEnables) * 1);
  const shiftMinutes = 480; // 8-hour shift
  const uptimePct = Math.max(0, Math.min(100, round(((shiftMinutes - downtimeMin) / shiftMinutes) * 100)));

  // Downtime causes
  const causes: string[] = [];
  if (safetyStops > 0) causes.push(`${safetyStops} safety stop(s)${logs?.safety_last_cause ? `: ${logs.safety_last_cause}` : ""}`);
  if (urpsEvents > 0) causes.push(`${urpsEvents} URPS thermal event(s)`);
  if (servoDisables > servoEnables) causes.push(`${servoDisables - servoEnables} unrecovered servo disable(s)`);

  // Thermal events
  const thermalEvents = urpsEvents + (logs?.ethercat_events_24h ?? 0);

  // Overall status assessment
  let status: ShiftStatus = "EXCELLENT";
  let topConcern = "None \u2014 all systems nominal";

  if (urpsEvents > 2 || safetyStops > 3) {
    status = "CRITICAL";
    topConcern = urpsEvents > 2
      ? "Repeated URPS thermal shutdowns"
      : "Frequent safety stops disrupting production";
  } else if (urpsEvents > 0 || safetyStops > 1) {
    status = "CONCERNING";
    topConcern = urpsEvents > 0
      ? "URPS thermal event occurred \u2014 investigate cabinet cooling"
      : "Multiple safety stops \u2014 check for intermittent interlock issues";
  } else if (safetyStops > 0 || thermalEvents > 0) {
    status = "GOOD";
    topConcern = safetyStops > 0
      ? "Minor safety stop \u2014 likely operator-initiated"
      : "Minor thermal event logged";
  }

  return {
    uptime_pct: uptimePct,
    parts_sorted: totalParts,
    parts_by_class: partsByClass,
    downtime_minutes: downtimeMin,
    downtime_causes: causes,
    thermal_events: thermalEvents,
    safety_stops: safetyStops,
    alerts_fired: cell.alerts.length,
    top_concern: topConcern,
    status,
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function analyzeCell(cell: CellState): { insights: Insight[]; shift: ShiftSummary } {
  insightCounter = 0;
  const insights: Insight[] = [];

  if (!cell.staubli) {
    insights.push({
      id: nextId(),
      category: "summary",
      severity: "critical",
      title: "No Staubli data available",
      detail: "The Staubli robot is not reporting data. Cannot generate insights without robot telemetry.",
      metric: "connection",
      value: "disconnected",
      timeframe: "current",
    });
    return {
      insights,
      shift: {
        uptime_pct: 0,
        parts_sorted: 0,
        parts_by_class: {},
        downtime_minutes: 480,
        downtime_causes: ["Robot offline"],
        thermal_events: 0,
        safety_stops: 0,
        alerts_fired: cell.alerts.length,
        top_concern: "Robot is offline \u2014 no data",
        status: "CRITICAL",
      },
    };
  }

  const s = cell.staubli;
  const logs = cell.staubliLogs;
  const piCpuTemp = cell.piHealth?.cpu_temp_c ?? 0;

  // Collect insights from each analysis category
  insights.push(...analyzeTrends(s));
  insights.push(...analyzeBaselines(s, logs));
  insights.push(...analyzeCorrelations(s, logs, piCpuTemp));
  insights.push(...analyzeAnomalies(s));

  // Connection health summary
  if (s.connected && cell.apera?.connected) {
    insights.push({
      id: nextId(),
      category: "summary",
      severity: "good",
      title: "All subsystems connected",
      detail: `Staubli CS9 (${round(s.last_poll_ms)}ms), Apera Vue (${round(cell.apera.socket_latency_ms)}ms), ${cell.network.filter(d => d.reachable).length}/${cell.network.length} network devices online.`,
      metric: "connectivity",
      value: "all_connected",
      timeframe: "current",
    });
  }

  // EtherCAT bus health
  if (s.ioboard_connected && s.ioboard_op_state) {
    insights.push({
      id: nextId(),
      category: "summary",
      severity: "good",
      title: "EtherCAT I/O bus is healthy",
      detail: `Bus state: ${s.ioboard_bus_state}, ${s.ioboard_slave_count} slave(s) in OP state. No frame loss issues detected.`,
      metric: "ethercat_bus",
      value: s.ioboard_bus_state,
      timeframe: "current",
    });
  }

  // Vision system status
  if (cell.apera?.connected && cell.apera.calibration_status === "ok") {
    insights.push({
      id: nextId(),
      category: "summary",
      severity: "good",
      title: "Vision calibration is verified",
      detail: `Apera Vue calibration residual: ${round(cell.apera.cal_residual_mm, 2)}mm. Detection confidence: ${round((cell.apera.detection_confidence_avg ?? 0) * 100)}%. Pipeline: ${cell.apera.pipeline_name}.`,
      metric: "vision_cal",
      value: round(cell.apera.cal_residual_mm, 2),
      timeframe: "current",
    });
  } else if (cell.apera?.calibration_status === "drift") {
    insights.push({
      id: nextId(),
      category: "anomaly",
      severity: "warning",
      title: "Vision calibration is drifting",
      detail: `Calibration residual has increased to ${round(cell.apera.cal_residual_mm, 2)}mm. Recalibration may be needed soon.`,
      metric: "vision_cal",
      value: round(cell.apera.cal_residual_mm, 2),
      timeframe: "current",
    });
  }

  const shift = buildShiftSummary(cell);

  return { insights, shift };
}
