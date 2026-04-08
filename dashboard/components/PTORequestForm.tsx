"use client";

/**
 * PTORequestForm — Create a new PTO (time off) request.
 *
 * Features:
 *   - Request type selector (vacation, sick, personal, bereavement, other)
 *   - Start and end date pickers
 *   - Auto-calculated hours (business days x 8), editable override
 *   - Reason textarea
 *   - Remaining balance display for the selected type
 *   - Submit with loading/error feedback
 */

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  PTO_TYPE_LABELS,
  type PTORequestType,
  type PTOBalance,
  type CreatePTORequestPayload,
} from "@ironsight/shared";

interface Props {
  currentUserId: string;
}

/** Count business days (Mon-Fri) between two dates, inclusive. */
function countBusinessDays(start: string, end: string): number {
  if (!start || !end) return 0;
  const s = new Date(start + "T12:00:00");
  const e = new Date(end + "T12:00:00");
  if (e < s) return 0;

  let count = 0;
  const d = new Date(s);
  while (d <= e) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

/** Get today's date in YYYY-MM-DD. */
function todayStr(): string {
  return new Date().toISOString().split("T")[0];
}

const REQUEST_TYPES: PTORequestType[] = ["vacation", "sick", "personal", "bereavement", "other"];

export default function PTORequestForm({ currentUserId }: Props) {
  const router = useRouter();

  // ── Form state ──────────────────────────────────────────────────────
  const [requestType, setRequestType] = useState<PTORequestType>("vacation");
  const [startDate, setStartDate] = useState(todayStr());
  const [endDate, setEndDate] = useState(todayStr());
  const [hoursOverride, setHoursOverride] = useState<number | null>(null);
  const [reason, setReason] = useState("");

  // ── Balance data ────────────────────────────────────────────────────
  const [balance, setBalance] = useState<PTOBalance | null>(null);
  const [loadingBalance, setLoadingBalance] = useState(true);

  // ── UI state ────────────────────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // ── Load PTO balance ────────────────────────────────────────────────
  useEffect(() => {
    setLoadingBalance(true);
    fetch("/api/pto/balance")
      .then((r) => r.json())
      .then((data: PTOBalance) => setBalance(data))
      .catch(() => {})
      .finally(() => setLoadingBalance(false));
  }, []);

  // ── Auto-calculate hours from business days ─────────────────────────
  const calculatedHours = useMemo(() => countBusinessDays(startDate, endDate) * 8, [startDate, endDate]);
  const hours = hoursOverride !== null ? hoursOverride : calculatedHours;

  // ── Get remaining balance for selected type ─────────────────────────
  function getRemainingBalance(): number | null {
    if (!balance) return null;
    switch (requestType) {
      case "vacation": return balance.vacation_hours;
      case "sick": return balance.sick_hours;
      case "personal": return balance.personal_hours;
      default: return null; // bereavement and other have no tracked balance
    }
  }

  const remaining = getRemainingBalance();

  // ── Submit handler ──────────────────────────────────────────────────
  async function handleSubmit() {
    setError("");

    // Validation
    if (!startDate || !endDate) {
      setError("Please select start and end dates.");
      return;
    }
    if (new Date(endDate + "T12:00:00") < new Date(startDate + "T12:00:00")) {
      setError("End date must be on or after start date.");
      return;
    }
    if (hours <= 0) {
      setError("Hours must be greater than zero.");
      return;
    }
    if (remaining !== null && hours > remaining) {
      setError(`Insufficient balance. You have ${remaining} hours remaining for ${PTO_TYPE_LABELS[requestType]}.`);
      return;
    }

    setSubmitting(true);

    try {
      const payload: CreatePTORequestPayload = {
        request_type: requestType,
        start_date: startDate,
        end_date: endDate,
        hours_requested: hours,
        reason: reason || undefined,
      };

      const res = await fetch("/api/pto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to submit request");
      }

      router.push("/pto");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit request");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      {/* Error banner */}
      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-red-900/50 border border-red-700 text-red-200 text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError("")} className="text-red-400 hover:text-white ml-4">
            Dismiss
          </button>
        </div>
      )}

      {/* Remaining Balance Card */}
      {!loadingBalance && balance && (
        <section className="mb-8 grid grid-cols-3 gap-4">
          <div className="p-4 rounded-xl bg-blue-900/20 border border-blue-800">
            <div className="text-2xl font-black text-blue-400">{balance.vacation_hours}h</div>
            <div className="text-xs text-blue-300/70 uppercase tracking-wider mt-1">Vacation</div>
          </div>
          <div className="p-4 rounded-xl bg-amber-900/20 border border-amber-800">
            <div className="text-2xl font-black text-amber-400">{balance.sick_hours}h</div>
            <div className="text-xs text-amber-300/70 uppercase tracking-wider mt-1">Sick</div>
          </div>
          <div className="p-4 rounded-xl bg-purple-900/20 border border-purple-800">
            <div className="text-2xl font-black text-purple-400">{balance.personal_hours}h</div>
            <div className="text-xs text-purple-300/70 uppercase tracking-wider mt-1">Personal</div>
          </div>
        </section>
      )}

      {/* Request Type */}
      <section className="mb-8 p-6 rounded-xl bg-gray-900/50 border border-gray-800">
        <h3 className="text-lg font-bold text-gray-100 mb-4 flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-rose-400" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd" />
          </svg>
          Request Type
        </h3>

        <div className="flex flex-wrap gap-2">
          {REQUEST_TYPES.map((type) => (
            <button
              key={type}
              onClick={() => setRequestType(type)}
              className={`min-h-[44px] px-4 py-2 rounded-lg text-sm font-bold uppercase tracking-wider transition-colors ${
                requestType === type
                  ? "bg-rose-600 text-white border border-rose-500"
                  : "bg-gray-800 text-gray-400 border border-gray-700 hover:border-gray-500"
              }`}
            >
              {PTO_TYPE_LABELS[type]}
            </button>
          ))}
        </div>

        {/* Show remaining balance for selected type */}
        {remaining !== null && (
          <p className="mt-3 text-sm text-gray-500">
            Remaining {PTO_TYPE_LABELS[requestType]} balance:{" "}
            <span className={`font-bold ${remaining > 0 ? "text-green-400" : "text-red-400"}`}>
              {remaining} hours
            </span>
          </p>
        )}
      </section>

      {/* Date Range */}
      <section className="mb-8 p-6 rounded-xl bg-gray-900/50 border border-gray-800">
        <h3 className="text-lg font-bold text-gray-100 mb-4 flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-rose-400" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.828a1 1 0 101.415-1.414L11 9.586V6z" clipRule="evenodd" />
          </svg>
          Dates & Hours
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-semibold text-gray-400 mb-2">Start Date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setHoursOverride(null); // Reset override on date change
              }}
              className="w-full px-4 py-3 rounded-lg bg-gray-800 border border-gray-700 text-white focus:outline-none focus:border-rose-500"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-400 mb-2">End Date</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                setHoursOverride(null);
              }}
              className="w-full px-4 py-3 rounded-lg bg-gray-800 border border-gray-700 text-white focus:outline-none focus:border-rose-500"
            />
          </div>
        </div>

        {/* Hours — auto-calculated with manual override */}
        <div>
          <label className="block text-sm font-semibold text-gray-400 mb-2">
            Hours Requested
            <span className="text-xs text-gray-600 font-normal ml-2">
              ({countBusinessDays(startDate, endDate)} business day{countBusinessDays(startDate, endDate) !== 1 ? "s" : ""} x 8h = {calculatedHours}h)
            </span>
          </label>
          <input
            type="number"
            step="0.5"
            min={0}
            value={hours}
            onChange={(e) => setHoursOverride(parseFloat(e.target.value) || 0)}
            className="w-full px-4 py-3 rounded-lg bg-gray-800 border border-gray-700 text-white focus:outline-none focus:border-rose-500"
          />
          {hoursOverride !== null && hoursOverride !== calculatedHours && (
            <button
              onClick={() => setHoursOverride(null)}
              className="mt-1 text-xs text-gray-500 hover:text-gray-300"
            >
              Reset to calculated ({calculatedHours}h)
            </button>
          )}
        </div>
      </section>

      {/* Reason */}
      <section className="mb-8">
        <label className="block text-sm font-semibold text-gray-300 mb-2 uppercase tracking-wider">
          Reason <span className="text-gray-600 font-normal normal-case">(optional)</span>
        </label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder="Brief description of your time off request..."
          className="w-full px-4 py-3 rounded-lg bg-gray-800 border border-gray-700 text-white placeholder-gray-600 focus:outline-none focus:border-rose-500 resize-none"
        />
      </section>

      {/* Actions */}
      <div className="flex flex-wrap gap-3 pb-8">
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="min-h-[44px] px-6 py-3 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold uppercase tracking-wider transition-colors disabled:opacity-50"
        >
          {submitting ? "Submitting..." : "Submit Request"}
        </button>
        <a
          href="/pto"
          className="min-h-[44px] px-6 py-3 rounded-lg border border-gray-700 hover:border-gray-500 text-gray-400 hover:text-white font-bold uppercase tracking-wider transition-colors flex items-center"
        >
          Cancel
        </a>
      </div>
    </div>
  );
}
