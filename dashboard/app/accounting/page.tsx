"use client";

import { useState, useEffect, useMemo } from "react";
import AppNav from "@/components/AppNav";
import type {
  Account,
  AccountType,
  CreateAccountPayload,
} from "@ironsight/shared";
import {
  ACCOUNT_TYPE_LABELS,
  ACCOUNT_TYPE_COLORS,
  ACCOUNT_NUMBER_RANGES,
  JOURNAL_STATUS_LABELS,
  JOURNAL_SOURCE_LABELS,
} from "@ironsight/shared";
import type { JournalEntry, JournalEntryStatus } from "@ironsight/shared";

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

function fmtDate(iso: string): string {
  return new Date(iso + "T12:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const STATUS_COLORS: Record<JournalEntryStatus, string> = {
  draft: "bg-gray-700 text-gray-300",
  posted: "bg-emerald-900/60 text-emerald-300",
  voided: "bg-red-900/60 text-red-300",
};

// ── Add Account Modal ────────────────────────────────────────────────

function AddAccountModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState<CreateAccountPayload>({
    account_number: "",
    name: "",
    account_type: "asset",
    description: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/accounting/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to create account");
      }
      onCreated();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md mx-4 bg-gray-900 border border-gray-700 rounded-2xl p-6 space-y-4"
      >
        <h2 className="text-lg font-black uppercase tracking-widest text-gray-100">
          Add Account
        </h2>

        {error && (
          <p className="text-sm text-red-400 bg-red-900/30 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <div>
          <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">
            Account Number
          </label>
          <input
            type="text"
            required
            value={form.account_number}
            onChange={(e) =>
              setForm({ ...form, account_number: e.target.value })
            }
            placeholder={
              ACCOUNT_NUMBER_RANGES[form.account_type].label
            }
            className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm font-mono placeholder-gray-600 focus:outline-none focus:border-gray-500"
          />
          <p className="text-[10px] text-gray-600 mt-1">
            Range for {ACCOUNT_TYPE_LABELS[form.account_type]}:{" "}
            {ACCOUNT_NUMBER_RANGES[form.account_type].label}
          </p>
        </div>

        <div>
          <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">
            Name
          </label>
          <input
            type="text"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-gray-500"
          />
        </div>

        <div>
          <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">
            Account Type
          </label>
          <select
            value={form.account_type}
            onChange={(e) =>
              setForm({
                ...form,
                account_type: e.target.value as AccountType,
              })
            }
            className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:border-gray-500"
          >
            {ACCOUNT_TYPE_ORDER.map((t) => (
              <option key={t} value={t}>
                {ACCOUNT_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">
            Description
          </label>
          <textarea
            value={form.description || ""}
            onChange={(e) =>
              setForm({ ...form, description: e.target.value })
            }
            rows={2}
            className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-gray-500 resize-none"
          />
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="flex-1 px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-bold uppercase tracking-wider transition-colors"
          >
            {saving ? "Saving..." : "Create Account"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-lg border border-gray-700 hover:border-gray-500 text-gray-400 hover:text-white text-sm font-bold uppercase tracking-wider transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Chart of Accounts Tab ────────────────────────────────────────────

function ChartOfAccountsTab() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  function fetchAccounts() {
    setLoading(true);
    fetch("/api/accounting/accounts")
      .then((r) => r.json())
      .then((data) => setAccounts(Array.isArray(data) ? data : []))
      .catch(() => setAccounts([]))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    fetchAccounts();
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return accounts;
    const q = search.toLowerCase();
    return accounts.filter(
      (a) =>
        a.account_number.toLowerCase().includes(q) ||
        a.name.toLowerCase().includes(q) ||
        (a.description || "").toLowerCase().includes(q)
    );
  }, [accounts, search]);

  const grouped = useMemo(() => {
    const map: Record<AccountType, Account[]> = {
      asset: [],
      liability: [],
      equity: [],
      revenue: [],
      expense: [],
    };
    for (const a of filtered) {
      map[a.account_type]?.push(a);
    }
    // Sort each group by account number
    for (const key of ACCOUNT_TYPE_ORDER) {
      map[key].sort((a, b) => a.account_number.localeCompare(b.account_number));
    }
    return map;
  }, [filtered]);

  function toggleGroup(t: AccountType) {
    setCollapsed((prev) => ({ ...prev, [t]: !prev[t] }));
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <div className="flex-1 relative">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-600"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z"
              clipRule="evenodd"
            />
          </svg>
          <input
            type="text"
            placeholder="Search accounts..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-gray-600"
          />
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold uppercase tracking-wider transition-colors whitespace-nowrap"
        >
          + Add Account
        </button>
      </div>

      {/* Account Groups */}
      {ACCOUNT_TYPE_ORDER.map((type) => {
        const group = grouped[type];
        const isCollapsed = collapsed[type];
        const color = ACCOUNT_TYPE_COLORS[type];

        return (
          <div
            key={type}
            className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden"
          >
            {/* Group Header */}
            <button
              onClick={() => toggleGroup(type)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-800/50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: color }}
                />
                <span className="text-sm font-bold uppercase tracking-wider text-gray-200">
                  {ACCOUNT_TYPE_LABELS[type]}
                </span>
                <span className="text-xs text-gray-600 font-mono">
                  ({group.length})
                </span>
              </div>
              <svg
                className={`w-4 h-4 text-gray-600 transition-transform ${
                  isCollapsed ? "" : "rotate-180"
                }`}
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
            </button>

            {/* Account Rows */}
            {!isCollapsed && group.length > 0 && (
              <div className="border-t border-gray-800">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wider text-gray-600">
                      <th className="text-left px-4 py-2 font-medium w-28">
                        Acct #
                      </th>
                      <th className="text-left px-4 py-2 font-medium">
                        Name
                      </th>
                      <th className="text-right px-4 py-2 font-medium w-36">
                        Balance
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.map((a) => (
                      <tr
                        key={a.id}
                        className={`border-t border-gray-800/50 hover:bg-gray-800/30 transition-colors ${
                          !a.is_active ? "opacity-40" : ""
                        }`}
                      >
                        <td className="px-4 py-2.5 font-mono text-gray-400">
                          {a.account_number}
                        </td>
                        <td className="px-4 py-2.5 text-gray-200">
                          <span>{a.name}</span>
                          {!a.is_active && (
                            <span className="ml-2 text-[10px] uppercase tracking-wider text-gray-600 bg-gray-800 px-1.5 py-0.5 rounded">
                              Inactive
                            </span>
                          )}
                          {a.is_system && (
                            <span className="ml-2 text-[10px] uppercase tracking-wider text-gray-600 bg-gray-800 px-1.5 py-0.5 rounded">
                              System
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-gray-300">
                          {fmtCurrency(a.current_balance)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {!isCollapsed && group.length === 0 && (
              <div className="border-t border-gray-800 px-4 py-4 text-center text-sm text-gray-600">
                No {ACCOUNT_TYPE_LABELS[type].toLowerCase()} accounts
                {search ? " matching your search" : ""}
              </div>
            )}
          </div>
        );
      })}

      {showAdd && (
        <AddAccountModal
          onClose={() => setShowAdd(false)}
          onCreated={fetchAccounts}
        />
      )}
    </div>
  );
}

// ── Journal Entries Tab ──────────────────────────────────────────────

function JournalEntriesTab() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<
    JournalEntryStatus | "all"
  >("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (dateFrom) params.set("from", dateFrom);
    if (dateTo) params.set("to", dateTo);

    fetch(`/api/accounting/entries?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => setEntries(Array.isArray(data) ? data : []))
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, [statusFilter, dateFrom, dateTo]);

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={statusFilter}
          onChange={(e) =>
            setStatusFilter(e.target.value as JournalEntryStatus | "all")
          }
          className="px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white focus:outline-none focus:border-gray-600"
        >
          <option value="all">All Statuses</option>
          <option value="draft">Draft</option>
          <option value="posted">Posted</option>
          <option value="voided">Voided</option>
        </select>

        <div className="flex items-center gap-2">
          <label className="text-[10px] text-gray-600 uppercase tracking-wider">
            From
          </label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white focus:outline-none focus:border-gray-600 [color-scheme:dark]"
          />
        </div>

        <div className="flex items-center gap-2">
          <label className="text-[10px] text-gray-600 uppercase tracking-wider">
            To
          </label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white focus:outline-none focus:border-gray-600 [color-scheme:dark]"
          />
        </div>

        <div className="flex-1" />

        <a
          href="/accounting/new"
          className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold uppercase tracking-wider transition-colors whitespace-nowrap"
        >
          + New Entry
        </a>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
        </div>
      ) : entries.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-gray-600 text-sm">No journal entries found</p>
        </div>
      ) : (
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-gray-600 border-b border-gray-800">
                <th className="text-left px-4 py-3 font-medium w-28">
                  Date
                </th>
                <th className="text-left px-4 py-3 font-medium">
                  Description
                </th>
                <th className="text-left px-4 py-3 font-medium w-28">
                  Reference
                </th>
                <th className="text-left px-4 py-3 font-medium w-32">
                  Source
                </th>
                <th className="text-right px-4 py-3 font-medium w-28">
                  Amount
                </th>
                <th className="text-center px-4 py-3 font-medium w-24">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr
                  key={entry.id}
                  className="border-t border-gray-800/50 hover:bg-gray-800/30 transition-colors cursor-pointer"
                  onClick={() =>
                    (window.location.href = `/accounting/${entry.id}`)
                  }
                >
                  <td className="px-4 py-3 text-gray-400 font-mono text-xs">
                    {fmtDate(entry.entry_date)}
                  </td>
                  <td className="px-4 py-3 text-gray-200">
                    {entry.description}
                  </td>
                  <td className="px-4 py-3 text-gray-500 font-mono text-xs">
                    {entry.reference || "--"}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {JOURNAL_SOURCE_LABELS[entry.source] || entry.source}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-gray-300">
                    {fmtCurrency(entry.total_amount)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                        STATUS_COLORS[entry.status]
                      }`}
                    >
                      {JOURNAL_STATUS_LABELS[entry.status]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────

type Tab = "coa" | "entries";

export default function AccountingPage() {
  const [tab, setTab] = useState<Tab>("coa");

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <AppNav pageTitle="Accounting" />

      <main className="px-4 sm:px-6 py-6 max-w-6xl mx-auto">
        {/* Tab Switcher */}
        <div className="flex items-center gap-1 mb-6 bg-gray-900 rounded-xl p-1 w-fit">
          <button
            onClick={() => setTab("coa")}
            className={`px-5 py-2 rounded-lg text-sm font-bold uppercase tracking-wider transition-colors ${
              tab === "coa"
                ? "bg-gray-800 text-white"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            Chart of Accounts
          </button>
          <button
            onClick={() => setTab("entries")}
            className={`px-5 py-2 rounded-lg text-sm font-bold uppercase tracking-wider transition-colors ${
              tab === "entries"
                ? "bg-gray-800 text-white"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            Journal Entries
          </button>
        </div>

        {tab === "coa" ? <ChartOfAccountsTab /> : <JournalEntriesTab />}
      </main>
    </div>
  );
}
