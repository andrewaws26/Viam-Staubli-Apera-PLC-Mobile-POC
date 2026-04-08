"use client";

/**
 * PTOList — Displays the current user's PTO requests with filtering.
 *
 * Features:
 *   - Status filter tabs (All, Pending, Approved, Rejected, Cancelled)
 *   - Card layout with date range, type badge, hours, status badge, reason
 *   - Cancel button on own pending requests
 *   - "New Request" button linking to /pto/new
 *   - Manager view link for authorized roles
 */

import { useState, useEffect } from "react";
import type { PTORequest, PTOStatus, PTORequestType } from "@ironsight/shared";
import { PTO_TYPE_LABELS, PTO_STATUS_LABELS } from "@ironsight/shared";

// ── Status badge color mapping ───────────────────────────────────────
const STATUS_BADGE: Record<PTOStatus, { bg: string; text: string }> = {
  pending:   { bg: "bg-amber-900/60",  text: "text-amber-300" },
  approved:  { bg: "bg-green-900/60",  text: "text-green-300" },
  rejected:  { bg: "bg-red-900/60",    text: "text-red-300" },
  cancelled: { bg: "bg-gray-700",      text: "text-gray-400" },
};

// ── Request type badge colors ────────────────────────────────────────
const TYPE_BADGE: Record<PTORequestType, { bg: string; text: string }> = {
  vacation:    { bg: "bg-blue-900/50",   text: "text-blue-300" },
  sick:        { bg: "bg-amber-900/50",  text: "text-amber-300" },
  personal:    { bg: "bg-purple-900/50", text: "text-purple-300" },
  bereavement: { bg: "bg-gray-800",      text: "text-gray-300" },
  other:       { bg: "bg-gray-800",      text: "text-gray-400" },
};

interface Props {
  currentUserRole: string;
}

export default function PTOList({ currentUserRole }: Props) {
  const [requests, setRequests] = useState<PTORequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const isManager = currentUserRole === "developer" || currentUserRole === "manager";

  // ── Fetch PTO requests ──────────────────────────────────────────────
  function loadRequests() {
    setLoading(true);
    const params = new URLSearchParams();
    if (filter !== "all") params.set("status", filter);

    fetch(`/api/pto?${params}`)
      .then((r) => r.json())
      .then((data) => setRequests(Array.isArray(data) ? data : []))
      .catch(() => setRequests([]))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadRequests();
  }, [filter]);

  // ── Cancel a pending request ────────────────────────────────────────
  async function handleCancel(id: string) {
    setCancellingId(id);
    try {
      await fetch(`/api/pto/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "cancelled" }),
      });
      loadRequests();
    } catch {
      // Silently fail — user can retry
    } finally {
      setCancellingId(null);
    }
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        {/* Filter tabs */}
        <div className="flex flex-wrap gap-2">
          {["all", "pending", "approved", "rejected", "cancelled"].map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors ${
                filter === s
                  ? "bg-rose-600 text-white"
                  : "bg-gray-800 text-gray-400 hover:text-gray-200"
              }`}
            >
              {s === "all" ? "All" : PTO_STATUS_LABELS[s as PTOStatus]}
            </button>
          ))}
        </div>

        {/* Action buttons */}
        <div className="flex gap-2">
          <a
            href="/pto/new"
            className="min-h-[44px] px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-sm font-bold uppercase tracking-wider transition-colors flex items-center"
          >
            + New Request
          </a>
          {isManager && (
            <a
              href="/pto/admin"
              className="min-h-[44px] px-4 py-2 rounded-lg border border-amber-600 hover:border-amber-400 text-amber-300 hover:text-white text-sm font-bold uppercase tracking-wider transition-colors flex items-center"
            >
              Manager View
            </a>
          )}
        </div>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
        </div>
      )}

      {/* Empty state */}
      {!loading && requests.length === 0 && (
        <div className="text-center py-20">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-12 h-12 mx-auto text-gray-700 mb-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd" />
          </svg>
          <p className="text-gray-500 mb-4">No time off requests found</p>
          <a
            href="/pto/new"
            className="inline-block px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-sm font-bold transition-colors"
          >
            Request Time Off
          </a>
        </div>
      )}

      {/* Request cards */}
      {!loading && requests.length > 0 && (
        <div className="space-y-3">
          {requests.map((req) => {
            const statusBadge = STATUS_BADGE[req.status];
            const typeBadge = TYPE_BADGE[req.pto_type];
            const startFormatted = new Date(req.start_date + "T12:00:00").toLocaleDateString("en-US", {
              month: "short", day: "numeric",
            });
            const endFormatted = new Date(req.end_date + "T12:00:00").toLocaleDateString("en-US", {
              month: "short", day: "numeric", year: "numeric",
            });

            return (
              <div
                key={req.id}
                className="p-4 rounded-lg bg-gray-900 border border-gray-800 hover:border-gray-700 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    {/* Date range and badges */}
                    <div className="flex items-center flex-wrap gap-2 mb-1.5">
                      <span className="text-sm font-bold text-gray-100">
                        {startFormatted} - {endFormatted}
                      </span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${typeBadge.bg} ${typeBadge.text}`}>
                        {PTO_TYPE_LABELS[req.pto_type]}
                      </span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${statusBadge.bg} ${statusBadge.text}`}>
                        {PTO_STATUS_LABELS[req.status]}
                      </span>
                    </div>

                    {/* Reason preview */}
                    {req.notes && (
                      <p className="text-xs text-gray-500 truncate max-w-md">{req.notes}</p>
                    )}

                    {/* Manager notes */}
                    {req.manager_notes && (
                      <p className="text-xs text-amber-400/70 mt-1 truncate max-w-md">
                        Manager: {req.manager_notes}
                      </p>
                    )}
                  </div>

                  {/* Hours and actions */}
                  <div className="text-right shrink-0 flex flex-col items-end gap-2">
                    <div className="text-lg font-bold text-rose-400">{req.hours}h</div>
                    {req.status === "pending" && (
                      <button
                        onClick={() => handleCancel(req.id)}
                        disabled={cancellingId === req.id}
                        className="px-3 py-1 rounded text-xs font-medium bg-gray-800 text-gray-400 hover:text-red-300 hover:bg-red-900/30 transition-colors disabled:opacity-50"
                      >
                        {cancellingId === req.id ? "..." : "Cancel"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
