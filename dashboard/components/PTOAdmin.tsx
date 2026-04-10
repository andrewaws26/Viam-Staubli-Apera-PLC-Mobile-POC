"use client";

/**
 * PTOAdmin — Manager dashboard for PTO request management.
 *
 * Features:
 *   - Summary stat cards: pending count, approved this month, total hours
 *   - Pending approval queue with approve/reject + manager notes
 *   - Employee PTO usage table (vacation/sick/personal used & remaining)
 *   - Simple calendar view showing who's out by date range
 */

import { useState, useEffect } from "react";
import type { PTORequest, PTOStatus, PTOAdminResponse } from "@ironsight/shared";
import { PTO_TYPE_LABELS, PTO_STATUS_LABELS } from "@ironsight/shared";

// ── Status badge styles ──────────────────────────────────────────────
const STATUS_BADGE: Record<PTOStatus, { bg: string; text: string }> = {
  pending:   { bg: "bg-amber-900/60",  text: "text-amber-300" },
  approved:  { bg: "bg-green-900/60",  text: "text-green-300" },
  rejected:  { bg: "bg-red-900/60",    text: "text-red-300" },
  cancelled: { bg: "bg-gray-700",      text: "text-gray-400" },
};

export default function PTOAdmin() {
  const [data, setData] = useState<PTOAdminResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [managerNotes, setManagerNotes] = useState<Record<string, string>>({});

  // ── Load admin data ─────────────────────────────────────────────────
  function loadData() {
    setLoading(true);
    fetch("/api/pto/admin")
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load PTO admin data");
        return r.json();
      })
      .then((d) => setData(d))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadData();
  }, []);

  // ── Approve or reject a request ────────────────────────────────────
  async function handleAction(id: string, action: "approved" | "rejected") {
    setActionLoading(id);
    try {
      await fetch(`/api/pto/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: action,
          manager_notes: managerNotes[id] || undefined,
        }),
      });
      // Clear notes for this request and reload
      setManagerNotes((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      loadData();
    } catch {
      // Silently fail — user can retry
    } finally {
      setActionLoading(null);
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
          className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-800/50 text-white text-sm font-bold uppercase tracking-wider transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  // Derive pending requests from the full list
  const pendingRequests = data.requests.filter((r) => r.status === "pending");

  return (
    <div className="max-w-6xl mx-auto">
      {/* Summary stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-8">
        <div className="p-4 rounded-xl bg-amber-900/20 border border-amber-800">
          <div className="text-2xl font-black text-amber-400">{data.summary.pending_count}</div>
          <div className="text-xs text-amber-300/70 uppercase tracking-wider mt-1">Pending Approval</div>
        </div>
        <div className="p-4 rounded-xl bg-green-900/20 border border-green-800">
          <div className="text-2xl font-black text-green-400">{data.summary.approved_this_month}</div>
          <div className="text-xs text-green-300/70 uppercase tracking-wider mt-1">Approved This Month</div>
        </div>
        <div className="p-4 rounded-xl bg-rose-900/20 border border-rose-800">
          <div className="text-2xl font-black text-rose-400">{data.summary.total}</div>
          <div className="text-xs text-rose-300/70 uppercase tracking-wider mt-1">Total Requests</div>
        </div>
      </div>

      {/* Pending Approval Queue */}
      <section className="mb-8 p-5 rounded-xl bg-gray-900/50 border border-gray-800">
        <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wider mb-4 flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-amber-400" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.828a1 1 0 101.415-1.414L11 9.586V6z" clipRule="evenodd" />
          </svg>
          Pending Approval
        </h3>

        {pendingRequests.length === 0 ? (
          <p className="text-gray-500 text-sm py-4">No pending requests. All caught up!</p>
        ) : (
          <div className="space-y-3">
            {pendingRequests.map((req) => {
              const startFormatted = new Date(req.start_date + "T12:00:00").toLocaleDateString("en-US", {
                month: "short", day: "numeric",
              });
              const endFormatted = new Date(req.end_date + "T12:00:00").toLocaleDateString("en-US", {
                month: "short", day: "numeric", year: "numeric",
              });
              const isProcessing = actionLoading === req.id;

              return (
                <div key={req.id} className="p-4 rounded-lg bg-gray-800/50 border border-gray-800/60">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-bold text-gray-100">{req.user_name}</span>
                        <span className="px-2 py-0.5 rounded text-xs font-bold uppercase bg-blue-900/50 text-blue-300">
                          {PTO_TYPE_LABELS[req.pto_type]}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500">
                        {startFormatted} - {endFormatted} ({req.hours}h)
                      </p>
                      {req.notes && (
                        <p className="text-xs text-gray-400 mt-1">{req.notes}</p>
                      )}
                    </div>
                    <div className="text-lg font-bold text-rose-400 shrink-0">{req.hours}h</div>
                  </div>

                  {/* Manager notes input + action buttons */}
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      value={managerNotes[req.id] || ""}
                      onChange={(e) => setManagerNotes((prev) => ({ ...prev, [req.id]: e.target.value }))}
                      placeholder="Manager notes (optional)..."
                      className="flex-1 px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-rose-500"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleAction(req.id, "approved")}
                        disabled={isProcessing}
                        className="min-h-[44px] px-4 py-2 rounded-lg bg-green-700 hover:bg-green-600 text-white text-sm font-bold uppercase tracking-wider transition-colors disabled:opacity-50"
                      >
                        {isProcessing ? "..." : "Approve"}
                      </button>
                      <button
                        onClick={() => handleAction(req.id, "rejected")}
                        disabled={isProcessing}
                        className="min-h-[44px] px-4 py-2 rounded-lg bg-red-700 hover:bg-red-600 text-white text-sm font-bold uppercase tracking-wider transition-colors disabled:opacity-50"
                      >
                        {isProcessing ? "..." : "Reject"}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Employee PTO Usage Table */}
      {data.summary.by_employee.length > 0 && (
        <section className="mb-8 p-5 rounded-xl bg-gray-900/50 border border-gray-800">
          <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wider mb-4">Employee PTO Usage</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 uppercase">
                  <th className="pb-3 pr-4">Employee</th>
                  <th className="pb-3 pr-4 text-center">Pending</th>
                  <th className="pb-3 pr-4 text-center">Approved Hours</th>
                  <th className="pb-3 text-center">Total Requests</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {data.summary.by_employee.map((emp) => (
                  <tr key={emp.user_id} className="text-gray-300">
                    <td className="py-2.5 pr-4 font-medium">{emp.name}</td>
                    <td className="py-2.5 pr-4 text-center font-mono text-amber-400">{emp.pending}</td>
                    <td className="py-2.5 pr-4 text-center font-mono text-green-400">{emp.approved_hours}h</td>
                    <td className="py-2.5 text-center font-mono text-gray-400">{emp.total_requests}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Upcoming Out Calendar */}
      {data.upcoming.length > 0 && (
        <section className="mb-8 p-5 rounded-xl bg-gray-900/50 border border-gray-800">
          <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wider mb-4 flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-rose-400" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd" />
            </svg>
            Who&apos;s Out
          </h3>

          <div className="space-y-2">
            {data.upcoming.map((req) => {
              const start = new Date(req.start_date + "T12:00:00");
              const end = new Date(req.end_date + "T12:00:00");
              const startLabel = start.toLocaleDateString("en-US", { month: "short", day: "numeric" });
              const endLabel = end.toLocaleDateString("en-US", { month: "short", day: "numeric" });

              return (
                <div key={req.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-gray-800/30">
                  {/* Color bar representing date range */}
                  <div className="w-1 h-8 rounded-full bg-rose-500 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <span className="text-sm font-medium text-gray-200">{req.user_name}</span>
                    <span className="text-xs text-gray-500 ml-2">
                      {startLabel} - {endLabel}
                    </span>
                  </div>
                  <span className="px-2 py-0.5 rounded text-xs font-bold uppercase bg-rose-900/40 text-rose-300 shrink-0">
                    {PTO_TYPE_LABELS[req.pto_type]}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
