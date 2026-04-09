"use client";

import { useState, useEffect, FormEvent } from "react";
import Link from "next/link";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Job {
  id: string;
  job_number: string;
  name: string;
  customer_id: string | null;
  customer_name: string | null;
  status: string;
  job_type: string;
  location: string;
  bid_amount: number;
  contract_amount: number;
  start_date: string | null;
  end_date: string | null;
  estimated_hours: number;
  total_costs: number;
  total_revenue: number;
  profit: number;
  margin: number;
}

interface Customer {
  id: string;
  company_name: string;
}

interface JobForm {
  name: string;
  customer_id: string;
  job_type: string;
  location: string;
  bid_amount: string;
  contract_amount: string;
  estimated_hours: string;
  start_date: string;
  end_date: string;
  notes: string;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const JOB_TYPES = [
  "Railroad",
  "Bridge",
  "Construction",
  "Fabrication",
  "Maintenance",
  "Service",
  "Other",
];

const STATUS_CFG: Record<string, { label: string; bg: string; text: string }> =
  {
    bidding: {
      label: "Bidding",
      bg: "bg-blue-500/20",
      text: "text-blue-400",
    },
    active: {
      label: "Active",
      bg: "bg-green-500/20",
      text: "text-green-400",
    },
    completed: {
      label: "Completed",
      bg: "bg-amber-500/20",
      text: "text-amber-400",
    },
    closed: {
      label: "Closed",
      bg: "bg-gray-500/20",
      text: "text-gray-400",
    },
  };

const INITIAL_FORM: JobForm = {
  name: "",
  customer_id: "",
  job_type: "",
  location: "",
  bid_amount: "",
  contract_amount: "",
  estimated_hours: "",
  start_date: "",
  end_date: "",
  notes: "",
};

const fmt = (n: number) =>
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

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [showNew, setShowNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<JobForm>(INITIAL_FORM);

  useEffect(() => {
    Promise.all([
      fetch("/api/jobs").then((r) => r.json()),
      fetch("/api/accounting/customers").then((r) => r.json()),
    ])
      .then(([j, c]) => {
        setJobs(Array.isArray(j) ? j : []);
        setCustomers(Array.isArray(c) ? c : []);
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        bid_amount: parseFloat(form.bid_amount) || 0,
        contract_amount: parseFloat(form.contract_amount) || 0,
        estimated_hours: parseFloat(form.estimated_hours) || 0,
        customer_id: form.customer_id || null,
      }),
    });
    if (res.ok) {
      const created = await res.json();
      setJobs([
        {
          ...created,
          customer_name:
            customers.find((c) => c.id === created.customer_id)
              ?.company_name || null,
          total_costs: 0,
          total_revenue: 0,
          profit: 0,
          margin: 0,
        },
        ...jobs,
      ]);
      setShowNew(false);
      setForm(INITIAL_FORM);
    }
    setSaving(false);
  }

  const set = (k: keyof JobForm, v: string) =>
    setForm((p) => ({ ...p, [k]: v }));

  /* ---- Derived ---- */
  const filtered =
    filter === "all" ? jobs : jobs.filter((j) => j.status === filter);
  const active = jobs.filter((j) => j.status === "active");
  const totalRev = active.reduce((s, j) => s + (j.total_revenue || 0), 0);
  const totalCost = active.reduce((s, j) => s + (j.total_costs || 0), 0);
  const avgMargin = active.length
    ? active.reduce((s, j) => s + (j.margin || 0), 0) / active.length
    : 0;

  const marginColor = (m: number) =>
    m > 15
      ? "text-green-400"
      : m > 0
        ? "text-amber-400"
        : m < 0
          ? "text-red-400"
          : "text-gray-400";

  /* ---- Render ---- */
  return (
    <div className="text-white p-4 sm:p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Job Costing</h1>
            <p className="text-gray-400 text-sm">
              Track bids, costs, and profitability per job
            </p>
          </div>
          <button
            onClick={() => setShowNew(!showNew)}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium hover:bg-blue-500 transition"
          >
            {showNew ? "Cancel" : "+ New Job"}
          </button>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            {
              label: "Active Jobs",
              value: String(active.length),
              sub: `${jobs.length} total`,
            },
            { label: "Active Revenue", value: fmt(totalRev), sub: "invoiced" },
            {
              label: "Active Costs",
              value: fmt(totalCost),
              sub: "labor + materials + other",
            },
            {
              label: "Avg Margin",
              value: `${avgMargin.toFixed(1)}%`,
              sub: "across active jobs",
              color: marginColor(avgMargin),
            },
          ].map((c) => (
            <div
              key={c.label}
              className="rounded-lg bg-gray-900 border border-gray-800 p-4"
            >
              <p className="text-xs text-gray-500 uppercase tracking-wide">
                {c.label}
              </p>
              <p className={`text-2xl font-bold mt-1 ${c.color || ""}`}>
                {c.value}
              </p>
              <p className="text-xs text-gray-500 mt-1">{c.sub}</p>
            </div>
          ))}
        </div>

        {/* New Job Form */}
        {showNew && (
          <form
            onSubmit={handleCreate}
            className="rounded-lg bg-gray-900 border border-gray-800 p-5 space-y-4"
          >
            <h2 className="text-lg font-semibold">New Job</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  Job Name *
                </label>
                <input
                  className={inputCls}
                  required
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  placeholder="e.g. NS Rail Repair — Lexington"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  Customer
                </label>
                <select
                  className={selectCls}
                  value={form.customer_id}
                  onChange={(e) => set("customer_id", e.target.value)}
                >
                  <option value="">— None —</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.company_name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  Job Type
                </label>
                <select
                  className={selectCls}
                  value={form.job_type}
                  onChange={(e) => set("job_type", e.target.value)}
                >
                  <option value="">— Select —</option>
                  {JOB_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  Location
                </label>
                <input
                  className={inputCls}
                  value={form.location}
                  onChange={(e) => set("location", e.target.value)}
                  placeholder="City, State"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  Bid Amount
                </label>
                <input
                  className={inputCls}
                  type="number"
                  step="0.01"
                  value={form.bid_amount}
                  onChange={(e) => set("bid_amount", e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  Contract Amount
                </label>
                <input
                  className={inputCls}
                  type="number"
                  step="0.01"
                  value={form.contract_amount}
                  onChange={(e) => set("contract_amount", e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  Est. Hours
                </label>
                <input
                  className={inputCls}
                  type="number"
                  value={form.estimated_hours}
                  onChange={(e) => set("estimated_hours", e.target.value)}
                  placeholder="0"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  Start Date
                </label>
                <input
                  className={inputCls}
                  type="date"
                  value={form.start_date}
                  onChange={(e) => set("start_date", e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  End Date
                </label>
                <input
                  className={inputCls}
                  type="date"
                  value={form.end_date}
                  onChange={(e) => set("end_date", e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Notes</label>
              <textarea
                className={inputCls + " h-16"}
                value={form.notes}
                onChange={(e) => set("notes", e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setShowNew(false);
                  setForm(INITIAL_FORM);
                }}
                className="rounded px-4 py-2 text-sm text-gray-400 hover:text-white transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded bg-blue-600 px-5 py-2 text-sm font-medium hover:bg-blue-500 disabled:opacity-50 transition"
              >
                {saving ? "Creating..." : "Create Job"}
              </button>
            </div>
          </form>
        )}

        {/* Filter Tabs */}
        <div className="flex gap-2 flex-wrap">
          {["all", "bidding", "active", "completed", "closed"].map((s) => {
            const cnt =
              s === "all" ? jobs.length : jobs.filter((j) => j.status === s).length;
            return (
              <button
                key={s}
                onClick={() => setFilter(s)}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                  filter === s
                    ? "bg-blue-600 text-white"
                    : "bg-gray-800 text-gray-400 hover:text-white"
                }`}
              >
                {s === "all" ? "All" : STATUS_CFG[s]?.label || s} ({cnt})
              </button>
            );
          })}
        </div>

        {/* Table */}
        {loading ? (
          <div className="text-center py-12 text-gray-500">Loading jobs...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            {jobs.length === 0
              ? "No jobs yet — create your first one above."
              : "No jobs match this filter."}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-900 text-gray-400 text-xs uppercase tracking-wide">
                  <th className="text-left px-4 py-3">#</th>
                  <th className="text-left px-4 py-3">Job</th>
                  <th className="text-left px-4 py-3 hidden sm:table-cell">
                    Customer
                  </th>
                  <th className="text-left px-4 py-3 hidden md:table-cell">
                    Type
                  </th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-right px-4 py-3">Bid</th>
                  <th className="text-right px-4 py-3">Costs</th>
                  <th className="text-right px-4 py-3 hidden sm:table-cell">
                    Revenue
                  </th>
                  <th className="text-right px-4 py-3">Margin</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/50">
                {filtered.map((j) => {
                  const sc = STATUS_CFG[j.status] || STATUS_CFG.closed;
                  return (
                    <tr
                      key={j.id}
                      className="hover:bg-gray-900/50 transition"
                    >
                      <td className="px-4 py-3 font-mono text-gray-500">
                        {j.job_number}
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/jobs/${j.id}`}
                          className="text-blue-400 hover:text-blue-300 font-medium"
                        >
                          {j.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-gray-400 hidden sm:table-cell">
                        {j.customer_name || "—"}
                      </td>
                      <td className="px-4 py-3 text-gray-400 hidden md:table-cell">
                        {j.job_type || "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${sc.bg} ${sc.text}`}
                        >
                          {sc.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        {j.bid_amount ? fmt(j.bid_amount) : "—"}
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        {j.total_costs ? fmt(j.total_costs) : "—"}
                      </td>
                      <td className="px-4 py-3 text-right font-mono hidden sm:table-cell">
                        {j.total_revenue ? fmt(j.total_revenue) : "—"}
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-mono font-medium ${marginColor(j.margin)}`}
                      >
                        {j.total_revenue
                          ? `${j.margin > 0 ? "+" : ""}${j.margin.toFixed(1)}%`
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
