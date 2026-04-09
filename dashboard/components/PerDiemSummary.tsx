"use client";

/**
 * PerDiemSummary — Per diem summary with date range filtering.
 *
 * Per diem is auto-calculated from approved timesheets (nights_out, layovers).
 *
 * Features:
 *   - Date range selector (defaults to current month)
 *   - Summary cards: total nights, total layovers, total amount
 *   - Table of per diem entries with week ending, nights, layovers, amounts
 *   - Manager: user selector to view any employee's per diem
 */

import { useState, useEffect } from "react";
import type { PerDiemSummary as PerDiemSummaryType, PerDiemEntry } from "@ironsight/shared";
import { useToast } from "@/components/Toast";

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface Props {
  currentUserId: string;
  currentUserRole: string;
}

/** Get first day of current month as YYYY-MM-DD. */
function getMonthStart(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split("T")[0];
}

/** Get last day of current month as YYYY-MM-DD. */
function getMonthEnd(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().split("T")[0];
}

export default function PerDiemSummary({ currentUserId, currentUserRole }: Props) {
  const { toast } = useToast();
  const isManager = currentUserRole === "developer" || currentUserRole === "manager";

  // ── Filter state ────────────────────────────────────────────────────
  const [startDate, setStartDate] = useState(getMonthStart());
  const [endDate, setEndDate] = useState(getMonthEnd());
  const [selectedUserId, setSelectedUserId] = useState("");

  // ── Data state ──────────────────────────────────────────────────────
  const [summary, setSummary] = useState<PerDiemSummaryType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);

  // ── Load team members for manager user picker ───────────────────────
  useEffect(() => {
    if (!isManager) return;
    fetch("/api/team-members")
      .then((r) => r.json())
      .then((data) => setTeamMembers(Array.isArray(data) ? data : []))
      .catch(() => toast("Failed to load team members"));
  }, [isManager]);

  // ── Load per diem data ──────────────────────────────────────────────
  function loadSummary() {
    setLoading(true);
    setError("");

    const params = new URLSearchParams();
    params.set("start_date", startDate);
    params.set("end_date", endDate);
    if (selectedUserId) params.set("user_id", selectedUserId);

    fetch(`/api/per-diem?${params}`)
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load per diem data");
        return r.json();
      })
      .then((data: PerDiemSummaryType) => setSummary(data))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadSummary();
  }, [startDate, endDate, selectedUserId]);

  return (
    <div className="max-w-4xl mx-auto">
      {/* Date range selector + user picker */}
      <section className="mb-6 p-4 rounded-xl bg-gray-900/50 border border-gray-800">
        <div className="flex flex-col sm:flex-row items-start sm:items-end gap-4">
          <div className="flex gap-3 flex-1">
            <div>
              <label className="block text-[10px] text-gray-500 mb-1 uppercase tracking-wider">From</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:border-purple-500"
              />
            </div>
            <div>
              <label className="block text-[10px] text-gray-500 mb-1 uppercase tracking-wider">To</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:border-purple-500"
              />
            </div>
          </div>

          {/* Manager-only: user selector */}
          {isManager && teamMembers.length > 0 && (
            <div className="w-full sm:w-auto">
              <label className="block text-[10px] text-gray-500 mb-1 uppercase tracking-wider">Employee</label>
              <select
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
                className="w-full sm:w-48 px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:border-purple-500"
              >
                <option value="">My Per Diem</option>
                {teamMembers.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </section>

      {/* Error state */}
      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-red-900/50 border border-red-700 text-red-200 text-sm flex items-center justify-between">
          <span>{error}</span>
          <button
            onClick={loadSummary}
            className="text-red-400 hover:text-white ml-4 text-xs font-bold uppercase"
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
        </div>
      )}

      {!loading && summary && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-3 gap-4 mb-8">
            <div className="p-4 rounded-xl bg-indigo-900/20 border border-indigo-800">
              <div className="text-2xl font-black text-indigo-400">{summary.total_nights}</div>
              <div className="text-xs text-indigo-300/70 uppercase tracking-wider mt-1">Total Nights</div>
            </div>
            <div className="p-4 rounded-xl bg-purple-900/20 border border-purple-800">
              <div className="text-2xl font-black text-purple-400">{summary.total_layovers}</div>
              <div className="text-xs text-purple-300/70 uppercase tracking-wider mt-1">Total Layovers</div>
            </div>
            <div className="p-4 rounded-xl bg-green-900/20 border border-green-800">
              <div className="text-2xl font-black text-green-400">
                ${summary.total_amount.toFixed(2)}
              </div>
              <div className="text-xs text-green-300/70 uppercase tracking-wider mt-1">Total Amount</div>
            </div>
          </div>

          {/* Per diem entries table */}
          {summary.entries.length > 0 ? (
            <section className="p-5 rounded-xl bg-gray-900/50 border border-gray-800">
              <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wider mb-4">Per Diem Entries</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 uppercase">
                      <th className="pb-3 pr-4">Week Ending</th>
                      <th className="pb-3 pr-4 text-right">Nights</th>
                      <th className="pb-3 pr-4 text-right">Nights Amt</th>
                      <th className="pb-3 pr-4 text-right">Layovers</th>
                      <th className="pb-3 pr-4 text-right">Layover Amt</th>
                      <th className="pb-3 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                    {summary.entries.map((entry) => (
                      <tr key={entry.id} className="text-gray-300">
                        <td className="py-2.5 pr-4 font-medium">
                          {new Date(entry.week_ending + "T12:00:00").toLocaleDateString("en-US", {
                            month: "short", day: "numeric", year: "numeric",
                          })}
                        </td>
                        <td className="py-2.5 pr-4 text-right text-gray-400">{entry.nights_count}</td>
                        <td className="py-2.5 pr-4 text-right font-mono text-indigo-400">
                          ${entry.nights_amount.toFixed(2)}
                        </td>
                        <td className="py-2.5 pr-4 text-right text-gray-400">{entry.layover_count}</td>
                        <td className="py-2.5 pr-4 text-right font-mono text-purple-400">
                          ${entry.layover_amount.toFixed(2)}
                        </td>
                        <td className="py-2.5 text-right font-mono font-bold text-green-400">
                          ${entry.total_amount.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {/* Totals footer */}
                  <tfoot>
                    <tr className="border-t border-gray-700 text-gray-200 font-bold">
                      <td className="pt-3 pr-4">Totals</td>
                      <td className="pt-3 pr-4 text-right">{summary.total_nights}</td>
                      <td className="pt-3 pr-4 text-right font-mono text-indigo-400">
                        ${summary.entries.reduce((s, e) => s + e.nights_amount, 0).toFixed(2)}
                      </td>
                      <td className="pt-3 pr-4 text-right">{summary.total_layovers}</td>
                      <td className="pt-3 pr-4 text-right font-mono text-purple-400">
                        ${summary.entries.reduce((s, e) => s + e.layover_amount, 0).toFixed(2)}
                      </td>
                      <td className="pt-3 text-right font-mono text-green-400">
                        ${summary.total_amount.toFixed(2)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>
          ) : (
            <div className="text-center py-12">
              <p className="text-gray-500">No per diem entries for this period.</p>
              <p className="text-xs text-gray-600 mt-1">
                Per diem is auto-calculated when timesheets with nights out or layovers are approved.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
