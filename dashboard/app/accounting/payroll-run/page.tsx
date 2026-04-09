"use client";

import { useState, useEffect, useCallback, Fragment } from "react";


// ── Types ────────────────────────────────────────────────────────────

interface PayrollRunLine {
  user_id: string;
  employee_name: string;
  regular_hours: number;
  overtime_hours: number;
  holiday_hours: number;
  vacation_hours: number;
  hourly_rate: number;
  regular_pay: number;
  overtime_pay: number;
  holiday_pay: number;
  vacation_pay: number;
  per_diem: number;
  mileage_pay: number;
  gross_pay: number;
  federal_wh: number;
  state_wh: number;
  ss_employee: number;
  medicare_employee: number;
  benefits_deduction: number;
  total_deductions: number;
  net_pay: number;
  ss_employer: number;
  medicare_employer: number;
  futa: number;
  suta: number;
  total_employer_tax: number;
}

interface PayrollRun {
  id: string;
  pay_period_start: string;
  pay_period_end: string;
  pay_date: string;
  status: string;
  total_gross: number;
  total_net: number;
  total_employer_tax: number;
  total_deductions: number;
  employee_count: number;
  created_by_name: string;
  notes: string | null;
  payroll_run_lines: { count: number }[];
}

// ── Helpers ──────────────────────────────────────────────────────────

function fmt(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(n);
}

function fmtDate(iso: string): string {
  return new Date(iso + "T12:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtHours(n: number): string {
  return n.toFixed(1);
}

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-700 text-gray-300",
  approved: "bg-blue-900/50 text-blue-300",
  posted: "bg-emerald-900/50 text-emerald-300",
  voided: "bg-red-900/50 text-red-300",
};

// ── Page Component ───────────────────────────────────────────────────

export default function PayrollRunPage() {
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // New run form
  const [showNewRun, setShowNewRun] = useState(false);
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [payDate, setPayDate] = useState("");
  const [previewLines, setPreviewLines] = useState<PayrollRunLine[] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [creating, setCreating] = useState(false);

  // Expanded row
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedLines, setExpandedLines] = useState<PayrollRunLine[]>([]);
  const [expandLoading, setExpandLoading] = useState(false);

  // ── Data Loading ─────────────────────────────────────────────────

  const loadRuns = useCallback(async () => {
    try {
      const res = await fetch("/api/accounting/payroll-run");
      if (res.ok) {
        const data = await res.json();
        setRuns(Array.isArray(data) ? data : []);
      }
    } catch {
      /* ignore */
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadRuns();
  }, [loadRuns]);

  // ── Preview ──────────────────────────────────────────────────────

  async function handlePreview() {
    if (!periodStart || !periodEnd) return;
    setPreviewLoading(true);
    setPreviewError("");
    setPreviewLines(null);
    try {
      const params = new URLSearchParams({
        preview: "true",
        period_start: periodStart,
        period_end: periodEnd,
      });
      const res = await fetch(`/api/accounting/payroll-run?${params}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to generate preview");
      }
      const lines = await res.json();
      setPreviewLines(Array.isArray(lines) ? lines : []);
    } catch (err: unknown) {
      setPreviewError(err instanceof Error ? err.message : "Unknown error");
    }
    setPreviewLoading(false);
  }

  // ── Create Draft ─────────────────────────────────────────────────

  async function handleCreateDraft() {
    if (!previewLines || previewLines.length === 0 || !periodStart || !periodEnd || !payDate) return;
    setCreating(true);
    setError("");
    try {
      const res = await fetch("/api/accounting/payroll-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pay_period_start: periodStart,
          pay_period_end: periodEnd,
          pay_date: payDate,
          lines: previewLines,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to create payroll run");
      }
      // Reset form and reload
      setPeriodStart("");
      setPeriodEnd("");
      setPayDate("");
      setPreviewLines(null);
      setShowNewRun(false);
      await loadRuns();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
    setCreating(false);
  }

  // ── Actions (Approve / Post / Void) ──────────────────────────────

  async function handleAction(id: string, action: "approve" | "post" | "void") {
    setActionLoading(id);
    setError("");
    try {
      const res = await fetch("/api/accounting/payroll-run", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed to ${action} payroll run`);
      }
      await loadRuns();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
    setActionLoading(null);
  }

  // ── Expand Row (fetch lines) ─────────────────────────────────────

  async function toggleExpand(runId: string) {
    if (expandedId === runId) {
      setExpandedId(null);
      setExpandedLines([]);
      return;
    }
    setExpandedId(runId);
    setExpandLoading(true);
    setExpandedLines([]);
    try {
      const params = new URLSearchParams({ run_id: runId });
      const res = await fetch(`/api/accounting/payroll-run?${params}`);
      if (res.ok) {
        const data = await res.json();
        // If returning a single run with lines, extract them; otherwise treat as array of lines
        if (Array.isArray(data)) {
          setExpandedLines(data);
        } else if (data.lines) {
          setExpandedLines(data.lines);
        }
      }
    } catch {
      /* ignore */
    }
    setExpandLoading(false);
  }

  // ── Summary Stats ────────────────────────────────────────────────

  const totalRuns = runs.length;
  const draftCount = runs.filter((r) => r.status === "draft").length;
  const approvedCount = runs.filter((r) => r.status === "approved").length;
  const postedCount = runs.filter((r) => r.status === "posted").length;

  // ── Preview Totals ───────────────────────────────────────────────

  const previewTotals = previewLines
    ? {
        regular_hours: previewLines.reduce((s, l) => s + l.regular_hours, 0),
        overtime_hours: previewLines.reduce((s, l) => s + l.overtime_hours, 0),
        gross_pay: previewLines.reduce((s, l) => s + l.gross_pay, 0),
        federal_wh: previewLines.reduce((s, l) => s + l.federal_wh, 0),
        state_wh: previewLines.reduce((s, l) => s + l.state_wh, 0),
        ss_employee: previewLines.reduce((s, l) => s + l.ss_employee, 0),
        medicare_employee: previewLines.reduce((s, l) => s + l.medicare_employee, 0),
        benefits_deduction: previewLines.reduce((s, l) => s + l.benefits_deduction, 0),
        net_pay: previewLines.reduce((s, l) => s + l.net_pay, 0),
        total_employer_tax: previewLines.reduce((s, l) => s + l.total_employer_tax, 0),
      }
    : null;

  // ── Render ───────────────────────────────────────────────────────

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
            { label: "Total Runs", value: totalRuns, color: "text-gray-200" },
            { label: "Draft", value: draftCount, color: "text-gray-400" },
            { label: "Approved", value: approvedCount, color: "text-blue-400" },
            { label: "Posted", value: postedCount, color: "text-emerald-400" },
          ].map((c) => (
            <div key={c.label} className="rounded-xl bg-gray-900/50 border border-gray-800 p-4">
              <p className="text-[10px] uppercase tracking-wider text-gray-600 font-medium">
                {c.label}
              </p>
              <p className={`text-xl font-black mt-1 ${c.color}`}>{c.value}</p>
            </div>
          ))}
        </div>

        {/* New Payroll Run Section (Collapsible) */}
        <div className="mb-6">
          <button
            onClick={() => {
              setShowNewRun(!showNewRun);
              if (showNewRun) {
                setPreviewLines(null);
                setPreviewError("");
              }
            }}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold uppercase tracking-wider transition-colors"
          >
            <svg
              className={`w-4 h-4 transition-transform ${showNewRun ? "rotate-90" : ""}`}
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
                clipRule="evenodd"
              />
            </svg>
            New Payroll Run
          </button>

          {showNewRun && (
            <div className="mt-3 p-6 rounded-xl bg-gray-900/50 border border-gray-800 space-y-4">
              <h3 className="text-sm font-bold uppercase tracking-wider text-gray-300">
                Configure Pay Period
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-[10px] text-gray-600 uppercase tracking-wider mb-1">
                    Pay Period Start *
                  </label>
                  <input
                    type="date"
                    value={periodStart}
                    onChange={(e) => setPeriodStart(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white focus:outline-none focus:border-gray-600 [color-scheme:dark]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-gray-600 uppercase tracking-wider mb-1">
                    Pay Period End *
                  </label>
                  <input
                    type="date"
                    value={periodEnd}
                    onChange={(e) => setPeriodEnd(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white focus:outline-none focus:border-gray-600 [color-scheme:dark]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-gray-600 uppercase tracking-wider mb-1">
                    Pay Date *
                  </label>
                  <input
                    type="date"
                    value={payDate}
                    onChange={(e) => setPayDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white focus:outline-none focus:border-gray-600 [color-scheme:dark]"
                  />
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={handlePreview}
                  disabled={previewLoading || !periodStart || !periodEnd}
                  className="px-5 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-sm font-bold uppercase tracking-wider transition-colors"
                >
                  {previewLoading ? "Calculating..." : "Preview Payroll"}
                </button>
                {previewLines && previewLines.length > 0 && (
                  <span className="text-xs text-gray-500">
                    {previewLines.length} employee{previewLines.length !== 1 ? "s" : ""} found
                  </span>
                )}
              </div>

              {previewError && (
                <p className="text-sm text-red-400 bg-red-900/30 rounded-lg px-3 py-2">
                  {previewError}
                </p>
              )}

              {/* Preview Table */}
              {previewLines && previewLines.length > 0 && (
                <div className="space-y-4">
                  <div className="rounded-xl border border-gray-800 bg-gray-950/50 overflow-hidden overflow-x-auto">
                    <table className="w-full text-sm min-w-[1100px]">
                      <thead>
                        <tr className="text-[10px] uppercase tracking-wider text-gray-600 border-b border-gray-800">
                          <th className="text-left px-4 py-3 font-medium">Employee</th>
                          <th className="text-right px-3 py-3 font-medium">Reg Hrs</th>
                          <th className="text-right px-3 py-3 font-medium">OT Hrs</th>
                          <th className="text-right px-3 py-3 font-medium">Gross</th>
                          <th className="text-right px-3 py-3 font-medium">Fed WH</th>
                          <th className="text-right px-3 py-3 font-medium">State WH</th>
                          <th className="text-right px-3 py-3 font-medium">SS</th>
                          <th className="text-right px-3 py-3 font-medium">Medicare</th>
                          <th className="text-right px-3 py-3 font-medium">Benefits</th>
                          <th className="text-right px-3 py-3 font-medium">Net Pay</th>
                          <th className="text-right px-3 py-3 font-medium">Employer Tax</th>
                        </tr>
                      </thead>
                      <tbody>
                        {previewLines.map((line) => (
                          <tr
                            key={line.user_id}
                            className="border-t border-gray-800/50 hover:bg-gray-800/20 transition-colors"
                          >
                            <td className="px-4 py-3 text-gray-200 font-medium">{line.employee_name}</td>
                            <td className="px-3 py-3 text-right text-gray-400 font-mono">{fmtHours(line.regular_hours)}</td>
                            <td className="px-3 py-3 text-right text-gray-400 font-mono">{fmtHours(line.overtime_hours)}</td>
                            <td className="px-3 py-3 text-right text-gray-200 font-mono font-bold">{fmt(line.gross_pay)}</td>
                            <td className="px-3 py-3 text-right text-red-400/80 font-mono">{fmt(line.federal_wh)}</td>
                            <td className="px-3 py-3 text-right text-red-400/80 font-mono">{fmt(line.state_wh)}</td>
                            <td className="px-3 py-3 text-right text-red-400/80 font-mono">{fmt(line.ss_employee)}</td>
                            <td className="px-3 py-3 text-right text-red-400/80 font-mono">{fmt(line.medicare_employee)}</td>
                            <td className="px-3 py-3 text-right text-red-400/80 font-mono">{fmt(line.benefits_deduction)}</td>
                            <td className="px-3 py-3 text-right text-emerald-400 font-mono font-bold">{fmt(line.net_pay)}</td>
                            <td className="px-3 py-3 text-right text-amber-400/80 font-mono">{fmt(line.total_employer_tax)}</td>
                          </tr>
                        ))}
                        {/* Totals Row */}
                        {previewTotals && (
                          <tr className="border-t-2 border-gray-700 bg-gray-900/60">
                            <td className="px-4 py-3 text-gray-300 font-bold uppercase text-xs">Totals</td>
                            <td className="px-3 py-3 text-right text-gray-300 font-mono font-bold">{fmtHours(previewTotals.regular_hours)}</td>
                            <td className="px-3 py-3 text-right text-gray-300 font-mono font-bold">{fmtHours(previewTotals.overtime_hours)}</td>
                            <td className="px-3 py-3 text-right text-white font-mono font-black">{fmt(previewTotals.gross_pay)}</td>
                            <td className="px-3 py-3 text-right text-red-300 font-mono font-bold">{fmt(previewTotals.federal_wh)}</td>
                            <td className="px-3 py-3 text-right text-red-300 font-mono font-bold">{fmt(previewTotals.state_wh)}</td>
                            <td className="px-3 py-3 text-right text-red-300 font-mono font-bold">{fmt(previewTotals.ss_employee)}</td>
                            <td className="px-3 py-3 text-right text-red-300 font-mono font-bold">{fmt(previewTotals.medicare_employee)}</td>
                            <td className="px-3 py-3 text-right text-red-300 font-mono font-bold">{fmt(previewTotals.benefits_deduction)}</td>
                            <td className="px-3 py-3 text-right text-emerald-300 font-mono font-black">{fmt(previewTotals.net_pay)}</td>
                            <td className="px-3 py-3 text-right text-amber-300 font-mono font-bold">{fmt(previewTotals.total_employer_tax)}</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Create Draft Button */}
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-gray-500">
                      Review the numbers above, then create a draft payroll run.
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={handleCreateDraft}
                        disabled={creating || !payDate}
                        className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-bold uppercase tracking-wider transition-colors"
                      >
                        {creating ? "Creating..." : "Create Draft Run"}
                      </button>
                      <button
                        onClick={() => {
                          setShowNewRun(false);
                          setPreviewLines(null);
                          setPreviewError("");
                        }}
                        className="px-4 py-2 rounded-lg border border-gray-700 hover:border-gray-500 text-gray-400 text-sm font-bold uppercase tracking-wider transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {previewLines && previewLines.length === 0 && (
                <p className="text-sm text-gray-500 bg-gray-900 rounded-lg px-3 py-3">
                  No employees found with approved timesheets for this period.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Payroll Runs Table */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
          </div>
        ) : runs.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-gray-600 text-sm">No payroll runs found</p>
          </div>
        ) : (
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden overflow-x-auto">
            <table className="w-full text-sm min-w-[1000px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-gray-600 border-b border-gray-800">
                  <th className="text-left px-4 py-3 font-medium w-8" />
                  <th className="text-left px-4 py-3 font-medium">Pay Period</th>
                  <th className="text-left px-4 py-3 font-medium">Pay Date</th>
                  <th className="text-center px-4 py-3 font-medium w-24">Status</th>
                  <th className="text-center px-4 py-3 font-medium w-20">Employees</th>
                  <th className="text-right px-4 py-3 font-medium">Gross</th>
                  <th className="text-right px-4 py-3 font-medium">Net</th>
                  <th className="text-right px-4 py-3 font-medium">Employer Tax</th>
                  <th className="text-right px-4 py-3 font-medium w-48">Actions</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => {
                  const isExpanded = expandedId === run.id;
                  return (
                    <Fragment key={run.id}>
                      <tr
                        className="border-t border-gray-800/50 hover:bg-gray-800/20 transition-colors cursor-pointer"
                        onClick={() => toggleExpand(run.id)}
                      >
                        {/* Expand Chevron */}
                        <td className="px-4 py-3 text-gray-600">
                          <svg
                            className={`w-4 h-4 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 20 20"
                            fill="currentColor"
                          >
                            <path
                              fillRule="evenodd"
                              d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
                              clipRule="evenodd"
                            />
                          </svg>
                        </td>

                        {/* Pay Period */}
                        <td className="px-4 py-3 text-gray-200 font-medium text-xs font-mono">
                          {fmtDate(run.pay_period_start)} &mdash; {fmtDate(run.pay_period_end)}
                        </td>

                        {/* Pay Date */}
                        <td className="px-4 py-3 text-gray-400 text-xs font-mono">
                          {fmtDate(run.pay_date)}
                        </td>

                        {/* Status */}
                        <td className="px-4 py-3 text-center">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                              STATUS_COLORS[run.status] || "bg-gray-800 text-gray-400"
                            }`}
                          >
                            {run.status}
                          </span>
                        </td>

                        {/* Employees */}
                        <td className="px-4 py-3 text-center text-gray-400">
                          {run.employee_count}
                        </td>

                        {/* Gross */}
                        <td className="px-4 py-3 text-right text-gray-200 font-mono">
                          {fmt(Number(run.total_gross))}
                        </td>

                        {/* Net */}
                        <td className="px-4 py-3 text-right text-emerald-400 font-mono font-bold">
                          {fmt(Number(run.total_net))}
                        </td>

                        {/* Employer Tax */}
                        <td className="px-4 py-3 text-right text-amber-400/80 font-mono">
                          {fmt(Number(run.total_employer_tax))}
                        </td>

                        {/* Actions */}
                        <td className="px-4 py-3 text-right">
                          <div
                            className="flex items-center justify-end gap-2"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {run.status === "draft" && (
                              <button
                                onClick={() => handleAction(run.id, "approve")}
                                disabled={actionLoading === run.id}
                                className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-[11px] font-bold uppercase tracking-wider transition-colors"
                              >
                                {actionLoading === run.id ? "..." : "Approve"}
                              </button>
                            )}

                            {run.status === "approved" && (
                              <button
                                onClick={() => handleAction(run.id, "post")}
                                disabled={actionLoading === run.id}
                                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-[11px] font-bold uppercase tracking-wider transition-colors"
                              >
                                {actionLoading === run.id ? "..." : "Post"}
                              </button>
                            )}

                            {run.status === "posted" && (
                              <span className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-emerald-500">
                                Posted
                              </span>
                            )}

                            {run.status !== "posted" && run.status !== "voided" && (
                              <button
                                onClick={() => handleAction(run.id, "void")}
                                disabled={actionLoading === run.id}
                                className="px-3 py-1.5 rounded-lg border border-red-800 hover:border-red-600 disabled:opacity-50 text-red-400 hover:text-red-300 text-[11px] font-bold uppercase tracking-wider transition-colors"
                              >
                                {actionLoading === run.id ? "..." : "Void"}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>

                      {/* Expanded Employee Lines */}
                      {isExpanded && (
                        <tr>
                          <td colSpan={9} className="bg-gray-950/50 border-t border-gray-800/50">
                            <div className="px-8 py-4">
                              {expandLoading ? (
                                <div className="flex items-center justify-center py-6">
                                  <div className="w-6 h-6 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
                                </div>
                              ) : expandedLines.length === 0 ? (
                                <p className="text-sm text-gray-600 py-3">No employee lines found</p>
                              ) : (
                                <>
                                  <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-2">
                                    Employee Breakdown &mdash; {expandedLines.length} employee{expandedLines.length !== 1 ? "s" : ""}
                                  </p>
                                  <div className="overflow-x-auto">
                                    <table className="w-full text-sm min-w-[1100px]">
                                      <thead>
                                        <tr className="text-[9px] uppercase tracking-wider text-gray-600">
                                          <th className="text-left py-1 font-medium">Employee</th>
                                          <th className="text-right py-1 font-medium w-16">Reg Hrs</th>
                                          <th className="text-right py-1 font-medium w-16">OT Hrs</th>
                                          <th className="text-right py-1 font-medium w-24">Gross</th>
                                          <th className="text-right py-1 font-medium w-24">Fed WH</th>
                                          <th className="text-right py-1 font-medium w-24">State WH</th>
                                          <th className="text-right py-1 font-medium w-24">SS</th>
                                          <th className="text-right py-1 font-medium w-24">Medicare</th>
                                          <th className="text-right py-1 font-medium w-24">Benefits</th>
                                          <th className="text-right py-1 font-medium w-24">Net Pay</th>
                                          <th className="text-right py-1 font-medium w-24">Emplr Tax</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {expandedLines.map((line) => (
                                          <tr key={line.user_id} className="border-t border-gray-800/30">
                                            <td className="py-1.5 text-gray-300">{line.employee_name}</td>
                                            <td className="py-1.5 text-right text-gray-400 font-mono">{fmtHours(line.regular_hours)}</td>
                                            <td className="py-1.5 text-right text-gray-400 font-mono">{fmtHours(line.overtime_hours)}</td>
                                            <td className="py-1.5 text-right text-gray-200 font-mono">{fmt(line.gross_pay)}</td>
                                            <td className="py-1.5 text-right text-red-400/80 font-mono">{fmt(line.federal_wh)}</td>
                                            <td className="py-1.5 text-right text-red-400/80 font-mono">{fmt(line.state_wh)}</td>
                                            <td className="py-1.5 text-right text-red-400/80 font-mono">{fmt(line.ss_employee)}</td>
                                            <td className="py-1.5 text-right text-red-400/80 font-mono">{fmt(line.medicare_employee)}</td>
                                            <td className="py-1.5 text-right text-red-400/80 font-mono">{fmt(line.benefits_deduction)}</td>
                                            <td className="py-1.5 text-right text-emerald-400 font-mono font-bold">{fmt(line.net_pay)}</td>
                                            <td className="py-1.5 text-right text-amber-400/80 font-mono">{fmt(line.total_employer_tax)}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </>
                              )}
                              {run.notes && (
                                <p className="mt-3 text-xs text-gray-500">
                                  <span className="text-gray-600 uppercase tracking-wider">Notes:</span>{" "}
                                  {run.notes}
                                </p>
                              )}
                              {run.created_by_name && (
                                <p className="mt-1 text-[10px] text-gray-600">
                                  Created by {run.created_by_name}
                                </p>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
