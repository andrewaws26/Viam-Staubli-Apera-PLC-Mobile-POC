"use client";

import { useState, useMemo } from "react";
import type { AccountType, TrialBalanceSummary, TrialBalanceRow } from "@ironsight/shared";
import {
  ACCOUNT_TYPE_LABELS,
  ACCOUNT_TYPE_COLORS,
} from "@ironsight/shared";

// ── Helpers ──────────────────────────────────────────────────────────

const ACCOUNT_TYPE_ORDER: AccountType[] = [
  "asset",
  "liability",
  "equity",
  "revenue",
  "expense",
];

function fmtCurrency(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  });
}

function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

// ── Trial Balance Section ────────────────────────────────────────────

function TrialBalanceReport({ data }: { data: TrialBalanceSummary }) {
  const grouped = useMemo(() => {
    const map: Record<AccountType, TrialBalanceRow[]> = {
      asset: [],
      liability: [],
      equity: [],
      revenue: [],
      expense: [],
    };
    for (const row of data.rows) {
      map[row.account_type]?.push(row);
    }
    return map;
  }, [data.rows]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-black uppercase tracking-widest text-gray-100">
          Trial Balance
        </h2>
        {data.is_balanced ? (
          <span className="inline-block px-3 py-1 rounded-lg text-xs font-bold uppercase tracking-wider bg-emerald-900/60 text-emerald-300 border border-emerald-700/50">
            Balanced
          </span>
        ) : (
          <span className="inline-block px-3 py-1 rounded-lg text-xs font-bold uppercase tracking-wider bg-red-900/60 text-red-300 border border-red-700/50">
            UNBALANCED
          </span>
        )}
      </div>

      <p className="text-xs text-gray-500 tracking-wide">
        As of {data.as_of_date}
      </p>

      <div className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-gray-600 border-b border-gray-800">
              <th className="text-left px-4 py-3 font-medium w-28">Acct #</th>
              <th className="text-left px-4 py-3 font-medium">Account Name</th>
              <th className="text-left px-4 py-3 font-medium w-28">Type</th>
              <th className="text-right px-4 py-3 font-medium w-32">Debit</th>
              <th className="text-right px-4 py-3 font-medium w-32">Credit</th>
            </tr>
          </thead>
          <tbody>
            {ACCOUNT_TYPE_ORDER.map((type) => {
              const rows = grouped[type];
              if (rows.length === 0) return null;

              const subtotalDebit = rows.reduce((s, r) => s + r.debit_total, 0);
              const subtotalCredit = rows.reduce((s, r) => s + r.credit_total, 0);
              const color = ACCOUNT_TYPE_COLORS[type];

              return (
                <Fragment key={type}>
                  {/* Type header row */}
                  <tr className="bg-gray-800/40">
                    <td colSpan={5} className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ backgroundColor: color }}
                        />
                        <span className="text-xs font-bold uppercase tracking-wider text-gray-300">
                          {ACCOUNT_TYPE_LABELS[type]}
                        </span>
                      </div>
                    </td>
                  </tr>

                  {/* Account rows */}
                  {rows.map((row) => (
                    <tr
                      key={row.account_id}
                      className="border-t border-gray-800/50 hover:bg-gray-800/20 transition-colors"
                    >
                      <td className="px-4 py-2.5 font-mono text-gray-400 text-xs">
                        {row.account_number}
                      </td>
                      <td className="px-4 py-2.5 text-gray-200">
                        {row.account_name}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className="text-xs font-medium"
                          style={{ color }}
                        >
                          {ACCOUNT_TYPE_LABELS[row.account_type]}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-gray-300">
                        {row.debit_total > 0 ? fmtCurrency(row.debit_total) : ""}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-gray-300">
                        {row.credit_total > 0 ? fmtCurrency(row.credit_total) : ""}
                      </td>
                    </tr>
                  ))}

                  {/* Subtotal row */}
                  <tr className="border-t border-gray-700">
                    <td colSpan={3} className="px-4 py-2 text-right">
                      <span className="text-[10px] uppercase tracking-wider text-gray-500">
                        {ACCOUNT_TYPE_LABELS[type]} Subtotal
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-gray-200 font-medium border-t border-gray-700">
                      {subtotalDebit > 0 ? fmtCurrency(subtotalDebit) : ""}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-gray-200 font-medium border-t border-gray-700">
                      {subtotalCredit > 0 ? fmtCurrency(subtotalCredit) : ""}
                    </td>
                  </tr>
                </Fragment>
              );
            })}

            {/* Grand totals */}
            <tr className="border-t-2 border-gray-600 bg-gray-800/60">
              <td colSpan={3} className="px-4 py-3 text-right">
                <span className="text-xs font-bold uppercase tracking-wider text-gray-200">
                  Total
                </span>
              </td>
              <td className="px-4 py-3 text-right font-mono text-white font-bold text-base">
                {fmtCurrency(data.total_debits)}
              </td>
              <td className="px-4 py-3 text-right font-mono text-white font-bold text-base">
                {fmtCurrency(data.total_credits)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Profit & Loss Section ────────────────────────────────────────────

function ProfitLossReport({ data }: { data: TrialBalanceSummary }) {
  const { revenueRows, expenseRows, totalRevenue, totalExpenses, netIncome } =
    useMemo(() => {
      const rev = data.rows.filter(
        (r) => r.account_type === "revenue" && r.credit_total > 0
      );
      const exp = data.rows.filter(
        (r) => r.account_type === "expense" && r.debit_total > 0
      );
      const totRev = rev.reduce((s, r) => s + r.credit_total, 0);
      const totExp = exp.reduce((s, r) => s + r.debit_total, 0);
      return {
        revenueRows: rev,
        expenseRows: exp,
        totalRevenue: Math.round(totRev * 100) / 100,
        totalExpenses: Math.round(totExp * 100) / 100,
        netIncome: Math.round((totRev - totExp) * 100) / 100,
      };
    }, [data.rows]);

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-black uppercase tracking-widest text-gray-100">
        Profit &amp; Loss (Income Statement)
      </h2>

      <p className="text-xs text-gray-500 tracking-wide">
        As of {data.as_of_date}
      </p>

      <div className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden overflow-x-auto">
        <table className="w-full text-sm min-w-[480px]">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-gray-600 border-b border-gray-800">
              <th className="text-left px-4 py-3 font-medium w-28">Acct #</th>
              <th className="text-left px-4 py-3 font-medium">Account</th>
              <th className="text-right px-4 py-3 font-medium w-36">Amount</th>
            </tr>
          </thead>
          <tbody>
            {/* Revenue section */}
            <tr className="bg-gray-800/40">
              <td colSpan={3} className="px-4 py-2">
                <div className="flex items-center gap-2">
                  <div
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: ACCOUNT_TYPE_COLORS.revenue }}
                  />
                  <span className="text-xs font-bold uppercase tracking-wider text-gray-300">
                    Revenue
                  </span>
                </div>
              </td>
            </tr>

            {revenueRows.length === 0 ? (
              <tr>
                <td
                  colSpan={3}
                  className="px-4 py-3 text-center text-gray-600 text-xs"
                >
                  No revenue accounts with balances
                </td>
              </tr>
            ) : (
              revenueRows.map((row) => (
                <tr
                  key={row.account_id}
                  className="border-t border-gray-800/50 hover:bg-gray-800/20 transition-colors"
                >
                  <td className="px-4 py-2.5 font-mono text-gray-400 text-xs">
                    {row.account_number}
                  </td>
                  <td className="px-4 py-2.5 text-gray-200">
                    {row.account_name}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-emerald-400">
                    {fmtCurrency(row.credit_total)}
                  </td>
                </tr>
              ))
            )}

            {/* Revenue total */}
            <tr className="border-t border-gray-700">
              <td colSpan={2} className="px-4 py-2 text-right">
                <span className="text-[10px] uppercase tracking-wider text-gray-500">
                  Total Revenue
                </span>
              </td>
              <td className="px-4 py-2 text-right font-mono text-emerald-300 font-medium border-t border-gray-700">
                {fmtCurrency(totalRevenue)}
              </td>
            </tr>

            {/* Expense section */}
            <tr className="bg-gray-800/40">
              <td colSpan={3} className="px-4 py-2">
                <div className="flex items-center gap-2">
                  <div
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: ACCOUNT_TYPE_COLORS.expense }}
                  />
                  <span className="text-xs font-bold uppercase tracking-wider text-gray-300">
                    Expenses
                  </span>
                </div>
              </td>
            </tr>

            {expenseRows.length === 0 ? (
              <tr>
                <td
                  colSpan={3}
                  className="px-4 py-3 text-center text-gray-600 text-xs"
                >
                  No expense accounts with balances
                </td>
              </tr>
            ) : (
              expenseRows.map((row) => (
                <tr
                  key={row.account_id}
                  className="border-t border-gray-800/50 hover:bg-gray-800/20 transition-colors"
                >
                  <td className="px-4 py-2.5 font-mono text-gray-400 text-xs">
                    {row.account_number}
                  </td>
                  <td className="px-4 py-2.5 text-gray-200">
                    {row.account_name}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-red-400">
                    ({fmtCurrency(row.debit_total)})
                  </td>
                </tr>
              ))
            )}

            {/* Expense total */}
            <tr className="border-t border-gray-700">
              <td colSpan={2} className="px-4 py-2 text-right">
                <span className="text-[10px] uppercase tracking-wider text-gray-500">
                  Total Expenses
                </span>
              </td>
              <td className="px-4 py-2 text-right font-mono text-red-300 font-medium border-t border-gray-700">
                ({fmtCurrency(totalExpenses)})
              </td>
            </tr>

            {/* Net Income / Net Loss */}
            <tr className="border-t-2 border-gray-600 bg-gray-800/60">
              <td colSpan={2} className="px-4 py-3 text-right">
                <span className="text-xs font-bold uppercase tracking-wider text-gray-200">
                  {netIncome >= 0 ? "Net Income" : "Net Loss"}
                </span>
              </td>
              <td
                className={`px-4 py-3 text-right font-mono font-bold text-base ${
                  netIncome >= 0 ? "text-emerald-400" : "text-red-400"
                }`}
              >
                {netIncome >= 0
                  ? fmtCurrency(netIncome)
                  : `(${fmtCurrency(Math.abs(netIncome))})`}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Fragment import (React) ──────────────────────────────────────────

import { Fragment } from "react";

// ── Main Page ────────────────────────────────────────────────────────

type ReportTab = "trial-balance" | "profit-loss";

export default function FinancialReportsPage() {
  const [asOf, setAsOf] = useState(todayISO());
  const [data, setData] = useState<TrialBalanceSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<ReportTab>("trial-balance");

  async function generate() {
    setLoading(true);
    setError("");
    setData(null);
    try {
      const res = await fetch(
        `/api/accounting/trial-balance?as_of=${encodeURIComponent(asOf)}`
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const summary: TrialBalanceSummary = await res.json();
      setData(summary);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load report");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Print styles */}
      <style>{`
        @media print {
          body { background: white !important; color: black !important; }
          .no-print { display: none !important; }
          table { border-collapse: collapse; }
          td, th { border: 1px solid #ccc !important; padding: 4px 8px !important; color: black !important; }
          tr { background: white !important; }
          .font-mono { font-family: 'Courier New', monospace !important; }
        }
      `}</style>

      <header className="border-b border-gray-800 px-4 sm:px-6 py-4 flex items-center justify-between no-print">
        <div>
          <h1 className="text-xl sm:text-2xl font-black tracking-widest uppercase text-gray-100">
            Financial Reports
          </h1>
          <p className="text-xs text-gray-600 mt-0.5 tracking-wide">
            IronSight — Trial Balance &amp; Income Statement
          </p>
        </div>
        <a
          href="/accounting"
          className="px-4 py-2 rounded-lg border border-gray-700 hover:border-gray-500 text-gray-400 hover:text-white text-sm font-bold uppercase tracking-wider transition-colors"
        >
          Back to Accounting
        </a>
      </header>

      <main className="px-4 sm:px-6 py-6 max-w-6xl mx-auto">
        {/* Date picker + Generate */}
        <div className="flex flex-wrap items-end gap-3 mb-6 no-print">
          <div>
            <label className="block text-[10px] text-gray-600 uppercase tracking-wider mb-1">
              As of
            </label>
            <input
              type="date"
              value={asOf}
              onChange={(e) => setAsOf(e.target.value)}
              className="px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white focus:outline-none focus:border-gray-600 [color-scheme:dark]"
            />
          </div>
          <button
            onClick={generate}
            disabled={loading}
            className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-bold uppercase tracking-wider transition-colors"
          >
            {loading ? "Loading..." : "Generate"}
          </button>

          {data && (
            <button
              onClick={() => window.print()}
              className="px-4 py-2 rounded-lg border border-gray-700 hover:border-gray-500 text-gray-400 hover:text-white text-sm font-bold uppercase tracking-wider transition-colors"
            >
              Print Report
            </button>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="mb-6 px-4 py-3 rounded-lg bg-red-900/30 border border-red-800/50 text-sm text-red-400">
            {error}
          </div>
        )}

        {/* Empty state */}
        {!data && !loading && !error && (
          <div className="text-center py-20">
            <p className="text-gray-600 text-sm">
              Select a date and click Generate to view reports.
            </p>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
          </div>
        )}

        {/* Report content */}
        {data && !loading && (
          <>
            {/* Tab toggle */}
            <div className="flex items-center gap-1 mb-6 bg-gray-900 rounded-xl p-1 w-fit no-print">
              <button
                onClick={() => setActiveTab("trial-balance")}
                className={`px-5 py-2 rounded-lg text-sm font-bold uppercase tracking-wider transition-colors ${
                  activeTab === "trial-balance"
                    ? "bg-gray-800 text-white"
                    : "text-gray-500 hover:text-gray-300"
                }`}
              >
                Trial Balance
              </button>
              <button
                onClick={() => setActiveTab("profit-loss")}
                className={`px-5 py-2 rounded-lg text-sm font-bold uppercase tracking-wider transition-colors ${
                  activeTab === "profit-loss"
                    ? "bg-gray-800 text-white"
                    : "text-gray-500 hover:text-gray-300"
                }`}
              >
                Profit &amp; Loss
              </button>
            </div>

            {activeTab === "trial-balance" && <TrialBalanceReport data={data} />}
            {activeTab === "profit-loss" && <ProfitLossReport data={data} />}
          </>
        )}
      </main>
    </div>
  );
}
