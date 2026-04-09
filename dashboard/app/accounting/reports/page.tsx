"use client";

import { useState, useMemo, useCallback } from "react";
import { useUser } from "@clerk/nextjs";
import type { AccountType, TrialBalanceSummary, TrialBalanceRow } from "@ironsight/shared";
import ComplianceDisclaimer from "@/components/ComplianceDisclaimer";
import {
  ACCOUNT_TYPE_LABELS,
  ACCOUNT_TYPE_COLORS,
} from "@ironsight/shared";

// ── Types for new reports ────────────────────────────────────────────

interface BalanceSheetAccount {
  account_id: string;
  account_number: number;
  account_name: string;
  balance: number;
}

interface BalanceSheetSection {
  label: string;
  accounts: BalanceSheetAccount[];
  total: number;
}

interface BalanceSheetData {
  as_of_date: string;
  assets: BalanceSheetSection;
  liabilities: BalanceSheetSection;
  equity: BalanceSheetSection;
  retained_earnings: number;
  total_equity_with_re: number;
  total_liabilities_and_equity: number;
  is_balanced: boolean;
}

interface GLLine {
  line_id: string;
  entry_id: string;
  entry_date: string;
  entry_description: string;
  reference: string | null;
  source: string;
  account_id: string;
  account_number: number;
  account_name: string;
  account_type: string;
  line_description: string | null;
  debit: number;
  credit: number;
  running_balance: number;
}

interface GLData {
  lines: GLLine[];
  count: number;
  start_date: string | null;
  end_date: string;
  account_id: string | null;
}

interface AccountOption {
  id: string;
  account_number: number;
  name: string;
  account_type: string;
}

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

// ── Balance Sheet Section ────────────────────────────────────────────

function BalanceSheetReport({ data }: { data: BalanceSheetData }) {
  function SectionTable({ section, color }: { section: BalanceSheetSection; color: string }) {
    return (
      <>
        <tr className="bg-gray-800/40">
          <td colSpan={3} className="px-4 py-2">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
              <span className="text-xs font-bold uppercase tracking-wider text-gray-300">
                {section.label}
              </span>
            </div>
          </td>
        </tr>
        {section.accounts.length === 0 ? (
          <tr>
            <td colSpan={3} className="px-4 py-3 text-center text-gray-600 text-xs">
              No {section.label.toLowerCase()} accounts with balances
            </td>
          </tr>
        ) : (
          section.accounts.map((acct) => (
            <tr key={acct.account_id} className="border-t border-gray-800/50 hover:bg-gray-800/20 transition-colors">
              <td className="px-4 py-2.5 font-mono text-gray-400 text-xs">{acct.account_number}</td>
              <td className="px-4 py-2.5 text-gray-200">{acct.account_name}</td>
              <td className="px-4 py-2.5 text-right font-mono text-gray-300">{fmtCurrency(acct.balance)}</td>
            </tr>
          ))
        )}
        <tr className="border-t border-gray-700">
          <td colSpan={2} className="px-4 py-2 text-right">
            <span className="text-[10px] uppercase tracking-wider text-gray-500">
              Total {section.label}
            </span>
          </td>
          <td className="px-4 py-2 text-right font-mono text-gray-200 font-medium border-t border-gray-700">
            {fmtCurrency(section.total)}
          </td>
        </tr>
      </>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-black uppercase tracking-widest text-gray-100">
          Balance Sheet
        </h2>
        {data.is_balanced ? (
          <span className="inline-block px-3 py-1 rounded-lg text-xs font-bold uppercase tracking-wider bg-emerald-900/60 text-emerald-300 border border-emerald-700/50">
            A = L + E
          </span>
        ) : (
          <span className="inline-block px-3 py-1 rounded-lg text-xs font-bold uppercase tracking-wider bg-red-900/60 text-red-300 border border-red-700/50">
            UNBALANCED
          </span>
        )}
      </div>

      <p className="text-xs text-gray-500 tracking-wide">As of {data.as_of_date}</p>

      <div className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden overflow-x-auto">
        <table className="w-full text-sm min-w-[480px]">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-gray-600 border-b border-gray-800">
              <th className="text-left px-4 py-3 font-medium w-28">Acct #</th>
              <th className="text-left px-4 py-3 font-medium">Account</th>
              <th className="text-right px-4 py-3 font-medium w-36">Balance</th>
            </tr>
          </thead>
          <tbody>
            {/* Assets */}
            <SectionTable section={data.assets} color={ACCOUNT_TYPE_COLORS.asset} />

            {/* Total Assets grand total */}
            <tr className="border-t-2 border-gray-600 bg-gray-800/60">
              <td colSpan={2} className="px-4 py-3 text-right">
                <span className="text-xs font-bold uppercase tracking-wider text-gray-200">
                  Total Assets
                </span>
              </td>
              <td className="px-4 py-3 text-right font-mono text-white font-bold text-base">
                {fmtCurrency(data.assets.total)}
              </td>
            </tr>

            {/* Spacer */}
            <tr><td colSpan={3} className="h-4" /></tr>

            {/* Liabilities */}
            <SectionTable section={data.liabilities} color={ACCOUNT_TYPE_COLORS.liability} />

            {/* Equity */}
            <SectionTable section={data.equity} color={ACCOUNT_TYPE_COLORS.equity} />

            {/* Retained Earnings */}
            <tr className="border-t border-gray-800/50 hover:bg-gray-800/20 transition-colors">
              <td className="px-4 py-2.5 font-mono text-gray-400 text-xs" />
              <td className="px-4 py-2.5 text-gray-200 italic">Retained Earnings (Net Income)</td>
              <td className={`px-4 py-2.5 text-right font-mono ${data.retained_earnings >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {data.retained_earnings >= 0 ? fmtCurrency(data.retained_earnings) : `(${fmtCurrency(Math.abs(data.retained_earnings))})`}
              </td>
            </tr>

            {/* Total L+E */}
            <tr className="border-t-2 border-gray-600 bg-gray-800/60">
              <td colSpan={2} className="px-4 py-3 text-right">
                <span className="text-xs font-bold uppercase tracking-wider text-gray-200">
                  Total Liabilities + Equity
                </span>
              </td>
              <td className="px-4 py-3 text-right font-mono text-white font-bold text-base">
                {fmtCurrency(data.total_liabilities_and_equity)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── General Ledger Section ───────────────────────────────────────────

function GeneralLedgerReport({ data }: { data: GLData }) {
  // Group lines by account
  const grouped = useMemo(() => {
    const map = new Map<string, { account_number: number; account_name: string; account_type: string; lines: GLLine[] }>();
    for (const line of data.lines) {
      const key = line.account_id;
      if (!map.has(key)) {
        map.set(key, {
          account_number: line.account_number,
          account_name: line.account_name,
          account_type: line.account_type,
          lines: [],
        });
      }
      map.get(key)!.lines.push(line);
    }
    return [...map.entries()].sort((a, b) => a[1].account_number - b[1].account_number);
  }, [data.lines]);

  if (data.lines.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-600 text-sm">No posted transactions found for this period.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-black uppercase tracking-widest text-gray-100">
        General Ledger
      </h2>
      <p className="text-xs text-gray-500 tracking-wide">
        {data.start_date ? `${data.start_date} through ${data.end_date}` : `Through ${data.end_date}`}
        {" "} &mdash; {data.count} transaction{data.count !== 1 ? "s" : ""}
      </p>

      {grouped.map(([accountId, group]) => {
        const color = ACCOUNT_TYPE_COLORS[group.account_type as AccountType] || "#6b7280";
        return (
          <div key={accountId} className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden overflow-x-auto">
            {/* Account header */}
            <div className="px-4 py-3 bg-gray-800/40 flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
              <span className="font-mono text-gray-400 text-xs">{group.account_number}</span>
              <span className="font-bold text-gray-200 text-sm">{group.account_name}</span>
              <span className="text-xs font-medium ml-auto" style={{ color }}>
                {ACCOUNT_TYPE_LABELS[group.account_type as AccountType]}
              </span>
            </div>

            <table className="w-full text-sm min-w-[700px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-gray-600 border-b border-gray-800">
                  <th className="text-left px-4 py-2 font-medium w-24">Date</th>
                  <th className="text-left px-4 py-2 font-medium">Description</th>
                  <th className="text-left px-4 py-2 font-medium w-20">Ref</th>
                  <th className="text-right px-4 py-2 font-medium w-28">Debit</th>
                  <th className="text-right px-4 py-2 font-medium w-28">Credit</th>
                  <th className="text-right px-4 py-2 font-medium w-32">Balance</th>
                </tr>
              </thead>
              <tbody>
                {group.lines.map((line) => (
                  <tr key={line.line_id} className="border-t border-gray-800/50 hover:bg-gray-800/20 transition-colors">
                    <td className="px-4 py-2 font-mono text-gray-400 text-xs">{line.entry_date}</td>
                    <td className="px-4 py-2 text-gray-200 text-xs">
                      {line.entry_description}
                      {line.line_description && line.line_description !== line.entry_description && (
                        <span className="text-gray-500 ml-1">— {line.line_description}</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-gray-500 text-xs">{line.reference || ""}</td>
                    <td className="px-4 py-2 text-right font-mono text-gray-300">
                      {line.debit > 0 ? fmtCurrency(line.debit) : ""}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-gray-300">
                      {line.credit > 0 ? fmtCurrency(line.credit) : ""}
                    </td>
                    <td className={`px-4 py-2 text-right font-mono font-medium ${line.running_balance >= 0 ? "text-gray-200" : "text-red-400"}`}>
                      {line.running_balance >= 0 ? fmtCurrency(line.running_balance) : `(${fmtCurrency(Math.abs(line.running_balance))})`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────

// ── Aging Report types ──────────────────────────────────────────────

interface AgingRow {
  entity_id: string;
  entity_name: string;
  current: number;
  days_30: number;
  days_60: number;
  days_90: number;
  days_120_plus: number;
  total: number;
}

interface AgingData {
  type: string;
  as_of: string;
  rows: AgingRow[];
  totals: { current: number; days_30: number; days_60: number; days_90: number; days_120_plus: number; total: number };
}

// ── Cash Flow types ─────────────────────────────────────────────────

interface CashFlowItem { name: string; amount: number }
interface CashFlowSection { label: string; items?: CashFlowItem[]; adjustments?: CashFlowItem[]; total: number; net_income?: number; total_adjustments?: number }
interface CashFlowData {
  start_date: string;
  end_date: string;
  net_income: number;
  operating: CashFlowSection;
  investing: CashFlowSection;
  financing: CashFlowSection;
  net_cash_change: number;
}

type ReportTab = "trial-balance" | "profit-loss" | "balance-sheet" | "general-ledger" | "aging" | "cash-flow";

export default function FinancialReportsPage() {
  const { user, isLoaded } = useUser();
  const role =
    ((user?.publicMetadata as Record<string, unknown>)?.role as string) ||
    "operator";

  const [asOf, setAsOf] = useState(todayISO());
  const [data, setData] = useState<TrialBalanceSummary | null>(null);
  const [bsData, setBsData] = useState<BalanceSheetData | null>(null);
  const [glData, setGlData] = useState<GLData | null>(null);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [glAccountId, setGlAccountId] = useState("");
  const [agingData, setAgingData] = useState<AgingData | null>(null);
  const [agingType, setAgingType] = useState<"ar" | "ap">("ar");
  const [cashFlowData, setCashFlowData] = useState<CashFlowData | null>(null);
  const [cfStartDate, setCfStartDate] = useState(() => {
    const d = new Date();
    d.setMonth(0, 1);
    return d.toISOString().split("T")[0];
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<ReportTab>("trial-balance");

  // Load account list for GL filter (once on first GL tab switch)
  const loadAccounts = useCallback(async () => {
    if (accounts.length > 0) return;
    try {
      const res = await fetch("/api/accounting/accounts?active_only=true");
      if (res.ok) {
        const list = await res.json();
        setAccounts(list.map((a: { id: string; account_number: number; name: string; account_type: string }) => ({
          id: a.id,
          account_number: a.account_number,
          name: a.name,
          account_type: a.account_type,
        })));
      }
    } catch { /* ignore */ }
  }, [accounts.length]);

  async function generate() {
    setLoading(true);
    setError("");
    setData(null);
    setBsData(null);
    setGlData(null);
    setAgingData(null);
    setCashFlowData(null);

    try {
      if (activeTab === "aging") {
        const res = await fetch(`/api/accounting/aging?type=${agingType}&as_of=${encodeURIComponent(asOf)}`);
        if (!res.ok) {
          const b = await res.json().catch(() => ({}));
          throw new Error(b.error || `HTTP ${res.status}`);
        }
        setAgingData(await res.json());
      } else if (activeTab === "cash-flow") {
        const res = await fetch(`/api/accounting/cash-flow?start_date=${encodeURIComponent(cfStartDate)}&end_date=${encodeURIComponent(asOf)}`);
        if (!res.ok) {
          const b = await res.json().catch(() => ({}));
          throw new Error(b.error || `HTTP ${res.status}`);
        }
        setCashFlowData(await res.json());
      } else if (activeTab === "balance-sheet") {
        const res = await fetch(`/api/accounting/balance-sheet?as_of=${encodeURIComponent(asOf)}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        setBsData(await res.json());
      } else if (activeTab === "general-ledger") {
        const params = new URLSearchParams({ end_date: asOf });
        if (glAccountId) params.set("account_id", glAccountId);
        const res = await fetch(`/api/accounting/general-ledger?${params}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        setGlData(await res.json());
      } else {
        // Trial balance + P&L share the same data
        const res = await fetch(`/api/accounting/trial-balance?as_of=${encodeURIComponent(asOf)}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        setData(await res.json());
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load report");
    } finally {
      setLoading(false);
    }
  }

  const hasData = data || bsData || glData || agingData || cashFlowData;

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="w-10 h-10 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
      </div>
    );
  }

  if (role !== "developer" && role !== "manager") {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="text-center">
          <h1 className="text-xl font-bold text-gray-300">Access Denied</h1>
          <p className="text-sm text-gray-600 mt-2">Financial reports are restricted to managers and developers.</p>
          <a href="/accounting" className="inline-block mt-4 text-sm text-purple-400 hover:text-purple-300 underline">Back to Accounting</a>
        </div>
      </div>
    );
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


      <main className="px-4 sm:px-6 py-6 max-w-6xl mx-auto">
        <ComplianceDisclaimer variant="financial" className="mb-4 no-print" />

        {/* Tab toggle — always visible */}
        <div className="flex flex-wrap items-center gap-1 mb-6 bg-gray-900 rounded-xl p-1 w-fit no-print">
          {(["trial-balance", "profit-loss", "balance-sheet", "general-ledger", "aging", "cash-flow"] as ReportTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => {
                setActiveTab(tab);
                if (tab === "general-ledger") loadAccounts();
              }}
              className={`px-4 py-2 rounded-lg text-xs sm:text-sm font-bold uppercase tracking-wider transition-colors ${
                activeTab === tab
                  ? "bg-gray-800 text-white"
                  : "text-gray-500 hover:text-gray-300"
              }`}
            >
              {tab === "trial-balance" ? "Trial Balance" :
               tab === "profit-loss" ? "P&L" :
               tab === "balance-sheet" ? "Balance Sheet" :
               tab === "general-ledger" ? "General Ledger" :
               tab === "aging" ? "Aging" :
               "Cash Flow"}
            </button>
          ))}
        </div>

        {/* Controls row */}
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

          {/* Aging type selector */}
          {activeTab === "aging" && (
            <div>
              <label className="block text-[10px] text-gray-600 uppercase tracking-wider mb-1">Type</label>
              <select value={agingType} onChange={(e) => setAgingType(e.target.value as "ar" | "ap")}
                className="px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white">
                <option value="ar">Accounts Receivable</option>
                <option value="ap">Accounts Payable</option>
              </select>
            </div>
          )}

          {/* Cash flow start date */}
          {activeTab === "cash-flow" && (
            <div>
              <label className="block text-[10px] text-gray-600 uppercase tracking-wider mb-1">Start Date</label>
              <input type="date" value={cfStartDate} onChange={(e) => setCfStartDate(e.target.value)}
                className="px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white [color-scheme:dark]" />
            </div>
          )}

          {/* Account filter for GL */}
          {activeTab === "general-ledger" && (
            <div>
              <label className="block text-[10px] text-gray-600 uppercase tracking-wider mb-1">
                Account
              </label>
              <select
                value={glAccountId}
                onChange={(e) => setGlAccountId(e.target.value)}
                className="px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white focus:outline-none focus:border-gray-600 min-w-[200px]"
              >
                <option value="">All Accounts</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.account_number} — {a.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <button
            onClick={generate}
            disabled={loading}
            className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-bold uppercase tracking-wider transition-colors"
          >
            {loading ? "Loading..." : "Generate"}
          </button>

          {hasData && (
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
        {!hasData && !loading && !error && (
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
        {!loading && (
          <>
            {activeTab === "trial-balance" && data && <TrialBalanceReport data={data} />}
            {activeTab === "profit-loss" && data && <ProfitLossReport data={data} />}
            {activeTab === "balance-sheet" && bsData && <BalanceSheetReport data={bsData} />}
            {activeTab === "general-ledger" && glData && <GeneralLedgerReport data={glData} />}
            {activeTab === "aging" && agingData && <AgingReport data={agingData} />}
            {activeTab === "cash-flow" && cashFlowData && <CashFlowReport data={cashFlowData} />}
          </>
        )}
      </main>
    </div>
  );
}

// ── Aging Report Component ──────────────────────────────────────────

function AgingReport({ data }: { data: AgingData }) {
  const buckets: (keyof Omit<AgingRow, "entity_id" | "entity_name" | "total">)[] = ["current", "days_30", "days_60", "days_90", "days_120_plus"];
  const labels: Record<string, string> = {
    current: "Current",
    days_30: "1-30",
    days_60: "31-60",
    days_90: "61-90",
    days_120_plus: "90+",
  };

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden overflow-x-auto">
      <div className="px-4 py-3 border-b border-gray-800">
        <h2 className="text-sm font-bold uppercase tracking-wider text-gray-300">
          {data.type === "ar" ? "AR" : "AP"} Aging Report — as of {data.as_of}
        </h2>
      </div>
      <table className="w-full text-sm min-w-[700px]">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-gray-600 border-b border-gray-800">
            <th className="text-left px-4 py-3 font-medium">{data.type === "ar" ? "Customer" : "Vendor"}</th>
            {buckets.map((b) => (
              <th key={b} className="text-right px-4 py-3 font-medium">{labels[b]}</th>
            ))}
            <th className="text-right px-4 py-3 font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row) => (
            <tr key={row.entity_id} className="border-t border-gray-800/50 hover:bg-gray-800/20">
              <td className="px-4 py-2 text-gray-200 font-medium">{row.entity_name}</td>
              {buckets.map((b) => (
                <td key={b} className="px-4 py-2 text-right font-mono text-gray-400">
                  {row[b] !== 0 ? fmtCurrency(row[b]) : "—"}
                </td>
              ))}
              <td className="px-4 py-2 text-right font-mono text-white font-bold">{fmtCurrency(row.total)}</td>
            </tr>
          ))}
          {data.rows.length === 0 && (
            <tr>
              <td colSpan={7} className="px-4 py-8 text-center text-gray-600">
                No outstanding {data.type === "ar" ? "receivables" : "payables"}.
              </td>
            </tr>
          )}
        </tbody>
        {data.rows.length > 0 && (
          <tfoot>
            <tr className="border-t-2 border-gray-700 font-bold">
              <td className="px-4 py-3 text-gray-300 uppercase text-xs">Total</td>
              {buckets.map((b) => (
                <td key={b} className="px-4 py-3 text-right font-mono text-gray-200">
                  {data.totals[b] !== 0 ? fmtCurrency(data.totals[b]) : "—"}
                </td>
              ))}
              <td className="px-4 py-3 text-right font-mono text-white">{fmtCurrency(data.totals.total)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

// ── Cash Flow Report Component ──────────────────────────────────────

function CashFlowReport({ data }: { data: CashFlowData }) {
  function SectionBlock({ section }: { section: CashFlowSection }) {
    const items = section.adjustments || section.items || [];
    return (
      <div className="mb-4">
        <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-2">{section.label}</h3>
        {section.net_income !== undefined && (
          <div className="flex justify-between px-4 py-1">
            <span className="text-gray-400">Net Income</span>
            <span className="font-mono text-gray-200">{fmtCurrency(section.net_income)}</span>
          </div>
        )}
        {items.map((item, i) => (
          <div key={i} className="flex justify-between px-4 py-1">
            <span className="text-gray-500 pl-4">{item.name}</span>
            <span className={`font-mono ${item.amount >= 0 ? "text-gray-300" : "text-red-400"}`}>
              {fmtCurrency(item.amount)}
            </span>
          </div>
        ))}
        <div className="flex justify-between px-4 py-2 border-t border-gray-800 mt-1 font-bold">
          <span className="text-gray-300">Net Cash from {section.label.replace("Cash from ", "")}</span>
          <span className={`font-mono ${section.total >= 0 ? "text-emerald-400" : "text-red-400"}`}>
            {fmtCurrency(section.total)}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-800">
        <h2 className="text-sm font-bold uppercase tracking-wider text-gray-300">
          Cash Flow Statement — {data.start_date} to {data.end_date}
        </h2>
      </div>
      <div className="p-4 space-y-2">
        <SectionBlock section={data.operating} />
        <SectionBlock section={data.investing} />
        <SectionBlock section={data.financing} />

        <div className="flex justify-between px-4 py-3 border-t-2 border-gray-700 font-bold text-base">
          <span className="text-white">Net Change in Cash</span>
          <span className={`font-mono ${data.net_cash_change >= 0 ? "text-emerald-400" : "text-red-400"}`}>
            {fmtCurrency(data.net_cash_change)}
          </span>
        </div>
      </div>
    </div>
  );
}
