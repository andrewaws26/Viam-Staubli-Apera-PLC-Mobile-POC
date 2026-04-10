"use client";

import { useState, useEffect, useCallback } from "react";

// ── Types ────────────────────────────────────────────────────────────

interface AccountingPeriod {
  id: string;
  start_date: string;
  end_date: string;
  label: string;
  period_type: "month" | "quarter" | "year";
  status: "open" | "closed" | "locked";
  closed_by: string | null;
  closed_by_name: string | null;
  closed_at: string | null;
  notes: string | null;
  created_at: string;
}

interface YearEndResult {
  success: boolean;
  journal_entry_id: string;
  net_income: number;
  accounts_closed: number;
}

// ── Helpers ──────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  return new Date(iso + "T12:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function fmtCurrency(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  });
}

const STATUS_COLORS: Record<string, string> = {
  open: "bg-emerald-900/60 text-emerald-300",
  closed: "bg-amber-900/60 text-amber-300",
  locked: "bg-red-900/60 text-red-300",
};

const PERIOD_TYPE_LABELS: Record<string, string> = {
  month: "Month",
  quarter: "Quarter",
  year: "Year",
};

// ── Close Notes Modal ────────────────────────────────────────────────

function CloseNotesModal({
  period,
  onClose,
  onConfirm,
}: {
  period: AccountingPeriod;
  onClose: () => void;
  onConfirm: (notes: string) => void;
}) {
  const [notes, setNotes] = useState("");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md mx-4 bg-gray-900 border border-gray-700 rounded-2xl p-6 space-y-4">
        <h2 className="text-lg font-black uppercase tracking-widest text-gray-100">
          Close Period
        </h2>
        <p className="text-sm text-gray-400">
          Closing <span className="text-white font-semibold">{period.label}</span> will
          prevent new journal entries from being posted to this period.
        </p>

        <div>
          <label className="block text-xs text-gray-600 uppercase tracking-wider mb-1">
            Notes (optional)
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Month-end close, all entries reviewed..."
            className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-gray-500 resize-none"
          />
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={() => onConfirm(notes)}
            className="flex-1 px-4 py-2.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-bold uppercase tracking-wider transition-colors"
          >
            Close Period
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2.5 rounded-lg border border-gray-700 hover:border-gray-500 text-gray-400 hover:text-white text-sm font-bold uppercase tracking-wider transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────

export default function AccountingPeriodsPage() {
  const [periods, setPeriods] = useState<AccountingPeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [closeModal, setCloseModal] = useState<AccountingPeriod | null>(null);

  // Year-end close state
  const [fiscalYear, setFiscalYear] = useState(new Date().getFullYear());
  const [yearEndLoading, setYearEndLoading] = useState(false);
  const [yearEndResult, setYearEndResult] = useState<YearEndResult | null>(null);
  const [yearEndError, setYearEndError] = useState("");

  const loadPeriods = useCallback(async () => {
    try {
      const res = await fetch("/api/accounting/periods");
      if (res.ok) {
        const data = await res.json();
        setPeriods(Array.isArray(data) ? data : []);
      }
    } catch {
      /* ignore */
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadPeriods();
  }, [loadPeriods]);

  async function handleAction(id: string, action: "close" | "lock" | "reopen", notes?: string) {
    setActionLoading(id);
    setError("");
    try {
      const res = await fetch("/api/accounting/periods", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action, notes: notes || undefined }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed to ${action} period`);
      }
      await loadPeriods();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
    setActionLoading(null);
  }

  async function handleYearEndClose() {
    setYearEndLoading(true);
    setYearEndError("");
    setYearEndResult(null);
    try {
      const res = await fetch("/api/accounting/periods", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fiscal_year: fiscalYear }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Year-end close failed");
      }
      const result = await res.json();
      setYearEndResult(result);
      await loadPeriods();
    } catch (err: unknown) {
      setYearEndError(err instanceof Error ? err.message : "Unknown error");
    }
    setYearEndLoading(false);
  }

  // Summary counts
  const totalPeriods = periods.length;
  const openCount = periods.filter((p) => p.status === "open").length;
  const closedCount = periods.filter((p) => p.status === "closed").length;
  const lockedCount = periods.filter((p) => p.status === "locked").length;

  return (
    <div className="min-h-screen bg-gray-950 text-white">

      <main className="px-4 sm:px-6 py-6 max-w-7xl mx-auto">
        {/* Error Banner */}
        {error && (
          <div className="mb-4 px-4 py-3 rounded-xl bg-red-900/30 border border-red-800 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* Summary Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {[
            { label: "Total Periods", value: totalPeriods, color: "text-gray-200" },
            { label: "Open", value: openCount, color: "text-emerald-400" },
            { label: "Closed", value: closedCount, color: "text-amber-400" },
            { label: "Locked", value: lockedCount, color: "text-red-400" },
          ].map((c) => (
            <div key={c.label} className="rounded-xl bg-gray-900/50 border border-gray-800 p-4">
              <p className="text-xs uppercase tracking-wider text-gray-600 font-medium">
                {c.label}
              </p>
              <p className={`text-xl font-black mt-1 ${c.color}`}>{c.value}</p>
            </div>
          ))}
        </div>

        {/* Periods Table */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
          </div>
        ) : periods.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-gray-600 text-sm">No accounting periods found</p>
          </div>
        ) : (
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden overflow-x-auto mb-8">
            <table className="w-full text-sm min-w-[900px]">
              <thead>
                <tr className="text-xs uppercase tracking-wider text-gray-600 border-b border-gray-800">
                  <th className="text-left px-4 py-3 font-medium">Label</th>
                  <th className="text-left px-4 py-3 font-medium w-24">Type</th>
                  <th className="text-left px-4 py-3 font-medium w-48">Date Range</th>
                  <th className="text-center px-4 py-3 font-medium w-24">Status</th>
                  <th className="text-left px-4 py-3 font-medium w-44">Closed By</th>
                  <th className="text-left px-4 py-3 font-medium">Notes</th>
                  <th className="text-right px-4 py-3 font-medium w-52">Actions</th>
                </tr>
              </thead>
              <tbody>
                {periods.map((period) => (
                  <tr
                    key={period.id}
                    className="border-t border-gray-800/50 hover:bg-gray-800/20 transition-colors"
                  >
                    {/* Label */}
                    <td className="px-4 py-3 text-gray-200 font-medium">
                      {period.label}
                    </td>

                    {/* Period Type */}
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider bg-gray-800 text-gray-400">
                        {PERIOD_TYPE_LABELS[period.period_type] || period.period_type}
                      </span>
                    </td>

                    {/* Date Range */}
                    <td className="px-4 py-3 text-gray-400 text-xs font-mono">
                      {fmtDate(period.start_date)} &mdash; {fmtDate(period.end_date)}
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider ${
                          STATUS_COLORS[period.status] || "bg-gray-800 text-gray-400"
                        }`}
                      >
                        {period.status}
                      </span>
                    </td>

                    {/* Closed By */}
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {period.closed_by_name ? (
                        <div>
                          <span className="text-gray-300">{period.closed_by_name}</span>
                          {period.closed_at && (
                            <div className="text-gray-600 text-xs mt-0.5">
                              {fmtDateTime(period.closed_at)}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-700">&mdash;</span>
                      )}
                    </td>

                    {/* Notes */}
                    <td className="px-4 py-3 text-gray-500 text-xs max-w-[200px] truncate">
                      {period.notes || <span className="text-gray-700">&mdash;</span>}
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {period.status === "open" && (
                          <button
                            onClick={() => setCloseModal(period)}
                            disabled={actionLoading === period.id}
                            className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-[11px] font-bold uppercase tracking-wider transition-colors"
                          >
                            {actionLoading === period.id ? "..." : "Close"}
                          </button>
                        )}

                        {period.status === "closed" && (
                          <>
                            <button
                              onClick={() => handleAction(period.id, "lock")}
                              disabled={actionLoading === period.id}
                              className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-[11px] font-bold uppercase tracking-wider transition-colors"
                            >
                              {actionLoading === period.id ? "..." : "Lock"}
                            </button>
                            <button
                              onClick={() => handleAction(period.id, "reopen")}
                              disabled={actionLoading === period.id}
                              className="px-3 py-1.5 rounded-lg border border-gray-700 hover:border-gray-500 disabled:opacity-50 text-gray-400 hover:text-white text-[11px] font-bold uppercase tracking-wider transition-colors"
                            >
                              {actionLoading === period.id ? "..." : "Reopen"}
                            </button>
                          </>
                        )}

                        {period.status === "locked" && (
                          <button
                            onClick={() => handleAction(period.id, "reopen")}
                            disabled={actionLoading === period.id}
                            className="px-3 py-1.5 rounded-lg border border-gray-700 hover:border-gray-500 disabled:opacity-50 text-gray-400 hover:text-white text-[11px] font-bold uppercase tracking-wider transition-colors"
                          >
                            {actionLoading === period.id ? "..." : "Reopen"}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Year-End Close Section */}
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-5 space-y-4">
          <h3 className="text-sm font-bold uppercase tracking-wider text-gray-300">
            Year-End Close
          </h3>

          <p className="text-xs text-amber-400/80 bg-amber-900/20 border border-amber-800/40 rounded-lg px-3 py-2">
            This creates a posted journal entry that zeros all revenue and expense accounts into
            Retained Earnings. This action cannot be easily undone.
          </p>

          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="block text-xs text-gray-600 uppercase tracking-wider mb-1">
                Fiscal Year
              </label>
              <input
                type="number"
                value={fiscalYear}
                onChange={(e) => setFiscalYear(parseInt(e.target.value) || new Date().getFullYear())}
                min={2020}
                max={2099}
                className="w-32 px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm font-mono focus:outline-none focus:border-gray-500"
              />
            </div>
            <button
              onClick={handleYearEndClose}
              disabled={yearEndLoading}
              className="px-5 py-2 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-sm font-bold uppercase tracking-wider transition-colors"
            >
              {yearEndLoading ? "Processing..." : "Execute Year-End Close"}
            </button>
          </div>

          {yearEndError && (
            <p className="text-sm text-red-400 bg-red-900/30 rounded-lg px-3 py-2">
              {yearEndError}
            </p>
          )}

          {yearEndResult && (
            <div className="rounded-xl bg-emerald-900/20 border border-emerald-800/40 p-4 space-y-2">
              <p className="text-sm font-bold text-emerald-300">
                Year-end close completed successfully
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                <div>
                  <span className="text-xs uppercase tracking-wider text-gray-600">
                    Net Income
                  </span>
                  <p className="text-white font-mono font-bold mt-0.5">
                    {fmtCurrency(yearEndResult.net_income)}
                  </p>
                </div>
                <div>
                  <span className="text-xs uppercase tracking-wider text-gray-600">
                    Accounts Closed
                  </span>
                  <p className="text-white font-bold mt-0.5">
                    {yearEndResult.accounts_closed}
                  </p>
                </div>
                <div>
                  <span className="text-xs uppercase tracking-wider text-gray-600">
                    Journal Entry
                  </span>
                  <p className="mt-0.5">
                    <a
                      href={`/accounting/${yearEndResult.journal_entry_id}`}
                      className="text-blue-400 hover:text-blue-300 underline underline-offset-2 text-sm transition-colors"
                    >
                      View Entry
                    </a>
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Close Period Modal */}
      {closeModal && (
        <CloseNotesModal
          period={closeModal}
          onClose={() => setCloseModal(null)}
          onConfirm={(notes) => {
            handleAction(closeModal.id, "close", notes);
            setCloseModal(null);
          }}
        />
      )}
    </div>
  );
}
