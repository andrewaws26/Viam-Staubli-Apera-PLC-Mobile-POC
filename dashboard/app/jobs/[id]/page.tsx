"use client";

import { useState, useEffect, FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface JobDetail {
  id: string;
  job_number: string;
  name: string;
  description: string;
  status: string;
  job_type: string;
  location: string;
  bid_amount: number;
  contract_amount: number;
  start_date: string | null;
  end_date: string | null;
  estimated_hours: number;
  notes: string;
  customer_id: string | null;
  customers?: { company_name: string; contact_name: string } | null;
}

interface CostEntry {
  id: string;
  cost_type: string;
  description: string;
  quantity: number;
  rate: number;
  amount: number;
  date: string;
  source_type: string;
}

interface LaborEmployee {
  user_id: string;
  name: string;
  hours: number;
  rate: number;
  cost: number;
}

interface Timesheet {
  id: string;
  user_name: string;
  week_ending: string;
  status: string;
}

interface Invoice {
  id: string;
  invoice_number: number;
  status: string;
  total: number;
  amount_paid: number;
  balance_due: number;
  invoice_date: string;
}

interface Bill {
  id: string;
  bill_number: string;
  status: string;
  total: number;
  amount_paid: number;
  bill_date: string;
  vendors?: { company_name: string } | null;
}

interface Summary {
  total_costs: number;
  costs_by_type: Record<string, number>;
  total_revenue: number;
  profit: number;
  margin: number;
}

interface FullResponse {
  job: JobDetail;
  cost_entries: CostEntry[];
  labor: { total: number; per_diem: number; by_employee: LaborEmployee[] };
  timesheets: Timesheet[];
  invoices: Invoice[];
  bills: Bill[];
  estimates: { id: string; estimate_number: number; status: string; total: number; estimate_date: string }[];
  summary: Summary;
}

interface CostForm {
  cost_type: string;
  description: string;
  quantity: string;
  rate: string;
  amount: string;
  date: string;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const COST_TYPES: Record<string, string> = {
  labor: "Labor",
  per_diem: "Per Diem",
  mileage: "Mileage",
  fuel: "Fuel",
  equipment: "Equipment",
  material: "Materials",
  subcontractor: "Subcontractor",
  expense: "Expenses",
  other: "Other",
};

const STATUS_CFG: Record<string, { label: string; bg: string; text: string }> = {
  bidding: { label: "Bidding", bg: "bg-blue-500/20", text: "text-blue-400" },
  active: { label: "Active", bg: "bg-green-500/20", text: "text-green-400" },
  completed: { label: "Completed", bg: "bg-amber-500/20", text: "text-amber-400" },
  closed: { label: "Closed", bg: "bg-gray-500/20", text: "text-gray-400" },
};

const COST_COLORS: Record<string, string> = {
  labor: "bg-blue-500",
  per_diem: "bg-amber-500",
  mileage: "bg-purple-500",
  fuel: "bg-orange-500",
  equipment: "bg-cyan-500",
  material: "bg-green-500",
  subcontractor: "bg-pink-500",
  expense: "bg-red-400",
  other: "bg-gray-500",
};

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

const fmtShort = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);

const inputCls =
  "w-full rounded bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none";
const selectCls =
  "w-full rounded bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none";

const EMPTY_COST: CostForm = {
  cost_type: "",
  description: "",
  quantity: "1",
  rate: "",
  amount: "",
  date: new Date().toISOString().split("T")[0],
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<FullResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"costs" | "timesheets" | "invoices" | "bills">("costs");
  const [costForm, setCostForm] = useState<CostForm>(EMPTY_COST);
  const [addingCost, setAddingCost] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);

  useEffect(() => {
    fetch(`/api/jobs/${id}`)
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, [id]);

  async function handleStatusChange(newStatus: string) {
    if (!data) return;
    setStatusSaving(true);
    const res = await fetch(`/api/jobs/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    if (res.ok) {
      setData({ ...data, job: { ...data.job, status: newStatus } });
    }
    setStatusSaving(false);
  }

  async function handleAddCost(e: FormEvent) {
    e.preventDefault();
    if (!costForm.cost_type || !costForm.amount) return;
    setAddingCost(true);
    const res = await fetch(`/api/jobs/${id}/costs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cost_type: costForm.cost_type,
        description: costForm.description,
        quantity: parseFloat(costForm.quantity) || 1,
        rate: parseFloat(costForm.rate) || 0,
        amount: parseFloat(costForm.amount) || 0,
        date: costForm.date,
      }),
    });
    if (res.ok) {
      // Refetch to get updated summary
      const fresh = await fetch(`/api/jobs/${id}`).then((r) => r.json());
      setData(fresh);
      setCostForm(EMPTY_COST);
    }
    setAddingCost(false);
  }

  const cf = (k: keyof CostForm, v: string) => {
    const next = { ...costForm, [k]: v };
    // Auto-calc amount from qty * rate
    if ((k === "quantity" || k === "rate") && next.quantity && next.rate) {
      const calc = (parseFloat(next.quantity) || 0) * (parseFloat(next.rate) || 0);
      if (calc > 0) next.amount = calc.toFixed(2);
    }
    setCostForm(next);
  };

  if (loading)
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
        Loading...
      </div>
    );

  if (!data?.job)
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
        Job not found
      </div>
    );

  const { job, summary, labor, cost_entries, timesheets, invoices, bills, estimates } = data;
  const sc = STATUS_CFG[job.status] || STATUS_CFG.closed;

  // Cost breakdown sorted by amount
  const costBreakdown = Object.entries(summary.costs_by_type)
    .sort(([, a], [, b]) => b - a);
  const maxCost = costBreakdown.length ? costBreakdown[0][1] : 0;

  // Bid comparison reference
  const bidRef = job.contract_amount || job.bid_amount || 0;

  return (
    <div className="min-h-screen bg-gray-950 text-white p-4 sm:p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <Link
            href="/jobs"
            className="text-sm text-gray-500 hover:text-gray-300 transition"
          >
            &larr; Back to Jobs
          </Link>
          <div className="flex flex-wrap items-center gap-3 mt-2">
            <span className="text-gray-500 font-mono">{job.job_number}</span>
            <h1 className="text-2xl font-bold">{job.name}</h1>
            <select
              className={`rounded-full px-3 py-1 text-xs font-medium border-0 cursor-pointer ${sc.bg} ${sc.text}`}
              value={job.status}
              onChange={(e) => handleStatusChange(e.target.value)}
              disabled={statusSaving}
            >
              {Object.entries(STATUS_CFG).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-400 mt-2">
            {job.customers?.company_name && (
              <span>{job.customers.company_name}</span>
            )}
            {job.job_type && <span>{job.job_type}</span>}
            {job.location && <span>{job.location}</span>}
            {job.start_date && (
              <span>
                {new Date(job.start_date + "T00:00").toLocaleDateString()}{" "}
                {job.end_date
                  ? `\u2013 ${new Date(job.end_date + "T00:00").toLocaleDateString()}`
                  : "\u2013 ongoing"}
              </span>
            )}
            {job.estimated_hours > 0 && (
              <span>Est. {job.estimated_hours} hrs</span>
            )}
          </div>
        </div>

        {/* Financial Summary Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {[
            { label: "Bid / Contract", value: fmtShort(bidRef), sub: job.contract_amount && job.bid_amount ? `Bid ${fmtShort(job.bid_amount)}` : "" },
            { label: "Revenue", value: fmtShort(summary.total_revenue), sub: `${invoices.filter(i => i.status !== "voided").length} invoices` },
            { label: "Total Costs", value: fmtShort(summary.total_costs), sub: `${Object.keys(summary.costs_by_type).length} categories` },
            {
              label: "Profit",
              value: fmtShort(summary.profit),
              color: summary.profit > 0 ? "text-green-400" : summary.profit < 0 ? "text-red-400" : "",
            },
            {
              label: "Margin",
              value: summary.total_revenue ? `${summary.margin > 0 ? "+" : ""}${summary.margin.toFixed(1)}%` : "N/A",
              color: summary.margin > 15 ? "text-green-400" : summary.margin > 0 ? "text-amber-400" : summary.margin < 0 ? "text-red-400" : "",
            },
          ].map((c) => (
            <div
              key={c.label}
              className="rounded-lg bg-gray-900 border border-gray-800 p-4"
            >
              <p className="text-xs text-gray-500 uppercase tracking-wide">
                {c.label}
              </p>
              <p className={`text-xl font-bold mt-1 ${c.color || ""}`}>
                {c.value}
              </p>
              {c.sub && (
                <p className="text-xs text-gray-500 mt-1">{c.sub}</p>
              )}
            </div>
          ))}
        </div>

        {/* Bid vs Actual Bars */}
        {bidRef > 0 && (
          <div className="rounded-lg bg-gray-900 border border-gray-800 p-5 space-y-3">
            <h3 className="text-sm font-semibold text-gray-300">
              Bid vs Actual
            </h3>
            {[
              { label: "Bid / Contract", value: bidRef, color: "bg-gray-600" },
              { label: "Costs", value: summary.total_costs, color: summary.total_costs > bidRef ? "bg-red-500" : "bg-amber-500" },
              { label: "Revenue", value: summary.total_revenue, color: "bg-green-500" },
            ].map((bar) => {
              const pct = bidRef > 0 ? Math.min((bar.value / bidRef) * 100, 100) : 0;
              return (
                <div key={bar.label} className="flex items-center gap-3">
                  <span className="text-xs text-gray-400 w-24 text-right shrink-0">
                    {bar.label}
                  </span>
                  <div className="flex-1 bg-gray-800 rounded-full h-5 overflow-hidden relative">
                    <div
                      className={`${bar.color} h-full rounded-full transition-all duration-500`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-sm font-mono w-24 text-right shrink-0">
                    {fmtShort(bar.value)}
                  </span>
                  <span className="text-xs text-gray-500 w-14 text-right shrink-0">
                    {pct.toFixed(0)}%
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Cost Breakdown */}
        {costBreakdown.length > 0 && (
          <div className="rounded-lg bg-gray-900 border border-gray-800 p-5">
            <h3 className="text-sm font-semibold text-gray-300 mb-4">
              Cost Breakdown
            </h3>
            <div className="space-y-2">
              {costBreakdown.map(([type, amount]) => {
                const pct =
                  summary.total_costs > 0
                    ? (amount / summary.total_costs) * 100
                    : 0;
                const barPct = maxCost > 0 ? (amount / maxCost) * 100 : 0;
                return (
                  <div
                    key={type}
                    className="flex items-center gap-3"
                  >
                    <span className="text-sm text-gray-300 w-28 shrink-0">
                      {COST_TYPES[type] || type}
                    </span>
                    <div className="flex-1 bg-gray-800 rounded h-3 overflow-hidden">
                      <div
                        className={`${COST_COLORS[type] || "bg-gray-500"} h-full rounded transition-all duration-500`}
                        style={{ width: `${barPct}%` }}
                      />
                    </div>
                    <span className="text-sm font-mono w-24 text-right shrink-0">
                      {fmt(amount)}
                    </span>
                    <span className="text-xs text-gray-500 w-12 text-right shrink-0">
                      {pct.toFixed(1)}%
                    </span>
                  </div>
                );
              })}
              <div className="flex items-center gap-3 border-t border-gray-700 pt-2 mt-2">
                <span className="text-sm font-semibold w-28 shrink-0">Total</span>
                <div className="flex-1" />
                <span className="text-sm font-mono font-semibold w-24 text-right shrink-0">
                  {fmt(summary.total_costs)}
                </span>
                <span className="text-xs w-12 text-right shrink-0">100%</span>
              </div>
            </div>
          </div>
        )}

        {/* Labor Detail (from timesheets) */}
        {labor.by_employee.length > 0 && (
          <div className="rounded-lg bg-gray-900 border border-gray-800 p-5">
            <h3 className="text-sm font-semibold text-gray-300 mb-3">
              Labor Detail{" "}
              <span className="text-gray-500 font-normal">
                (auto-calculated from approved timesheets)
              </span>
            </h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-500 text-xs uppercase">
                  <th className="text-left pb-2">Employee</th>
                  <th className="text-right pb-2">Hours</th>
                  <th className="text-right pb-2">Rate</th>
                  <th className="text-right pb-2">Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/50">
                {labor.by_employee.map((e) => (
                  <tr key={e.user_id}>
                    <td className="py-2 text-gray-300">{e.name}</td>
                    <td className="py-2 text-right font-mono">{e.hours}</td>
                    <td className="py-2 text-right font-mono">{fmt(e.rate)}/hr</td>
                    <td className="py-2 text-right font-mono">{fmt(e.cost)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-gray-700">
                  <td className="pt-2 font-semibold">Total Labor</td>
                  <td className="pt-2 text-right font-mono">
                    {labor.by_employee.reduce((s, e) => s + e.hours, 0)}
                  </td>
                  <td />
                  <td className="pt-2 text-right font-mono font-semibold">
                    {fmt(labor.total)}
                  </td>
                </tr>
                {labor.per_diem > 0 && (
                  <tr>
                    <td className="pt-1 text-gray-400">Per Diem</td>
                    <td />
                    <td />
                    <td className="pt-1 text-right font-mono text-gray-400">
                      {fmt(labor.per_diem)}
                    </td>
                  </tr>
                )}
              </tfoot>
            </table>
          </div>
        )}

        {/* Tabbed Section: Cost Entries, Timesheets, Invoices, Bills */}
        <div className="rounded-lg bg-gray-900 border border-gray-800">
          {/* Tab bar */}
          <div className="flex border-b border-gray-800 overflow-x-auto">
            {(
              [
                { key: "costs", label: `Cost Entries (${cost_entries.length})` },
                { key: "timesheets", label: `Timesheets (${timesheets.length})` },
                { key: "invoices", label: `Invoices (${invoices.length})` },
                { key: "bills", label: `Bills (${bills.length})` },
              ] as { key: typeof tab; label: string }[]
            ).map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-5 py-3 text-sm font-medium whitespace-nowrap transition ${
                  tab === t.key
                    ? "text-blue-400 border-b-2 border-blue-400"
                    : "text-gray-500 hover:text-gray-300"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="p-5">
            {/* Cost Entries Tab */}
            {tab === "costs" && (
              <div className="space-y-4">
                {cost_entries.length > 0 ? (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-gray-500 text-xs uppercase">
                        <th className="text-left pb-2">Date</th>
                        <th className="text-left pb-2">Type</th>
                        <th className="text-left pb-2">Description</th>
                        <th className="text-right pb-2">Qty</th>
                        <th className="text-right pb-2">Rate</th>
                        <th className="text-right pb-2">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800/50">
                      {cost_entries.map((ce) => (
                        <tr key={ce.id}>
                          <td className="py-2 text-gray-400">
                            {new Date(ce.date + "T00:00").toLocaleDateString()}
                          </td>
                          <td className="py-2">
                            <span
                              className={`inline-block w-2 h-2 rounded-full mr-2 ${COST_COLORS[ce.cost_type] || "bg-gray-500"}`}
                            />
                            {COST_TYPES[ce.cost_type] || ce.cost_type}
                          </td>
                          <td className="py-2 text-gray-400">
                            {ce.description || "—"}
                          </td>
                          <td className="py-2 text-right font-mono">
                            {ce.quantity}
                          </td>
                          <td className="py-2 text-right font-mono">
                            {ce.rate ? fmt(ce.rate) : "—"}
                          </td>
                          <td className="py-2 text-right font-mono font-medium">
                            {fmt(ce.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="text-gray-500 text-sm">
                    No manual cost entries yet.
                  </p>
                )}

                {/* Add cost form */}
                <form
                  onSubmit={handleAddCost}
                  className="border-t border-gray-800 pt-4"
                >
                  <h4 className="text-sm font-medium text-gray-400 mb-3">
                    Add Cost Entry
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
                    <div>
                      <select
                        className={selectCls}
                        required
                        value={costForm.cost_type}
                        onChange={(e) => cf("cost_type", e.target.value)}
                      >
                        <option value="">Type</option>
                        {Object.entries(COST_TYPES).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="col-span-2 sm:col-span-1">
                      <input
                        className={inputCls}
                        placeholder="Description"
                        value={costForm.description}
                        onChange={(e) => cf("description", e.target.value)}
                      />
                    </div>
                    <div>
                      <input
                        className={inputCls}
                        type="number"
                        step="0.001"
                        placeholder="Qty"
                        value={costForm.quantity}
                        onChange={(e) => cf("quantity", e.target.value)}
                      />
                    </div>
                    <div>
                      <input
                        className={inputCls}
                        type="number"
                        step="0.01"
                        placeholder="Rate"
                        value={costForm.rate}
                        onChange={(e) => cf("rate", e.target.value)}
                      />
                    </div>
                    <div>
                      <input
                        className={inputCls}
                        type="number"
                        step="0.01"
                        placeholder="Amount"
                        required
                        value={costForm.amount}
                        onChange={(e) => cf("amount", e.target.value)}
                      />
                    </div>
                    <div className="flex gap-2">
                      <input
                        className={inputCls}
                        type="date"
                        value={costForm.date}
                        onChange={(e) => cf("date", e.target.value)}
                      />
                      <button
                        type="submit"
                        disabled={addingCost}
                        className="rounded bg-blue-600 px-4 py-2 text-sm font-medium hover:bg-blue-500 disabled:opacity-50 transition shrink-0"
                      >
                        {addingCost ? "..." : "Add"}
                      </button>
                    </div>
                  </div>
                </form>
              </div>
            )}

            {/* Timesheets Tab */}
            {tab === "timesheets" && (
              <div>
                {timesheets.length > 0 ? (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-gray-500 text-xs uppercase">
                        <th className="text-left pb-2">Employee</th>
                        <th className="text-left pb-2">Week Ending</th>
                        <th className="text-left pb-2">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800/50">
                      {timesheets.map((ts) => (
                        <tr key={ts.id}>
                          <td className="py-2">{ts.user_name}</td>
                          <td className="py-2 text-gray-400">
                            {new Date(ts.week_ending + "T00:00").toLocaleDateString()}
                          </td>
                          <td className="py-2">
                            <span
                              className={`text-xs rounded-full px-2 py-0.5 ${
                                ts.status === "approved"
                                  ? "bg-green-500/20 text-green-400"
                                  : ts.status === "submitted"
                                    ? "bg-blue-500/20 text-blue-400"
                                    : "bg-gray-500/20 text-gray-400"
                              }`}
                            >
                              {ts.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="text-gray-500 text-sm">
                    No timesheets linked to this job yet. Assign timesheets to
                    this job when creating or editing them.
                  </p>
                )}
              </div>
            )}

            {/* Invoices Tab */}
            {tab === "invoices" && (
              <div>
                {invoices.length > 0 ? (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-gray-500 text-xs uppercase">
                        <th className="text-left pb-2">#</th>
                        <th className="text-left pb-2">Date</th>
                        <th className="text-left pb-2">Status</th>
                        <th className="text-right pb-2">Total</th>
                        <th className="text-right pb-2">Paid</th>
                        <th className="text-right pb-2">Balance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800/50">
                      {invoices.map((inv) => (
                        <tr key={inv.id}>
                          <td className="py-2 font-mono">#{inv.invoice_number}</td>
                          <td className="py-2 text-gray-400">
                            {new Date(inv.invoice_date + "T00:00").toLocaleDateString()}
                          </td>
                          <td className="py-2">
                            <span
                              className={`text-xs rounded-full px-2 py-0.5 ${
                                inv.status === "paid"
                                  ? "bg-green-500/20 text-green-400"
                                  : inv.status === "sent" || inv.status === "partial"
                                    ? "bg-amber-500/20 text-amber-400"
                                    : "bg-gray-500/20 text-gray-400"
                              }`}
                            >
                              {inv.status}
                            </span>
                          </td>
                          <td className="py-2 text-right font-mono">
                            {fmt(inv.total)}
                          </td>
                          <td className="py-2 text-right font-mono text-green-400">
                            {fmt(inv.amount_paid)}
                          </td>
                          <td className="py-2 text-right font-mono">
                            {fmt(inv.balance_due)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="text-gray-500 text-sm">
                    No invoices linked. When creating invoices, assign them to
                    this job to track revenue.
                  </p>
                )}
              </div>
            )}

            {/* Bills Tab */}
            {tab === "bills" && (
              <div>
                {bills.length > 0 ? (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-gray-500 text-xs uppercase">
                        <th className="text-left pb-2">Bill #</th>
                        <th className="text-left pb-2">Vendor</th>
                        <th className="text-left pb-2">Date</th>
                        <th className="text-left pb-2">Status</th>
                        <th className="text-right pb-2">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800/50">
                      {bills.map((b) => (
                        <tr key={b.id}>
                          <td className="py-2 font-mono">{b.bill_number}</td>
                          <td className="py-2 text-gray-400">
                            {b.vendors?.company_name || "—"}
                          </td>
                          <td className="py-2 text-gray-400">
                            {new Date(b.bill_date + "T00:00").toLocaleDateString()}
                          </td>
                          <td className="py-2">
                            <span
                              className={`text-xs rounded-full px-2 py-0.5 ${
                                b.status === "paid"
                                  ? "bg-green-500/20 text-green-400"
                                  : "bg-amber-500/20 text-amber-400"
                              }`}
                            >
                              {b.status}
                            </span>
                          </td>
                          <td className="py-2 text-right font-mono">
                            {fmt(b.total)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="text-gray-500 text-sm">
                    No bills linked. When entering bills, assign them to this
                    job to track material and subcontractor costs.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Estimates */}
        {estimates.length > 0 && (
          <div className="rounded-lg bg-gray-900 border border-gray-800 p-5">
            <h3 className="text-sm font-semibold text-gray-300 mb-3">
              Linked Estimates
            </h3>
            <div className="flex flex-wrap gap-3">
              {estimates.map((est) => (
                <div
                  key={est.id}
                  className="rounded bg-gray-800 px-4 py-2 text-sm"
                >
                  <span className="font-mono">#{est.estimate_number}</span>
                  <span className="text-gray-400 ml-2">{est.status}</span>
                  <span className="ml-2 font-mono">{fmt(est.total)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Notes */}
        {job.notes && (
          <div className="rounded-lg bg-gray-900 border border-gray-800 p-5">
            <h3 className="text-sm font-semibold text-gray-300 mb-2">Notes</h3>
            <p className="text-gray-400 text-sm whitespace-pre-wrap">
              {job.notes}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
