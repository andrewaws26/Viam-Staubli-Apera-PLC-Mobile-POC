"use client";

/**
 * TrainingAdmin — Manager view for training compliance across all employees.
 *
 * Features:
 *   - Expiring soon alert section at top
 *   - Filter: show only non-compliant, show expiring soon
 *   - Table of all employees with compliance status badge
 *   - Expandable rows showing per-requirement detail
 *   - "Log Training" button with modal form: user, requirement, date, notes
 */

import { useState, useEffect } from "react";
import type {
  UserTrainingStatus,
  TrainingRequirement,
  TrainingComplianceStatus,
  CreateTrainingRecordPayload,
} from "@ironsight/shared";
import { COMPLIANCE_STATUS_LABELS } from "@ironsight/shared";

// ── Status styles ────────────────────────────────────────────────────
const STATUS_STYLES: Record<TrainingComplianceStatus, { bg: string; text: string; dot: string }> = {
  current:       { bg: "bg-green-900/50",  text: "text-green-300",  dot: "bg-green-400" },
  expiring_soon: { bg: "bg-amber-900/50",  text: "text-amber-300",  dot: "bg-amber-400" },
  expired:       { bg: "bg-red-900/50",    text: "text-red-300",    dot: "bg-red-400" },
  missing:       { bg: "bg-gray-800",      text: "text-gray-400",   dot: "bg-gray-500" },
};

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
}

export default function TrainingAdmin() {
  // ── Data state ──────────────────────────────────────────────────────
  const [employees, setEmployees] = useState<UserTrainingStatus[]>([]);
  const [requirements, setRequirements] = useState<TrainingRequirement[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // ── Filter state ────────────────────────────────────────────────────
  const [filterMode, setFilterMode] = useState<"all" | "non_compliant" | "expiring">("all");

  // ── Expanded rows ───────────────────────────────────────────────────
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);

  // ── Log Training modal state ────────────────────────────────────────
  const [showLogModal, setShowLogModal] = useState(false);
  const [logUserId, setLogUserId] = useState("");
  const [logRequirementId, setLogRequirementId] = useState("");
  const [logDate, setLogDate] = useState(new Date().toISOString().split("T")[0]);
  const [logNotes, setLogNotes] = useState("");
  const [logSaving, setLogSaving] = useState(false);
  const [logError, setLogError] = useState("");

  // ── Load data ───────────────────────────────────────────────────────
  function loadData() {
    setLoading(true);
    setError("");

    Promise.all([
      fetch("/api/training/admin").then((r) => {
        if (!r.ok) throw new Error("Failed to load training data");
        return r.json();
      }),
      fetch("/api/training/requirements").then((r) => r.json()).catch(() => []),
      fetch("/api/team-members").then((r) => r.json()).catch(() => []),
    ])
      .then(([adminData, reqs, members]) => {
        setEmployees(Array.isArray(adminData) ? adminData : adminData.employees || []);
        setRequirements(Array.isArray(reqs) ? reqs : []);
        setTeamMembers(Array.isArray(members) ? members : []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadData();
  }, []);

  // ── Filter employees ────────────────────────────────────────────────
  const filteredEmployees = employees.filter((emp) => {
    if (filterMode === "non_compliant") return !emp.is_compliant;
    if (filterMode === "expiring") return emp.expiring_soon > 0;
    return true;
  });

  // ── Employees with expiring trainings ───────────────────────────────
  const expiringEmployees = employees.filter((e) => e.expiring_soon > 0);

  // ── Log Training handler ────────────────────────────────────────────
  async function handleLogTraining() {
    if (!logUserId || !logRequirementId || !logDate) {
      setLogError("Please fill in all required fields.");
      return;
    }

    setLogError("");
    setLogSaving(true);

    try {
      const payload: CreateTrainingRecordPayload = {
        user_id: logUserId,
        requirement_id: logRequirementId,
        completed_date: logDate,
        notes: logNotes || undefined,
      };

      const res = await fetch("/api/training/records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to log training");
      }

      // Reset form and close modal
      setShowLogModal(false);
      setLogUserId("");
      setLogRequirementId("");
      setLogDate(new Date().toISOString().split("T")[0]);
      setLogNotes("");
      loadData(); // Refresh the table
    } catch (err) {
      setLogError(err instanceof Error ? err.message : "Failed to log training");
    } finally {
      setLogSaving(false);
    }
  }

  // ── Loading state ───────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
      </div>
    );
  }

  // ── Error state ─────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="max-w-4xl mx-auto text-center py-20">
        <p className="text-red-400 mb-4">{error}</p>
        <button
          onClick={loadData}
          className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-white text-sm font-bold uppercase tracking-wider transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto">
      {/* Expiring Soon Alert */}
      {expiringEmployees.length > 0 && (
        <div className="mb-6 p-4 rounded-xl bg-amber-900/20 border border-amber-800">
          <h3 className="text-sm font-bold text-amber-300 uppercase tracking-wider mb-3 flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            Expiring Soon
          </h3>
          <div className="space-y-1">
            {expiringEmployees.map((emp) => (
              <p key={emp.user_id} className="text-sm text-amber-200">
                <span className="font-medium">{emp.user_name}</span>
                <span className="text-amber-400/70"> — {emp.expiring_soon} training{emp.expiring_soon !== 1 ? "s" : ""} expiring within 30 days</span>
              </p>
            ))}
          </div>
        </div>
      )}

      {/* Toolbar: Filters + Log Training button */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div className="flex flex-wrap gap-2">
          {(["all", "non_compliant", "expiring"] as const).map((mode) => {
            const labels = { all: "All Employees", non_compliant: "Non-Compliant", expiring: "Expiring Soon" };
            return (
              <button
                key={mode}
                onClick={() => setFilterMode(mode)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors ${
                  filterMode === mode
                    ? "bg-teal-600 text-white"
                    : "bg-gray-800 text-gray-400 hover:text-gray-200"
                }`}
              >
                {labels[mode]}
                {mode === "non_compliant" && ` (${employees.filter((e) => !e.is_compliant).length})`}
                {mode === "expiring" && ` (${expiringEmployees.length})`}
              </button>
            );
          })}
        </div>

        <button
          onClick={() => setShowLogModal(true)}
          className="min-h-[44px] px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-sm font-bold uppercase tracking-wider transition-colors"
        >
          + Log Training
        </button>
      </div>

      {/* Employee compliance table */}
      <div className="space-y-2">
        {filteredEmployees.length === 0 && (
          <p className="text-center text-gray-500 py-12">No employees match the current filter.</p>
        )}

        {filteredEmployees.map((emp) => {
          const isExpanded = expandedUserId === emp.user_id;

          return (
            <div key={emp.user_id} className="rounded-lg bg-gray-900 border border-gray-800 overflow-hidden">
              {/* Employee row */}
              <button
                onClick={() => setExpandedUserId(isExpanded ? null : emp.user_id)}
                className="w-full p-4 flex items-center justify-between gap-3 hover:bg-gray-800/50 transition-colors text-left"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {/* Expand chevron */}
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className={`w-4 h-4 text-gray-500 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                  </svg>

                  <span className="text-sm font-bold text-gray-100">{emp.user_name}</span>

                  {/* Compliance badge */}
                  {emp.is_compliant ? (
                    <span className="px-2 py-0.5 rounded text-xs font-bold uppercase bg-green-900/50 text-green-300">
                      Compliant
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded text-xs font-bold uppercase bg-red-900/50 text-red-300">
                      Non-Compliant
                    </span>
                  )}
                </div>

                {/* Summary counts */}
                <div className="flex gap-3 text-xs text-gray-500 shrink-0">
                  <span className="text-green-400">{emp.current} current</span>
                  {emp.expiring_soon > 0 && <span className="text-amber-400">{emp.expiring_soon} expiring</span>}
                  {emp.expired > 0 && <span className="text-red-400">{emp.expired} expired</span>}
                  {emp.missing > 0 && <span className="text-gray-500">{emp.missing} missing</span>}
                </div>
              </button>

              {/* Expanded details */}
              {isExpanded && emp.details.length > 0 && (
                <div className="border-t border-gray-800 px-4 pb-4">
                  <div className="space-y-2 mt-3">
                    {emp.details.map((detail) => {
                      const style = STATUS_STYLES[detail.status];
                      return (
                        <div
                          key={detail.requirement.id}
                          className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-gray-800/30"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <div className={`w-2 h-2 rounded-full ${style.dot} shrink-0`} />
                            <span className="text-sm text-gray-300">{detail.requirement.name}</span>
                            <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase ${style.bg} ${style.text}`}>
                              {COMPLIANCE_STATUS_LABELS[detail.status]}
                            </span>
                          </div>
                          <div className="text-xs text-gray-500 shrink-0">
                            {detail.days_until_expiry !== null && detail.status !== "missing" && (
                              <span className={
                                detail.days_until_expiry <= 0 ? "text-red-400" :
                                detail.days_until_expiry <= 30 ? "text-amber-400" :
                                "text-green-400"
                              }>
                                {detail.days_until_expiry <= 0
                                  ? `${Math.abs(detail.days_until_expiry)}d overdue`
                                  : `${detail.days_until_expiry}d left`
                                }
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Log Training Modal */}
      {showLogModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl bg-gray-900 border border-gray-700 shadow-2xl">
            <div className="p-6">
              <h3 className="text-lg font-bold text-gray-100 mb-6">Log Training Completion</h3>

              {logError && (
                <div className="mb-4 px-4 py-3 rounded-lg bg-red-900/50 border border-red-700 text-red-200 text-sm">
                  {logError}
                </div>
              )}

              <div className="space-y-4">
                {/* Employee selector */}
                <div>
                  <label className="block text-sm font-semibold text-gray-400 mb-2">Employee</label>
                  <select
                    value={logUserId}
                    onChange={(e) => setLogUserId(e.target.value)}
                    className="w-full px-4 py-3 rounded-lg bg-gray-800 border border-gray-700 text-white focus:outline-none focus:border-teal-500"
                  >
                    <option value="">Select employee...</option>
                    {teamMembers.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                </div>

                {/* Requirement selector */}
                <div>
                  <label className="block text-sm font-semibold text-gray-400 mb-2">Training Requirement</label>
                  <select
                    value={logRequirementId}
                    onChange={(e) => setLogRequirementId(e.target.value)}
                    className="w-full px-4 py-3 rounded-lg bg-gray-800 border border-gray-700 text-white focus:outline-none focus:border-teal-500"
                  >
                    <option value="">Select requirement...</option>
                    {requirements.map((r) => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                </div>

                {/* Completion date */}
                <div>
                  <label className="block text-sm font-semibold text-gray-400 mb-2">Completion Date</label>
                  <input
                    type="date"
                    value={logDate}
                    onChange={(e) => setLogDate(e.target.value)}
                    className="w-full px-4 py-3 rounded-lg bg-gray-800 border border-gray-700 text-white focus:outline-none focus:border-teal-500"
                  />
                </div>

                {/* Notes */}
                <div>
                  <label className="block text-sm font-semibold text-gray-400 mb-2">
                    Notes <span className="text-gray-600 font-normal">(optional)</span>
                  </label>
                  <textarea
                    value={logNotes}
                    onChange={(e) => setLogNotes(e.target.value)}
                    rows={2}
                    placeholder="Instructor, location, certificate #..."
                    className="w-full px-4 py-3 rounded-lg bg-gray-800 border border-gray-700 text-white placeholder-gray-600 focus:outline-none focus:border-teal-500 resize-none"
                  />
                </div>
              </div>

              {/* Modal actions */}
              <div className="flex gap-3 mt-6">
                <button
                  onClick={handleLogTraining}
                  disabled={logSaving}
                  className="min-h-[44px] flex-1 px-4 py-3 rounded-lg bg-teal-600 hover:bg-teal-500 text-white font-bold uppercase tracking-wider transition-colors disabled:opacity-50"
                >
                  {logSaving ? "Saving..." : "Log Training"}
                </button>
                <button
                  onClick={() => {
                    setShowLogModal(false);
                    setLogError("");
                  }}
                  className="min-h-[44px] px-4 py-3 rounded-lg border border-gray-700 hover:border-gray-500 text-gray-400 hover:text-white font-bold uppercase tracking-wider transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
