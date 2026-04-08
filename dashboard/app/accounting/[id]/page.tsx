"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import type { JournalEntry, JournalEntryStatus } from "@ironsight/shared";
import {
  JOURNAL_STATUS_LABELS,
  JOURNAL_SOURCE_LABELS,
} from "@ironsight/shared";

// ── Helpers ──────────────────────────────────────────────────────────

function fmtCurrency(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  });
}

function fmtDate(iso: string): string {
  return new Date(iso + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const STATUS_BADGE: Record<JournalEntryStatus, string> = {
  draft: "bg-gray-700 text-gray-300 border-gray-600",
  posted: "bg-emerald-900/60 text-emerald-300 border-emerald-700",
  voided: "bg-red-900/60 text-red-300 border-red-700",
};

// ── Void Modal ───────────────────────────────────────────────────────

function VoidModal({
  onConfirm,
  onClose,
  loading,
}: {
  onConfirm: (reason: string) => void;
  onClose: () => void;
  loading: boolean;
}) {
  const [reason, setReason] = useState("");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md mx-4 bg-gray-900 border border-gray-700 rounded-2xl p-6 space-y-4">
        <h2 className="text-lg font-black uppercase tracking-widest text-red-300">
          Void Journal Entry
        </h2>
        <p className="text-sm text-gray-400">
          This will permanently void this entry. Voided entries cannot be edited
          or reposted. Please provide a reason.
        </p>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason for voiding..."
          rows={3}
          className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-gray-500 resize-none"
        />
        <div className="flex items-center gap-3">
          <button
            onClick={() => onConfirm(reason.trim())}
            disabled={!reason.trim() || loading}
            className="flex-1 px-4 py-2.5 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold uppercase tracking-wider transition-colors"
          >
            {loading ? "Voiding..." : "Void Entry"}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2.5 rounded-lg border border-gray-700 hover:border-gray-500 text-gray-400 hover:text-white text-sm font-bold uppercase tracking-wider transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────

export default function JournalEntryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [entry, setEntry] = useState<JournalEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [showVoid, setShowVoid] = useState(false);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    fetch(`/api/accounting/entries/${id}`)
      .then((r) => {
        if (!r.ok) throw new Error("Entry not found");
        return r.json();
      })
      .then((data) => setEntry(data))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  // ── Actions ────────────────────────────────────────────────────────

  async function handlePost() {
    if (!entry) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/accounting/entries/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "posted" }),
      });
      if (!res.ok) throw new Error("Failed to post entry");
      const updated = await res.json();
      setEntry(updated);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleVoid(reason: string) {
    if (!entry) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/accounting/entries/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "voided", voided_reason: reason }),
      });
      if (!res.ok) throw new Error("Failed to void entry");
      const updated = await res.json();
      setEntry(updated);
      setShowVoid(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleDelete() {
    if (!entry) return;
    if (!window.confirm("Delete this draft entry? This cannot be undone."))
      return;

    setActionLoading(true);
    try {
      const res = await fetch(`/api/accounting/entries/${entry.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete entry");
      router.push("/accounting");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setActionLoading(false);
    }
  }

  // ── Loading / Error States ─────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center gap-3">
        <div className="w-10 h-10 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
        <p className="text-gray-600 text-sm uppercase tracking-widest">
          Loading Entry
        </p>
      </div>
    );
  }

  if (error || !entry) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-xl font-bold text-gray-300">
            {error || "Entry Not Found"}
          </h1>
          <a
            href="/accounting"
            className="inline-block mt-4 text-sm text-blue-400 hover:text-blue-300 underline"
          >
            Back to Accounting
          </a>
        </div>
      </div>
    );
  }

  // ── Computed ───────────────────────────────────────────────────────

  const lines = entry.lines || [];
  const totalDebits = lines.reduce((s, l) => s + (l.debit || 0), 0);
  const totalCredits = lines.reduce((s, l) => s + (l.credit || 0), 0);

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 px-4 sm:px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-black tracking-widest uppercase text-gray-100">
            Journal Entry
          </h1>
          <p className="text-xs text-gray-600 mt-0.5 tracking-wide">
            IronSight — {entry.description}
          </p>
        </div>
        <a
          href="/accounting"
          className="px-4 py-2 rounded-lg border border-gray-700 hover:border-gray-500 text-gray-400 hover:text-white text-sm font-bold uppercase tracking-wider transition-colors"
        >
          Back
        </a>
      </header>

      <main className="px-4 sm:px-6 py-6 max-w-5xl mx-auto space-y-6">
        {/* Entry Header Card */}
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-5">
          <div className="flex flex-wrap items-start gap-4 justify-between">
            <div className="space-y-3 flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h2 className="text-lg font-bold text-gray-100 truncate">
                  {entry.description}
                </h2>
                <span
                  className={`inline-block px-2.5 py-0.5 rounded border text-[10px] font-bold uppercase tracking-wider ${
                    STATUS_BADGE[entry.status]
                  }`}
                >
                  {JOURNAL_STATUS_LABELS[entry.status]}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                <div>
                  <div className="text-[10px] text-gray-600 uppercase tracking-wider">
                    Date
                  </div>
                  <div className="text-gray-300 font-mono">
                    {fmtDate(entry.entry_date)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-gray-600 uppercase tracking-wider">
                    Reference
                  </div>
                  <div className="text-gray-300 font-mono">
                    {entry.reference || "--"}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-gray-600 uppercase tracking-wider">
                    Source
                  </div>
                  <div className="text-gray-300">
                    {JOURNAL_SOURCE_LABELS[entry.source] || entry.source}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-gray-600 uppercase tracking-wider">
                    Created By
                  </div>
                  <div className="text-gray-300">
                    {entry.created_by_name || entry.created_by}
                  </div>
                </div>
              </div>

              {entry.posted_at && (
                <div className="text-xs text-gray-600">
                  Posted {fmtDateTime(entry.posted_at)}
                </div>
              )}
            </div>

            <div className="text-right">
              <div className="text-[10px] text-gray-600 uppercase tracking-wider">
                Total Amount
              </div>
              <div className="text-2xl font-black font-mono text-gray-100">
                {fmtCurrency(entry.total_amount)}
              </div>
            </div>
          </div>
        </div>

        {/* Voided Info */}
        {entry.status === "voided" && (
          <div className="rounded-xl border border-red-800/50 bg-red-900/20 p-4">
            <div className="text-xs font-bold uppercase tracking-wider text-red-400 mb-2">
              Voided
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
              <div>
                <span className="text-gray-500">By: </span>
                <span className="text-gray-300">
                  {entry.voided_by || "Unknown"}
                </span>
              </div>
              <div>
                <span className="text-gray-500">When: </span>
                <span className="text-gray-300">
                  {entry.voided_at ? fmtDateTime(entry.voided_at) : "--"}
                </span>
              </div>
              <div>
                <span className="text-gray-500">Reason: </span>
                <span className="text-gray-300">
                  {entry.voided_reason || "No reason given"}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Lines Table */}
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden overflow-x-auto">
          <table className="w-full text-sm min-w-[600px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-gray-600 border-b border-gray-800">
                <th className="text-left px-4 py-3 font-medium w-24">
                  Acct #
                </th>
                <th className="text-left px-4 py-3 font-medium">
                  Account Name
                </th>
                <th className="text-right px-4 py-3 font-medium w-28">
                  Debit
                </th>
                <th className="text-right px-4 py-3 font-medium w-28">
                  Credit
                </th>
                <th className="text-left px-4 py-3 font-medium w-40">
                  Description
                </th>
              </tr>
            </thead>
            <tbody>
              {lines
                .sort((a, b) => a.line_order - b.line_order)
                .map((line) => (
                  <tr
                    key={line.id}
                    className="border-t border-gray-800/50"
                  >
                    <td className="px-4 py-2.5 font-mono text-gray-400">
                      {line.account_number || "--"}
                    </td>
                    <td className="px-4 py-2.5 text-gray-200">
                      {line.account_name || "--"}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-gray-300">
                      {line.debit > 0 ? fmtCurrency(line.debit) : ""}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-gray-300">
                      {line.credit > 0 ? fmtCurrency(line.credit) : ""}
                    </td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs">
                      {line.description || ""}
                    </td>
                  </tr>
                ))}

              {/* Totals Row */}
              <tr className="border-t-2 border-gray-700 bg-gray-800/30 font-bold">
                <td colSpan={2} className="px-4 py-3 text-right text-xs text-gray-500 uppercase tracking-wider">
                  Totals
                </td>
                <td className="px-4 py-3 text-right font-mono text-gray-200">
                  {fmtCurrency(totalDebits)}
                </td>
                <td className="px-4 py-3 text-right font-mono text-gray-200">
                  {fmtCurrency(totalCredits)}
                </td>
                <td className="px-4 py-3">
                  {Math.abs(totalDebits - totalCredits) < 0.01 ? (
                    <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                      Balanced
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold uppercase tracking-wider text-red-400">
                      Unbalanced
                    </span>
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3">
          {entry.status === "draft" && (
            <>
              <button
                onClick={handleDelete}
                disabled={actionLoading}
                className="px-5 py-2.5 rounded-lg border border-red-800 hover:border-red-600 text-red-400 hover:text-red-300 disabled:opacity-40 text-sm font-bold uppercase tracking-wider transition-colors"
              >
                Delete
              </button>
              <button
                onClick={handlePost}
                disabled={actionLoading}
                className="px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-sm font-bold uppercase tracking-wider transition-colors"
              >
                {actionLoading ? "Posting..." : "Post Entry"}
              </button>
            </>
          )}

          {entry.status === "posted" && (
            <button
              onClick={() => setShowVoid(true)}
              disabled={actionLoading}
              className="px-5 py-2.5 rounded-lg border border-red-800 hover:border-red-600 text-red-400 hover:text-red-300 disabled:opacity-40 text-sm font-bold uppercase tracking-wider transition-colors"
            >
              Void Entry
            </button>
          )}
        </div>

        {/* Metadata footer */}
        <div className="text-[10px] text-gray-700 flex items-center gap-4 pt-2">
          <span>Created {fmtDateTime(entry.created_at)}</span>
          {entry.updated_at !== entry.created_at && (
            <span>Updated {fmtDateTime(entry.updated_at)}</span>
          )}
          <span className="font-mono">{entry.id}</span>
        </div>
      </main>

      {showVoid && (
        <VoidModal
          onConfirm={handleVoid}
          onClose={() => setShowVoid(false)}
          loading={actionLoading}
        />
      )}
    </div>
  );
}
