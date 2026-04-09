"use client";

import { useState, useEffect } from "react";
import type { Timesheet, TimesheetStatus } from "@ironsight/shared";
import { useToast } from "@/components/Toast";

const STATUS_BADGE: Record<TimesheetStatus, { bg: string; text: string; label: string }> = {
  draft: { bg: "bg-gray-700", text: "text-gray-300", label: "Draft" },
  submitted: { bg: "bg-blue-900/60", text: "text-blue-300", label: "Submitted" },
  approved: { bg: "bg-green-900/60", text: "text-green-300", label: "Approved" },
  rejected: { bg: "bg-red-900/60", text: "text-red-300", label: "Rejected" },
};

interface Props {
  currentUserRole: string;
}

export default function TimesheetList({ currentUserRole }: Props) {
  const { toast } = useToast();
  const [timesheets, setTimesheets] = useState<Timesheet[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");
  const isManager = currentUserRole === "developer" || currentUserRole === "manager";

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filter !== "all") params.set("status", filter);
    fetch(`/api/timesheets?${params}`)
      .then((r) => r.json())
      .then((data) => setTimesheets(Array.isArray(data) ? data : []))
      .catch(() => { toast("Failed to load timesheets"); setTimesheets([]); })
      .finally(() => setLoading(false));
  }, [filter]);

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div className="flex flex-wrap gap-2">
          {["all", "draft", "submitted", "approved", "rejected"].map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors ${
                filter === s
                  ? "bg-purple-600 text-white"
                  : "bg-gray-800 text-gray-400 hover:text-gray-200"
              }`}
            >
              {s === "all" ? "All" : STATUS_BADGE[s as TimesheetStatus].label}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <a
            href="/timesheets/new"
            className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-sm font-bold uppercase tracking-wider transition-colors"
          >
            + New Timesheet
          </a>
          {isManager && (
            <a
              href="/timesheets/admin"
              className="px-4 py-2 rounded-lg border border-amber-600 hover:border-amber-400 text-amber-300 hover:text-white text-sm font-bold uppercase tracking-wider transition-colors"
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
      {!loading && timesheets.length === 0 && (
        <div className="text-center py-20">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-12 h-12 mx-auto text-gray-700 mb-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
          </svg>
          <p className="text-gray-500 mb-4">No timesheets found</p>
          <a
            href="/timesheets/new"
            className="inline-block px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-sm font-bold transition-colors"
          >
            Create Your First Timesheet
          </a>
        </div>
      )}

      {/* Timesheet cards */}
      {!loading && timesheets.length > 0 && (
        <div className="space-y-3">
          {timesheets.map((ts) => {
            const badge = STATUS_BADGE[ts.status];
            const weekEnd = new Date(ts.week_ending + "T12:00:00");
            const weekStart = new Date(weekEnd);
            weekStart.setDate(weekEnd.getDate() - 6);

            return (
              <a
                key={ts.id}
                href={`/timesheets/${ts.id}`}
                className="block p-4 rounded-lg bg-gray-900 border border-gray-800 hover:border-gray-600 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-3 mb-1">
                      <span className="text-sm font-bold text-gray-100">
                        Week of {weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        {" - "}
                        {weekEnd.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${badge.bg} ${badge.text}`}>
                        {badge.label}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                      {ts.railroad_working_on && (
                        <span>Railroad: <span className="text-gray-400">{ts.railroad_working_on}</span></span>
                      )}
                      {ts.work_location && (
                        <span>Location: <span className="text-gray-400">{ts.work_location}</span></span>
                      )}
                      {ts.coworkers.length > 0 && (
                        <span>Crew: <span className="text-gray-400">{ts.coworkers.length + 1}</span></span>
                      )}
                      {ts.nights_out > 0 && (
                        <span>Nights: <span className="text-gray-400">{ts.nights_out}</span></span>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-lg font-bold text-green-400">{ts.total_hours.toFixed(1)}h</div>
                    {ts.total_travel_hours > 0 && (
                      <div className="text-xs text-blue-400">+{ts.total_travel_hours.toFixed(1)}h travel</div>
                    )}
                  </div>
                </div>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
