// InsightsPanel.tsx — "Cell Intelligence" panel that turns raw sensor data
// into human-readable insights. The "so what?" layer for operators.
// Receives pre-computed insights and shift summary as props from CellSection.
"use client";

import { useState } from "react";
import type { Insight, InsightSeverity, ShiftSummary, ShiftStatus } from "@/lib/insights-engine";

// ---------------------------------------------------------------------------
// Status color maps
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<ShiftStatus, { bg: string; text: string; border: string; dot: string }> = {
  EXCELLENT: { bg: "bg-emerald-950/40", text: "text-emerald-400", border: "border-emerald-800/50", dot: "bg-emerald-500" },
  GOOD:      { bg: "bg-blue-950/40",    text: "text-blue-400",    border: "border-blue-800/50",    dot: "bg-blue-500" },
  CONCERNING:{ bg: "bg-orange-950/40",   text: "text-orange-400",  border: "border-orange-800/50",  dot: "bg-orange-500" },
  CRITICAL:  { bg: "bg-red-950/40",      text: "text-red-400",     border: "border-red-800/50",     dot: "bg-red-500 animate-pulse" },
};

const SEVERITY_DOT: Record<InsightSeverity, string> = {
  good:     "bg-emerald-500",
  info:     "bg-blue-500",
  warning:  "bg-orange-500",
  critical: "bg-red-500",
};

const SEVERITY_BORDER: Record<InsightSeverity, string> = {
  good:     "border-gray-800/50",
  info:     "border-blue-900/40",
  warning:  "border-orange-900/40",
  critical: "border-red-900/40",
};

const SEVERITY_BG: Record<InsightSeverity, string> = {
  good:     "bg-gray-900/30",
  info:     "bg-blue-950/20",
  warning:  "bg-orange-950/20",
  critical: "bg-red-950/20",
};

const CATEGORY_COLORS: Record<string, string> = {
  TREND:       "bg-purple-900/40 text-purple-400 border-purple-800/50",
  BASELINE:    "bg-gray-800/40 text-gray-400 border-gray-700/50",
  CORRELATION: "bg-cyan-900/40 text-cyan-400 border-cyan-800/50",
  ANOMALY:     "bg-amber-900/40 text-amber-400 border-amber-800/50",
};

const TREND_ARROW: Record<string, string> = {
  rising:  "\u2191",
  falling: "\u2193",
  stable:  "\u2192",
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ShiftMetric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex flex-col items-center min-w-0 px-2">
      <span className="text-xs text-gray-500 uppercase tracking-wide truncate">{label}</span>
      <span className={`font-mono text-sm sm:text-base font-bold ${color || "text-gray-200"}`}>{value}</span>
    </div>
  );
}

function InsightCard({ insight }: { insight: Insight }) {
  return (
    <div className={`flex items-start gap-3 p-3 rounded-lg border ${SEVERITY_BG[insight.severity]} ${SEVERITY_BORDER[insight.severity]}`}>
      {/* Left: severity dot */}
      <div className="pt-1 shrink-0">
        <span className={`block w-2.5 h-2.5 rounded-full ${SEVERITY_DOT[insight.severity]}`} />
      </div>

      {/* Center: content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${CATEGORY_COLORS[insight.category] || CATEGORY_COLORS.BASELINE}`}>
            {insight.category}
          </span>
        </div>
        <h4 className="text-sm font-semibold text-gray-200 leading-tight">{insight.title}</h4>
        <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{insight.detail}</p>
        {insight.baseline && (
          <p className="text-[10px] text-gray-600 mt-1 font-mono">Normal: {insight.baseline}</p>
        )}
      </div>

      {/* Right: metric value + trend */}
      {insight.value && (
        <div className="shrink-0 text-right">
          <div className="flex items-center gap-1 justify-end">
            <span className="font-mono text-sm font-bold text-gray-200">{insight.value}</span>
            {insight.trend && (
              <span className={`text-xs ${
                insight.trend === "rising" ? "text-orange-400" :
                insight.trend === "falling" ? "text-blue-400" :
                "text-gray-500"
              }`}>
                {TREND_ARROW[insight.trend]}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

interface Props {
  insights: Insight[];
  shift: ShiftSummary;
}

export default function InsightsPanel({ insights, shift }: Props) {
  const [showGood, setShowGood] = useState(false);

  const statusStyle = STATUS_COLORS[shift.status];

  // Group by severity
  const critical = insights.filter((i) => i.severity === "critical");
  const warnings = insights.filter((i) => i.severity === "warning");
  const info = insights.filter((i) => i.severity === "info");
  const good = insights.filter((i) => i.severity === "good");
  const visible = [...critical, ...warnings, ...info];

  return (
    <section className="border border-gray-800 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="p-4 sm:p-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${statusStyle.dot}`} />
          <h2 className="text-xs font-bold uppercase tracking-widest text-gray-400">
            Cell Intelligence
          </h2>
        </div>
        <span className={`px-2 py-0.5 rounded text-xs font-bold border ${statusStyle.bg} ${statusStyle.text} ${statusStyle.border}`}>
          {shift.status}
        </span>
      </div>

      <div className="px-4 sm:px-6 pb-4 sm:pb-6 space-y-5">
        {/* ---- Shift Summary Card ---- */}
        <div className={`p-4 rounded-xl border ${statusStyle.bg} ${statusStyle.border}`}>
          <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-6">
            <ShiftMetric
              label="Uptime"
              value={`${shift.uptime_pct.toFixed(0)}%`}
              color={shift.uptime_pct >= 95 ? "text-emerald-400" : shift.uptime_pct >= 80 ? "text-orange-400" : "text-red-400"}
            />
            <ShiftMetric label="Parts" value={shift.parts_sorted.toLocaleString()} />
            <ShiftMetric
              label="Downtime"
              value={shift.downtime_minutes > 0 ? `${shift.downtime_minutes}m` : "0m"}
              color={shift.downtime_minutes > 0 ? "text-orange-400" : "text-gray-200"}
            />
            <ShiftMetric
              label="Thermal"
              value={String(shift.thermal_events)}
              color={shift.thermal_events > 0 ? "text-orange-400" : "text-gray-200"}
            />
            <ShiftMetric
              label="Safety"
              value={String(shift.safety_stops)}
              color={shift.safety_stops > 0 ? "text-red-400" : "text-gray-200"}
            />
          </div>
          {shift.top_concern !== "No concerns" && (
            <div className="mt-3 text-center">
              <p className="text-xs text-gray-400">
                <span className="text-gray-600">Top concern: </span>
                <span className={statusStyle.text}>{shift.top_concern}</span>
              </p>
            </div>
          )}
        </div>

        {/* ---- Insights List ---- */}
        <div>
          <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3 border-b border-gray-800/50 pb-1">
            Insights
          </h3>

          {visible.length > 0 ? (
            <div className="space-y-2">
              {visible.map((insight) => (
                <InsightCard key={insight.id} insight={insight} />
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-600">No active warnings or issues.</p>
          )}

          {/* Collapsed good insights */}
          {good.length > 0 && (
            <div className="mt-3">
              <button
                onClick={() => setShowGood(!showGood)}
                className="text-xs text-gray-500 hover:text-gray-400 uppercase tracking-wider transition-colors"
              >
                {showGood ? "\u25BC" : "\u25B6"} {showGood ? "Hide" : "Show"} {good.length} healthy signal{good.length !== 1 ? "s" : ""}
              </button>
              {showGood && (
                <div className="space-y-2 mt-2">
                  {good.map((insight) => (
                    <InsightCard key={insight.id} insight={insight} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
