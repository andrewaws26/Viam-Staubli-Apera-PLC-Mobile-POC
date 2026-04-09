"use client";

import { useEffect, useState, useCallback } from "react";

interface BankAccount { id: string; name: string; type: string; balance: number }
interface OverdueInvoice { id: string; invoice_number: string; customer: string; due_date: string; balance_due: number; days_overdue: number }
interface JobSummary { id: string; job_number: string; name: string; status: string; bid_amount: number; contract_amount: number; costs: number; revenue: number; profit: number; margin: number }
interface CrewMember { user_id: string; name: string; total_hours: number; total_travel: number; weeks: number; avg_hours_per_week: number; utilization_pct: number; hourly_rate: number }
interface PendingTimesheet { id: string; user_name: string; week_ending: string }
interface ActivityItem { id: string; action: string; user: string; details: Record<string, unknown>; at: string }

interface ExecData {
  as_of: string;
  cash: { total: number; accounts: BankAccount[] };
  ar: { current: number; days_30: number; days_60: number; days_90: number; days_120_plus: number; total: number; count: number; overdue_invoices: OverdueInvoice[] };
  ap: { current: number; days_30: number; days_60: number; days_90: number; days_120_plus: number; total: number; count: number };
  jobs: { active_count: number; bidding_count: number; total_costs: number; total_revenue: number; avg_margin: number; items: JobSummary[] };
  payroll: { estimated_gross: number; pending_timesheets: number; pending_items: PendingTimesheet[]; pending_pto: number };
  crew: { avg_utilization: number; employees: CrewMember[] };
  recent_activity: ActivityItem[];
}

const fmt = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
const fmtDec = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

function AgingBar({ label, amount, total, color }: { label: string; amount: number; total: number; color: string }) {
  const pct = total > 0 ? (amount / total) * 100 : 0;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-16 text-gray-500 text-right">{label}</span>
      <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.max(pct, pct > 0 ? 2 : 0)}%` }} />
      </div>
      <span className="w-20 text-right font-medium">{fmt(amount)}</span>
    </div>
  );
}

function MetricCard({ title, value, subtitle, color = "text-gray-900" }: { title: string; value: string; subtitle?: string; color?: string }) {
  return (
    <div className="bg-white rounded-lg border p-4">
      <p className="text-xs text-gray-500 uppercase tracking-wide">{title}</p>
      <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
      {subtitle && <p className="text-xs text-gray-400 mt-1">{subtitle}</p>}
    </div>
  );
}

export default function ExecutiveDashboard() {
  const [data, setData] = useState<ExecData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/executive");
      if (!res.ok) throw new Error(await res.text());
      setData(await res.json());
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);

  if (loading) return <div className="p-8 text-center text-gray-500">Loading executive dashboard...</div>;
  if (error) return <div className="p-8 text-center text-red-600">{error}</div>;
  if (!data) return null;

  const netPosition = data.cash.total + data.ar.total - data.ap.total;

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Executive Dashboard</h1>
          <p className="text-sm text-gray-500">As of {data.as_of}</p>
        </div>
        <button onClick={() => { setLoading(true); load(); }} className="text-sm px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-md">
          Refresh
        </button>
      </div>

      {/* Top KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <MetricCard title="Cash Position" value={fmt(data.cash.total)} subtitle={`${data.cash.accounts.length} account${data.cash.accounts.length !== 1 ? "s" : ""}`} color="text-green-700" />
        <MetricCard title="AR Outstanding" value={fmt(data.ar.total)} subtitle={`${data.ar.count} invoice${data.ar.count !== 1 ? "s" : ""}`} color="text-blue-700" />
        <MetricCard title="AP Outstanding" value={fmt(data.ap.total)} subtitle={`${data.ap.count} bill${data.ap.count !== 1 ? "s" : ""}`} color="text-amber-700" />
        <MetricCard title="Net Position" value={fmt(netPosition)} subtitle="Cash + AR - AP" color={netPosition >= 0 ? "text-green-700" : "text-red-700"} />
        <MetricCard title="Avg Job Margin" value={`${data.jobs.avg_margin}%`} subtitle={`${data.jobs.active_count} active, ${data.jobs.bidding_count} bidding`} color={data.jobs.avg_margin >= 15 ? "text-green-700" : data.jobs.avg_margin > 0 ? "text-amber-700" : "text-red-700"} />
        <MetricCard title="Crew Utilization" value={`${data.crew.avg_utilization}%`} subtitle={`${data.crew.employees.length} employees`} color={data.crew.avg_utilization >= 80 ? "text-green-700" : data.crew.avg_utilization >= 60 ? "text-amber-700" : "text-red-700"} />
      </div>

      {/* Row 2: AR/AP Aging + Cash Accounts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* AR Aging */}
        <div className="bg-white rounded-lg border p-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Accounts Receivable Aging</h2>
          <div className="space-y-2">
            <AgingBar label="Current" amount={data.ar.current} total={data.ar.total} color="bg-green-500" />
            <AgingBar label="1-30" amount={data.ar.days_30} total={data.ar.total} color="bg-yellow-500" />
            <AgingBar label="31-60" amount={data.ar.days_60} total={data.ar.total} color="bg-orange-500" />
            <AgingBar label="61-90" amount={data.ar.days_90} total={data.ar.total} color="bg-red-400" />
            <AgingBar label="90+" amount={data.ar.days_120_plus} total={data.ar.total} color="bg-red-600" />
          </div>
          <div className="mt-3 pt-2 border-t text-right text-sm font-semibold text-gray-700">Total: {fmt(data.ar.total)}</div>
        </div>

        {/* AP Aging */}
        <div className="bg-white rounded-lg border p-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Accounts Payable Aging</h2>
          <div className="space-y-2">
            <AgingBar label="Current" amount={data.ap.current} total={data.ap.total} color="bg-green-500" />
            <AgingBar label="1-30" amount={data.ap.days_30} total={data.ap.total} color="bg-yellow-500" />
            <AgingBar label="31-60" amount={data.ap.days_60} total={data.ap.total} color="bg-orange-500" />
            <AgingBar label="61-90" amount={data.ap.days_90} total={data.ap.total} color="bg-red-400" />
            <AgingBar label="90+" amount={data.ap.days_120_plus} total={data.ap.total} color="bg-red-600" />
          </div>
          <div className="mt-3 pt-2 border-t text-right text-sm font-semibold text-gray-700">Total: {fmt(data.ap.total)}</div>
        </div>

        {/* Cash + Payroll */}
        <div className="space-y-4">
          <div className="bg-white rounded-lg border p-4">
            <h2 className="text-sm font-semibold text-gray-700 mb-2">Bank Accounts</h2>
            {data.cash.accounts.length === 0 ? (
              <p className="text-xs text-gray-400">No bank accounts configured</p>
            ) : (
              <div className="space-y-1">
                {data.cash.accounts.map((a) => (
                  <div key={a.id} className="flex justify-between text-sm">
                    <span className="text-gray-600 truncate">{a.name}</span>
                    <span className="font-medium">{fmtDec(a.balance)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="bg-white rounded-lg border p-4">
            <h2 className="text-sm font-semibold text-gray-700 mb-2">Payroll Snapshot</h2>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Est. Gross Payroll</span>
                <span className="font-medium">{fmt(data.payroll.estimated_gross)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Pending Timesheets</span>
                <span className={`font-medium ${data.payroll.pending_timesheets > 0 ? "text-amber-600" : "text-green-600"}`}>
                  {data.payroll.pending_timesheets}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Pending PTO</span>
                <span className={`font-medium ${data.payroll.pending_pto > 0 ? "text-amber-600" : "text-green-600"}`}>
                  {data.payroll.pending_pto}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Row 3: Job Margins + Overdue Invoices */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Active Job Margins */}
        <div className="bg-white rounded-lg border p-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Active Job Margins</h2>
          {data.jobs.items.length === 0 ? (
            <p className="text-xs text-gray-400">No active jobs</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-500 border-b">
                    <th className="text-left py-1 pr-2">Job</th>
                    <th className="text-right py-1 px-2">Costs</th>
                    <th className="text-right py-1 px-2">Revenue</th>
                    <th className="text-right py-1 px-2">Profit</th>
                    <th className="text-right py-1 pl-2">Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {data.jobs.items.map((j) => (
                    <tr key={j.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-1.5 pr-2">
                        <a href={`/jobs/${j.id}`} className="text-blue-600 hover:underline">
                          {j.job_number}
                        </a>
                        <span className="text-gray-500 ml-1 text-xs">{j.name}</span>
                      </td>
                      <td className="text-right py-1.5 px-2 text-gray-600">{fmt(j.costs)}</td>
                      <td className="text-right py-1.5 px-2 text-gray-600">{fmt(j.revenue)}</td>
                      <td className={`text-right py-1.5 px-2 font-medium ${j.profit >= 0 ? "text-green-700" : "text-red-700"}`}>
                        {fmt(j.profit)}
                      </td>
                      <td className={`text-right py-1.5 pl-2 font-semibold ${j.margin >= 15 ? "text-green-700" : j.margin > 0 ? "text-amber-700" : "text-red-700"}`}>
                        {j.margin}%
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="text-xs font-semibold text-gray-700 border-t">
                    <td className="py-1.5">Totals</td>
                    <td className="text-right py-1.5 px-2">{fmt(data.jobs.total_costs)}</td>
                    <td className="text-right py-1.5 px-2">{fmt(data.jobs.total_revenue)}</td>
                    <td className="text-right py-1.5 px-2">{fmt(data.jobs.total_revenue - data.jobs.total_costs)}</td>
                    <td className="text-right py-1.5 pl-2">{data.jobs.avg_margin}%</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>

        {/* Overdue Invoices */}
        <div className="bg-white rounded-lg border p-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">
            Overdue Invoices
            {data.ar.overdue_invoices.length > 0 && (
              <span className="ml-2 px-1.5 py-0.5 text-xs bg-red-100 text-red-700 rounded-full">{data.ar.overdue_invoices.length}</span>
            )}
          </h2>
          {data.ar.overdue_invoices.length === 0 ? (
            <p className="text-xs text-gray-400">No overdue invoices</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-500 border-b">
                    <th className="text-left py-1 pr-2">#</th>
                    <th className="text-left py-1 px-2">Customer</th>
                    <th className="text-right py-1 px-2">Balance</th>
                    <th className="text-right py-1 pl-2">Days Late</th>
                  </tr>
                </thead>
                <tbody>
                  {data.ar.overdue_invoices.map((inv) => (
                    <tr key={inv.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-1.5 pr-2">
                        <a href="/accounting/invoices" className="text-blue-600 hover:underline">
                          {inv.invoice_number}
                        </a>
                      </td>
                      <td className="py-1.5 px-2 text-gray-600 truncate max-w-[150px]">{inv.customer}</td>
                      <td className="text-right py-1.5 px-2 font-medium text-red-700">{fmtDec(inv.balance_due)}</td>
                      <td className={`text-right py-1.5 pl-2 font-semibold ${inv.days_overdue > 60 ? "text-red-700" : inv.days_overdue > 30 ? "text-orange-600" : "text-amber-600"}`}>
                        {inv.days_overdue}d
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Row 4: Crew Utilization + Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Crew Utilization */}
        <div className="bg-white rounded-lg border p-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Crew Utilization (Last 4 Weeks)</h2>
          {data.crew.employees.length === 0 ? (
            <p className="text-xs text-gray-400">No timesheet data</p>
          ) : (
            <div className="space-y-2">
              {data.crew.employees.map((e) => (
                <div key={e.user_id} className="flex items-center gap-2">
                  <span className="w-28 text-sm text-gray-700 truncate" title={e.name}>{e.name}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden relative">
                    <div
                      className={`h-full rounded-full ${
                        e.utilization_pct >= 90 ? "bg-green-500" : e.utilization_pct >= 70 ? "bg-blue-500" : e.utilization_pct >= 50 ? "bg-amber-500" : "bg-red-400"
                      }`}
                      style={{ width: `${Math.min(e.utilization_pct, 100)}%` }}
                    />
                    {e.utilization_pct > 100 && (
                      <div className="absolute top-0 h-full bg-green-700 opacity-60 rounded-r-full" style={{ left: "100%", width: `${Math.min(e.utilization_pct - 100, 100)}%` }} />
                    )}
                  </div>
                  <span className="w-16 text-right text-xs font-medium text-gray-700">{e.utilization_pct}%</span>
                  <span className="w-16 text-right text-xs text-gray-400">{e.avg_hours_per_week}h/wk</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Activity */}
        <div className="bg-white rounded-lg border p-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Recent Activity</h2>
          {data.recent_activity.length === 0 ? (
            <p className="text-xs text-gray-400">No recent activity</p>
          ) : (
            <div className="space-y-1.5 max-h-72 overflow-y-auto">
              {data.recent_activity.map((a) => (
                <div key={a.id} className="flex gap-2 text-xs border-b border-gray-50 pb-1.5">
                  <span className="text-gray-400 whitespace-nowrap">
                    {new Date(a.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                  <span className="text-gray-700">
                    <span className="font-medium">{a.user || "System"}</span>
                    {" "}
                    <span className="text-gray-500">{a.action.replace(/_/g, " ")}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Pending Approvals */}
      {(data.payroll.pending_timesheets > 0 || data.payroll.pending_pto > 0) && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <h2 className="text-sm font-semibold text-amber-800 mb-2">Action Required</h2>
          <div className="flex flex-wrap gap-4 text-sm">
            {data.payroll.pending_timesheets > 0 && (
              <a href="/timesheets/admin" className="text-amber-700 hover:text-amber-900 underline">
                {data.payroll.pending_timesheets} timesheet{data.payroll.pending_timesheets !== 1 ? "s" : ""} awaiting approval
              </a>
            )}
            {data.payroll.pending_pto > 0 && (
              <a href="/pto/admin" className="text-amber-700 hover:text-amber-900 underline">
                {data.payroll.pending_pto} PTO request{data.payroll.pending_pto !== 1 ? "s" : ""} pending
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
