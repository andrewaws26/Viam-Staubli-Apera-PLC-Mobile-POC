import { SensorReadings } from "../lib/types";

interface Props {
  readings: SensorReadings | null;
}

interface DiagnosticCheck {
  id: string;
  label: string;
  severity: "ok" | "warn" | "error";
  message: string;
}

function runChecks(r: SensorReadings): DiagnosticCheck[] {
  const checks: DiagnosticCheck[] = [];

  // ── Connection ──
  if (r.connected !== true) {
    checks.push({
      id: "plc-offline",
      label: "PLC Connection",
      severity: "error",
      message:
        "No Modbus TCP response — PLC may be powered off, Ethernet disconnected, or wrong IP configured",
    });
    return checks; // No point checking further if PLC is unreachable
  }

  checks.push({
    id: "plc-online",
    label: "PLC Connection",
    severity: "ok",
    message: "Modbus TCP responding normally",
  });

  // ── TPS Power Loop ──
  const tpsPower = r.tps_power_loop === true;
  if (!tpsPower) {
    checks.push({
      id: "tps-power-off",
      label: "TPS Power Loop",
      severity: "warn",
      message:
        "X4 (TPS Power Loop) is OFF — system is idle. TPS must be powered on for plate dropping.",
    });
  } else {
    checks.push({
      id: "tps-power-on",
      label: "TPS Power Loop",
      severity: "ok",
      message: "TPS power loop active",
    });
  }

  // ── Encoder Health ──
  const encoderCount = typeof r.encoder_count === "number" ? r.encoder_count : 0;
  const encoderEnabled = r.encoder_enabled === true;
  const encoderReset = r.encoder_reset === true;
  const floatingZero = r.floating_zero === true;

  if (encoderReset) {
    checks.push({
      id: "encoder-reset",
      label: "Encoder Reset",
      severity: "warn",
      message:
        "C1999 (Encoder Reset) is active — encoder count is being held at zero. This is normal during reset but should clear during operation.",
    });
  }

  if (tpsPower && !encoderEnabled && !encoderReset) {
    checks.push({
      id: "encoder-not-counting",
      label: "Encoder",
      severity: "error",
      message:
        "TPS is powered but encoder is not counting — check encoder cable connection, verify X1/X2 wiring to HSC inputs, or check if wheel is turning.",
    });
  } else if (encoderEnabled) {
    checks.push({
      id: "encoder-ok",
      label: "Encoder",
      severity: "ok",
      message: `Encoder counting — ${encoderCount.toLocaleString()} pulses`,
    });
  }

  if (floatingZero) {
    checks.push({
      id: "floating-zero",
      label: "Floating Zero",
      severity: "warn",
      message:
        "C2000 (Floating Zero) is active — encoder zero reference is floating. This may affect plate spacing accuracy.",
    });
  }

  // ── Camera Signal ──
  const cameraSignal = r.camera_signal === true;
  if (tpsPower && !cameraSignal) {
    checks.push({
      id: "camera-no-signal",
      label: "Camera Signal",
      severity: "warn",
      message:
        "X3 (Camera Signal) is OFF while TPS is running — camera may be disconnected or not detecting ties.",
    });
  }

  // ── Air Eagle Consistency ──
  const ae1 = r.air_eagle_1_feedback === true;
  const ae2 = r.air_eagle_2_feedback === true;
  const ae3 = r.air_eagle_3_enable === true;

  if (!tpsPower && (ae1 || ae2 || ae3)) {
    const active = [ae1 && "Air Eagle 1 (X5)", ae2 && "Air Eagle 2 (X6)", ae3 && "Air Eagle 3 (X7)"]
      .filter(Boolean)
      .join(", ");
    checks.push({
      id: "air-eagle-unexpected",
      label: "Air Eagle System",
      severity: "warn",
      message: `${active} active but TPS power is OFF — check wiring or verify these inputs should have voltage in idle state.`,
    });
  }

  // ── Eject Coils While TPS Off ──
  const eject1 = r.eject_tps_1 === true;
  const eject2L = r.eject_left_tps_2 === true;
  const eject2R = r.eject_right_tps_2 === true;

  if (!tpsPower && (eject1 || eject2L || eject2R)) {
    const active = [eject1 && "Y1 (Eject TPS-1)", eject2L && "Y2 (Eject Left)", eject2R && "Y3 (Eject Right)"]
      .filter(Boolean)
      .join(", ");
    checks.push({
      id: "eject-unexpected",
      label: "Eject Coils",
      severity: "error",
      message: `${active} energized but TPS power is OFF — eject coils should not be active when system is idle. Check ladder logic.`,
    });
  }

  // ── Plate Spacing Drift ──
  const lastSpacing = typeof r.last_drop_spacing_in === "number" ? r.last_drop_spacing_in : 0;
  const avgSpacing = typeof r.avg_drop_spacing_in === "number" ? r.avg_drop_spacing_in : 0;
  const targetSpacing = typeof r.ds2 === "number" ? r.ds2 : 0;

  if (targetSpacing > 0 && lastSpacing > 0) {
    const deviation = Math.abs(lastSpacing - targetSpacing) / targetSpacing;
    if (deviation > 0.2) {
      checks.push({
        id: "spacing-drift-severe",
        label: "Plate Spacing",
        severity: "error",
        message: `Last drop spacing ${lastSpacing.toFixed(1)} in is ${(deviation * 100).toFixed(0)}% off target (DS2=${targetSpacing}) — encoder may be out of sync with plate dropper.`,
      });
    } else if (deviation > 0.1) {
      checks.push({
        id: "spacing-drift-moderate",
        label: "Plate Spacing",
        severity: "warn",
        message: `Last drop spacing ${lastSpacing.toFixed(1)} in is ${(deviation * 100).toFixed(0)}% off target (DS2=${targetSpacing}) — monitor for worsening drift.`,
      });
    }
  }

  if (avgSpacing > 0 && targetSpacing > 0) {
    const minSpacing = typeof r.min_drop_spacing_in === "number" ? r.min_drop_spacing_in : 0;
    const maxSpacing = typeof r.max_drop_spacing_in === "number" ? r.max_drop_spacing_in : 0;
    const range = maxSpacing - minSpacing;
    if (range > 0 && range / avgSpacing > 0.15) {
      checks.push({
        id: "spacing-inconsistent",
        label: "Spacing Consistency",
        severity: "warn",
        message: `Plate spacing varies from ${minSpacing.toFixed(1)} to ${maxSpacing.toFixed(1)} in (range ${range.toFixed(1)} in) — inconsistent drops may indicate encoder slipping or mechanical issue.`,
      });
    }
  }

  // ── Predictive Sync — is the next drop going to be late? ──
  const distSinceLastDrop = typeof r.distance_since_last_drop_in === "number" ? r.distance_since_last_drop_in : 0;

  if (tpsPower && targetSpacing > 0 && distSinceLastDrop > 0) {
    const pctOfTarget = distSinceLastDrop / targetSpacing;

    if (pctOfTarget > 1.2) {
      // Already 20% past where the drop should have happened — it's late
      checks.push({
        id: "drop-overdue",
        label: "Next Drop OVERDUE",
        severity: "error",
        message: `Traveled ${distSinceLastDrop.toFixed(1)} in since last drop — ${((pctOfTarget - 1) * 100).toFixed(0)}% past target of ${targetSpacing} in. Plate dropper missed or encoder lost sync.`,
      });
    } else if (pctOfTarget > 1.05) {
      // 5% past target — drop should have fired by now
      checks.push({
        id: "drop-late",
        label: "Next Drop Late",
        severity: "warn",
        message: `Traveled ${distSinceLastDrop.toFixed(1)} in since last drop — past target of ${targetSpacing} in. Drop should have fired. Possible sync lag.`,
      });
    }
  }

  // ── Uptime / Error Rate ──
  const totalReads = typeof r.total_reads === "number" ? r.total_reads : 0;
  const totalErrors = typeof r.total_errors === "number" ? r.total_errors : 0;
  if (totalReads > 100 && totalErrors / totalReads > 0.05) {
    checks.push({
      id: "high-error-rate",
      label: "Communication",
      severity: "warn",
      message: `${totalErrors} errors out of ${totalReads} reads (${((totalErrors / totalReads) * 100).toFixed(1)}%) — intermittent Modbus connection. Check Ethernet cable and switch.`,
    });
  }

  return checks;
}

const SEVERITY_ICON: Record<string, string> = {
  ok: "✓",
  warn: "⚠",
  error: "✕",
};

const SEVERITY_COLOR: Record<string, string> = {
  ok: "text-green-500",
  warn: "text-yellow-500",
  error: "text-red-500",
};

const SEVERITY_BG: Record<string, string> = {
  ok: "",
  warn: "bg-yellow-950/20",
  error: "bg-red-950/20",
};

export default function DiagnosticsPanel({ readings }: Props) {
  if (!readings) return null;

  const checks = runChecks(readings);
  const hasIssues = checks.some((c) => c.severity !== "ok");

  // Sort: errors first, then warnings, then OK
  const sorted = [...checks].sort((a, b) => {
    const order = { error: 0, warn: 1, ok: 2 };
    return order[a.severity] - order[b.severity];
  });

  return (
    <div
      className={[
        "border rounded-2xl p-4 sm:p-6",
        hasIssues
          ? "border-yellow-900/40 bg-yellow-950/5"
          : "border-gray-800",
      ].join(" ")}
    >
      <h3
        className={[
          "text-xs font-bold uppercase tracking-widest mb-3 sm:mb-4",
          hasIssues ? "text-yellow-500" : "text-gray-500",
        ].join(" ")}
      >
        System Diagnostics
        {hasIssues && (
          <span className="ml-2 text-yellow-600 normal-case tracking-normal font-normal">
            — {checks.filter((c) => c.severity === "error").length} errors,{" "}
            {checks.filter((c) => c.severity === "warn").length} warnings
          </span>
        )}
      </h3>

      <div className="space-y-1.5">
        {sorted.map((check) => (
          <div
            key={check.id}
            className={[
              "flex items-start gap-2 sm:gap-3 py-1.5 px-2 rounded-lg text-sm",
              SEVERITY_BG[check.severity],
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <span
              className={[
                "shrink-0 font-bold text-xs mt-0.5 w-4 text-center",
                SEVERITY_COLOR[check.severity],
              ].join(" ")}
            >
              {SEVERITY_ICON[check.severity]}
            </span>
            <div className="min-w-0">
              <span className="font-bold text-gray-300 text-xs sm:text-sm">
                {check.label}
              </span>
              <span className="text-gray-500 mx-1.5">—</span>
              <span
                className={[
                  "text-xs sm:text-sm",
                  check.severity === "ok"
                    ? "text-gray-600"
                    : check.severity === "warn"
                    ? "text-yellow-600"
                    : "text-red-400",
                ].join(" ")}
              >
                {check.message}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
