"use client";

import { useState, useEffect, useCallback } from "react";

interface AuditEntry {
  id: string;
  user_id: string;
  user_name: string;
  user_role: string;
  action: string;
  truck_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  dtc_clear: { label: "DTC Clear", color: "bg-red-600/30 text-red-300" },
  plc_command: { label: "PLC Command", color: "bg-purple-600/30 text-purple-300" },
  ai_chat: { label: "AI Chat", color: "bg-cyan-600/30 text-cyan-300" },
  ai_diagnosis: { label: "AI Diagnosis", color: "bg-cyan-600/30 text-cyan-300" },
  note_created: { label: "Note Added", color: "bg-green-600/30 text-green-300" },
  note_deleted: { label: "Note Deleted", color: "bg-gray-600/30 text-gray-300" },
  assignment_created: { label: "Assignment", color: "bg-blue-600/30 text-blue-300" },
  assignment_deleted: { label: "Unassigned", color: "bg-gray-600/30 text-gray-300" },
  maintenance_logged: { label: "Maintenance", color: "bg-amber-600/30 text-amber-300" },
  maintenance_deleted: { label: "Maint. Deleted", color: "bg-gray-600/30 text-gray-300" },
  role_change: { label: "Role Change", color: "bg-purple-600/30 text-purple-300" },
};

const ROLE_COLORS: Record<string, string> = {
  developer: "text-purple-400",
  manager: "text-blue-400",
  mechanic: "text-green-400",
  operator: "text-gray-400",
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function AuditLogViewer() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");

  const fetchLog = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (filter !== "all") params.set("action", filter);
      const res = await fetch(`/api/audit-log?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      setEntries(Array.isArray(data) ? data : []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [filter]);

  useEffect(() => {
    setLoading(true);
    fetchLog();
  }, [fetchLog]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-base sm:text-lg font-bold text-gray-200">Audit Log</h2>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="min-h-[44px] px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-200 text-xs"
        >
          <option value="all">All Actions</option>
          <option value="dtc_clear">DTC Clears</option>
          <option value="plc_command">PLC Commands</option>
          <option value="ai_chat">AI Chats</option>
          <option value="ai_diagnosis">AI Diagnoses</option>
          <option value="maintenance_logged">Maintenance</option>
          <option value="note_created">Notes</option>
          <option value="assignment_created">Assignments</option>
        </select>
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <div className="w-6 h-6 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
        </div>
      ) : entries.length === 0 ? (
        <p className="text-xs text-gray-600 py-8 text-center">No audit entries found.</p>
      ) : (
        <div className="space-y-1.5 max-h-[600px] overflow-y-auto">
          {entries.map((entry) => {
            const actionInfo = ACTION_LABELS[entry.action] || { label: entry.action, color: "bg-gray-600/30 text-gray-300" };
            return (
              <div key={entry.id} className="bg-gray-800/40 rounded-lg px-3 py-2 flex items-start gap-3">
                <div className="shrink-0 mt-0.5">
                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${actionInfo.color}`}>
                    {actionInfo.label}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-xs">
                    <span className={`font-semibold ${ROLE_COLORS[entry.user_role] || "text-gray-300"}`}>
                      {entry.user_name}
                    </span>
                    {entry.truck_id && (
                      <span className="text-gray-600">on {entry.truck_id}</span>
                    )}
                    <span className="text-gray-600 ml-auto shrink-0">{formatTime(entry.created_at)}</span>
                  </div>
                  {Object.keys(entry.details).length > 0 && (
                    <div className="text-[10px] text-gray-500 mt-0.5 truncate">
                      {Object.entries(entry.details)
                        .filter(([, v]) => v != null && v !== "")
                        .map(([k, v]) => `${k}: ${typeof v === "string" ? v.substring(0, 60) : v}`)
                        .join(" · ")}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
