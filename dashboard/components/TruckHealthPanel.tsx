"use client";

/**
 * TruckHealthPanel -- At-a-glance engine health visualization.
 *
 * Shows overall health badge, 7 expandable category cards, per-metric
 * bar charts with deviation highlights, and data quality footer.
 * Built on top of the baseline assessment from lib/truck-baseline.ts.
 */

import React from "react";
import type {
  TruckHealth,
  CategoryHealth,
  MetricHealth,
  HealthStatus,
} from "@/lib/truck-baseline";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  health: TruckHealth | null;
  loading?: boolean;
}

// ---------------------------------------------------------------------------
// Status color helpers
// ---------------------------------------------------------------------------

function statusDotColor(status: HealthStatus): string {
  switch (status) {
    case "critical": return "bg-red-500";
    case "warning":  return "bg-orange-500";
    case "watch":    return "bg-yellow-500";
    case "good":     return "bg-emerald-500";
    default:         return "bg-gray-600";
  }
}

function statusBadgeClasses(status: HealthStatus): string {
  switch (status) {
    case "critical": return "bg-red-500/20 text-red-400 border-red-500/40";
    case "warning":  return "bg-orange-500/20 text-orange-400 border-orange-500/40";
    case "watch":    return "bg-yellow-500/20 text-yellow-400 border-yellow-500/40";
    case "good":     return "bg-emerald-500/20 text-emerald-400 border-emerald-500/40";
    default:         return "bg-gray-500/20 text-gray-400 border-gray-500/40";
  }
}

function statusLabel(status: HealthStatus): string {
  switch (status) {
    case "critical": return "CRITICAL";
    case "warning":  return "WARNING";
    case "watch":    return "WATCH";
    case "good":     return "HEALTHY";
    default:         return "NO DATA";
  }
}

function deviationTextColor(status: HealthStatus): string {
  switch (status) {
    case "critical": return "text-red-400";
    case "warning":  return "text-orange-400";
    case "watch":    return "text-yellow-400/70";
    case "good":     return "text-gray-500";
    default:         return "text-gray-600";
  }
}

// ---------------------------------------------------------------------------
// MetricBar -- range visualization for a single metric
// ---------------------------------------------------------------------------

function MetricBar({ metric }: { metric: MetricHealth }) {
  const { baseline, value, status } = metric;
  if (value === null || typeof value !== "number") return null;

  const bMin = baseline.min;
  const bMax = baseline.max;

  // Determine the full scale for the bar
  const critH = baseline.critHigh;
  const critL = baseline.critLow;
  const rangeSpan = bMax - bMin;
  const padding = Math.max(rangeSpan * 0.5, 1);
  const scaleMin = critL !== undefined ? Math.min(critL, bMin - padding) : bMin - padding;
  const scaleMax = critH !== undefined ? Math.max(critH, bMax + padding) : bMax + padding;
  const scaleSpan = scaleMax - scaleMin || 1;

  // Position helpers: percent of full bar
  const toPos = (v: number) => Math.max(0, Math.min(100, ((v - scaleMin) / scaleSpan) * 100));

  const greenLeft = toPos(bMin);
  const greenRight = toPos(bMax);
  const greenWidth = greenRight - greenLeft;
  const valuePos = toPos(value);

  // Bar color for the current value marker
  let markerColor: string;
  switch (status) {
    case "critical": markerColor = "bg-red-500"; break;
    case "warning":  markerColor = "bg-orange-500"; break;
    case "watch":    markerColor = "bg-yellow-500"; break;
    default:         markerColor = "bg-emerald-500"; break;
  }

  return (
    <div className="relative h-3 w-full bg-gray-800 rounded-full overflow-hidden">
      {/* Green zone: observed normal range */}
      <div
        className="absolute top-0 h-full bg-emerald-900/50 rounded-full"
        style={{ left: `${greenLeft}%`, width: `${greenWidth}%` }}
      />

      {/* Warn low threshold mark */}
      {baseline.warnLow !== undefined && (
        <div
          className="absolute top-0 h-full w-px bg-yellow-600/60"
          style={{ left: `${toPos(baseline.warnLow)}%` }}
        />
      )}
      {/* Warn high threshold mark */}
      {baseline.warnHigh !== undefined && (
        <div
          className="absolute top-0 h-full w-px bg-yellow-600/60"
          style={{ left: `${toPos(baseline.warnHigh)}%` }}
        />
      )}
      {/* Crit low threshold mark */}
      {baseline.critLow !== undefined && (
        <div
          className="absolute top-0 h-full w-px bg-red-600/60"
          style={{ left: `${toPos(baseline.critLow)}%` }}
        />
      )}
      {/* Crit high threshold mark */}
      {baseline.critHigh !== undefined && (
        <div
          className="absolute top-0 h-full w-px bg-red-600/60"
          style={{ left: `${toPos(baseline.critHigh)}%` }}
        />
      )}

      {/* Current value marker */}
      <div
        className={`absolute top-0 h-full w-1.5 rounded-full ${markerColor} shadow-sm shadow-black/40`}
        style={{ left: `calc(${valuePos}% - 3px)` }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// MetricRow -- single metric display
// ---------------------------------------------------------------------------

function MetricRow({ metric }: { metric: MetricHealth }) {
  const { label, value, unit, status, deviation } = metric;
  const displayValue =
    value === null
      ? "--"
      : typeof value === "number"
        ? `${value}${unit.startsWith("\u00B0") || unit === "%" ? "" : " "}${unit}`
        : String(value);

  const showDeviation = status !== "good" || (deviation !== "normal" && deviation !== "no data" && deviation !== "at average");

  return (
    <div className="py-2 px-1">
      <div className="flex items-center gap-2 mb-1">
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${statusDotColor(status)}`} />
        <span className="text-xs text-gray-300 flex-1 min-w-0 truncate">{label}</span>
        <span className="font-mono text-xs text-gray-100 flex-shrink-0 tabular-nums">{displayValue}</span>
      </div>
      {value !== null && typeof value === "number" && (
        <div className="ml-4 mb-1">
          <MetricBar metric={metric} />
        </div>
      )}
      {showDeviation && (
        <div className={`ml-4 text-[10px] leading-tight ${deviationTextColor(status)}`}>
          {status === "critical" && "CRITICAL: "}{deviation}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CategoryCard -- expandable card for one health category
// ---------------------------------------------------------------------------

function CategoryCard({ cat }: { cat: CategoryHealth }) {
  const [expanded, setExpanded] = React.useState(true);
  const metricsWithData = cat.metrics.filter((m) => m.status !== "no_data");
  const issueCount = metricsWithData.filter(
    (m) => m.status !== "good",
  ).length;

  return (
    <div className="border border-gray-800 rounded-2xl bg-gray-950/60 overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-gray-800/40 transition-colors"
      >
        <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${statusDotColor(cat.status)}`} />
        <span className="text-xs uppercase tracking-widest text-gray-300 font-medium flex-1 text-left">
          {cat.label}
        </span>
        <span
          className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${statusBadgeClasses(
            cat.status,
          )}`}
        >
          {statusLabel(cat.status)}
        </span>
        <span className="text-[10px] text-gray-500 tabular-nums">
          {metricsWithData.length} metric{metricsWithData.length !== 1 ? "s" : ""}
          {issueCount > 0 && (
            <span className="text-orange-400 ml-1">
              ({issueCount} issue{issueCount !== 1 ? "s" : ""})
            </span>
          )}
        </span>
        <svg
          className={`w-3.5 h-3.5 text-gray-500 transform transition-transform ${
            expanded ? "rotate-180" : ""
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Metrics */}
      {expanded && metricsWithData.length > 0 && (
        <div className="border-t border-gray-800/60 px-2 pb-1 divide-y divide-gray-800/40">
          {metricsWithData.map((m) => (
            <MetricRow key={m.key} metric={m} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FindingsSection -- notable findings from the assessment
// ---------------------------------------------------------------------------

function FindingsSection({ findings }: { findings: string[] }) {
  if (findings.length === 0) return null;

  return (
    <div className="border border-gray-800 rounded-2xl bg-gray-950/60 p-3 mt-3">
      <h3 className="text-xs uppercase tracking-widest text-gray-400 font-medium mb-2">
        Findings
      </h3>
      <ul className="space-y-1.5">
        {findings.map((f, i) => (
          <li key={i} className="flex gap-2 text-xs text-gray-300 leading-relaxed">
            <span className="text-yellow-500 flex-shrink-0 mt-0.5">*</span>
            <span>{f}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function LoadingSkeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      <div className="border border-gray-800 rounded-2xl bg-gray-950/60 p-4">
        <div className="h-6 w-24 bg-gray-800 rounded-full mb-2" />
        <div className="h-4 w-64 bg-gray-800/60 rounded mb-1" />
        <div className="h-3 w-40 bg-gray-800/40 rounded" />
      </div>
      {[1, 2, 3].map((i) => (
        <div key={i} className="border border-gray-800 rounded-2xl bg-gray-950/60 p-3">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-gray-800" />
            <div className="h-3 w-28 bg-gray-800 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TruckHealthPanel -- main export
// ---------------------------------------------------------------------------

export default function TruckHealthPanel({ health, loading }: Props) {
  if (loading) {
    return (
      <div className="mb-4">
        <LoadingSkeleton />
      </div>
    );
  }

  if (!health) return null;

  return (
    <div className="mb-4 space-y-3">
      {/* Overall Status Card */}
      <div className="border border-gray-800 rounded-2xl bg-gray-950/60 p-4">
        <div className="flex items-center gap-3 mb-2">
          <span
            className={`text-xs font-bold px-3 py-1 rounded-full border ${statusBadgeClasses(
              health.overall,
            )}`}
          >
            {statusLabel(health.overall)}
          </span>
          <span className={`w-2 h-2 rounded-full ${statusDotColor(health.overall)} ${
            health.overall === "critical" ? "animate-pulse" : ""
          }`} />
        </div>
        <p className="text-sm text-gray-200 leading-relaxed mb-1.5">
          {health.overall_summary}
        </p>
        <p className="text-[10px] text-gray-500">
          Based on {health.data_quality.points_available.toLocaleString()} data points
        </p>
      </div>

      {/* Category Cards */}
      {health.categories.map((cat) => (
        <CategoryCard key={cat.category} cat={cat} />
      ))}

      {/* Findings */}
      <FindingsSection findings={health.findings} />

      {/* Data Quality Footer */}
      <p className="text-[10px] text-gray-600 text-center px-2 leading-relaxed">
        Baseline: {health.data_quality.points_available.toLocaleString()} readings | {health.data_quality.coverage} (no driving) | {health.data_quality.last_data} | {health.data_quality.baseline_source.split(",")[0]}
      </p>
    </div>
  );
}
