/**
 * AI Diagnostic Pre-Processing Layer
 *
 * Runs pattern detection on live readings + trend data BEFORE
 * sending to Claude. Produces structured diagnostic notes that
 * guide the AI toward correct root-cause analysis.
 *
 * Built from lessons learned diagnosing the 2024 Mack Granite
 * SCR temp sensor failure (2026-04-03).
 */

// ── Types ──────────────────────────────────────────────────────────

export interface DiagnosticNote {
  severity: "critical" | "warning" | "info";
  category: string;
  title: string;
  detail: string;
  physical_check?: string; // What CAN data can't tell you
}

export interface TrendPoint {
  [key: string]: number | string | null | undefined;
}

// ── Signal helpers ─────────────────────────────────────────────────

/** Returns true if the value represents a missing/unavailable signal */
function isNoSignal(val: unknown): boolean {
  if (val === null || val === undefined) return true;
  if (typeof val === "string" && (val === "N/A" || val === "" || val === "n/a")) return true;
  if (typeof val === "number" && (isNaN(val) || val === 65535 || val === 255 || val === 0xFF00)) return true;
  return false;
}

/** Safely get a numeric reading, returning null if missing */
function num(readings: Record<string, unknown>, key: string): number | null {
  const v = readings[key];
  if (isNoSignal(v)) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

/** Safely get a lamp value (0=off, 1=on, null=not reported) */
function lamp(readings: Record<string, unknown>, key: string): number | null {
  const v = readings[key];
  if (v === null || v === undefined) return null;
  return Number(v);
}

// ── Main export ────────────────────────────────────────────────────

/**
 * Analyze live readings and optional trend history to produce
 * diagnostic notes for the AI system prompt.
 */
export function runDiagnostics(
  readings: Record<string, unknown>,
  trendHistory?: TrendPoint[],
): DiagnosticNote[] {
  const notes: DiagnosticNote[] = [];

  // Run all pattern detectors
  detectScrTempChain(readings, notes);
  detectDefDosingDisabled(readings, notes);
  detectEpaInducement(readings, notes);
  detectPerEcuLampCorrelation(readings, notes);
  detectCrossEcuDiscrepancies(readings, notes);
  detectDpfSootStatus(readings, notes);
  detectNoxSensorStatus(readings, notes);
  detectStuckValues(readings, trendHistory, notes);
  detectMissingSignals(readings, notes);

  return notes;
}

/**
 * Format diagnostic notes into a text block for injection into
 * the AI system prompt.
 */
export function formatDiagnosticNotes(notes: DiagnosticNote[]): string {
  if (notes.length === 0) return "";

  const critical = notes.filter(n => n.severity === "critical");
  const warning = notes.filter(n => n.severity === "warning");
  const info = notes.filter(n => n.severity === "info");

  const lines: string[] = [];
  lines.push("AUTOMATED DIAGNOSTIC NOTES (pre-processed from live data):");
  lines.push("");

  if (critical.length > 0) {
    lines.push(">>> CRITICAL FINDINGS:");
    for (const n of critical) {
      lines.push(`  [${n.category}] ${n.title}`);
      lines.push(`    ${n.detail}`);
      if (n.physical_check) lines.push(`    PHYSICAL CHECK NEEDED: ${n.physical_check}`);
    }
    lines.push("");
  }

  if (warning.length > 0) {
    lines.push(">> WARNINGS:");
    for (const n of warning) {
      lines.push(`  [${n.category}] ${n.title}`);
      lines.push(`    ${n.detail}`);
      if (n.physical_check) lines.push(`    PHYSICAL CHECK NEEDED: ${n.physical_check}`);
    }
    lines.push("");
  }

  if (info.length > 0) {
    lines.push("> INFO:");
    for (const n of info) {
      lines.push(`  [${n.category}] ${n.title} — ${n.detail}`);
    }
    lines.push("");
  }

  lines.push("Use these notes to guide your analysis. The cascade chains are confirmed by the data — present them to the mechanic as evidence-backed findings, not guesses.");

  return lines.join("\n");
}

// ── Pattern detectors ──────────────────────────────────────────────

/**
 * SCR temp sensor signal chain failure.
 * Pattern: SCR temp missing → DEF dosing disabled → efficiency collapse
 * This is the exact cascade found on the Mack Granite 2026-04-03.
 */
function detectScrTempChain(r: Record<string, unknown>, notes: DiagnosticNote[]) {
  const scrTemp = num(r, "scr_catalyst_temp_f");
  const defDose = num(r, "def_dose_rate_gs");
  const defCmd = num(r, "def_dose_commanded_gs");
  const scrEff = num(r, "scr_efficiency_pct");

  if (scrTemp === null && (defDose === null || defDose === 0) && scrEff !== null && scrEff < 50) {
    notes.push({
      severity: "critical",
      category: "AFTERTREATMENT CASCADE",
      title: "SCR temp sensor signal chain failure detected",
      detail: `SCR exhaust temp = NO SIGNAL → ECU disabled DEF dosing (actual=${defDose ?? "N/A"}, commanded=${defCmd ?? "N/A"}) → SCR efficiency collapsed to ${scrEff}%. This is a single root cause producing multiple symptoms. The missing temp signal is the trigger — without it, the ECU cannot verify catalyst temperature for safe DEF injection.`,
      physical_check: "Inspect SCR exhaust temp sensor between DPF outlet and SCR catalyst inlet. Check: connector (melted/corroded pins), harness (chafing against exhaust, heat damage), sensor resistance (100-2000Ω), reference voltage at harness (5V from ACM), harness continuity (<2Ω pin-to-pin).",
    });
  } else if (scrTemp === null) {
    // Temp missing but maybe engine is cold / just started
    notes.push({
      severity: "warning",
      category: "AFTERTREATMENT",
      title: "SCR exhaust temperature not reporting",
      detail: "SCR catalyst temp reads N/A. If engine is cold, this may resolve at operating temp. If it persists after warmup, this will disable DEF dosing and trigger efficiency collapse.",
      physical_check: "If persistent after warmup: check SCR temp sensor connector and wiring.",
    });
  }
}

/**
 * DEF dosing disabled — both actual and commanded rates missing.
 * Only fires if the SCR chain detector didn't already cover it.
 */
function detectDefDosingDisabled(r: Record<string, unknown>, notes: DiagnosticNote[]) {
  const defDose = num(r, "def_dose_rate_gs");
  const defCmd = num(r, "def_dose_commanded_gs");
  const scrTemp = num(r, "scr_catalyst_temp_f");
  const rpm = num(r, "engine_rpm");

  // Skip if engine is off or SCR chain already detected
  if (rpm !== null && rpm < 300) return;
  if (scrTemp === null) return; // SCR chain handler covers this

  if ((defDose === null || defDose === 0) && (defCmd === null || defCmd === 0)) {
    notes.push({
      severity: "warning",
      category: "AFTERTREATMENT",
      title: "DEF dosing system inactive",
      detail: `Both actual (${defDose ?? "N/A"}) and commanded (${defCmd ?? "N/A"}) DEF dose rates are zero/missing. SCR temp IS reporting (${scrTemp}°F), so the cause is not a missing temp signal. Check: DEF quality sensor, DEF pump, dosing valve, or ACM commanding zero dose for another reason.`,
      physical_check: "Check DEF pump operation, dosing valve connector, DEF quality/concentration, and ACM fault history (DM2).",
    });
  }
}

/**
 * EPA inducement active — escalating derate stages.
 */
function detectEpaInducement(r: Record<string, unknown>, notes: DiagnosticNote[]) {
  const level = num(r, "epa_inducement_level");
  if (level === null || level === 0) return;

  const stages: Record<number, string> = {
    1: "Stage 1 — Protect Lamp only. No performance impact yet, but will escalate with engine hours if not resolved.",
    2: "Stage 2 — 5 mph speed derate active. Truck is limited to 5 mph. Urgent repair needed.",
    3: "Stage 3 — Idle only. Truck cannot move under its own power. Immediate repair required.",
  };

  notes.push({
    severity: level >= 2 ? "critical" : "warning",
    category: "EPA INDUCEMENT",
    title: `EPA inducement ${stages[level] || `Stage ${level} active`}`,
    detail: `Inducement stages escalate with continued engine operation. Resolving the root cause (typically aftertreatment system fault) and clearing DTCs will reset the inducement counter.`,
  });
}

/**
 * Per-ECU lamp correlation — which ECUs command which lamps,
 * cross-referenced with DTC counts.
 */
function detectPerEcuLampCorrelation(r: Record<string, unknown>, notes: DiagnosticNote[]) {
  const protectEngine = lamp(r, "protect_lamp_engine");
  const protectAcm = lamp(r, "protect_lamp_acm");
  const dtcCount = num(r, "active_dtc_count") ?? 0;

  if (protectEngine === null && protectAcm === null) return;

  // Both ECUs commanding Protect with zero DTCs
  if (protectEngine === 1 && protectAcm === 1 && dtcCount === 0) {
    notes.push({
      severity: "critical",
      category: "ECU CORRELATION",
      title: "Protect Lamp ON from both ECUs with ZERO stored DTCs",
      detail: "Engine ECM and Aftertreatment ACM are both commanding the Protect Lamp ON every broadcast cycle, but no fault codes are stored. This means: (1) the DTC was cleared but the underlying condition persists — the ECU reasserts the lamp immediately, or (2) the condition triggers the lamp directly without setting a DTC (e.g., EPA inducement). Clearing DTCs again will NOT fix this — the root cause must be resolved first.",
    });
  }

  // Only ACM commanding — aftertreatment-specific issue
  if (protectEngine === 0 && protectAcm === 1) {
    notes.push({
      severity: "warning",
      category: "ECU CORRELATION",
      title: "Protect Lamp commanded by ACM only (not Engine ECM)",
      detail: "Only the Aftertreatment Control Module is commanding the Protect Lamp. The Engine ECM is not. This narrows the cause to the aftertreatment system specifically — SCR, DEF, DPF, or NOx sensor subsystems.",
    });
  }

  // Only Engine ECM commanding — engine-side issue
  if (protectEngine === 1 && protectAcm === 0) {
    notes.push({
      severity: "warning",
      category: "ECU CORRELATION",
      title: "Protect Lamp commanded by Engine ECM only (not ACM)",
      detail: "Only the Engine ECM is commanding the Protect Lamp. The ACM is not. This suggests an engine-side protection condition — oil pressure, coolant temp, or engine overload — rather than aftertreatment.",
    });
  }

  // Red stop lamp
  const redEngine = lamp(r, "red_stop_lamp_engine");
  const redAcm = lamp(r, "red_stop_lamp_acm");
  if (redEngine === 1 || redAcm === 1) {
    notes.push({
      severity: "critical",
      category: "ECU CORRELATION",
      title: "RED STOP LAMP active",
      detail: `Red stop lamp commanded by: ${redEngine === 1 ? "Engine ECM" : ""}${redEngine === 1 && redAcm === 1 ? " + " : ""}${redAcm === 1 ? "ACM" : ""}. This indicates a condition requiring immediate engine shutdown. Do NOT recommend continued operation.`,
    });
  }
}

/**
 * Cross-ECU discrepancies — same parameter reported differently
 * by different ECUs.
 */
function detectCrossEcuDiscrepancies(r: Record<string, unknown>, notes: DiagnosticNote[]) {
  // DEF level: ACM vs Engine ECM
  const defAcm = num(r, "def_level_pct");
  const defEcm = num(r, "def_level_ecm_pct");

  if (defAcm !== null && defEcm === null) {
    notes.push({
      severity: "info",
      category: "CROSS-ECU",
      title: "Engine ECM cannot see DEF level that ACM reports fine",
      detail: `ACM reports DEF level at ${defAcm}% but Engine ECM shows N/A. Possible ACM-to-ECM broadcast issue. May resolve after primary aftertreatment repair, or may need ACM broadcast config check with PTT.`,
    });
  } else if (defAcm !== null && defEcm !== null && Math.abs(defAcm - defEcm) > 10) {
    notes.push({
      severity: "warning",
      category: "CROSS-ECU",
      title: "DEF level mismatch between ACM and Engine ECM",
      detail: `ACM reports ${defAcm}%, Engine ECM reports ${defEcm}%. Difference of ${Math.abs(defAcm - defEcm).toFixed(0)}%. Check DEF level sensor wiring and CAN bus communication.`,
    });
  }
}

/**
 * DPF soot load status.
 */
function detectDpfSootStatus(r: Record<string, unknown>, notes: DiagnosticNote[]) {
  const soot = num(r, "dpf_soot_load_pct");
  if (soot === null) return;

  if (soot > 90) {
    notes.push({
      severity: "critical",
      category: "DPF",
      title: `DPF soot load critically high (${soot}%)`,
      detail: "Above 90% — may require forced regen with a scan tool. Passive regen unlikely to clear this level. If DEF dosing is also disabled, the DPF cannot regen until the dosing system is restored.",
      physical_check: "Check DPF pressure differential sensor. If dosing is disabled, fix that first — the DPF will clear itself once DEF is flowing and a regen cycle completes.",
    });
  } else if (soot > 80) {
    notes.push({
      severity: "warning",
      category: "DPF",
      title: `DPF soot load high (${soot}%)`,
      detail: "Above 80% — approaching forced regen threshold. A passive regen should initiate on the next sustained highway drive. Monitor after any aftertreatment repairs.",
    });
  } else if (soot > 70) {
    notes.push({
      severity: "info",
      category: "DPF",
      title: `DPF soot load elevated (${soot}%)`,
      detail: "Above 70% — in the upper range but not critical. Will likely trigger a passive regen soon. Note: if DEF dosing is disabled, soot will continue to climb.",
    });
  }
}

/**
 * NOx sensor status flags — power, temperature, stability.
 */
function detectNoxSensorStatus(r: Record<string, unknown>, notes: DiagnosticNote[]) {
  const rpm = num(r, "engine_rpm");
  if (rpm !== null && rpm < 300) return; // Don't check when engine is off

  const checks = [
    { prefix: "nox_inlet", label: "Intake NOx sensor" },
    { prefix: "nox_outlet", label: "Outlet NOx sensor" },
  ];

  for (const { prefix, label } of checks) {
    const power = r[`${prefix}_power_ok`];
    const atTemp = r[`${prefix}_at_temp`];
    const stable = r[`${prefix}_reading_stable`];

    // Skip if no NOx data at all
    if (power === undefined && atTemp === undefined && stable === undefined) continue;

    const issues: string[] = [];
    if (power === false || power === 0) issues.push("power NOT in range");
    if (atTemp === false || atTemp === 0) issues.push("sensor NOT at operating temp");
    if (stable === false || stable === 0) issues.push("reading NOT stable");

    if (issues.length > 0) {
      notes.push({
        severity: issues.length >= 2 ? "warning" : "info",
        category: "NOX SENSOR",
        title: `${label} issues: ${issues.join(", ")}`,
        detail: `${label} reporting ${issues.length} status flag(s) abnormal. All three flags (power in range, at temp, reading stable) should be true when engine is at operating temp. If engine is still warming up, these may resolve.`,
        physical_check: issues.includes("power NOT in range")
          ? `Check ${label.toLowerCase()} wiring and connector. Verify 12V supply to sensor module.`
          : undefined,
      });
    }
  }
}

/**
 * Stuck value detection — a reading that hasn't changed while
 * others have, suggesting it's a stored value, not a live measurement.
 */
function detectStuckValues(
  r: Record<string, unknown>,
  history: TrendPoint[] | undefined,
  notes: DiagnosticNote[],
) {
  if (!history || history.length < 10) return;

  // Check aftertreatment values for stuck patterns
  const keysToCheck = [
    { key: "scr_efficiency_pct", label: "SCR Efficiency", readingKey: "scr_eff" },
    { key: "dpf_soot_load_pct", label: "DPF Soot Load", readingKey: "dpf_soot" },
    { key: "def_level_pct", label: "DEF Level", readingKey: "def_pct" },
  ];

  // Reference: check if coolant changed (proving engine was running and data is flowing)
  const coolantVals = history
    .map(p => Number(p.coolant_f))
    .filter(v => !isNaN(v) && v > 0);
  if (coolantVals.length < 5) return;
  const coolantRange = Math.max(...coolantVals) - Math.min(...coolantVals);
  if (coolantRange < 5) return; // Coolant didn't change — can't use as reference

  for (const { key, label, readingKey } of keysToCheck) {
    const vals = history
      .map(p => Number(p[readingKey] ?? p[key]))
      .filter(v => !isNaN(v) && v > 0);
    if (vals.length < 5) continue;

    const range = Math.max(...vals) - Math.min(...vals);
    const value = vals[vals.length - 1];

    // Value didn't change at all while coolant moved 5+ degrees
    if (range < 0.5 && coolantRange > 10) {
      notes.push({
        severity: "info",
        category: "STUCK VALUE",
        title: `${label} frozen at ${value}% over trend window`,
        detail: `${label} has not changed (range: ${range.toFixed(1)}) while coolant moved ${coolantRange.toFixed(0)}°F. This suggests a stored/stale value rather than a live measurement — the subsystem producing this reading may be disabled or the sensor may not be updating.`,
      });
    }
  }
}

/**
 * Missing signal summary — list all key aftertreatment parameters
 * that are not reporting, so the AI knows what data it's missing.
 */
function detectMissingSignals(r: Record<string, unknown>, notes: DiagnosticNote[]) {
  const critical_signals = [
    { key: "scr_catalyst_temp_f", label: "SCR Catalyst Temp" },
    { key: "scr_efficiency_pct", label: "SCR Efficiency" },
    { key: "def_dose_rate_gs", label: "DEF Dose Rate (actual)" },
    { key: "def_dose_commanded_gs", label: "DEF Dose Rate (commanded)" },
    { key: "def_level_pct", label: "DEF Level" },
    { key: "dpf_soot_load_pct", label: "DPF Soot Load" },
    { key: "dpf_outlet_temp_f", label: "DPF Outlet Temp" },
  ];

  const missing = critical_signals.filter(s => isNoSignal(r[s.key]));

  if (missing.length > 0 && missing.length < critical_signals.length) {
    // Some signals missing but not all — selective failure
    notes.push({
      severity: "info",
      category: "SIGNAL STATUS",
      title: `${missing.length} aftertreatment signal(s) not reporting`,
      detail: `Missing: ${missing.map(m => m.label).join(", ")}. Present signals are being used for analysis. Missing signals may indicate disabled subsystems, sensor failures, or ECU not broadcasting these PGNs.`,
    });
  }
}
