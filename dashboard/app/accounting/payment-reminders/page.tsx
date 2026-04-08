"use client";

import { useState, useEffect, useCallback } from "react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface OverdueInvoice {
  id: string;
  invoice_number: number;
  due_date: string;
  total: number;
  balance_due: number;
  status: string;
  customers?: { company_name: string; contact_name?: string; email?: string };
  days_overdue: number;
  last_reminder: { reminder_type: string; sent_at: string | null; created_at: string } | null;
}

interface Reminder {
  id: string;
  invoice_id: string;
  reminder_type: string;
  scheduled_date: string;
  sent_at: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  invoices?: {
    invoice_number: number;
    due_date: string;
    total: number;
    balance_due: number;
    customers?: { company_name: string };
  };
}

interface MileageRate {
  id: string;
  effective_date: string;
  rate_per_mile: number;
  rate_type: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function fmtCurrency(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
}

function fmtDate(iso: string): string {
  return new Date(iso + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtRate(n: number): string {
  return `$${Number(n).toFixed(4)}`;
}

function severityColor(days: number): { bg: string; text: string; border: string } {
  if (days >= 60) return { bg: "bg-red-900/40", text: "text-red-300", border: "border-red-800/60" };
  if (days >= 30) return { bg: "bg-orange-900/40", text: "text-orange-300", border: "border-orange-800/60" };
  if (days >= 7)  return { bg: "bg-yellow-900/40", text: "text-yellow-300", border: "border-yellow-800/60" };
  return { bg: "bg-green-900/40", text: "text-green-300", border: "border-green-800/60" };
}

function reminderLabel(type: string): string {
  const map: Record<string, string> = {
    upcoming: "Upcoming",
    overdue_7: "7-Day",
    overdue_30: "30-Day",
    overdue_60: "60-Day",
    overdue_90: "90-Day",
    final_notice: "Final Notice",
  };
  return map[type] || type;
}

function statusBadge(status: string): { bg: string; text: string } {
  switch (status) {
    case "pending": return { bg: "bg-amber-900/50", text: "text-amber-300" };
    case "sent": return { bg: "bg-green-900/50", text: "text-green-300" };
    case "skipped": return { bg: "bg-gray-800", text: "text-gray-400" };
    case "cancelled": return { bg: "bg-red-900/50", text: "text-red-400" };
    default: return { bg: "bg-gray-800", text: "text-gray-400" };
  }
}

const RATE_TYPE_LABELS: Record<string, string> = {
  standard: "Standard",
  medical: "Medical / Moving",
  charitable: "Charitable",
  custom: "Custom",
};

/* ------------------------------------------------------------------ */
/*  Page Component                                                     */
/* ------------------------------------------------------------------ */

export default function PaymentRemindersPage() {
  const [tab, setTab] = useState<"overdue" | "mileage">("overdue");

  // Overdue invoices state
  const [overdueInvoices, setOverdueInvoices] = useState<OverdueInvoice[]>([]);
  const [allReminders, setAllReminders] = useState<Reminder[]>([]);
  const [loadingOverdue, setLoadingOverdue] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [genResult, setGenResult] = useState<string | null>(null);

  // Mileage state
  const [rates, setRates] = useState<MileageRate[]>([]);
  const [loadingRates, setLoadingRates] = useState(true);
  const [showCreateRate, setShowCreateRate] = useState(false);
  const [editingRate, setEditingRate] = useState<MileageRate | null>(null);

  // Rate form
  const [rateDate, setRateDate] = useState(new Date().toISOString().split("T")[0]);
  const [rateValue, setRateValue] = useState("");
  const [rateType, setRateType] = useState("standard");
  const [rateDesc, setRateDesc] = useState("");
  const [savingRate, setSavingRate] = useState(false);

  // Mileage calculator
  const [calcMiles, setCalcMiles] = useState("");
  const [calcRateType, setCalcRateType] = useState("standard");

  /* ---------------------------------------------------------------- */
  /*  Data Loading                                                     */
  /* ---------------------------------------------------------------- */

  const loadOverdue = useCallback(async () => {
    setLoadingOverdue(true);
    try {
      const [overdueRes, remindersRes] = await Promise.all([
        fetch("/api/accounting/payment-reminders?overdue=true"),
        fetch("/api/accounting/payment-reminders"),
      ]);
      if (overdueRes.ok) setOverdueInvoices(await overdueRes.json());
      if (remindersRes.ok) setAllReminders(await remindersRes.json());
    } catch { /* ignore */ }
    setLoadingOverdue(false);
  }, []);

  const loadRates = useCallback(async () => {
    setLoadingRates(true);
    try {
      const res = await fetch("/api/accounting/mileage-rates");
      if (res.ok) setRates(await res.json());
    } catch { /* ignore */ }
    setLoadingRates(false);
  }, []);

  useEffect(() => { loadOverdue(); loadRates(); }, [loadOverdue, loadRates]);

  /* ---------------------------------------------------------------- */
  /*  Actions — Reminders                                              */
  /* ---------------------------------------------------------------- */

  async function handleGenerate() {
    setGenerating(true);
    setGenResult(null);
    try {
      const res = await fetch("/api/accounting/payment-reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate" }),
      });
      const data = await res.json();
      setGenResult(`${data.created ?? 0} reminder(s) generated`);
      loadOverdue();
    } catch {
      setGenResult("Failed to generate reminders");
    }
    setGenerating(false);
  }

  async function handleReminderAction(reminderId: string, action: "mark_sent" | "skip" | "cancel") {
    try {
      const res = await fetch("/api/accounting/payment-reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reminder_id: reminderId }),
      });
      if (res.ok) loadOverdue();
    } catch { /* ignore */ }
  }

  /* ---------------------------------------------------------------- */
  /*  Actions — Mileage Rates                                          */
  /* ---------------------------------------------------------------- */

  function resetRateForm() {
    setRateDate(new Date().toISOString().split("T")[0]);
    setRateValue("");
    setRateType("standard");
    setRateDesc("");
    setEditingRate(null);
    setShowCreateRate(false);
  }

  function startEditRate(rate: MileageRate) {
    setEditingRate(rate);
    setRateDate(rate.effective_date);
    setRateValue(String(rate.rate_per_mile));
    setRateType(rate.rate_type);
    setRateDesc(rate.description || "");
    setShowCreateRate(true);
  }

  async function handleSaveRate() {
    if (!rateDate || !rateValue) return;
    setSavingRate(true);
    try {
      if (editingRate) {
        // Update
        await fetch("/api/accounting/mileage-rates", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: editingRate.id,
            effective_date: rateDate,
            rate_per_mile: Number(rateValue),
            rate_type: rateType,
            description: rateDesc || null,
          }),
        });
      } else {
        // Create
        await fetch("/api/accounting/mileage-rates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            effective_date: rateDate,
            rate_per_mile: Number(rateValue),
            rate_type: rateType,
            description: rateDesc || null,
          }),
        });
      }
      resetRateForm();
      loadRates();
    } catch { /* ignore */ }
    setSavingRate(false);
  }

  async function handleDeactivateRate(id: string) {
    try {
      await fetch("/api/accounting/mileage-rates", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      loadRates();
    } catch { /* ignore */ }
  }

  /* ---------------------------------------------------------------- */
  /*  Computed                                                         */
  /* ---------------------------------------------------------------- */

  // Current effective rate for the calculator
  const activeRates = rates.filter((r) => r.is_active);
  const today = new Date().toISOString().split("T")[0];

  const currentRate = activeRates
    .filter((r) => r.rate_type === calcRateType && r.effective_date <= today)
    .sort((a, b) => b.effective_date.localeCompare(a.effective_date))[0];

  const calcResult = currentRate && calcMiles
    ? Number(calcMiles) * Number(currentRate.rate_per_mile)
    : null;

  // Current standard rate for display
  const currentStandard = activeRates
    .filter((r) => r.rate_type === "standard" && r.effective_date <= today)
    .sort((a, b) => b.effective_date.localeCompare(a.effective_date))[0];

  // Summary stats
  const totalOverdueAmount = overdueInvoices.reduce((s, i) => s + Number(i.balance_due), 0);
  const critical = overdueInvoices.filter((i) => i.days_overdue >= 60).length;
  const pendingReminders = allReminders.filter((r) => r.status === "pending").length;

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  return (
    <div className="min-h-screen bg-gray-950 text-white">

      <main className="px-4 sm:px-6 py-6 max-w-6xl mx-auto">
        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <div className="p-4 rounded-xl bg-gray-900/50 border border-gray-800">
            <div className="text-[10px] text-gray-600 uppercase tracking-wider mb-1">Overdue Invoices</div>
            <div className="text-xl font-bold text-red-400">{overdueInvoices.length}</div>
          </div>
          <div className="p-4 rounded-xl bg-gray-900/50 border border-gray-800">
            <div className="text-[10px] text-gray-600 uppercase tracking-wider mb-1">Total Overdue</div>
            <div className="text-xl font-bold text-orange-400">{fmtCurrency(totalOverdueAmount)}</div>
          </div>
          <div className="p-4 rounded-xl bg-gray-900/50 border border-gray-800">
            <div className="text-[10px] text-gray-600 uppercase tracking-wider mb-1">Critical (60+ days)</div>
            <div className="text-xl font-bold text-red-500">{critical}</div>
          </div>
          <div className="p-4 rounded-xl bg-gray-900/50 border border-gray-800">
            <div className="text-[10px] text-gray-600 uppercase tracking-wider mb-1">Pending Reminders</div>
            <div className="text-xl font-bold text-amber-400">{pendingReminders}</div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-gray-900/50 rounded-lg p-1 w-fit border border-gray-800">
          <button
            onClick={() => setTab("overdue")}
            className={`px-4 py-2 rounded-md text-xs font-bold uppercase tracking-wider transition-colors ${
              tab === "overdue"
                ? "bg-violet-600 text-white"
                : "text-gray-400 hover:text-gray-200 hover:bg-gray-800/50"
            }`}
          >
            Overdue Invoices
          </button>
          <button
            onClick={() => setTab("mileage")}
            className={`px-4 py-2 rounded-md text-xs font-bold uppercase tracking-wider transition-colors ${
              tab === "mileage"
                ? "bg-violet-600 text-white"
                : "text-gray-400 hover:text-gray-200 hover:bg-gray-800/50"
            }`}
          >
            Mileage Rates
          </button>
        </div>

        {/* ============================================================ */}
        {/*  TAB: Overdue Invoices                                       */}
        {/* ============================================================ */}
        {tab === "overdue" && (
          <>
            {/* Actions */}
            <div className="flex items-center gap-3 mb-4">
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="px-5 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-bold uppercase tracking-wider"
              >
                {generating ? "Generating..." : "Generate Reminders"}
              </button>
              {genResult && (
                <span className="text-sm text-gray-400">{genResult}</span>
              )}
            </div>

            {loadingOverdue ? (
              <div className="flex items-center justify-center py-20">
                <div className="w-8 h-8 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
              </div>
            ) : (
              <>
                {/* Overdue invoices table */}
                <div className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden overflow-x-auto mb-8">
                  <table className="w-full text-sm min-w-[900px]">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-wider text-gray-600 border-b border-gray-800">
                        <th className="text-left px-4 py-3 font-medium w-20">Invoice #</th>
                        <th className="text-left px-4 py-3 font-medium">Customer</th>
                        <th className="text-right px-4 py-3 font-medium w-28">Balance Due</th>
                        <th className="text-left px-4 py-3 font-medium w-24">Due Date</th>
                        <th className="text-center px-4 py-3 font-medium w-24">Days Overdue</th>
                        <th className="text-left px-4 py-3 font-medium w-32">Last Reminder</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overdueInvoices.map((inv) => {
                        const sev = severityColor(inv.days_overdue);
                        return (
                          <tr key={inv.id} className="border-t border-gray-800/50 hover:bg-gray-800/20 transition-colors">
                            <td className="px-4 py-3 font-mono text-gray-400">{inv.invoice_number}</td>
                            <td className="px-4 py-3 text-gray-200">{inv.customers?.company_name || "---"}</td>
                            <td className="px-4 py-3 text-right font-mono text-gray-300">{fmtCurrency(Number(inv.balance_due))}</td>
                            <td className="px-4 py-3 text-gray-400 text-xs">{fmtDate(inv.due_date)}</td>
                            <td className="px-4 py-3 text-center">
                              <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${sev.bg} ${sev.text} border ${sev.border}`}>
                                {inv.days_overdue}d
                              </span>
                            </td>
                            <td className="px-4 py-3 text-xs text-gray-500">
                              {inv.last_reminder
                                ? `${reminderLabel(inv.last_reminder.reminder_type)} ${inv.last_reminder.sent_at ? "(sent)" : "(pending)"}`
                                : "None"}
                            </td>
                          </tr>
                        );
                      })}
                      {overdueInvoices.length === 0 && (
                        <tr>
                          <td colSpan={6} className="px-4 py-8 text-center text-gray-600">
                            No overdue invoices. All caught up.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {/* All reminders list */}
                {allReminders.length > 0 && (
                  <div>
                    <h3 className="text-sm font-bold uppercase tracking-wider text-gray-400 mb-3">Reminder History</h3>
                    <div className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden overflow-x-auto">
                      <table className="w-full text-sm min-w-[800px]">
                        <thead>
                          <tr className="text-[10px] uppercase tracking-wider text-gray-600 border-b border-gray-800">
                            <th className="text-left px-4 py-3 font-medium w-20">Invoice</th>
                            <th className="text-left px-4 py-3 font-medium">Customer</th>
                            <th className="text-left px-4 py-3 font-medium w-28">Type</th>
                            <th className="text-left px-4 py-3 font-medium w-24">Scheduled</th>
                            <th className="text-left px-4 py-3 font-medium w-24">Status</th>
                            <th className="text-right px-4 py-3 font-medium w-36">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {allReminders.map((rem) => {
                            const badge = statusBadge(rem.status);
                            return (
                              <tr key={rem.id} className="border-t border-gray-800/50 hover:bg-gray-800/20 transition-colors">
                                <td className="px-4 py-3 font-mono text-gray-400">
                                  {rem.invoices?.invoice_number || "---"}
                                </td>
                                <td className="px-4 py-3 text-gray-200">
                                  {rem.invoices?.customers?.company_name || "---"}
                                </td>
                                <td className="px-4 py-3 text-gray-300 text-xs">{reminderLabel(rem.reminder_type)}</td>
                                <td className="px-4 py-3 text-gray-400 text-xs">{fmtDate(rem.scheduled_date)}</td>
                                <td className="px-4 py-3">
                                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${badge.bg} ${badge.text}`}>
                                    {rem.status}
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-right">
                                  {rem.status === "pending" && (
                                    <div className="flex gap-2 justify-end">
                                      <button
                                        onClick={() => handleReminderAction(rem.id, "mark_sent")}
                                        className="text-xs text-green-400 hover:text-green-300 font-bold uppercase"
                                      >
                                        Sent
                                      </button>
                                      <button
                                        onClick={() => handleReminderAction(rem.id, "skip")}
                                        className="text-xs text-gray-400 hover:text-gray-300 font-bold uppercase"
                                      >
                                        Skip
                                      </button>
                                      <button
                                        onClick={() => handleReminderAction(rem.id, "cancel")}
                                        className="text-xs text-red-400 hover:text-red-300 font-bold uppercase"
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* ============================================================ */}
        {/*  TAB: Mileage Rates                                          */}
        {/* ============================================================ */}
        {tab === "mileage" && (
          <>
            {/* Current effective rate callout */}
            {currentStandard && (
              <div className="mb-6 p-5 rounded-xl bg-gradient-to-r from-violet-900/30 to-purple-900/20 border border-violet-800/40">
                <div className="text-[10px] text-violet-400 uppercase tracking-wider mb-1">Current IRS Standard Rate</div>
                <div className="flex items-baseline gap-3">
                  <span className="text-3xl font-black text-white">{fmtRate(currentStandard.rate_per_mile)}</span>
                  <span className="text-sm text-gray-400">per mile</span>
                  <span className="text-xs text-gray-600">effective {fmtDate(currentStandard.effective_date)}</span>
                </div>
                {currentStandard.description && (
                  <p className="text-xs text-gray-500 mt-1">{currentStandard.description}</p>
                )}
              </div>
            )}

            {/* Mileage calculator */}
            <div className="mb-6 p-5 rounded-xl bg-gray-900/50 border border-gray-800">
              <h3 className="text-sm font-bold uppercase tracking-wider text-gray-300 mb-3">Mileage Reimbursement Calculator</h3>
              <div className="flex flex-wrap items-end gap-4">
                <div>
                  <label className="block text-[10px] text-gray-600 uppercase tracking-wider mb-1">Miles Driven</label>
                  <input
                    type="number"
                    step="0.1"
                    value={calcMiles}
                    onChange={(e) => setCalcMiles(e.target.value)}
                    placeholder="e.g. 150"
                    className="w-36 px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-gray-600 uppercase tracking-wider mb-1">Rate Type</label>
                  <select
                    value={calcRateType}
                    onChange={(e) => setCalcRateType(e.target.value)}
                    className="w-44 px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white"
                  >
                    <option value="standard">Standard</option>
                    <option value="medical">Medical / Moving</option>
                    <option value="charitable">Charitable</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-gray-600 uppercase tracking-wider mb-1">Rate</label>
                  <div className="px-3 py-2 text-sm text-gray-400">
                    {currentRate ? fmtRate(currentRate.rate_per_mile) : "N/A"}
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] text-gray-600 uppercase tracking-wider mb-1">Reimbursement</label>
                  <div className="px-3 py-2 text-lg font-bold text-violet-300">
                    {calcResult != null ? fmtCurrency(calcResult) : "---"}
                  </div>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3 mb-4">
              <button
                onClick={() => { resetRateForm(); setShowCreateRate(true); }}
                className="px-5 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-bold uppercase tracking-wider"
              >
                + New Rate
              </button>
            </div>

            {/* Create / Edit form */}
            {showCreateRate && (
              <div className="mb-6 p-6 rounded-xl bg-gray-900/50 border border-gray-800 space-y-4">
                <h3 className="text-sm font-bold uppercase tracking-wider text-gray-300">
                  {editingRate ? "Edit Mileage Rate" : "New Mileage Rate"}
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-[10px] text-gray-600 uppercase tracking-wider mb-1">Effective Date *</label>
                    <input
                      type="date"
                      value={rateDate}
                      onChange={(e) => setRateDate(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white [color-scheme:dark]"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-600 uppercase tracking-wider mb-1">Rate per Mile *</label>
                    <input
                      type="number"
                      step="0.0001"
                      value={rateValue}
                      onChange={(e) => setRateValue(e.target.value)}
                      placeholder="0.7000"
                      className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-600 uppercase tracking-wider mb-1">Rate Type</label>
                    <select
                      value={rateType}
                      onChange={(e) => setRateType(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white"
                    >
                      <option value="standard">Standard</option>
                      <option value="medical">Medical / Moving</option>
                      <option value="charitable">Charitable</option>
                      <option value="custom">Custom</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-600 uppercase tracking-wider mb-1">Description</label>
                    <input
                      value={rateDesc}
                      onChange={(e) => setRateDesc(e.target.value)}
                      placeholder="e.g. 2026 IRS rate"
                      className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white"
                    />
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={handleSaveRate}
                    disabled={savingRate || !rateDate || !rateValue}
                    className="px-5 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-bold uppercase tracking-wider"
                  >
                    {savingRate ? "Saving..." : editingRate ? "Update Rate" : "Create Rate"}
                  </button>
                  <button
                    onClick={resetRateForm}
                    className="px-4 py-2 rounded-lg border border-gray-700 text-gray-400 text-sm font-bold uppercase tracking-wider"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Rates table */}
            {loadingRates ? (
              <div className="flex items-center justify-center py-20">
                <div className="w-8 h-8 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
              </div>
            ) : (
              <div className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden overflow-x-auto">
                <table className="w-full text-sm min-w-[700px]">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wider text-gray-600 border-b border-gray-800">
                      <th className="text-left px-4 py-3 font-medium w-28">Effective</th>
                      <th className="text-left px-4 py-3 font-medium w-28">Rate Type</th>
                      <th className="text-right px-4 py-3 font-medium w-28">Rate / Mile</th>
                      <th className="text-left px-4 py-3 font-medium">Description</th>
                      <th className="text-center px-4 py-3 font-medium w-20">Active</th>
                      <th className="text-right px-4 py-3 font-medium w-32">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rates.map((rate) => (
                      <tr
                        key={rate.id}
                        className={`border-t border-gray-800/50 hover:bg-gray-800/20 transition-colors ${
                          !rate.is_active ? "opacity-50" : ""
                        }`}
                      >
                        <td className="px-4 py-3 text-gray-400 text-xs">{fmtDate(rate.effective_date)}</td>
                        <td className="px-4 py-3">
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-violet-900/40 text-violet-300 border border-violet-800/40">
                            {RATE_TYPE_LABELS[rate.rate_type] || rate.rate_type}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-gray-200">{fmtRate(rate.rate_per_mile)}</td>
                        <td className="px-4 py-3 text-gray-400 text-xs">{rate.description || "---"}</td>
                        <td className="px-4 py-3 text-center">
                          {rate.is_active ? (
                            <span className="inline-block w-2 h-2 rounded-full bg-green-400" />
                          ) : (
                            <span className="inline-block w-2 h-2 rounded-full bg-gray-600" />
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex gap-2 justify-end">
                            <button
                              onClick={() => startEditRate(rate)}
                              className="text-xs text-violet-400 hover:text-violet-300 font-bold uppercase"
                            >
                              Edit
                            </button>
                            {rate.is_active && (
                              <button
                                onClick={() => handleDeactivateRate(rate.id)}
                                className="text-xs text-red-400 hover:text-red-300 font-bold uppercase"
                              >
                                Deactivate
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {rates.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-gray-600">
                          No mileage rates configured. Create one above.
                        </td>
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
