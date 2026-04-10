"use client";

import { useState, useEffect, useCallback } from "react";


// ── Types ────────────────────────────────────────────────────────────

interface Worksheet941 {
  line_1_employee_count: number;
  line_2_total_wages: number;
  line_3_federal_wh: number;
  line_5a_taxable_ss_wages: number;
  line_5a_ii_ss_tax: number;
  line_5c_taxable_medicare_wages: number;
  line_5c_ii_medicare_tax: number;
  line_5d_additional_medicare: number;
  line_5e_total_ss_medicare: number;
  line_6_total_taxes: number;
  line_7_current_quarter_adjustment: number;
  line_8_sick_pay: number;
  line_9_tips_group_life: number;
  line_10_total_after_adjustments: number;
  line_11_qualified_sb_credit: number;
  line_12_total_after_credits: number;
}

interface MonthlyBreakdown {
  month: number;
  month_name: string;
  tax_liability: number;
}

interface Rates941 {
  ss_wage_base: number;
  ss_combined_rate: number;
  medicare_combined_rate: number;
  additional_medicare_threshold: number;
  additional_medicare_rate: number;
}

interface Report941 {
  year: number;
  quarter: number;
  period: { start: string; end: string };
  no_data?: boolean;
  message?: string;
  payroll_runs_count?: number;
  worksheet?: Worksheet941;
  monthly_breakdown?: MonthlyBreakdown[];
  rates?: Rates941;
}

interface StateMonthly {
  month: number;
  month_name: string;
  total_wages: number;
  state_withholding: number;
  employee_count: number;
}

interface ReportState {
  year: number;
  quarter: number;
  period: { start: string; end: string };
  no_data?: boolean;
  message?: string;
  state?: string;
  state_name?: string;
  summary?: {
    total_wages: number;
    total_state_withholding: number;
    employee_count: number;
  };
  monthly?: StateMonthly[];
}

interface FutaEmployee {
  user_id: string;
  name: string;
  total_wages: number;
  futa_taxable: number;
  futa_tax: number;
}

interface FutaQuarterly {
  quarter: number;
  label: string;
  futa_liability: number;
}

interface Report940 {
  year: number;
  period: { start: string; end: string };
  no_data?: boolean;
  message?: string;
  worksheet?: {
    line_3_total_payments: number;
    line_4_exempt_payments: number;
    line_5_taxable_futa_wages: number;
    line_8_futa_tax: number;
    line_13_futa_deposits: number;
    futa_wage_base: number;
    futa_rate: number;
  };
  employees?: FutaEmployee[];
  quarterly_liability?: FutaQuarterly[];
}

interface SummaryQuarter {
  quarter: number;
  label: string;
  period: { start: string; end: string };
  total_gross: number;
  federal_withholding: number;
  state_withholding: number;
  social_security: number;
  medicare: number;
  futa: number;
  suta: number;
  total_tax_liability: number;
  payroll_runs: number;
  has_data: boolean;
}

interface Filing {
  form: string;
  period: string;
  due_date: string;
  description: string;
}

interface ReportSummary {
  year: number;
  ytd_gross: number;
  ytd_tax_liability: number;
  quarters: SummaryQuarter[];
  filings: Filing[];
}

// ── Helpers ──────────────────────────────────────────────────────────

function fmt(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(n);
}

function fmtPct(n: number): string {
  return (n * 100).toFixed(1) + "%";
}

function fmtDate(iso: string): string {
  return new Date(iso + "T12:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const TABS = ["Form 941", "KY Withholding", "Form 940", "Filing Calendar"] as const;
type Tab = (typeof TABS)[number];

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - 2 + i); // 3 years back, current, 1 forward

// ── Page Component ───────────────────────────────────────────────────

export default function TaxReportsPage() {
  const [tab, setTab] = useState<Tab>("Form 941");
  const [year, setYear] = useState(CURRENT_YEAR);
  const [quarter, setQuarter] = useState(() => Math.ceil((new Date().getMonth() + 1) / 3));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Data states
  const [data941, setData941] = useState<Report941 | null>(null);
  const [dataState, setDataState] = useState<ReportState | null>(null);
  const [data940, setData940] = useState<Report940 | null>(null);
  const [dataSummary, setDataSummary] = useState<ReportSummary | null>(null);

  // ── Fetch functions ──

  const fetch941 = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/accounting/tax-reports?report=941&year=${year}&quarter=${quarter}`);
      if (!res.ok) throw new Error((await res.json()).error || res.statusText);
      setData941(await res.json());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [year, quarter]);

  const fetchState = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/accounting/tax-reports?report=state&year=${year}&quarter=${quarter}`);
      if (!res.ok) throw new Error((await res.json()).error || res.statusText);
      setDataState(await res.json());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [year, quarter]);

  const fetch940 = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/accounting/tax-reports?report=940&year=${year}`);
      if (!res.ok) throw new Error((await res.json()).error || res.statusText);
      setData940(await res.json());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [year]);

  const fetchSummary = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/accounting/tax-reports?report=summary&year=${year}`);
      if (!res.ok) throw new Error((await res.json()).error || res.statusText);
      setDataSummary(await res.json());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [year]);

  // ── Auto-fetch on tab/year/quarter change ──

  useEffect(() => {
    if (tab === "Form 941") fetch941();
    else if (tab === "KY Withholding") fetchState();
    else if (tab === "Form 940") fetch940();
    else if (tab === "Filing Calendar") fetchSummary();
  }, [tab, year, quarter, fetch941, fetchState, fetch940, fetchSummary]);

  // ── Filing status helper ──

  function filingStatus(dueDate: string): {
    label: string;
    color: string;
    bgColor: string;
  } {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(dueDate + "T12:00:00");
    const diffDays = Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
      return { label: "Overdue", color: "text-red-400", bgColor: "bg-red-900/30 border-red-800/50" };
    }
    if (diffDays <= 30) {
      return { label: "Due Soon", color: "text-yellow-400", bgColor: "bg-yellow-900/30 border-yellow-800/50" };
    }
    return { label: "Upcoming", color: "text-gray-500", bgColor: "bg-gray-800/30 border-gray-800/60" };
  }

  // ── Summary cards (from summary data or individual reports) ──

  const ytdGross = dataSummary?.ytd_gross ?? 0;
  const ytdTax = dataSummary?.ytd_tax_liability ?? 0;
  const nextFiling = dataSummary?.filings?.find((f) => {
    const due = new Date(f.due_date + "T12:00:00");
    return due >= new Date();
  });

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* ── Summary Cards ── */}
        {dataSummary && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Total Payroll YTD</p>
              <p className="text-2xl font-bold text-white mt-1">{fmt(ytdGross)}</p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Tax Liability YTD</p>
              <p className="text-2xl font-bold text-violet-400 mt-1">{fmt(ytdTax)}</p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Next Filing Due</p>
              {nextFiling ? (
                <div className="mt-1">
                  <p className="text-lg font-bold text-white">{nextFiling.form} ({nextFiling.period})</p>
                  <p className="text-sm text-gray-400">{fmtDate(nextFiling.due_date)}</p>
                </div>
              ) : (
                <p className="text-lg font-bold text-gray-500 mt-1">None pending</p>
              )}
            </div>
          </div>
        )}

        {/* ── Tabs + Selectors ── */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex gap-1 bg-gray-900 rounded-lg p-1 overflow-x-auto">
            {TABS.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-1.5 rounded-md text-sm font-semibold whitespace-nowrap transition-colors ${
                  tab === t
                    ? "bg-violet-600 text-white"
                    : "text-gray-400 hover:text-gray-200 hover:bg-gray-800/50"
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-violet-600"
            >
              {YEARS.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>

            {(tab === "Form 941" || tab === "KY Withholding") && (
              <select
                value={quarter}
                onChange={(e) => setQuarter(Number(e.target.value))}
                className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-violet-600"
              >
                <option value={1}>Q1 (Jan-Mar)</option>
                <option value={2}>Q2 (Apr-Jun)</option>
                <option value={3}>Q3 (Jul-Sep)</option>
                <option value={4}>Q4 (Oct-Dec)</option>
              </select>
            )}
          </div>
        </div>

        {/* ── Error ── */}
        {error && (
          <div className="bg-red-900/30 border border-red-800 rounded-xl p-4 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* ── Loading ── */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {/* ── Tab Content ── */}
        {!loading && !error && (
          <>
            {tab === "Form 941" && <Tab941 data={data941} />}
            {tab === "KY Withholding" && <TabState data={dataState} />}
            {tab === "Form 940" && <Tab940 data={data940} />}
            {tab === "Filing Calendar" && <TabCalendar data={dataSummary} filingStatus={filingStatus} />}
          </>
        )}
      </div>
    </div>
  );
}

// ── Tab: Form 941 ──────────────────────────────────────────────────

function Tab941({ data }: { data: Report941 | null }) {
  if (!data) return null;

  if (data.no_data) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center">
        <p className="text-gray-400">{data.message}</p>
      </div>
    );
  }

  const w = data.worksheet!;
  const rates = data.rates!;

  return (
    <div className="space-y-6 print:space-y-4">
      {/* Header */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 print:border-black print:bg-white print:text-black">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-white print:text-black">
              Form 941 Worksheet — Q{data.quarter} {data.year}
            </h2>
            <p className="text-sm text-gray-400 print:text-gray-600">
              {fmtDate(data.period.start)} - {fmtDate(data.period.end)} | {data.payroll_runs_count} payroll run(s)
            </p>
          </div>
          <button
            onClick={() => window.print()}
            className="print:hidden px-3 py-1.5 bg-gray-800 hover:bg-gray-800/50 text-gray-300 text-sm rounded-lg transition-colors"
          >
            Print
          </button>
        </div>

        <div className="divide-y divide-gray-800 print:divide-gray-300">
          <WorksheetLine num="1" label="Number of employees who received wages" value={w.line_1_employee_count.toString()} isCount />
          <WorksheetLine num="2" label="Wages, tips, and other compensation" value={fmt(w.line_2_total_wages)} />
          <WorksheetLine num="3" label="Federal income tax withheld" value={fmt(w.line_3_federal_wh)} />
          <div className="py-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 print:text-gray-600">
              Line 5 - Social Security and Medicare Taxes
            </p>
          </div>
          <WorksheetSubLine
            num="5a"
            label={`Taxable Social Security wages (capped at ${fmt(rates.ss_wage_base)}/employee)`}
            col1={fmt(w.line_5a_taxable_ss_wages)}
            col2={fmtPct(rates.ss_combined_rate)}
            result={fmt(w.line_5a_ii_ss_tax)}
          />
          <WorksheetSubLine
            num="5c"
            label="Taxable Medicare wages and tips"
            col1={fmt(w.line_5c_taxable_medicare_wages)}
            col2={fmtPct(rates.medicare_combined_rate)}
            result={fmt(w.line_5c_ii_medicare_tax)}
          />
          <WorksheetSubLine
            num="5d"
            label={`Additional Medicare Tax (wages > ${fmt(rates.additional_medicare_threshold)})`}
            col1=""
            col2={fmtPct(rates.additional_medicare_rate)}
            result={fmt(w.line_5d_additional_medicare)}
          />
          <WorksheetLine num="5e" label="Total Social Security and Medicare taxes (5a + 5c + 5d)" value={fmt(w.line_5e_total_ss_medicare)} bold />
          <WorksheetLine num="6" label="Total taxes before adjustments (Line 3 + Line 5e)" value={fmt(w.line_6_total_taxes)} bold />
          <WorksheetLine num="7" label="Current quarter adjustment for fractions of cents" value={fmt(w.line_7_current_quarter_adjustment)} />
          <WorksheetLine num="8" label="Current quarter adjustment for sick pay" value={fmt(w.line_8_sick_pay)} />
          <WorksheetLine num="9" label="Current quarter adjustments for tips and group-term life insurance" value={fmt(w.line_9_tips_group_life)} />
          <WorksheetLine num="10" label="Total taxes after adjustments" value={fmt(w.line_10_total_after_adjustments)} bold />
          <WorksheetLine num="11" label="Qualified small business payroll tax credit" value={fmt(w.line_11_qualified_sb_credit)} />
          <WorksheetLine num="12" label="Total taxes after adjustments and credits" value={fmt(w.line_12_total_after_credits)} bold highlight />
        </div>
      </div>

      {/* Monthly Breakdown */}
      {data.monthly_breakdown && data.monthly_breakdown.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 print:border-black print:bg-white print:text-black">
          <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wider mb-4 print:text-black">
            Monthly Tax Liability
          </h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 print:border-gray-300">
                <th className="text-left py-2 text-gray-500 font-semibold print:text-gray-600">Month</th>
                <th className="text-right py-2 text-gray-500 font-semibold print:text-gray-600">Tax Liability</th>
              </tr>
            </thead>
            <tbody>
              {data.monthly_breakdown.map((m) => (
                <tr key={m.month} className="border-b border-gray-800 print:border-gray-200">
                  <td className="py-2 text-gray-200 print:text-black">{m.month_name}</td>
                  <td className="py-2 text-right text-gray-200 font-mono print:text-black">{fmt(m.tax_liability)}</td>
                </tr>
              ))}
              <tr className="font-bold">
                <td className="py-2 text-gray-100 print:text-black">Total</td>
                <td className="py-2 text-right text-violet-400 font-mono print:text-black">
                  {fmt(data.monthly_breakdown.reduce((s, m) => s + m.tax_liability, 0))}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function WorksheetLine({
  num,
  label,
  value,
  bold,
  highlight,
  isCount,
}: {
  num: string;
  label: string;
  value: string;
  bold?: boolean;
  highlight?: boolean;
  isCount?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between py-3 gap-4 ${
        highlight ? "bg-violet-900/20 -mx-6 px-6 print:bg-gray-100" : ""
      }`}
    >
      <div className="flex items-start gap-3 min-w-0">
        <span className="text-xs font-bold text-violet-400 bg-violet-900/30 px-2 py-0.5 rounded shrink-0 print:text-black print:bg-gray-200">
          {num}
        </span>
        <span className={`text-sm ${bold ? "font-semibold text-gray-100" : "text-gray-300"} print:text-black`}>
          {label}
        </span>
      </div>
      <span
        className={`text-sm font-mono shrink-0 ${
          bold ? "font-bold text-white" : "text-gray-200"
        } ${highlight ? "text-violet-300 text-base" : ""} ${isCount ? "" : ""} print:text-black`}
      >
        {value}
      </span>
    </div>
  );
}

function WorksheetSubLine({
  num,
  label,
  col1,
  col2,
  result,
}: {
  num: string;
  label: string;
  col1: string;
  col2: string;
  result: string;
}) {
  return (
    <div className="py-3">
      <div className="flex items-start gap-3 mb-1">
        <span className="text-xs font-bold text-violet-400 bg-violet-900/30 px-2 py-0.5 rounded shrink-0 print:text-black print:bg-gray-200">
          {num}
        </span>
        <span className="text-sm text-gray-300 print:text-black">{label}</span>
      </div>
      <div className="flex items-center justify-end gap-4 text-sm font-mono">
        {col1 && <span className="text-gray-400 print:text-gray-600">{col1}</span>}
        <span className="text-gray-500 print:text-gray-600">x {col2}</span>
        <span className="text-gray-100 font-semibold print:text-black">= {result}</span>
      </div>
    </div>
  );
}

// ── Tab: KY Withholding ─────────────────────────────────────────────

function TabState({ data }: { data: ReportState | null }) {
  if (!data) return null;

  if (data.no_data) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center">
        <p className="text-gray-400">{data.message}</p>
      </div>
    );
  }

  const s = data.summary!;

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Total KY Wages</p>
          <p className="text-2xl font-bold text-white mt-1">{fmt(s.total_wages)}</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">KY Withholding</p>
          <p className="text-2xl font-bold text-violet-400 mt-1">{fmt(s.total_state_withholding)}</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Employees</p>
          <p className="text-2xl font-bold text-white mt-1">{s.employee_count}</p>
        </div>
      </div>

      {/* Monthly breakdown */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
        <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wider mb-4">
          {data.state_name} Quarterly Withholding — Q{data.quarter} {data.year}
        </h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700">
              <th className="text-left py-2 text-gray-500 font-semibold">Month</th>
              <th className="text-right py-2 text-gray-500 font-semibold">Wages</th>
              <th className="text-right py-2 text-gray-500 font-semibold">Withholding</th>
              <th className="text-right py-2 text-gray-500 font-semibold">Employees</th>
            </tr>
          </thead>
          <tbody>
            {(data.monthly ?? []).map((m) => (
              <tr key={m.month} className="border-b border-gray-800">
                <td className="py-2 text-gray-200">{m.month_name}</td>
                <td className="py-2 text-right text-gray-200 font-mono">{fmt(m.total_wages)}</td>
                <td className="py-2 text-right text-gray-200 font-mono">{fmt(m.state_withholding)}</td>
                <td className="py-2 text-right text-gray-400">{m.employee_count}</td>
              </tr>
            ))}
            <tr className="font-bold">
              <td className="py-2 text-gray-100">Total</td>
              <td className="py-2 text-right text-gray-100 font-mono">{fmt(s.total_wages)}</td>
              <td className="py-2 text-right text-violet-400 font-mono">{fmt(s.total_state_withholding)}</td>
              <td className="py-2 text-right text-gray-400">{s.employee_count}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Tab: Form 940 ──────────────────────────────────────────────────

function Tab940({ data }: { data: Report940 | null }) {
  if (!data) return null;

  if (data.no_data) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center">
        <p className="text-gray-400">{data.message}</p>
      </div>
    );
  }

  const w = data.worksheet!;

  return (
    <div className="space-y-6">
      {/* Worksheet */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
        <h2 className="text-lg font-bold text-white mb-4">
          Form 940 Worksheet — {data.year} (Annual FUTA)
        </h2>
        <div className="divide-y divide-gray-800">
          <WorksheetLine num="3" label="Total payments to all employees" value={fmt(w.line_3_total_payments)} />
          <WorksheetLine num="4" label="Payments exempt from FUTA tax" value={fmt(w.line_4_exempt_payments)} />
          <WorksheetLine
            num="5"
            label={`Total taxable FUTA wages (first ${fmt(w.futa_wage_base)} per employee)`}
            value={fmt(w.line_5_taxable_futa_wages)}
            bold
          />
          <WorksheetLine
            num="8"
            label={`FUTA tax before adjustments (${(w.futa_rate * 100).toFixed(1)}% after state credit)`}
            value={fmt(w.line_8_futa_tax)}
            bold
          />
          <WorksheetLine num="13" label="FUTA tax deposited (from payroll runs)" value={fmt(w.line_13_futa_deposits)} />
          <WorksheetLine
            num=""
            label="Balance due / (Overpayment)"
            value={fmt(w.line_8_futa_tax - w.line_13_futa_deposits)}
            bold
            highlight
          />
        </div>
      </div>

      {/* Quarterly FUTA Liability */}
      {data.quarterly_liability && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wider mb-4">
            Quarterly FUTA Liability
          </h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="text-left py-2 text-gray-500 font-semibold">Quarter</th>
                <th className="text-right py-2 text-gray-500 font-semibold">FUTA Liability</th>
              </tr>
            </thead>
            <tbody>
              {data.quarterly_liability.map((q) => (
                <tr key={q.quarter} className="border-b border-gray-800">
                  <td className="py-2 text-gray-200">{q.label}</td>
                  <td className="py-2 text-right text-gray-200 font-mono">{fmt(q.futa_liability)}</td>
                </tr>
              ))}
              <tr className="font-bold">
                <td className="py-2 text-gray-100">Total</td>
                <td className="py-2 text-right text-violet-400 font-mono">
                  {fmt(data.quarterly_liability.reduce((s, q) => s + q.futa_liability, 0))}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Per-Employee FUTA */}
      {data.employees && data.employees.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wider mb-4">
            Per-Employee FUTA Wage Tracking
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="text-left py-2 text-gray-500 font-semibold">Employee</th>
                  <th className="text-right py-2 text-gray-500 font-semibold">Total Wages</th>
                  <th className="text-right py-2 text-gray-500 font-semibold">FUTA Taxable</th>
                  <th className="text-right py-2 text-gray-500 font-semibold">FUTA Tax</th>
                  <th className="text-right py-2 text-gray-500 font-semibold">Cap Reached</th>
                </tr>
              </thead>
              <tbody>
                {data.employees.map((emp) => (
                  <tr key={emp.user_id} className="border-b border-gray-800">
                    <td className="py-2 text-gray-200">{emp.name}</td>
                    <td className="py-2 text-right text-gray-200 font-mono">{fmt(emp.total_wages)}</td>
                    <td className="py-2 text-right text-gray-200 font-mono">{fmt(emp.futa_taxable)}</td>
                    <td className="py-2 text-right text-gray-200 font-mono">{fmt(emp.futa_tax)}</td>
                    <td className="py-2 text-right">
                      {emp.total_wages >= w.futa_wage_base ? (
                        <span className="text-xs font-semibold text-emerald-400 bg-emerald-900/30 px-2 py-0.5 rounded">
                          Yes
                        </span>
                      ) : (
                        <span className="text-xs font-semibold text-gray-500 bg-gray-800 px-2 py-0.5 rounded">
                          No ({Math.round((emp.total_wages / w.futa_wage_base) * 100)}%)
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tab: Filing Calendar ───────────────────────────────────────────

function TabCalendar({
  data,
  filingStatus,
}: {
  data: ReportSummary | null;
  filingStatus: (due: string) => { label: string; color: string; bgColor: string };
}) {
  if (!data) return null;

  return (
    <div className="space-y-6">
      {/* Quarters Overview */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
        <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wider mb-4">
          {data.year} Quarterly Tax Summary
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="text-left py-2 text-gray-500 font-semibold">Quarter</th>
                <th className="text-right py-2 text-gray-500 font-semibold">Gross Payroll</th>
                <th className="text-right py-2 text-gray-500 font-semibold">Federal WH</th>
                <th className="text-right py-2 text-gray-500 font-semibold">State WH</th>
                <th className="text-right py-2 text-gray-500 font-semibold">SS</th>
                <th className="text-right py-2 text-gray-500 font-semibold">Medicare</th>
                <th className="text-right py-2 text-gray-500 font-semibold">FUTA</th>
                <th className="text-right py-2 text-gray-500 font-semibold">SUTA</th>
                <th className="text-right py-2 text-gray-500 font-semibold">Total Tax</th>
                <th className="text-center py-2 text-gray-500 font-semibold">Runs</th>
              </tr>
            </thead>
            <tbody>
              {data.quarters.map((q) => (
                <tr
                  key={q.quarter}
                  className={`border-b border-gray-800 ${!q.has_data ? "opacity-40" : ""}`}
                >
                  <td className="py-2 text-gray-200 font-semibold">{q.label}</td>
                  <td className="py-2 text-right text-gray-200 font-mono">{fmt(q.total_gross)}</td>
                  <td className="py-2 text-right text-gray-300 font-mono">{fmt(q.federal_withholding)}</td>
                  <td className="py-2 text-right text-gray-300 font-mono">{fmt(q.state_withholding)}</td>
                  <td className="py-2 text-right text-gray-300 font-mono">{fmt(q.social_security)}</td>
                  <td className="py-2 text-right text-gray-300 font-mono">{fmt(q.medicare)}</td>
                  <td className="py-2 text-right text-gray-300 font-mono">{fmt(q.futa)}</td>
                  <td className="py-2 text-right text-gray-300 font-mono">{fmt(q.suta)}</td>
                  <td className="py-2 text-right text-violet-400 font-mono font-semibold">
                    {fmt(q.total_tax_liability)}
                  </td>
                  <td className="py-2 text-center text-gray-400">{q.payroll_runs}</td>
                </tr>
              ))}
              <tr className="font-bold">
                <td className="py-2 text-gray-100">YTD Total</td>
                <td className="py-2 text-right text-gray-100 font-mono">{fmt(data.ytd_gross)}</td>
                <td className="py-2 text-right text-gray-200 font-mono">
                  {fmt(data.quarters.reduce((s, q) => s + q.federal_withholding, 0))}
                </td>
                <td className="py-2 text-right text-gray-200 font-mono">
                  {fmt(data.quarters.reduce((s, q) => s + q.state_withholding, 0))}
                </td>
                <td className="py-2 text-right text-gray-200 font-mono">
                  {fmt(data.quarters.reduce((s, q) => s + q.social_security, 0))}
                </td>
                <td className="py-2 text-right text-gray-200 font-mono">
                  {fmt(data.quarters.reduce((s, q) => s + q.medicare, 0))}
                </td>
                <td className="py-2 text-right text-gray-200 font-mono">
                  {fmt(data.quarters.reduce((s, q) => s + q.futa, 0))}
                </td>
                <td className="py-2 text-right text-gray-200 font-mono">
                  {fmt(data.quarters.reduce((s, q) => s + q.suta, 0))}
                </td>
                <td className="py-2 text-right text-violet-400 font-mono">{fmt(data.ytd_tax_liability)}</td>
                <td className="py-2 text-center text-gray-400">
                  {data.quarters.reduce((s, q) => s + q.payroll_runs, 0)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Filing Calendar */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
        <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wider mb-4">
          {data.year} Filing Calendar
        </h3>
        <div className="space-y-3">
          {data.filings.map((f, i) => {
            const status = filingStatus(f.due_date);
            return (
              <div
                key={i}
                className={`flex items-center justify-between border rounded-lg px-4 py-3 ${status.bgColor}`}
              >
                <div className="flex items-center gap-4 min-w-0">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-100">
                      {f.form}{" "}
                      <span className="text-gray-500 font-normal">({f.period})</span>
                    </p>
                    <p className="text-xs text-gray-400">{f.description}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4 shrink-0">
                  <span className="text-sm text-gray-300 font-mono">{fmtDate(f.due_date)}</span>
                  <span
                    className={`text-xs font-bold px-2 py-0.5 rounded ${status.color} ${
                      status.label === "Overdue"
                        ? "bg-red-900/50"
                        : status.label === "Due Soon"
                        ? "bg-yellow-900/50"
                        : "bg-gray-800/50"
                    }`}
                  >
                    {status.label}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
