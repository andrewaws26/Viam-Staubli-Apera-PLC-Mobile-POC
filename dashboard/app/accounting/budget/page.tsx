"use client";

import { useState, useEffect, useCallback, useMemo } from "react";

// ── Types ────────────────────────────────────────────────────────────

interface AccountRecord {
  id: string;
  account_number: string;
  name: string;
  account_type: string;
}

interface BudgetRecord {
  id: string;
  fiscal_year: number;
  account_id: string;
  account_number: string;
  account_name: string;
  account_type: string;
  period: string;
  budgeted_amount: number;
}

interface BvaRow {
  account_id: string;
  account_number: string;
  account_name: string;
  account_type: string;
  budget_amount: number;
  actual_amount: number;
  variance_amount: number;
  variance_percent: number;
  favorable: boolean;
}

interface BvaSummary {
  total_revenue_budget: number;
  total_revenue_actual: number;
  total_expense_budget: number;
  total_expense_actual: number;
  net_budget: number;
  net_actual: number;
}

interface BvaReport {
  fiscal_year: number;
  rows: BvaRow[];
  summary: BvaSummary;
}

type TabId = "entry" | "report";

// ── Helpers ──────────────────────────────────────────────────────────

function fmtCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(n);
}

function fmtPercent(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(n / 100);
}

// ── Main Page ────────────────────────────────────────────────────────

export default function BudgetPage() {
  const [activeTab, setActiveTab] = useState<TabId>("entry");

  // Shared state
  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Budget Entry state
  const [entryYear, setEntryYear] = useState(new Date().getFullYear());
  const [budgetAmounts, setBudgetAmounts] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Report state
  const [reportYear, setReportYear] = useState(new Date().getFullYear());
  const [reportData, setReportData] = useState<BvaReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);

  // ── Load accounts ────────────────────────────────────────────────

  const loadAccounts = useCallback(async () => {
    try {
      const res = await fetch("/api/accounting/accounts?active_only=true");
      if (res.ok) {
        const list = await res.json();
        setAccounts(
          (Array.isArray(list) ? list : []).map(
            (a: { id: string; account_number: string; name: string; account_type: string }) => ({
              id: a.id,
              account_number: a.account_number,
              name: a.name,
              account_type: a.account_type,
            })
          )
        );
      }
    } catch {
      /* ignore */
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  // ── Load existing budgets for entry tab ──────────────────────────

  const loadBudgets = useCallback(async () => {
    try {
      const res = await fetch(`/api/accounting/budget?fiscal_year=${entryYear}`);
      if (res.ok) {
        const records: BudgetRecord[] = await res.json();
        const map: Record<string, number> = {};
        for (const r of records) {
          map[r.account_id] = r.budgeted_amount;
        }
        setBudgetAmounts(map);
      } else {
        setBudgetAmounts({});
      }
    } catch {
      setBudgetAmounts({});
    }
  }, [entryYear]);

  useEffect(() => {
    if (activeTab === "entry") loadBudgets();
  }, [activeTab, loadBudgets]);

  // ── Filtered accounts by type ────────────────────────────────────

  const revenueAccounts = useMemo(
    () => accounts.filter((a) => a.account_type === "revenue"),
    [accounts]
  );

  const expenseAccounts = useMemo(
    () => accounts.filter((a) => a.account_type === "expense"),
    [accounts]
  );

  // ── Budget entry totals ──────────────────────────────────────────

  const revenueTotal = useMemo(
    () => revenueAccounts.reduce((s, a) => s + (budgetAmounts[a.id] || 0), 0),
    [revenueAccounts, budgetAmounts]
  );

  const expenseTotal = useMemo(
    () => expenseAccounts.reduce((s, a) => s + (budgetAmounts[a.id] || 0), 0),
    [expenseAccounts, budgetAmounts]
  );

  // ── Save budget ──────────────────────────────────────────────────

  async function handleSaveBudget() {
    setSaving(true);
    setError("");
    setSaveSuccess(false);
    try {
      const entries = [...revenueAccounts, ...expenseAccounts]
        .filter((a) => (budgetAmounts[a.id] || 0) > 0)
        .map((a) => ({
          account_id: a.id,
          period: "annual",
          budgeted_amount: budgetAmounts[a.id] || 0,
        }));

      const res = await fetch("/api/accounting/budget", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fiscal_year: entryYear, entries }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save budget");
      }

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
    setSaving(false);
  }

  // ── Generate report ──────────────────────────────────────────────

  async function generateReport() {
    setReportLoading(true);
    setError("");
    setReportData(null);
    try {
      const res = await fetch(
        `/api/accounting/budget?fiscal_year=${reportYear}&report=true`
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to generate report");
      }
      setReportData(await res.json());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
    setReportLoading(false);
  }

  // ── Report grouped rows ──────────────────────────────────────────

  const reportRevenue = useMemo(
    () => (reportData?.rows || []).filter((r) => r.account_type === "revenue"),
    [reportData]
  );

  const reportExpenses = useMemo(
    () => (reportData?.rows || []).filter((r) => r.account_type === "expense"),
    [reportData]
  );

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

        {/* Tab Toggle */}
        <div className="flex items-center gap-1 mb-6 bg-gray-900 rounded-xl p-1 w-fit">
          {([
            { id: "entry" as TabId, label: "Budget Entry" },
            { id: "report" as TabId, label: "Budget vs. Actual Report" },
          ]).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 rounded-lg text-xs sm:text-sm font-bold uppercase tracking-wider transition-colors ${
                activeTab === tab.id
                  ? "bg-gray-800 text-white"
                  : "text-gray-500 hover:text-gray-300"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
          </div>
        ) : (
          <>
            {/* ── Budget Entry Tab ──────────────────────────────────── */}
            {activeTab === "entry" && (
              <div className="space-y-6">
                {/* Fiscal Year + Save */}
                <div className="flex flex-wrap items-end gap-4">
                  <div>
                    <label className="block text-xs text-gray-600 uppercase tracking-wider mb-1">
                      Fiscal Year
                    </label>
                    <input
                      type="number"
                      value={entryYear}
                      onChange={(e) =>
                        setEntryYear(parseInt(e.target.value) || new Date().getFullYear())
                      }
                      min={2020}
                      max={2099}
                      className="w-32 px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm font-mono focus:outline-none focus:border-gray-500"
                    />
                  </div>
                  <button
                    onClick={handleSaveBudget}
                    disabled={saving}
                    className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-bold uppercase tracking-wider transition-colors"
                  >
                    {saving ? "Saving..." : "Save Budget"}
                  </button>
                  {saveSuccess && (
                    <span className="text-sm text-emerald-400 font-medium">
                      Budget saved
                    </span>
                  )}
                </div>

                {/* Revenue Section */}
                {revenueAccounts.length > 0 && (
                  <div className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden overflow-x-auto">
                    <table className="w-full text-sm min-w-[600px]">
                      <thead>
                        <tr className="bg-gray-800/40">
                          <th colSpan={3} className="px-4 py-2.5 text-left">
                            <div className="flex items-center gap-2">
                              <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                              <span className="text-xs font-bold uppercase tracking-wider text-gray-300">
                                Revenue
                              </span>
                            </div>
                          </th>
                        </tr>
                        <tr className="text-xs uppercase tracking-wider text-gray-600 border-b border-gray-800">
                          <th className="text-left px-4 py-3 font-medium w-28">Acct #</th>
                          <th className="text-left px-4 py-3 font-medium">Account Name</th>
                          <th className="text-right px-4 py-3 font-medium w-44">Budget</th>
                        </tr>
                      </thead>
                      <tbody>
                        {revenueAccounts.map((acct) => (
                          <tr
                            key={acct.id}
                            className="border-t border-gray-800/50 hover:bg-gray-800/20 transition-colors"
                          >
                            <td className="px-4 py-2.5 font-mono text-gray-400 text-xs">
                              {acct.account_number}
                            </td>
                            <td className="px-4 py-2.5 text-gray-200">
                              {acct.name}
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <input
                                type="number"
                                min={0}
                                step={0.01}
                                value={budgetAmounts[acct.id] || ""}
                                onChange={(e) =>
                                  setBudgetAmounts((prev) => ({
                                    ...prev,
                                    [acct.id]: parseFloat(e.target.value) || 0,
                                  }))
                                }
                                placeholder="0.00"
                                className="w-36 px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm font-mono text-right focus:outline-none focus:border-gray-500 placeholder-gray-600"
                              />
                            </td>
                          </tr>
                        ))}
                        {/* Revenue Total */}
                        <tr className="border-t border-gray-700 bg-gray-800/40">
                          <td colSpan={2} className="px-4 py-2.5 text-right">
                            <span className="text-xs uppercase tracking-wider text-gray-500">
                              Revenue Total
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono text-emerald-400 font-bold">
                            {fmtCurrency(revenueTotal)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Expense Section */}
                {expenseAccounts.length > 0 && (
                  <div className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden overflow-x-auto">
                    <table className="w-full text-sm min-w-[600px]">
                      <thead>
                        <tr className="bg-gray-800/40">
                          <th colSpan={3} className="px-4 py-2.5 text-left">
                            <div className="flex items-center gap-2">
                              <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
                              <span className="text-xs font-bold uppercase tracking-wider text-gray-300">
                                Expenses
                              </span>
                            </div>
                          </th>
                        </tr>
                        <tr className="text-xs uppercase tracking-wider text-gray-600 border-b border-gray-800">
                          <th className="text-left px-4 py-3 font-medium w-28">Acct #</th>
                          <th className="text-left px-4 py-3 font-medium">Account Name</th>
                          <th className="text-right px-4 py-3 font-medium w-44">Budget</th>
                        </tr>
                      </thead>
                      <tbody>
                        {expenseAccounts.map((acct) => (
                          <tr
                            key={acct.id}
                            className="border-t border-gray-800/50 hover:bg-gray-800/20 transition-colors"
                          >
                            <td className="px-4 py-2.5 font-mono text-gray-400 text-xs">
                              {acct.account_number}
                            </td>
                            <td className="px-4 py-2.5 text-gray-200">
                              {acct.name}
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <input
                                type="number"
                                min={0}
                                step={0.01}
                                value={budgetAmounts[acct.id] || ""}
                                onChange={(e) =>
                                  setBudgetAmounts((prev) => ({
                                    ...prev,
                                    [acct.id]: parseFloat(e.target.value) || 0,
                                  }))
                                }
                                placeholder="0.00"
                                className="w-36 px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm font-mono text-right focus:outline-none focus:border-gray-500 placeholder-gray-600"
                              />
                            </td>
                          </tr>
                        ))}
                        {/* Expense Total */}
                        <tr className="border-t border-gray-700 bg-gray-800/40">
                          <td colSpan={2} className="px-4 py-2.5 text-right">
                            <span className="text-xs uppercase tracking-wider text-gray-500">
                              Expense Total
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono text-red-400 font-bold">
                            {fmtCurrency(expenseTotal)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Net Budget */}
                <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs uppercase tracking-wider text-gray-600 font-medium">
                      Net Budgeted Income
                    </span>
                    <span
                      className={`text-xl font-black font-mono ${
                        revenueTotal - expenseTotal >= 0
                          ? "text-emerald-400"
                          : "text-red-400"
                      }`}
                    >
                      {fmtCurrency(revenueTotal - expenseTotal)}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* ── Budget vs. Actual Report Tab ─────────────────────── */}
            {activeTab === "report" && (
              <div className="space-y-6">
                {/* Controls */}
                <div className="flex flex-wrap items-end gap-4">
                  <div>
                    <label className="block text-xs text-gray-600 uppercase tracking-wider mb-1">
                      Fiscal Year
                    </label>
                    <input
                      type="number"
                      value={reportYear}
                      onChange={(e) =>
                        setReportYear(parseInt(e.target.value) || new Date().getFullYear())
                      }
                      min={2020}
                      max={2099}
                      className="w-32 px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm font-mono focus:outline-none focus:border-gray-500"
                    />
                  </div>
                  <button
                    onClick={generateReport}
                    disabled={reportLoading}
                    className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-bold uppercase tracking-wider transition-colors"
                  >
                    {reportLoading ? "Loading..." : "Generate Report"}
                  </button>
                </div>

                {/* Report Loading */}
                {reportLoading && (
                  <div className="flex items-center justify-center py-12">
                    <div className="w-8 h-8 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
                  </div>
                )}

                {/* Report Content */}
                {reportData && !reportLoading && (
                  <>
                    {/* Summary Cards */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="rounded-xl bg-gray-900/50 border border-gray-800 p-4">
                        <p className="text-xs uppercase tracking-wider text-gray-600 font-medium">
                          Revenue
                        </p>
                        <p className="text-lg font-black text-emerald-400 mt-1">
                          {fmtCurrency(reportData.summary.total_revenue_actual)}
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          Budget: {fmtCurrency(reportData.summary.total_revenue_budget)}
                        </p>
                      </div>

                      <div className="rounded-xl bg-gray-900/50 border border-gray-800 p-4">
                        <p className="text-xs uppercase tracking-wider text-gray-600 font-medium">
                          Expenses
                        </p>
                        <p className="text-lg font-black text-red-400 mt-1">
                          {fmtCurrency(reportData.summary.total_expense_actual)}
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          Budget: {fmtCurrency(reportData.summary.total_expense_budget)}
                        </p>
                      </div>

                      <div className="rounded-xl bg-gray-900/50 border border-gray-800 p-4">
                        <p className="text-xs uppercase tracking-wider text-gray-600 font-medium">
                          Net Income
                        </p>
                        <p
                          className={`text-lg font-black mt-1 ${
                            reportData.summary.net_actual >= 0
                              ? "text-emerald-400"
                              : "text-red-400"
                          }`}
                        >
                          {fmtCurrency(reportData.summary.net_actual)}
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          Budget: {fmtCurrency(reportData.summary.net_budget)}
                        </p>
                      </div>

                      <div className="rounded-xl bg-gray-900/50 border border-gray-800 p-4">
                        <p className="text-xs uppercase tracking-wider text-gray-600 font-medium">
                          Overall Variance
                        </p>
                        <p
                          className={`text-lg font-black mt-1 ${
                            reportData.summary.net_actual - reportData.summary.net_budget >= 0
                              ? "text-emerald-400"
                              : "text-red-400"
                          }`}
                        >
                          {fmtCurrency(
                            reportData.summary.net_actual - reportData.summary.net_budget
                          )}
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {reportData.summary.net_budget !== 0
                            ? fmtPercent(
                                ((reportData.summary.net_actual -
                                  reportData.summary.net_budget) /
                                  Math.abs(reportData.summary.net_budget)) *
                                  100
                              )
                            : "N/A"}{" "}
                          of budget
                        </p>
                      </div>
                    </div>

                    {/* Report Table */}
                    <div className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden overflow-x-auto">
                      <table className="w-full text-sm min-w-[800px]">
                        <thead>
                          <tr className="text-xs uppercase tracking-wider text-gray-600 border-b border-gray-800">
                            <th className="text-left px-4 py-3 font-medium">Account</th>
                            <th className="text-right px-4 py-3 font-medium w-28">Budget</th>
                            <th className="text-right px-4 py-3 font-medium w-28">Actual</th>
                            <th className="text-right px-4 py-3 font-medium w-28">Variance $</th>
                            <th className="text-right px-4 py-3 font-medium w-24">Variance %</th>
                            <th className="text-center px-4 py-3 font-medium w-28">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {/* Revenue Section */}
                          {reportRevenue.length > 0 && (
                            <>
                              <tr className="bg-gray-800/40">
                                <td colSpan={6} className="px-4 py-2">
                                  <div className="flex items-center gap-2">
                                    <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                                    <span className="text-xs font-bold uppercase tracking-wider text-gray-300">
                                      Revenue
                                    </span>
                                  </div>
                                </td>
                              </tr>
                              {reportRevenue.map((row) => (
                                <tr
                                  key={row.account_id}
                                  className="border-t border-gray-800/50 hover:bg-gray-800/20 transition-colors"
                                >
                                  <td className="px-4 py-2.5">
                                    <span className="font-mono text-gray-400 text-xs mr-2">
                                      {row.account_number}
                                    </span>
                                    <span className="text-gray-200">{row.account_name}</span>
                                  </td>
                                  <td className="px-4 py-2.5 text-right font-mono text-gray-300">
                                    {fmtCurrency(row.budget_amount)}
                                  </td>
                                  <td className="px-4 py-2.5 text-right font-mono text-gray-300">
                                    {fmtCurrency(row.actual_amount)}
                                  </td>
                                  <td
                                    className={`px-4 py-2.5 text-right font-mono font-medium ${
                                      row.favorable ? "text-emerald-400" : "text-red-400"
                                    }`}
                                  >
                                    {fmtCurrency(row.variance_amount)}
                                  </td>
                                  <td
                                    className={`px-4 py-2.5 text-right font-mono font-medium ${
                                      row.favorable ? "text-emerald-400" : "text-red-400"
                                    }`}
                                  >
                                    {fmtPercent(row.variance_percent)}
                                  </td>
                                  <td className="px-4 py-2.5 text-center">
                                    <span
                                      className={`inline-block px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider ${
                                        row.favorable
                                          ? "bg-emerald-900/60 text-emerald-300"
                                          : "bg-red-900/60 text-red-300"
                                      }`}
                                    >
                                      {row.favorable ? "Favorable" : "Unfavorable"}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                              {/* Revenue Total */}
                              <tr className="border-t border-gray-700">
                                <td className="px-4 py-2 text-right">
                                  <span className="text-xs uppercase tracking-wider text-gray-500">
                                    Revenue Total
                                  </span>
                                </td>
                                <td className="px-4 py-2 text-right font-mono text-gray-200 font-medium">
                                  {fmtCurrency(reportData.summary.total_revenue_budget)}
                                </td>
                                <td className="px-4 py-2 text-right font-mono text-gray-200 font-medium">
                                  {fmtCurrency(reportData.summary.total_revenue_actual)}
                                </td>
                                <td
                                  className={`px-4 py-2 text-right font-mono font-bold ${
                                    reportData.summary.total_revenue_actual >=
                                    reportData.summary.total_revenue_budget
                                      ? "text-emerald-400"
                                      : "text-red-400"
                                  }`}
                                >
                                  {fmtCurrency(
                                    reportData.summary.total_revenue_actual -
                                      reportData.summary.total_revenue_budget
                                  )}
                                </td>
                                <td className="px-4 py-2" />
                                <td className="px-4 py-2" />
                              </tr>
                            </>
                          )}

                          {/* Expense Section */}
                          {reportExpenses.length > 0 && (
                            <>
                              <tr className="bg-gray-800/40">
                                <td colSpan={6} className="px-4 py-2">
                                  <div className="flex items-center gap-2">
                                    <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
                                    <span className="text-xs font-bold uppercase tracking-wider text-gray-300">
                                      Expenses
                                    </span>
                                  </div>
                                </td>
                              </tr>
                              {reportExpenses.map((row) => (
                                <tr
                                  key={row.account_id}
                                  className="border-t border-gray-800/50 hover:bg-gray-800/20 transition-colors"
                                >
                                  <td className="px-4 py-2.5">
                                    <span className="font-mono text-gray-400 text-xs mr-2">
                                      {row.account_number}
                                    </span>
                                    <span className="text-gray-200">{row.account_name}</span>
                                  </td>
                                  <td className="px-4 py-2.5 text-right font-mono text-gray-300">
                                    {fmtCurrency(row.budget_amount)}
                                  </td>
                                  <td className="px-4 py-2.5 text-right font-mono text-gray-300">
                                    {fmtCurrency(row.actual_amount)}
                                  </td>
                                  <td
                                    className={`px-4 py-2.5 text-right font-mono font-medium ${
                                      row.favorable ? "text-emerald-400" : "text-red-400"
                                    }`}
                                  >
                                    {fmtCurrency(row.variance_amount)}
                                  </td>
                                  <td
                                    className={`px-4 py-2.5 text-right font-mono font-medium ${
                                      row.favorable ? "text-emerald-400" : "text-red-400"
                                    }`}
                                  >
                                    {fmtPercent(row.variance_percent)}
                                  </td>
                                  <td className="px-4 py-2.5 text-center">
                                    <span
                                      className={`inline-block px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider ${
                                        row.favorable
                                          ? "bg-emerald-900/60 text-emerald-300"
                                          : "bg-red-900/60 text-red-300"
                                      }`}
                                    >
                                      {row.favorable ? "Favorable" : "Unfavorable"}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                              {/* Expense Total */}
                              <tr className="border-t border-gray-700">
                                <td className="px-4 py-2 text-right">
                                  <span className="text-xs uppercase tracking-wider text-gray-500">
                                    Expense Total
                                  </span>
                                </td>
                                <td className="px-4 py-2 text-right font-mono text-gray-200 font-medium">
                                  {fmtCurrency(reportData.summary.total_expense_budget)}
                                </td>
                                <td className="px-4 py-2 text-right font-mono text-gray-200 font-medium">
                                  {fmtCurrency(reportData.summary.total_expense_actual)}
                                </td>
                                <td
                                  className={`px-4 py-2 text-right font-mono font-bold ${
                                    reportData.summary.total_expense_actual <=
                                    reportData.summary.total_expense_budget
                                      ? "text-emerald-400"
                                      : "text-red-400"
                                  }`}
                                >
                                  {fmtCurrency(
                                    reportData.summary.total_expense_budget -
                                      reportData.summary.total_expense_actual
                                  )}
                                </td>
                                <td className="px-4 py-2" />
                                <td className="px-4 py-2" />
                              </tr>
                            </>
                          )}

                          {/* Net Income Row */}
                          <tr className="border-t-2 border-gray-600 bg-gray-800/60">
                            <td className="px-4 py-3 text-right">
                              <span className="text-xs font-bold uppercase tracking-wider text-gray-200">
                                Net Income
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-white font-bold text-base">
                              {fmtCurrency(reportData.summary.net_budget)}
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-white font-bold text-base">
                              {fmtCurrency(reportData.summary.net_actual)}
                            </td>
                            <td
                              className={`px-4 py-3 text-right font-mono font-bold text-base ${
                                reportData.summary.net_actual >= reportData.summary.net_budget
                                  ? "text-emerald-400"
                                  : "text-red-400"
                              }`}
                            >
                              {fmtCurrency(
                                reportData.summary.net_actual - reportData.summary.net_budget
                              )}
                            </td>
                            <td
                              className={`px-4 py-3 text-right font-mono font-bold ${
                                reportData.summary.net_actual >= reportData.summary.net_budget
                                  ? "text-emerald-400"
                                  : "text-red-400"
                              }`}
                            >
                              {reportData.summary.net_budget !== 0
                                ? fmtPercent(
                                    ((reportData.summary.net_actual -
                                      reportData.summary.net_budget) /
                                      Math.abs(reportData.summary.net_budget)) *
                                      100
                                  )
                                : "N/A"}
                            </td>
                            <td className="px-4 py-3 text-center">
                              <span
                                className={`inline-block px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider ${
                                  reportData.summary.net_actual >= reportData.summary.net_budget
                                    ? "bg-emerald-900/60 text-emerald-300"
                                    : "bg-red-900/60 text-red-300"
                                }`}
                              >
                                {reportData.summary.net_actual >= reportData.summary.net_budget
                                  ? "Favorable"
                                  : "Unfavorable"}
                              </span>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </>
                )}

                {/* Empty state */}
                {!reportData && !reportLoading && (
                  <div className="text-center py-20">
                    <p className="text-gray-600 text-sm">
                      Select a fiscal year and click Generate Report
                    </p>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
