"use client";

/**
 * TrainingStatus — Current user's training compliance overview.
 *
 * Features:
 *   - Progress bar showing X of Y required trainings current
 *   - List of each requirement with status badge (current/expiring/expired/missing)
 *   - Days until expiry for each training
 *   - Certificate upload link where applicable
 *   - Retry on error
 */

import { useState, useEffect } from "react";
import type {
  UserTrainingStatus,
  TrainingComplianceDetail,
  TrainingComplianceStatus,
} from "@ironsight/shared";
import { COMPLIANCE_STATUS_LABELS } from "@ironsight/shared";

// ── Status badge color mapping ───────────────────────────────────────
const STATUS_STYLES: Record<TrainingComplianceStatus, { bg: string; text: string; dot: string }> = {
  current:       { bg: "bg-green-900/50",  text: "text-green-300",  dot: "bg-green-400" },
  expiring_soon: { bg: "bg-amber-900/50",  text: "text-amber-300",  dot: "bg-amber-400" },
  expired:       { bg: "bg-red-900/50",    text: "text-red-300",    dot: "bg-red-400" },
  missing:       { bg: "bg-gray-800",      text: "text-gray-400",   dot: "bg-gray-500" },
};

interface Props {
  currentUserId: string;
}

export default function TrainingStatus({ currentUserId }: Props) {
  const [status, setStatus] = useState<UserTrainingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // ── Fetch training status ───────────────────────────────────────────
  function loadStatus() {
    setLoading(true);
    setError("");
    fetch("/api/training/status")
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load training status");
        return r.json();
      })
      .then((data: UserTrainingStatus) => setStatus(data))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadStatus();
  }, []);

  // ── Loading skeleton ────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="h-20 rounded-xl bg-gray-800/50 animate-pulse" />
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-16 rounded-lg bg-gray-800/50 animate-pulse" />
        ))}
      </div>
    );
  }

  // ── Error state ─────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="max-w-3xl mx-auto text-center py-20">
        <p className="text-red-400 mb-4">{error}</p>
        <button
          onClick={loadStatus}
          className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-white text-sm font-bold uppercase tracking-wider transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!status) return null;

  // ── Progress calculation ────────────────────────────────────────────
  const progressPercent = status.total_required > 0
    ? Math.round((status.current / status.total_required) * 100)
    : 100;

  return (
    <div className="max-w-3xl mx-auto">
      {/* Overall compliance card */}
      <section className="mb-8 p-6 rounded-xl bg-gray-900/50 border border-gray-800">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-gray-100 flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-teal-400" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10.394 2.08a1 1 0 00-.788 0l-7 3a1 1 0 000 1.84L5.25 8.051a.999.999 0 01.356-.257l4-1.714a1 1 0 11.788 1.838L7.667 9.088l1.94.831a1 1 0 00.787 0l7-3a1 1 0 000-1.838l-7-3zM3.31 9.397L5 10.12v4.102a8.969 8.969 0 00-1.05-.174 1 1 0 01-.89-.89 11.115 11.115 0 01.25-3.762zM9.3 16.573A9.026 9.026 0 007 14.935v-3.957l1.818.78a3 3 0 002.364 0l5.508-2.361a11.026 11.026 0 01.25 3.762 1 1 0 01-.89.89 8.968 8.968 0 00-5.35 2.524 1 1 0 01-1.4 0z" />
            </svg>
            Training Compliance
          </h3>
          {/* Overall badge */}
          {status.is_compliant ? (
            <span className="px-3 py-1 rounded-full bg-green-900/50 border border-green-700 text-green-300 text-xs font-bold uppercase tracking-wider">
              Compliant
            </span>
          ) : (
            <span className="px-3 py-1 rounded-full bg-red-900/50 border border-red-700 text-red-300 text-xs font-bold uppercase tracking-wider">
              Non-Compliant
            </span>
          )}
        </div>

        {/* Progress bar */}
        <div className="mb-2">
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>{status.current} of {status.total_required} required trainings current</span>
            <span>{progressPercent}%</span>
          </div>
          <div className="w-full h-3 rounded-full bg-gray-800 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                progressPercent === 100 ? "bg-green-500" : progressPercent >= 70 ? "bg-amber-500" : "bg-red-500"
              }`}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        {/* Quick summary counts */}
        <div className="flex flex-wrap gap-4 mt-4 text-xs">
          {status.expiring_soon > 0 && (
            <span className="flex items-center gap-1.5 text-amber-400">
              <div className="w-2 h-2 rounded-full bg-amber-400" />
              {status.expiring_soon} expiring soon
            </span>
          )}
          {status.expired > 0 && (
            <span className="flex items-center gap-1.5 text-red-400">
              <div className="w-2 h-2 rounded-full bg-red-400" />
              {status.expired} expired
            </span>
          )}
          {status.missing > 0 && (
            <span className="flex items-center gap-1.5 text-gray-500">
              <div className="w-2 h-2 rounded-full bg-gray-500" />
              {status.missing} not completed
            </span>
          )}
        </div>
      </section>

      {/* Individual requirement list */}
      <section className="space-y-3">
        {status.details.map((detail) => (
          <TrainingDetailCard key={detail.requirement.id} detail={detail} />
        ))}
      </section>

      {/* Empty state */}
      {status.details.length === 0 && (
        <div className="text-center py-12">
          <p className="text-gray-500">No training requirements configured yet.</p>
        </div>
      )}
    </div>
  );
}

/** Individual training requirement card. */
function TrainingDetailCard({ detail }: { detail: TrainingComplianceDetail }) {
  const style = STATUS_STYLES[detail.status];
  const { requirement, latest_record, days_until_expiry } = detail;

  return (
    <div className="p-4 rounded-lg bg-gray-900 border border-gray-800 hover:border-gray-700 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            {/* Status indicator dot */}
            <div className={`w-2.5 h-2.5 rounded-full ${style.dot} shrink-0`} />
            <span className="text-sm font-bold text-gray-100">{requirement.name}</span>
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${style.bg} ${style.text}`}>
              {COMPLIANCE_STATUS_LABELS[detail.status]}
            </span>
          </div>

          {/* Description */}
          {requirement.description && (
            <p className="text-xs text-gray-500 mb-1 ml-5">{requirement.description}</p>
          )}

          {/* Completion and expiry info */}
          <div className="flex flex-wrap gap-x-4 text-xs text-gray-500 ml-5">
            {latest_record && (
              <span>
                Completed: {new Date(latest_record.completed_date + "T12:00:00").toLocaleDateString("en-US", {
                  month: "short", day: "numeric", year: "numeric",
                })}
              </span>
            )}
            {latest_record?.expiry_date && (
              <span>
                Expires: {new Date(latest_record.expiry_date + "T12:00:00").toLocaleDateString("en-US", {
                  month: "short", day: "numeric", year: "numeric",
                })}
              </span>
            )}
            {requirement.frequency_months && (
              <span>Every {requirement.frequency_months} months</span>
            )}
          </div>
        </div>

        {/* Days until expiry badge */}
        <div className="text-right shrink-0">
          {days_until_expiry !== null && detail.status !== "missing" && (
            <div className={`text-sm font-bold ${
              days_until_expiry <= 0 ? "text-red-400" :
              days_until_expiry <= 30 ? "text-amber-400" :
              "text-green-400"
            }`}>
              {days_until_expiry <= 0
                ? `${Math.abs(days_until_expiry)}d overdue`
                : `${days_until_expiry}d left`
              }
            </div>
          )}
          {detail.status === "missing" && (
            <span className="text-xs text-gray-600">Not completed</span>
          )}
          {days_until_expiry === null && detail.status === "current" && (
            <span className="text-xs text-green-500">No expiry</span>
          )}
        </div>
      </div>

      {/* Certificate link */}
      {latest_record?.certificate_url && (
        <div className="mt-2 ml-5">
          <a
            href={latest_record.certificate_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-teal-400 hover:text-teal-300 underline underline-offset-2"
          >
            View Certificate
          </a>
        </div>
      )}
    </div>
  );
}
