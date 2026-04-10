"use client";

import { useState } from "react";

// ── Types matching API response ──────────────────────────────────────

interface PayrollRow {
  employee_name: string;
  employee_id: string;
  week_ending: string;
  regular_hours: number;
  travel_hours: number;
  total_hours: number;
  per_diem_amount: number;
  mileage_miles: number;
  reimbursable_expenses: number;
  maintenance_hours: number;
  shop_hours: number;
  railroad: string;
  nights_out: number;
  layovers: number;
}

interface PayrollSummary {
  total_hours: number;
  total_per_diem: number;
  total_expenses: number;
  employee_count: number;
}

interface PayrollExport {
  export_date: string;
  period: { from: string; to: string };
  employees: PayrollRow[];
  summary: PayrollSummary;
}

// ── Helpers ──────────────────────────────────────────────────────────

function fmtCurrency(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  });
}

function fmtHours(n: number): string {
  return n.toFixed(2);
}

function fmtDate(iso: string): string {
  return new Date(iso + "T12:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Get Monday of the current week (ISO week starts Monday). */
function getMonday(d: Date): Date {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d);
  monday.setDate(diff);
  return monday;
}

/** Format Date to YYYY-MM-DD for input[type=date]. */
function toISO(d: Date): string {
  return d.toISOString().split("T")[0];
}

/** Get default date range: current week Mon-Sun. */
function currentWeekRange(): { from: string; to: string } {
  const now = new Date();
  const mon = getMonday(now);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  return { from: toISO(mon), to: toISO(sun) };
}

// ── Summary Cards ────────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4 flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wider text-gray-600 font-medium">
        {label}
      </span>
      <span className="text-xl sm:text-2xl font-black text-gray-100 font-mono tracking-tight">
        {value}
      </span>
      {sub && (
        <span className="text-xs text-gray-600">{sub}</span>
      )}
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────

export default function PayrollPage() {
  const defaults = currentWeekRange();
  const [from, setFrom] = useState(defaults.from);
  const [to, setTo] = useState(defaults.to);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<PayrollExport | null>(null);

  // ── Quick date presets ──

  function setThisWeek() {
    const range = currentWeekRange();
    setFrom(range.from);
    setTo(range.to);
  }

  function setLastWeek() {
    const now = new Date();
    const mon = getMonday(now);
    mon.setDate(mon.getDate() - 7);
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    setFrom(toISO(mon));
    setTo(toISO(sun));
  }

  function setThisMonth() {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    setFrom(toISO(first));
    setTo(toISO(last));
  }

  function setLastMonth() {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const last = new Date(now.getFullYear(), now.getMonth(), 0);
    setFrom(toISO(first));
    setTo(toISO(last));
  }

  // ── Fetch payroll data ──

  async function generate() {
    setLoading(true);
    setError("");
    setData(null);
    try {
      const res = await fetch(
        `/api/payroll/export?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
      }
      const json: PayrollExport = await res.json();
      setData(json);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  // ── Download helpers ──

  async function downloadFile(format: "csv" | "json") {
    try {
      const res = await fetch(
        `/api/payroll/export?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&format=${format}`
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Export failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `payroll_export_${from}_to_${to}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Download failed");
    }
  }

  // ── Compute totals row ──

  const totals = data
    ? data.employees.reduce(
        (acc, row) => ({
          regular_hours: acc.regular_hours + row.regular_hours,
          travel_hours: acc.travel_hours + row.travel_hours,
          total_hours: acc.total_hours + row.total_hours,
          per_diem_amount: acc.per_diem_amount + row.per_diem_amount,
          mileage_miles: acc.mileage_miles + row.mileage_miles,
          reimbursable_expenses:
            acc.reimbursable_expenses + row.reimbursable_expenses,
        }),
        {
          regular_hours: 0,
          travel_hours: 0,
          total_hours: 0,
          per_diem_amount: 0,
          mileage_miles: 0,
          reimbursable_expenses: 0,
        }
      )
    : null;

  return (
    <div className="min-h-screen bg-gray-950 text-white">

      <main className="px-4 sm:px-6 py-6 max-w-7xl mx-auto space-y-6">
        {/* ── Controls Row ── */}
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4 space-y-4">
          {/* Date inputs + quick buttons */}
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs text-gray-600 uppercase tracking-wider mb-1">
                From
              </label>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-white font-mono focus:outline-none focus:border-gray-500 [color-scheme:dark]"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 uppercase tracking-wider mb-1">
                To
              </label>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-white font-mono focus:outline-none focus:border-gray-500 [color-scheme:dark]"
              />
            </div>

            {/* Quick presets */}
            <div className="flex items-center gap-1.5">
              <button
                onClick={setThisWeek}
                className="px-3 py-2 rounded-lg border border-gray-700 hover:border-gray-500 text-gray-400 hover:text-white text-xs font-bold uppercase tracking-wider transition-colors"
              >
                This Week
              </button>
              <button
                onClick={setLastWeek}
                className="px-3 py-2 rounded-lg border border-gray-700 hover:border-gray-500 text-gray-400 hover:text-white text-xs font-bold uppercase tracking-wider transition-colors"
              >
                Last Week
              </button>
              <button
                onClick={setThisMonth}
                className="px-3 py-2 rounded-lg border border-gray-700 hover:border-gray-500 text-gray-400 hover:text-white text-xs font-bold uppercase tracking-wider transition-colors"
              >
                This Month
              </button>
              <button
                onClick={setLastMonth}
                className="px-3 py-2 rounded-lg border border-gray-700 hover:border-gray-500 text-gray-400 hover:text-white text-xs font-bold uppercase tracking-wider transition-colors"
              >
                Last Month
              </button>
            </div>

            <div className="flex-1" />

            {/* Generate */}
            <button
              onClick={generate}
              disabled={loading || !from || !to}
              className="px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-bold uppercase tracking-wider transition-colors"
            >
              {loading ? "Generating..." : "Generate"}
            </button>
          </div>

          {/* Export buttons — only show after data loaded */}
          {data && (
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={() => downloadFile("csv")}
                className="px-4 py-2 rounded-lg border border-emerald-700 hover:border-emerald-500 text-emerald-400 hover:text-white text-xs font-bold uppercase tracking-wider transition-colors flex items-center gap-1.5"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="w-4 h-4"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z"
                    clipRule="evenodd"
                  />
                </svg>
                Download CSV
              </button>
              <button
                onClick={() => downloadFile("json")}
                className="px-4 py-2 rounded-lg border border-emerald-700 hover:border-emerald-500 text-emerald-400 hover:text-white text-xs font-bold uppercase tracking-wider transition-colors flex items-center gap-1.5"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="w-4 h-4"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z"
                    clipRule="evenodd"
                  />
                </svg>
                Download JSON
              </button>
              <div className="flex-1" />
              <span className="text-xs text-gray-600">
                Export date: {data.export_date} | Period: {fmtDate(data.period.from)} &mdash; {fmtDate(data.period.to)}
              </span>
            </div>
          )}
        </div>

        {/* ── Error ── */}
        {error && (
          <p className="text-sm text-red-400 bg-red-900/30 rounded-lg px-4 py-3">
            {error}
          </p>
        )}

        {/* ── Loading ── */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
          </div>
        )}

        {/* ── Results ── */}
        {data && !loading && (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <SummaryCard
                label="Total Hours"
                value={fmtHours(data.summary.total_hours)}
                sub={`${data.employees.length} timesheet rows`}
              />
              <SummaryCard
                label="Total Per Diem"
                value={fmtCurrency(data.summary.total_per_diem)}
              />
              <SummaryCard
                label="Total Expenses"
                value={fmtCurrency(data.summary.total_expenses)}
                sub="Reimbursable only"
              />
              <SummaryCard
                label="Employee Count"
                value={String(data.summary.employee_count)}
                sub="Unique employees"
              />
            </div>

            {/* Results Table */}
            {data.employees.length === 0 ? (
              <div className="text-center py-20">
                <p className="text-gray-600 text-sm">
                  No approved timesheets found for this period
                </p>
              </div>
            ) : (
              <div className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden overflow-x-auto">
                <table className="w-full text-sm min-w-[960px]">
                  <thead>
                    <tr className="text-xs uppercase tracking-wider text-gray-600 border-b border-gray-800">
                      <th className="text-left px-4 py-3 font-medium">Name</th>
                      <th className="text-left px-4 py-3 font-medium w-28">
                        Week Ending
                      </th>
                      <th className="text-right px-4 py-3 font-medium w-24">
                        Regular Hrs
                      </th>
                      <th className="text-right px-4 py-3 font-medium w-24">
                        Travel Hrs
                      </th>
                      <th className="text-right px-4 py-3 font-medium w-24">
                        Total Hrs
                      </th>
                      <th className="text-right px-4 py-3 font-medium w-28">
                        Per Diem
                      </th>
                      <th className="text-right px-4 py-3 font-medium w-24">
                        Mileage
                      </th>
                      <th className="text-right px-4 py-3 font-medium w-28">
                        Expenses
                      </th>
                      <th className="text-left px-4 py-3 font-medium w-32">
                        Railroad
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.employees.map((row, idx) => (
                      <tr
                        key={`${row.employee_id}-${row.week_ending}`}
                        className={`border-t border-gray-800/50 transition-colors ${
                          idx % 2 === 1 ? "bg-gray-800/20" : ""
                        }`}
                      >
                        <td className="px-4 py-2.5 text-gray-200">
                          {row.employee_name}
                        </td>
                        <td className="px-4 py-2.5 text-gray-400 font-mono text-xs">
                          {fmtDate(row.week_ending)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-gray-300">
                          {fmtHours(row.regular_hours)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-gray-300">
                          {fmtHours(row.travel_hours)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-gray-100 font-bold">
                          {fmtHours(row.total_hours)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-gray-300">
                          {fmtCurrency(row.per_diem_amount)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-gray-300">
                          {row.mileage_miles.toFixed(1)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-gray-300">
                          {fmtCurrency(row.reimbursable_expenses)}
                        </td>
                        <td className="px-4 py-2.5 text-gray-400 text-xs">
                          {row.railroad || "--"}
                        </td>
                      </tr>
                    ))}

                    {/* Totals row */}
                    {totals && (
                      <tr className="border-t-2 border-gray-700 bg-gray-800/40">
                        <td className="px-4 py-3 text-gray-100 font-bold uppercase text-xs tracking-wider">
                          Totals
                        </td>
                        <td className="px-4 py-3" />
                        <td className="px-4 py-3 text-right font-mono text-gray-100 font-bold">
                          {fmtHours(totals.regular_hours)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-gray-100 font-bold">
                          {fmtHours(totals.travel_hours)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-gray-100 font-bold">
                          {fmtHours(totals.total_hours)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-gray-100 font-bold">
                          {fmtCurrency(totals.per_diem_amount)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-gray-100 font-bold">
                          {totals.mileage_miles.toFixed(1)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-gray-100 font-bold">
                          {fmtCurrency(totals.reimbursable_expenses)}
                        </td>
                        <td className="px-4 py-3" />
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
