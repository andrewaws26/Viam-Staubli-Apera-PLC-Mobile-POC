"use client";

import { useState, useEffect, useCallback, Fragment } from "react";

// ── Types ────────────────────────────────────────────────────────────

interface Account {
  id: string;
  account_number: string;
  name: string;
  account_type: string;
}

interface RecurringLine {
  id: string;
  account_id: string;
  debit: number;
  credit: number;
  description: string | null;
  line_order: number;
  chart_of_accounts: { account_number: string; name: string };
}

interface RecurringTemplate {
  id: string;
  description: string;
  reference: string | null;
  frequency: "monthly" | "quarterly" | "annually";
  next_date: string;
  end_date: string | null;
  is_active: boolean;
  created_by_name: string;
  created_at: string;
  recurring_journal_entry_lines: RecurringLine[];
}

interface FormLine {
  account_id: string;
  debit: number;
  credit: number;
  description: string;
}

type Frequency = "monthly" | "quarterly" | "annually";

// ── Helpers ──────────────────────────────────────────────────────────

function fmtCurrency(n: number): string {
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

const FREQUENCY_LABELS: Record<Frequency, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  annually: "Annually",
};

const FREQUENCY_COLORS: Record<Frequency, string> = {
  monthly: "bg-blue-900/50 text-blue-300",
  quarterly: "bg-purple-900/50 text-purple-300",
  annually: "bg-amber-900/50 text-amber-300",
};

// ── Page Component ───────────────────────────────────────────────────

export default function RecurringEntriesPage() {
  const [templates, setTemplates] = useState<RecurringTemplate[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [generateMsg, setGenerateMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Create form state
  const [formDesc, setFormDesc] = useState("");
  const [formRef, setFormRef] = useState("");
  const [formFreq, setFormFreq] = useState<Frequency>("monthly");
  const [formNextDate, setFormNextDate] = useState("");
  const [formEndDate, setFormEndDate] = useState("");
  const [formLines, setFormLines] = useState<FormLine[]>([
    { account_id: "", debit: 0, credit: 0, description: "" },
    { account_id: "", debit: 0, credit: 0, description: "" },
  ]);
  const [formError, setFormError] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [tplRes, acctRes] = await Promise.all([
        fetch("/api/accounting/recurring"),
        fetch("/api/accounting/accounts"),
      ]);
      if (tplRes.ok) setTemplates(await tplRes.json());
      if (acctRes.ok) {
        const data = await acctRes.json();
        setAccounts(Array.isArray(data) ? data : []);
      }
    } catch {
      /* ignore */
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ── Form helpers ─────────────────────────────────────────────────

  function resetForm() {
    setFormDesc("");
    setFormRef("");
    setFormFreq("monthly");
    setFormNextDate("");
    setFormEndDate("");
    setFormLines([
      { account_id: "", debit: 0, credit: 0, description: "" },
      { account_id: "", debit: 0, credit: 0, description: "" },
    ]);
    setFormError("");
    setShowCreate(false);
  }

  function updateLine(
    idx: number,
    field: keyof FormLine,
    value: string | number
  ) {
    setFormLines((prev) =>
      prev.map((l, i) => (i === idx ? { ...l, [field]: value } : l))
    );
  }

  function addLine() {
    setFormLines((prev) => [
      ...prev,
      { account_id: "", debit: 0, credit: 0, description: "" },
    ]);
  }

  function removeLine(idx: number) {
    if (formLines.length <= 2) return;
    setFormLines((prev) => prev.filter((_, i) => i !== idx));
  }

  const totalDebits = formLines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const totalCredits = formLines.reduce(
    (s, l) => s + (Number(l.credit) || 0),
    0
  );
  const isBalanced =
    Math.abs(totalDebits - totalCredits) < 0.005 && totalDebits > 0;

  // ── API actions ──────────────────────────────────────────────────

  async function handleCreate() {
    setFormError("");
    if (!formDesc.trim()) {
      setFormError("Description is required");
      return;
    }
    if (!formNextDate) {
      setFormError("Next date is required");
      return;
    }
    if (formLines.some((l) => !l.account_id)) {
      setFormError("Every line must have an account selected");
      return;
    }
    if (
      formLines.some(
        (l) => (Number(l.debit) || 0) === 0 && (Number(l.credit) || 0) === 0
      )
    ) {
      setFormError("Every line must have a debit or credit amount");
      return;
    }
    if (!isBalanced) {
      setFormError("Total debits must equal total credits");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/accounting/recurring", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: formDesc.trim(),
          reference: formRef.trim() || null,
          frequency: formFreq,
          next_date: formNextDate,
          end_date: formEndDate || null,
          lines: formLines.map((l) => ({
            account_id: l.account_id,
            debit: Number(l.debit) || 0,
            credit: Number(l.credit) || 0,
            description: l.description.trim() || null,
          })),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to create template");
      }
      resetForm();
      loadData();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Unknown error");
    }
    setSaving(false);
  }

  async function handleToggleActive(id: string, currentlyActive: boolean) {
    try {
      await fetch("/api/accounting/recurring", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, is_active: !currentlyActive }),
      });
      loadData();
    } catch {
      /* ignore */
    }
  }

  async function handleGenerate() {
    setSaving(true);
    setGenerateMsg(null);
    try {
      const res = await fetch("/api/accounting/recurring", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate" }),
      });
      if (res.ok) {
        const data = await res.json();
        setGenerateMsg(data.message || `Generated ${data.generated} entries`);
        loadData();
      } else {
        const data = await res.json().catch(() => ({}));
        setGenerateMsg(data.error || "Failed to generate entries");
      }
    } catch {
      setGenerateMsg("Network error generating entries");
    }
    setSaving(false);
  }

  async function handleDelete(id: string) {
    try {
      await fetch(`/api/accounting/recurring?id=${id}`, { method: "DELETE" });
      setDeleteConfirm(null);
      loadData();
    } catch {
      /* ignore */
    }
  }

  // ── Summary stats ────────────────────────────────────────────────

  const totalTemplates = templates.length;
  const activeCount = templates.filter((t) => t.is_active).length;
  const pausedCount = templates.filter((t) => !t.is_active).length;
  const today = new Date().toISOString().split("T")[0];
  const nextDue = templates
    .filter((t) => t.is_active)
    .sort((a, b) => a.next_date.localeCompare(b.next_date))
    .find((t) => t.next_date >= today);

  // ── Render ───────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-950 text-white">

      <main className="px-4 sm:px-6 py-6 max-w-6xl mx-auto">
        {/* Summary Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <div className="p-4 rounded-xl bg-gray-900/50 border border-gray-800">
            <p className="text-xs uppercase tracking-wider text-gray-600 font-medium">
              Total Templates
            </p>
            <p className="text-xl font-black mt-1 text-gray-200">
              {totalTemplates}
            </p>
          </div>
          <div className="p-4 rounded-xl bg-gray-900/50 border border-gray-800">
            <p className="text-xs uppercase tracking-wider text-gray-600 font-medium">
              Active
            </p>
            <p className="text-xl font-black mt-1 text-emerald-400">
              {activeCount}
            </p>
          </div>
          <div className="p-4 rounded-xl bg-gray-900/50 border border-gray-800">
            <p className="text-xs uppercase tracking-wider text-gray-600 font-medium">
              Paused
            </p>
            <p className="text-xl font-black mt-1 text-amber-400">
              {pausedCount}
            </p>
          </div>
          <div className="p-4 rounded-xl bg-gray-900/50 border border-gray-800">
            <p className="text-xs uppercase tracking-wider text-gray-600 font-medium">
              Next Due
            </p>
            <p className="text-xl font-black mt-1 text-blue-400">
              {nextDue ? fmtDate(nextDue.next_date) : "--"}
            </p>
          </div>
        </div>

        {/* Action Bar */}
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <button
            onClick={() => {
              resetForm();
              setShowCreate(true);
            }}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold uppercase tracking-wider transition-colors"
          >
            + New Template
          </button>
          <button
            onClick={handleGenerate}
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-bold uppercase tracking-wider transition-colors"
          >
            {saving ? "Generating..." : "Generate Due Entries"}
          </button>
          {generateMsg && (
            <span className="text-sm text-gray-400 bg-gray-900 border border-gray-800 rounded-lg px-3 py-2">
              {generateMsg}
            </span>
          )}
        </div>

        {/* Create Form */}
        {showCreate && (
          <div className="mb-6 p-6 rounded-xl bg-gray-900/50 border border-gray-800 space-y-4">
            <h3 className="text-sm font-bold uppercase tracking-wider text-gray-300">
              New Recurring Template
            </h3>

            {formError && (
              <p className="text-sm text-red-400 bg-red-900/30 rounded-lg px-3 py-2">
                {formError}
              </p>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="sm:col-span-2 lg:col-span-3">
                <label className="block text-xs text-gray-600 uppercase tracking-wider mb-1">
                  Description *
                </label>
                <input
                  type="text"
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  placeholder="e.g. Monthly rent expense"
                  className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-gray-600"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 uppercase tracking-wider mb-1">
                  Reference
                </label>
                <input
                  type="text"
                  value={formRef}
                  onChange={(e) => setFormRef(e.target.value)}
                  placeholder="Optional"
                  className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-gray-600"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 uppercase tracking-wider mb-1">
                  Frequency *
                </label>
                <select
                  value={formFreq}
                  onChange={(e) => setFormFreq(e.target.value as Frequency)}
                  className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white focus:outline-none focus:border-gray-600"
                >
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="annually">Annually</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-600 uppercase tracking-wider mb-1">
                  Next Date *
                </label>
                <input
                  type="date"
                  value={formNextDate}
                  onChange={(e) => setFormNextDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white focus:outline-none focus:border-gray-600 [color-scheme:dark]"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 uppercase tracking-wider mb-1">
                  End Date
                </label>
                <input
                  type="date"
                  value={formEndDate}
                  onChange={(e) => setFormEndDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-gray-600 [color-scheme:dark]"
                />
                <p className="text-xs text-gray-600 mt-1">
                  Leave blank for no end date
                </p>
              </div>
            </div>

            {/* Line Items */}
            <div>
              <label className="block text-xs text-gray-600 uppercase tracking-wider mb-2">
                Journal Lines *
              </label>
              <div className="space-y-2">
                {formLines.map((line, idx) => (
                  <div
                    key={idx}
                    className="grid grid-cols-12 gap-2 items-end"
                  >
                    <div className="col-span-4">
                      {idx === 0 && (
                        <span className="text-[9px] text-gray-600 uppercase">
                          Account
                        </span>
                      )}
                      <select
                        value={line.account_id}
                        onChange={(e) =>
                          updateLine(idx, "account_id", e.target.value)
                        }
                        className="w-full px-2 py-1.5 rounded bg-gray-900 border border-gray-800 text-sm text-white"
                      >
                        <option value="">Select account...</option>
                        {accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.account_number} — {a.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="col-span-2">
                      {idx === 0 && (
                        <span className="text-[9px] text-gray-600 uppercase">
                          Debit
                        </span>
                      )}
                      <input
                        type="number"
                        value={line.debit || ""}
                        onChange={(e) =>
                          updateLine(
                            idx,
                            "debit",
                            parseFloat(e.target.value) || 0
                          )
                        }
                        className="w-full px-2 py-1.5 rounded bg-gray-900 border border-gray-800 text-sm text-white text-right"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                      />
                    </div>
                    <div className="col-span-2">
                      {idx === 0 && (
                        <span className="text-[9px] text-gray-600 uppercase">
                          Credit
                        </span>
                      )}
                      <input
                        type="number"
                        value={line.credit || ""}
                        onChange={(e) =>
                          updateLine(
                            idx,
                            "credit",
                            parseFloat(e.target.value) || 0
                          )
                        }
                        className="w-full px-2 py-1.5 rounded bg-gray-900 border border-gray-800 text-sm text-white text-right"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                      />
                    </div>
                    <div className="col-span-3">
                      {idx === 0 && (
                        <span className="text-[9px] text-gray-600 uppercase">
                          Description
                        </span>
                      )}
                      <input
                        type="text"
                        value={line.description}
                        onChange={(e) =>
                          updateLine(idx, "description", e.target.value)
                        }
                        className="w-full px-2 py-1.5 rounded bg-gray-900 border border-gray-800 text-sm text-white"
                        placeholder="Optional"
                      />
                    </div>
                    <div className="col-span-1 flex justify-center">
                      <button
                        onClick={() => removeLine(idx)}
                        disabled={formLines.length <= 2}
                        className="text-red-500 hover:text-red-400 disabled:text-gray-700 text-xs font-bold"
                      >
                        &times;
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <button
                onClick={addLine}
                className="mt-2 text-xs text-teal-400 hover:text-teal-300 font-bold uppercase"
              >
                + Add Line
              </button>
            </div>

            {/* Balance Indicator */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-6">
                <p className="text-sm text-gray-400">
                  Debits:{" "}
                  <span className="text-white font-bold font-mono">
                    {fmtCurrency(totalDebits)}
                  </span>
                </p>
                <p className="text-sm text-gray-400">
                  Credits:{" "}
                  <span className="text-white font-bold font-mono">
                    {fmtCurrency(totalCredits)}
                  </span>
                </p>
                <span
                  className={`px-2 py-0.5 rounded text-xs font-bold uppercase ${
                    isBalanced
                      ? "bg-emerald-900/50 text-emerald-300"
                      : totalDebits === 0 && totalCredits === 0
                        ? "bg-gray-800 text-gray-500"
                        : "bg-red-900/50 text-red-300"
                  }`}
                >
                  {isBalanced
                    ? "Balanced"
                    : totalDebits === 0 && totalCredits === 0
                      ? "Enter amounts"
                      : `Off by ${fmtCurrency(Math.abs(totalDebits - totalCredits))}`}
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleCreate}
                  disabled={saving || !isBalanced}
                  className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-bold uppercase tracking-wider transition-colors"
                >
                  {saving ? "Saving..." : "Create Template"}
                </button>
                <button
                  onClick={resetForm}
                  className="px-4 py-2 rounded-lg border border-gray-700 hover:border-gray-500 text-gray-400 text-sm font-bold uppercase tracking-wider transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
          </div>
        )}

        {/* Templates List */}
        {!loading && (
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden overflow-x-auto">
            <table className="w-full text-sm min-w-[800px]">
              <thead>
                <tr className="text-xs uppercase tracking-wider text-gray-600 border-b border-gray-800">
                  <th className="text-left px-4 py-3 font-medium w-8" />
                  <th className="text-left px-4 py-3 font-medium">
                    Description
                  </th>
                  <th className="text-left px-4 py-3 font-medium w-28">
                    Frequency
                  </th>
                  <th className="text-left px-4 py-3 font-medium w-28">
                    Next Date
                  </th>
                  <th className="text-center px-4 py-3 font-medium w-24">
                    Status
                  </th>
                  <th className="text-left px-4 py-3 font-medium w-32">
                    Created By
                  </th>
                  <th className="text-right px-4 py-3 font-medium w-40">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {templates.map((tpl) => {
                  const isExpanded = expandedId === tpl.id;
                  const lines = tpl.recurring_journal_entry_lines || [];
                  const lineDebits = lines.reduce(
                    (s, l) => s + Number(l.debit),
                    0
                  );

                  return (
                    <Fragment key={tpl.id}>
                      <tr
                        className={`border-t border-gray-800/50 hover:bg-gray-800/20 transition-colors cursor-pointer ${
                          !tpl.is_active ? "opacity-50" : ""
                        }`}
                        onClick={() =>
                          setExpandedId(isExpanded ? null : tpl.id)
                        }
                      >
                        <td className="px-4 py-3 text-gray-600">
                          <svg
                            className={`w-4 h-4 transition-transform ${
                              isExpanded ? "rotate-90" : ""
                            }`}
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
                        <td className="px-4 py-3">
                          <div className="text-gray-200 font-medium">
                            {tpl.description}
                          </div>
                          {tpl.reference && (
                            <div className="text-xs text-gray-500 font-mono mt-0.5">
                              Ref: {tpl.reference}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`px-2 py-0.5 rounded text-xs font-bold uppercase ${
                              FREQUENCY_COLORS[tpl.frequency]
                            }`}
                          >
                            {FREQUENCY_LABELS[tpl.frequency]}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-400 text-xs font-mono">
                          {fmtDate(tpl.next_date)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-xs font-bold uppercase ${
                              tpl.is_active
                                ? "bg-emerald-900/60 text-emerald-300"
                                : "bg-gray-700 text-gray-300"
                            }`}
                          >
                            {tpl.is_active ? "Active" : "Paused"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs">
                          {tpl.created_by_name}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div
                            className="flex gap-2 justify-end"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              onClick={() =>
                                handleToggleActive(tpl.id, tpl.is_active)
                              }
                              className={`text-xs font-bold uppercase ${
                                tpl.is_active
                                  ? "text-amber-400 hover:text-amber-300"
                                  : "text-emerald-400 hover:text-emerald-300"
                              }`}
                            >
                              {tpl.is_active ? "Pause" : "Resume"}
                            </button>
                            <button
                              onClick={() => setDeleteConfirm(tpl.id)}
                              className="text-xs text-red-400 hover:text-red-300 font-bold uppercase"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>

                      {/* Expanded line items */}
                      {isExpanded && lines.length > 0 && (
                        <tr>
                          <td
                            colSpan={7}
                            className="bg-gray-950/50 border-t border-gray-800/50"
                          >
                            <div className="px-8 py-3">
                              <p className="text-xs text-gray-600 uppercase tracking-wider mb-2">
                                Template Lines &mdash;{" "}
                                {fmtCurrency(lineDebits)} per entry
                              </p>
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="text-[9px] uppercase tracking-wider text-gray-600">
                                    <th className="text-left py-1 font-medium">
                                      Account
                                    </th>
                                    <th className="text-right py-1 font-medium w-28">
                                      Debit
                                    </th>
                                    <th className="text-right py-1 font-medium w-28">
                                      Credit
                                    </th>
                                    <th className="text-left py-1 pl-4 font-medium">
                                      Description
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {lines
                                    .sort(
                                      (a, b) => a.line_order - b.line_order
                                    )
                                    .map((line) => (
                                      <tr
                                        key={line.id}
                                        className="border-t border-gray-800/30"
                                      >
                                        <td className="py-1.5 text-gray-300">
                                          <span className="font-mono text-gray-500 mr-2">
                                            {line.chart_of_accounts
                                              .account_number}
                                          </span>
                                          {line.chart_of_accounts.name}
                                        </td>
                                        <td className="py-1.5 text-right font-mono text-gray-300">
                                          {Number(line.debit) > 0
                                            ? fmtCurrency(Number(line.debit))
                                            : ""}
                                        </td>
                                        <td className="py-1.5 text-right font-mono text-gray-300">
                                          {Number(line.credit) > 0
                                            ? fmtCurrency(Number(line.credit))
                                            : ""}
                                        </td>
                                        <td className="py-1.5 pl-4 text-gray-500 text-xs">
                                          {line.description || ""}
                                        </td>
                                      </tr>
                                    ))}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {templates.length === 0 && (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-8 text-center text-gray-600"
                    >
                      No recurring templates yet. Click &quot;+ New
                      Template&quot; to create one.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Delete Confirmation Modal */}
        {deleteConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-gray-900 border border-gray-800 rounded-2xl shadow-2xl p-6 w-full max-w-sm space-y-4">
              <h3 className="text-sm font-bold uppercase tracking-wider text-gray-300">
                Confirm Delete
              </h3>
              <p className="text-sm text-gray-400">
                Are you sure you want to delete this recurring template? This
                action cannot be undone. Previously generated journal entries
                will not be affected.
              </p>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => setDeleteConfirm(null)}
                  className="px-4 py-2 rounded-lg border border-gray-700 hover:border-gray-500 text-gray-400 text-sm font-bold uppercase tracking-wider transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleDelete(deleteConfirm)}
                  className="px-5 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-bold uppercase tracking-wider transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
