"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import type { Account, CreateJournalEntryPayload } from "@ironsight/shared";

// ── Helpers ──────────────────────────────────────────────────────────

function fmtCurrency(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  });
}

function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

interface LineItem {
  key: number;
  account_id: string;
  debit: string;
  credit: string;
  description: string;
}

// ── Page ─────────────────────────────────────────────────────────────

export default function NewJournalEntryPage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);

  const [entryDate, setEntryDate] = useState(todayISO());
  const [description, setDescription] = useState("");
  const [reference, setReference] = useState("");

  const [lines, setLines] = useState<LineItem[]>([
    { key: 1, account_id: "", debit: "", credit: "", description: "" },
    { key: 2, account_id: "", debit: "", credit: "", description: "" },
  ]);
  const [nextKey, setNextKey] = useState(3);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Fetch chart of accounts for the dropdowns
  useEffect(() => {
    fetch("/api/accounting/accounts")
      .then((r) => r.json())
      .then((data) => {
        const active = (Array.isArray(data) ? data : []).filter(
          (a: Account) => a.is_active
        );
        // Sort by account_number
        active.sort((a: Account, b: Account) =>
          a.account_number.localeCompare(b.account_number)
        );
        setAccounts(active);
      })
      .catch(() => setAccounts([]))
      .finally(() => setLoadingAccounts(false));
  }, []);

  // ── Line management ──────────────────────────────────────────────

  function updateLine(key: number, field: keyof LineItem, value: string) {
    setLines((prev) =>
      prev.map((l) => (l.key === key ? { ...l, [field]: value } : l))
    );
  }

  function removeLine(key: number) {
    setLines((prev) => prev.filter((l) => l.key !== key));
  }

  function addLine() {
    setLines((prev) => [
      ...prev,
      { key: nextKey, account_id: "", debit: "", credit: "", description: "" },
    ]);
    setNextKey((k) => k + 1);
  }

  // ── Totals ───────────────────────────────────────────────────────

  const totalDebits = useMemo(
    () =>
      lines.reduce((sum, l) => sum + (parseFloat(l.debit) || 0), 0),
    [lines]
  );

  const totalCredits = useMemo(
    () =>
      lines.reduce((sum, l) => sum + (parseFloat(l.credit) || 0), 0),
    [lines]
  );

  const difference = Math.abs(
    Math.round((totalDebits - totalCredits) * 100) / 100
  );
  const isBalanced = difference === 0 && totalDebits > 0;

  const hasMinLines =
    lines.filter((l) => l.account_id && (l.debit || l.credit)).length >= 2;

  const canSave = isBalanced && hasMinLines && description.trim().length > 0;

  // ── Submit ───────────────────────────────────────────────────────

  async function handleSubmit(postImmediately: boolean) {
    if (!canSave) return;
    setSaving(true);
    setError("");

    const payload: CreateJournalEntryPayload = {
      entry_date: entryDate,
      description: description.trim(),
      reference: reference.trim() || undefined,
      source: "manual",
      lines: lines
        .filter((l) => l.account_id && (l.debit || l.credit))
        .map((l) => ({
          account_id: l.account_id,
          debit: parseFloat(l.debit) || 0,
          credit: parseFloat(l.credit) || 0,
          description: l.description.trim() || undefined,
        })),
    };

    try {
      const res = await fetch("/api/accounting/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to create entry");
      }

      const entry = await res.json();

      // If posting immediately, PATCH to posted
      if (postImmediately) {
        const patchRes = await fetch(`/api/accounting/entries/${entry.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "posted" }),
        });

        if (!patchRes.ok) {
          // Entry was created as draft but posting failed -- navigate to it
          router.push(`/accounting/${entry.id}`);
          return;
        }
      }

      router.push(`/accounting/${entry.id}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  if (loadingAccounts) {
    return (
      <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center gap-3">
        <div className="w-10 h-10 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
        <p className="text-gray-500 text-sm uppercase tracking-widest">
          Loading Accounts
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">

      <main className="px-4 sm:px-6 py-6 max-w-5xl mx-auto">
        {error && (
          <div className="mb-4 px-4 py-3 rounded-lg bg-red-900/30 border border-red-800 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* Header Fields */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <div>
            <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">
              Date
            </label>
            <input
              type="date"
              value={entryDate}
              onChange={(e) => setEntryDate(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white focus:outline-none focus:border-gray-600 [color-scheme:dark]"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">
              Description <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this entry for?"
              className="w-full px-3 py-2.5 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-gray-600"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">
              Reference
            </label>
            <input
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Invoice #, check #, etc."
              className="w-full px-3 py-2.5 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-gray-600"
            />
          </div>
        </div>

        {/* Lines Table */}
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden overflow-x-auto">
          <table className="w-full text-sm min-w-[700px]">
            <thead>
              <tr className="text-xs uppercase tracking-wider text-gray-500 border-b border-gray-800">
                <th className="text-left px-4 py-3 font-medium">Account</th>
                <th className="text-right px-4 py-3 font-medium w-32">
                  Debit
                </th>
                <th className="text-right px-4 py-3 font-medium w-32">
                  Credit
                </th>
                <th className="text-left px-4 py-3 font-medium w-48">
                  Description
                </th>
                <th className="w-12" />
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr
                  key={line.key}
                  className="border-t border-gray-800/50"
                >
                  <td className="px-3 py-2">
                    <select
                      value={line.account_id}
                      onChange={(e) =>
                        updateLine(line.key, "account_id", e.target.value)
                      }
                      className="w-full px-2 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-sm text-white focus:outline-none focus:border-gray-500"
                    >
                      <option value="">Select account...</option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.account_number} — {a.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      value={line.debit}
                      onChange={(e) =>
                        updateLine(line.key, "debit", e.target.value)
                      }
                      onFocus={() => {
                        // Clear credit if user starts typing debit
                        if (line.credit)
                          updateLine(line.key, "credit", "");
                      }}
                      className="w-full px-2 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-sm text-white text-right font-mono placeholder-gray-600 focus:outline-none focus:border-gray-500"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      value={line.credit}
                      onChange={(e) =>
                        updateLine(line.key, "credit", e.target.value)
                      }
                      onFocus={() => {
                        // Clear debit if user starts typing credit
                        if (line.debit)
                          updateLine(line.key, "debit", "");
                      }}
                      className="w-full px-2 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-sm text-white text-right font-mono placeholder-gray-600 focus:outline-none focus:border-gray-500"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      placeholder="Optional note"
                      value={line.description}
                      onChange={(e) =>
                        updateLine(line.key, "description", e.target.value)
                      }
                      className="w-full px-2 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-gray-500"
                    />
                  </td>
                  <td className="px-2 py-2 text-center">
                    {lines.length > 2 && (
                      <button
                        onClick={() => removeLine(line.key)}
                        className="p-1 rounded hover:bg-red-900/40 text-gray-500 hover:text-red-400 transition-colors"
                        title="Remove line"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className="w-4 h-4"
                          viewBox="0 0 20 20"
                          fill="currentColor"
                        >
                          <path
                            fillRule="evenodd"
                            d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                            clipRule="evenodd"
                          />
                        </svg>
                      </button>
                    )}
                  </td>
                </tr>
              ))}

              {/* Totals Row */}
              <tr className="border-t-2 border-gray-700 bg-gray-800/30">
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={addLine}
                    className="text-xs font-bold uppercase tracking-wider text-blue-400 hover:text-blue-300 transition-colors"
                  >
                    + Add Line
                  </button>
                </td>
                <td className="px-4 py-3 text-right font-mono font-bold text-gray-200">
                  {fmtCurrency(totalDebits)}
                </td>
                <td className="px-4 py-3 text-right font-mono font-bold text-gray-200">
                  {fmtCurrency(totalCredits)}
                </td>
                <td colSpan={2} className="px-4 py-3">
                  {totalDebits > 0 || totalCredits > 0 ? (
                    <span
                      className={`text-xs font-bold uppercase tracking-wider ${
                        isBalanced
                          ? "text-emerald-400"
                          : "text-red-400"
                      }`}
                    >
                      {isBalanced
                        ? "Balanced"
                        : `Off by ${fmtCurrency(difference)}`}
                    </span>
                  ) : null}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 mt-6">
          <a
            href="/accounting"
            className="px-5 py-2.5 rounded-lg border border-gray-700 hover:border-gray-500 text-gray-400 hover:text-white text-sm font-bold uppercase tracking-wider transition-colors"
          >
            Cancel
          </a>
          <button
            onClick={() => handleSubmit(false)}
            disabled={!canSave || saving}
            className="px-5 py-2.5 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold uppercase tracking-wider transition-colors"
          >
            {saving ? "Saving..." : "Save as Draft"}
          </button>
          <button
            onClick={() => handleSubmit(true)}
            disabled={!canSave || saving}
            className="px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold uppercase tracking-wider transition-colors"
          >
            {saving ? "Posting..." : "Post"}
          </button>
        </div>
      </main>
    </div>
  );
}
