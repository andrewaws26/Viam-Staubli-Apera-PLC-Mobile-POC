"use client";

import { useState, useEffect } from "react";
import type { Timesheet, TimesheetStatus } from "@ironsight/shared";
import { useToast } from "@/components/Toast";
import PromptModal from "@/components/ui/PromptModal";

const STATUS_BADGE: Record<TimesheetStatus, { bg: string; text: string; label: string }> = {
  draft: { bg: "bg-gray-700", text: "text-gray-300", label: "Draft" },
  submitted: { bg: "bg-blue-900/60", text: "text-blue-300", label: "Submitted" },
  approved: { bg: "bg-green-900/60", text: "text-green-300", label: "Approved" },
  rejected: { bg: "bg-red-900/60", text: "text-red-300", label: "Rejected" },
};

interface AdminData {
  timesheets: Timesheet[];
  summary: {
    total: number;
    by_status: Record<string, number>;
    total_hours: number;
    total_nights_out: number;
    by_employee: { user_id: string; name: string; hours: number; count: number; status: string }[];
  };
}

export default function TimesheetAdmin() {
  const { toast } = useToast();
  const [data, setData] = useState<AdminData | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("submitted");
  const [weekFilter, setWeekFilter] = useState<string>("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);

  function loadData() {
    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter && statusFilter !== "all") params.set("status", statusFilter);
    if (weekFilter) params.set("week_ending", weekFilter);
    fetch(`/api/timesheets/admin?${params}`)
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(() => { toast("Failed to load timesheet admin data"); setData(null); })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadData();
  }, [statusFilter, weekFilter]);

  async function handleAction(id: string, action: "approved" | "rejected", reason?: string) {
    setActionLoading(id);
    try {
      await fetch(`/api/timesheets/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: action,
          ...(reason ? { rejection_reason: reason } : {}),
        }),
      });
      loadData();
    } catch {
      // Ignore
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <div className="max-w-6xl mx-auto">
      {/* Summary cards */}
      {data?.summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          <div className="p-4 rounded-xl bg-blue-900/20 border border-blue-800">
            <div className="text-2xl font-black text-blue-400">{data.summary.by_status.submitted || 0}</div>
            <div className="text-xs text-blue-300/70 uppercase tracking-wider mt-1">Pending Review</div>
          </div>
          <div className="p-4 rounded-xl bg-green-900/20 border border-green-800">
            <div className="text-2xl font-black text-green-400">{data.summary.by_status.approved || 0}</div>
            <div className="text-xs text-green-300/70 uppercase tracking-wider mt-1">Approved</div>
          </div>
          <div className="p-4 rounded-xl bg-purple-900/20 border border-purple-800">
            <div className="text-2xl font-black text-purple-400">{data.summary.total_hours.toFixed(1)}h</div>
            <div className="text-xs text-purple-300/70 uppercase tracking-wider mt-1">Total Hours</div>
          </div>
          <div className="p-4 rounded-xl bg-amber-900/20 border border-amber-800">
            <div className="text-2xl font-black text-amber-400">{data.summary.total_nights_out}</div>
            <div className="text-xs text-amber-300/70 uppercase tracking-wider mt-1">Nights Out</div>
          </div>
        </div>
      )}

      {/* Employee summary table */}
      {data?.summary?.by_employee && data.summary.by_employee.length > 0 && (
        <section className="mb-8 p-5 rounded-xl bg-gray-900/50 border border-gray-800">
          <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wider mb-4">By Employee</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 uppercase">
                  <th className="pb-2 pr-4">Employee</th>
                  <th className="pb-2 pr-4 text-right">Timesheets</th>
                  <th className="pb-2 text-right">Total Hours</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {data.summary.by_employee.map((emp) => (
                  <tr key={emp.user_id} className="text-gray-300">
                    <td className="py-2 pr-4 font-medium">{emp.name}</td>
                    <td className="py-2 pr-4 text-right text-gray-400">{emp.count}</td>
                    <td className="py-2 text-right font-mono text-green-400">{emp.hours.toFixed(1)}h</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="flex flex-wrap gap-2">
          {["all", "submitted", "approved", "rejected", "draft"].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors ${
                statusFilter === s
                  ? "bg-purple-600 text-white"
                  : "bg-gray-800 text-gray-400 hover:text-gray-200"
              }`}
            >
              {s === "all" ? "All" : s}
              {s !== "all" && data?.summary?.by_status && ` (${data.summary.by_status[s] || 0})`}
            </button>
          ))}
        </div>
        <input
          type="date"
          value={weekFilter}
          onChange={(e) => setWeekFilter(e.target.value)}
          className="px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-white text-xs focus:outline-none focus:border-purple-500"
          placeholder="Filter by week"
        />
        {weekFilter && (
          <button
            onClick={() => setWeekFilter("")}
            className="text-xs text-gray-500 hover:text-gray-300"
          >
            Clear date
          </button>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
        </div>
      )}

      {/* Timesheet list */}
      {!loading && data?.timesheets && (
        <div className="space-y-3">
          {data.timesheets.length === 0 && (
            <p className="text-center text-gray-500 py-12">No timesheets match the current filter.</p>
          )}

          {data.timesheets.map((ts) => {
            const badge = STATUS_BADGE[ts.status];
            const weekEnd = new Date(ts.week_ending + "T12:00:00");
            const weekStart = new Date(weekEnd);
            weekStart.setDate(weekEnd.getDate() - 6);
            const isProcessing = actionLoading === ts.id;

            return (
              <div
                key={ts.id}
                className="p-4 rounded-lg bg-gray-900 border border-gray-800"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-3 mb-1">
                      <span className="text-sm font-bold text-gray-100">{ts.user_name}</span>
                      <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase ${badge.bg} ${badge.text}`}>
                        {badge.label}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 mb-1">
                      {weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      {" - "}
                      {weekEnd.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                      {ts.railroad_working_on && (
                        <span>{ts.railroad_working_on}</span>
                      )}
                      {ts.work_location && (
                        <span>{ts.work_location}</span>
                      )}
                      {ts.coworkers.length > 0 && (
                        <span>Crew: {ts.coworkers.map((c) => c.name).join(", ")}</span>
                      )}
                      {ts.nights_out > 0 && (
                        <span>{ts.nights_out} nights out</span>
                      )}
                      {ts.chase_vehicles.length > 0 && (
                        <span>Chase: {ts.chase_vehicles.join(", ")}</span>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0 flex flex-col items-end gap-2">
                    <div>
                      <div className="text-lg font-bold text-green-400">{ts.total_hours.toFixed(1)}h</div>
                      {ts.total_travel_hours > 0 && (
                        <div className="text-xs text-blue-400">+{ts.total_travel_hours.toFixed(1)}h travel</div>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <a
                        href={`/timesheets/${ts.id}`}
                        className="px-3 py-1 rounded text-xs font-medium bg-gray-800 text-gray-300 hover:text-white hover:bg-gray-700 transition-colors"
                      >
                        View
                      </a>
                      {ts.status === "submitted" && (
                        <>
                          <button
                            onClick={() => handleAction(ts.id, "approved")}
                            disabled={isProcessing}
                            className="px-3 py-1 rounded text-xs font-medium bg-green-800 text-green-200 hover:bg-green-700 transition-colors disabled:opacity-50"
                          >
                            {isProcessing ? "..." : "Approve"}
                          </button>
                          <button
                            onClick={() => setRejectTarget(ts.id)}
                            disabled={isProcessing}
                            className="px-3 py-1 rounded text-xs font-medium bg-red-800 text-red-200 hover:bg-red-700 transition-colors disabled:opacity-50"
                          >
                            {isProcessing ? "..." : "Reject"}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <PromptModal
        open={!!rejectTarget}
        title="Rejection reason (optional)"
        placeholder="Why is this timesheet being rejected?"
        onConfirm={(reason) => {
          if (rejectTarget) handleAction(rejectTarget, "rejected", reason || undefined);
          setRejectTarget(null);
        }}
        onCancel={() => setRejectTarget(null)}
      />
    </div>
  );
}
