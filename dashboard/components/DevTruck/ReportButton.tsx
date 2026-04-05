"use client";

import React, { useState } from "react";

export interface ReportButtonProps {
  readings?: Record<string, unknown> | null;
  cachedHistory?: Record<string, unknown> | null;
}

export default function ReportButton({
  readings,
  cachedHistory,
}: ReportButtonProps) {
  const [reportLoading, setReportLoading] = useState(false);

  const generateReport = async () => {
    setReportLoading(true);
    const r = (readings || {}) as Record<string, unknown>;
    const now = new Date().toLocaleString();
    const protocol = r._protocol === "obd2" ? "OBD-II" : r._protocol === "j1939" ? "J1939" : "OBD-II";

    // Fetch historical data — try cloud, then cache
    let history: {
      totalPoints: number;
      totalMinutes: number;
      periodStart: string;
      periodEnd: string;
      source?: string;
      summary: Record<string, Record<string, number>>;
      dtcEvents: { timestamp: string; code: string }[];
    } | null = null;

    // Fetch from Viam Cloud Data API
    if (!history) {
      try {
        const resp = await fetch("/api/truck-history?hours=168");
        if (resp.ok) {
          const data = await resp.json();
          if (data.totalPoints > 0) history = data;
        }
      } catch {
        /* cloud unavailable */
      }
    }

    // Final fallback: cached historical data from localStorage
    if (
      !history &&
      cachedHistory &&
      (cachedHistory as Record<string, unknown>).totalPoints
    ) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      history = cachedHistory as any;
      if (history) (history as Record<string, unknown>).source = "cached";
    }

    // Generate AI health summary using live readings + historical data
    let aiSummary = "";
    try {
      const aiResp = await fetch("/api/ai-report-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ readings: r, history }),
      });
      if (aiResp.ok) {
        const aiData = await aiResp.json();
        aiSummary = aiData.summary || "";
      }
    } catch {
      /* AI summary is optional */
    }
    setReportLoading(false);

    const fmtTime = (iso: string) => new Date(iso).toLocaleString();
    const fmtNum = (v: unknown, decimals = 1) =>
      typeof v === "number" ? v.toFixed(decimals) : "\u2014";

    // SVG trend chart generator for the report
    const makeSvgChart = (
      label: string,
      data: number[],
      timestamps: string[],
      unit: string,
      color: string,
      warnLine?: number
    ) => {
      if (!data || data.length < 3) return "";

      const filtered: { v: number; t: string }[] = [];
      data.forEach((v, i) => {
        if (typeof v === "number") filtered.push({ v, t: timestamps[i] || "" });
      });
      if (filtered.length < 3) return "";

      const w = 370,
        h = 130;
      const left = 55,
        right = 10,
        top = 8,
        bottom = 28;
      const chartW = w - left - right;
      const chartH = h - top - bottom;
      const minV = Math.min(...filtered.map((d) => d.v));
      const maxV = Math.max(...filtered.map((d) => d.v));
      const range = maxV - minV || 1;
      const avgV = filtered.reduce((a, d) => a + d.v, 0) / filtered.length;

      const points = filtered
        .map((d, i) => {
          const x = left + (i / (filtered.length - 1)) * chartW;
          const y = top + (1 - (d.v - minV) / range) * chartH;
          return `${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(" ");

      const yMin = top + chartH;
      const yMax = top;
      const yAvg = top + (1 - (avgV - minV) / range) * chartH;

      let warnHtml = "";
      if (warnLine !== undefined && warnLine >= minV && warnLine <= maxV) {
        const yWarn = top + (1 - (warnLine - minV) / range) * chartH;
        warnHtml = `<line x1="${left}" y1="${yWarn}" x2="${left + chartW}" y2="${yWarn}" stroke="#ef4444" stroke-width="1" stroke-dasharray="4,3" /><text x="${left - 4}" y="${yWarn + 3}" font-size="8" fill="#ef4444" text-anchor="end">WARN</text>`;
      }

      const fmtShort = (iso: string) => {
        try {
          const d = new Date(iso);
          return d.toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
          });
        } catch {
          return "";
        }
      };
      const startLabel = fmtShort(filtered[0].t);
      const midLabel = fmtShort(filtered[Math.floor(filtered.length / 2)].t);
      const endLabel = fmtShort(filtered[filtered.length - 1].t);

      return `<div style="display:inline-block;margin:6px;vertical-align:top;width:${w}px;">
        <div style="font-size:12px;color:#1f2937;font-weight:700;margin-bottom:4px;">${label}</div>
        <svg width="${w}" height="${h}" style="background:#ffffff;border:1px solid #d1d5db;border-radius:8px;">
          <!-- Grid lines -->
          <line x1="${left}" y1="${yMax}" x2="${left + chartW}" y2="${yMax}" stroke="#e5e7eb" stroke-width="0.5" />
          <line x1="${left}" y1="${yAvg}" x2="${left + chartW}" y2="${yAvg}" stroke="#e5e7eb" stroke-width="0.5" stroke-dasharray="3,3" />
          <line x1="${left}" y1="${yMin}" x2="${left + chartW}" y2="${yMin}" stroke="#e5e7eb" stroke-width="0.5" />
          <!-- Y-axis labels -->
          <text x="${left - 4}" y="${yMax + 4}" font-size="9" fill="#6b7280" text-anchor="end" font-family="monospace">${fmtNum(maxV)}${unit}</text>
          <text x="${left - 4}" y="${yAvg + 3}" font-size="9" fill="#9ca3af" text-anchor="end" font-family="monospace">${fmtNum(avgV)}${unit}</text>
          <text x="${left - 4}" y="${yMin}" font-size="9" fill="#6b7280" text-anchor="end" font-family="monospace">${fmtNum(minV)}${unit}</text>
          ${warnHtml}
          <!-- Data line -->
          <polyline points="${points}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" />
          <!-- Time axis -->
          <text x="${left}" y="${h - 6}" font-size="9" fill="#9ca3af">${startLabel}</text>
          <text x="${left + chartW / 2}" y="${h - 6}" font-size="9" fill="#9ca3af" text-anchor="middle">${midLabel}</text>
          <text x="${left + chartW}" y="${h - 6}" font-size="9" fill="#9ca3af" text-anchor="end">${endLabel}</text>
        </svg>
      </div>`;
    };

    const historySection =
      history && history.totalPoints > 0
        ? `
<h2>Historical Data (Last ${history.totalMinutes} minutes \u2014 ${history.totalPoints} readings)</h2>
<p style="color:#6b7280;font-size:12px;">Source: ${history.source === "cached" ? "Cached (last successful fetch" + ((history as Record<string, unknown>)._cachedAt ? " at " + fmtTime(String((history as Record<string, unknown>)._cachedAt)) : "") + ")" : history.source === "offline-buffer" ? "Pi Local Buffer" : "Viam Cloud"} | Period: ${fmtTime(history.periodStart)} to ${fmtTime(history.periodEnd)}</p>

<table style="width:100%;border-collapse:collapse;font-size:13px;margin:12px 0;">
  <tr style="background:#f3f4f6;"><th style="text-align:left;padding:6px;">Parameter</th><th style="padding:6px;">Min</th><th style="padding:6px;">Avg</th><th style="padding:6px;">Max</th></tr>
  ${history.summary?.engine_rpm ? `<tr><td style="padding:4px 6px;">Engine RPM</td><td style="text-align:center;font-family:monospace;">${fmtNum(history.summary.engine_rpm.min, 0)}</td><td style="text-align:center;font-family:monospace;">${fmtNum(history.summary.engine_rpm.avg, 0)}</td><td style="text-align:center;font-family:monospace;">${fmtNum(history.summary.engine_rpm.max, 0)}</td></tr>` : ""}
  ${history.summary?.coolant_temp_f ? `<tr style="background:#fafafa;"><td style="padding:4px 6px;">Coolant Temp</td><td style="text-align:center;font-family:monospace;">${fmtNum(history.summary.coolant_temp_f.min)}\u00B0F</td><td style="text-align:center;font-family:monospace;">${fmtNum(history.summary.coolant_temp_f.avg)}\u00B0F</td><td style="text-align:center;font-family:monospace;">${fmtNum(history.summary.coolant_temp_f.max)}\u00B0F</td></tr>` : ""}
  ${history.summary?.oil_temp_f ? `<tr><td style="padding:4px 6px;">Oil Temp</td><td style="text-align:center;font-family:monospace;">\u2014</td><td style="text-align:center;font-family:monospace;">${fmtNum(history.summary.oil_temp_f.avg)}\u00B0F</td><td style="text-align:center;font-family:monospace;">${fmtNum(history.summary.oil_temp_f.max)}\u00B0F</td></tr>` : ""}
  ${history.summary?.battery_voltage_v ? `<tr style="background:#fafafa;"><td style="padding:4px 6px;">Battery Voltage</td><td style="text-align:center;font-family:monospace;">${fmtNum(history.summary.battery_voltage_v.min, 2)}V</td><td style="text-align:center;font-family:monospace;">${fmtNum(history.summary.battery_voltage_v.avg, 2)}V</td><td style="text-align:center;font-family:monospace;">${fmtNum(history.summary.battery_voltage_v.max, 2)}V</td></tr>` : ""}
  ${history.summary?.vehicle_speed_mph ? `<tr><td style="padding:4px 6px;">Vehicle Speed</td><td style="text-align:center;font-family:monospace;">\u2014</td><td style="text-align:center;font-family:monospace;">${fmtNum(history.summary.vehicle_speed_mph.avg)} mph</td><td style="text-align:center;font-family:monospace;">${fmtNum(history.summary.vehicle_speed_mph.max)} mph</td></tr>` : ""}
  ${history.summary?.short_fuel_trim_b1_pct ? `<tr style="background:#fafafa;"><td style="padding:4px 6px;">Short Fuel Trim B1</td><td style="text-align:center;font-family:monospace;">${fmtNum(history.summary.short_fuel_trim_b1_pct.min)}%</td><td style="text-align:center;font-family:monospace;">${fmtNum(history.summary.short_fuel_trim_b1_pct.avg)}%</td><td style="text-align:center;font-family:monospace;">${fmtNum(history.summary.short_fuel_trim_b1_pct.max)}%</td></tr>` : ""}
  ${history.summary?.long_fuel_trim_b1_pct ? `<tr><td style="padding:4px 6px;">Long Fuel Trim B1</td><td style="text-align:center;font-family:monospace;">${fmtNum(history.summary.long_fuel_trim_b1_pct.min)}%</td><td style="text-align:center;font-family:monospace;">${fmtNum(history.summary.long_fuel_trim_b1_pct.avg)}%</td><td style="text-align:center;font-family:monospace;">${fmtNum(history.summary.long_fuel_trim_b1_pct.max)}%</td></tr>` : ""}
  ${history.summary?.fuel_level_pct ? `<tr style="background:#fafafa;"><td style="padding:4px 6px;">Fuel Level</td><td colspan="2" style="text-align:center;font-family:monospace;">${fmtNum(history.summary.fuel_level_pct.start)}% \u2192 ${fmtNum(history.summary.fuel_level_pct.end)}%</td><td style="text-align:center;font-family:monospace;">${fmtNum(history.summary.fuel_level_pct.consumed)}% used</td></tr>` : ""}
</table>

${
  (history as Record<string, unknown>).timeSeries
    ? (() => {
        const ts = (history as Record<string, unknown>)
          .timeSeries as Record<string, unknown>[];
        const times = ts.map((p) => String(p.t || ""));
        return `
<h2>Trend Charts</h2>
<div style="display:flex;flex-wrap:wrap;justify-content:center;">
  ${makeSvgChart("Engine RPM", ts.map((p) => Number(p.rpm || 0)), times, "", "#6366f1")}
  ${makeSvgChart("Coolant Temp", ts.map((p) => Number(p.coolant_f || 0)), times, "\u00B0F", "#ef4444", 221)}
  ${makeSvgChart("Battery Voltage", ts.map((p) => Number(p.battery_v || 0)), times, "V", "#3b82f6", 12)}
  ${makeSvgChart("Vehicle Speed", ts.map((p) => Number(p.speed_mph || 0)), times, " mph", "#10b981")}
  ${makeSvgChart("Fuel Level", ts.map((p) => Number(p.fuel_pct || 0)), times, "%", "#06b6d4")}
  ${makeSvgChart("Short Fuel Trim", ts.map((p) => Number(p.short_trim || 0)), times, "%", "#f59e0b")}
</div>`;
      })()
    : ""
}

${
  history.dtcEvents && history.dtcEvents.length > 0
    ? `
<h2>DTC Events During Period</h2>
${history.dtcEvents.map((e) => `<div class="dtc"><span class="dtc-code">${e.code}</span> <span style="color:#6b7280;font-size:12px;">at ${fmtTime(e.timestamp)}</span></div>`).join("")}
`
    : ""
}
`
        : `<h2>Historical Data</h2><p style="color:#9ca3af;">No historical data available from Viam Cloud for this period. Data capture is active and will be available in future reports.</p>`;

    const html = `<!DOCTYPE html>
<html><head><title>IronSight Vehicle Diagnostic Report</title>
<style>
  body { font-family: -apple-system, Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; color: #1a1a1a; }
  h1 { font-size: 24px; border-bottom: 3px solid #2563eb; padding-bottom: 8px; }
  h2 { font-size: 16px; color: #2563eb; margin-top: 24px; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
  .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
  .badge { background: #2563eb; color: white; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: bold; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .field { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid #f3f4f6; }
  .label { color: #6b7280; font-size: 13px; }
  .value { font-weight: bold; font-family: monospace; font-size: 13px; }
  .dtc { background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 12px; margin: 8px 0; }
  .dtc-code { font-weight: bold; color: #dc2626; font-size: 16px; }
  .footer { margin-top: 30px; padding-top: 10px; border-top: 2px solid #e5e7eb; font-size: 11px; color: #9ca3af; text-align: center; }
  @media print { body { padding: 0; } }
</style></head><body>
<div class="header">
  <div>
    <h1>IronSight Vehicle Diagnostic Report</h1>
    <p style="color:#6b7280;margin:0;">Generated: ${now}</p>
    <p style="color:#6b7280;margin:4px 0;">Protocol: ${protocol} | Interface: ${r._can_interface || "can0"}</p>
  </div>
  <span class="badge">${r._bus_connected ? "LIVE" : "OFFLINE"}</span>
</div>

${(r.vehicle_vin || r.vin) ? `<p><strong>VIN:</strong> <span style="font-family:monospace">${r.vehicle_vin || r.vin}</span></p>` : ""}

<h2>Current Readings (Live Snapshot)</h2>

<h3 style="font-size:14px;color:#374151;margin-top:16px;">Engine</h3>
<div class="grid">
  ${[["RPM", r.engine_rpm, ""], ["Load", r.engine_load_pct, "%"], ["Throttle", r.throttle_position_pct, "%"], ["Timing Advance", r.timing_advance_deg, "\u00B0"], ["MAF Flow", r.maf_flow_gps, " g/s"], ["Air/Fuel Ratio", r.commanded_equiv_ratio, ""]].map(([l, v, u]) => v !== undefined ? `<div class="field"><span class="label">${l}</span><span class="value">${typeof v === "number" ? (v as number).toFixed(1) : v}${u}</span></div>` : "").join("")}
</div>

<h3 style="font-size:14px;color:#374151;margin-top:16px;">Temperatures</h3>
<div class="grid">
  ${[["Coolant", r.coolant_temp_f, "\u00B0F"], ["Oil", r.oil_temp_f, "\u00B0F"], ["Intake Air", r.intake_air_temp_f, "\u00B0F"], ["Ambient", r.ambient_temp_f, "\u00B0F"], ["Catalyst", r.catalyst_temp_b1s1_f, "\u00B0F"]].map(([l, v, u]) => v !== undefined ? `<div class="field"><span class="label">${l}</span><span class="value">${typeof v === "number" ? (v as number).toFixed(1) : v}${u}</span></div>` : "").join("")}
</div>

<h3 style="font-size:14px;color:#374151;margin-top:16px;">Pressures</h3>
<div class="grid">
  ${[["Manifold", r.boost_pressure_psi, " PSI"], ["Fuel Rail", r.fuel_pressure_psi, " PSI"], ["Barometric", r.barometric_pressure_psi, " PSI"]].map(([l, v, u]) => v !== undefined ? `<div class="field"><span class="label">${l}</span><span class="value">${typeof v === "number" ? (v as number).toFixed(1) : v}${u}</span></div>` : "").join("")}
</div>

<h3 style="font-size:14px;color:#374151;margin-top:16px;">Vehicle</h3>
<div class="grid">
  ${[["Speed", r.vehicle_speed_mph, " mph"], ["Fuel Level", r.fuel_level_pct, "%"], ["Battery", r.battery_voltage_v, "V"], ["Runtime", r.runtime_seconds, "s"]].map(([l, v, u]) => v !== undefined ? `<div class="field"><span class="label">${l}</span><span class="value">${typeof v === "number" ? (v as number).toFixed(1) : v}${u}</span></div>` : "").join("")}
</div>

<h3 style="font-size:14px;color:#374151;margin-top:16px;">Fuel System</h3>
<div class="grid">
  ${[["Short Fuel Trim B1", r.short_fuel_trim_b1_pct, "%"], ["Long Fuel Trim B1", r.long_fuel_trim_b1_pct, "%"], ["Distance w/ MIL", r.distance_with_mil_mi, " mi"], ["Distance Since Clear", r.distance_since_clear_mi, " mi"], ["Time Since Clear", r.time_since_clear_min, " min"], ["Warmups Since Clear", r.warmup_cycles_since_clear, ""]].map(([l, v, u]) => v !== undefined ? `<div class="field"><span class="label">${l}</span><span class="value">${typeof v === "number" ? (v as number).toFixed(1) : v}${u}</span></div>` : "").join("")}
</div>

<h2>Trouble Codes</h2>
${
  (r.active_dtc_count as number) > 0
    ? Array.from({ length: Math.min(r.active_dtc_count as number, 5) })
        .map((_, i) => {
          const code = r[("obd2_dtc_" + i) as string] as string;
          return code
            ? `<div class="dtc"><span class="dtc-code">${code}</span></div>`
            : "";
        })
        .join("")
    : "<p style='color:#16a34a'>No active trouble codes</p>"
}

${historySection}

${aiSummary ? `<h2>AI Vehicle Health Summary</h2><div style="white-space:pre-wrap;font-size:13px;line-height:1.6;background:#f0f9ff;padding:16px;border-radius:8px;border:1px solid #bae6fd;">${aiSummary}</div>` : ""}

<div class="footer">
  <p>IronSight Fleet Diagnostics Platform | Data stored and queried from Viam Cloud</p>
  <p>Pi Zero 2W + MCP2515 CAN HAT | ${protocol} at ${r._can_interface || "can0"}</p>
</div>
</body></html>`;

    const win = window.open("", "_blank");
    if (win) {
      win.document.write(html);
      win.document.close();
      setTimeout(() => win.print(), 500);
    }
  };

  return (
    <div className="flex justify-end mt-3">
      <button
        onClick={generateReport}
        disabled={reportLoading}
        className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider bg-blue-900/50 hover:bg-blue-800 text-blue-300 border border-blue-700/50 transition-colors disabled:opacity-50 min-h-[44px]"
      >
        {reportLoading
          ? "Loading history..."
          : "\u{1F4C4} Generate Report"}
      </button>
    </div>
  );
}
