"use client";

import React, { useState, useEffect, useCallback } from "react";
import type { WorkOrder } from "@ironsight/shared/work-order";

const STATUS_COLORS: Record<string, string> = {
  open: "bg-gray-500",
  in_progress: "bg-amber-500",
  blocked: "bg-red-500",
  done: "bg-green-500",
};

const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  in_progress: "In Progress",
  blocked: "Blocked",
  done: "Done",
};

export default function TruckWorkOrders({ truckId }: { truckId?: string }) {
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [showHistory, setShowHistory] = useState(false);

  const fetchWorkOrders = useCallback(async () => {
    if (!truckId) return;
    try {
      const res = await fetch(`/api/work-orders?truck_id=${encodeURIComponent(truckId)}`);
      if (!res.ok) return;
      const data = await res.json();
      setWorkOrders(data);
    } catch {
      // Silent
    } finally {
      setLoading(false);
    }
  }, [truckId]);

  useEffect(() => {
    fetchWorkOrders();
    const interval = setInterval(fetchWorkOrders, 15000);
    return () => clearInterval(interval);
  }, [fetchWorkOrders]);

  if (loading) {
    return (
      <div className="bg-gray-900/50 border border-gray-700/50 rounded-lg p-4">
        <h3 className="text-sm font-bold text-gray-200 mb-2">Work Orders</h3>
        <p className="text-xs text-gray-500">Loading...</p>
      </div>
    );
  }

  const active = workOrders.filter((wo) => wo.status !== "done");
  const completed = workOrders.filter((wo) => wo.status === "done");

  if (workOrders.length === 0) {
    return (
      <div className="bg-gray-900/50 border border-gray-700/50 rounded-lg p-4">
        <h3 className="text-sm font-bold text-gray-200 mb-2">Work Orders</h3>
        <p className="text-xs text-gray-500">No work orders for this truck.</p>
        <a
          href="/work"
          className="text-xs text-purple-400 hover:text-purple-300 transition mt-2 inline-block"
        >
          Create one on the Work Board →
        </a>
      </div>
    );
  }

  return (
    <div className="bg-gray-900/50 border border-gray-700/50 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-gray-200">
          Work Orders
          {active.length > 0 && (
            <span className="ml-2 text-xs font-normal text-amber-400">
              {active.length} active
            </span>
          )}
        </h3>
        <a
          href="/work"
          className="text-xs text-purple-400 hover:text-purple-300 transition"
        >
          View Board →
        </a>
      </div>

      {/* Active work orders */}
      {active.length > 0 && (
        <div className="space-y-2 mb-3">
          {active.map((wo) => (
            <WorkOrderRow key={wo.id} wo={wo} />
          ))}
        </div>
      )}

      {/* Completed history */}
      {completed.length > 0 && (
        <div>
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="text-xs text-gray-400 hover:text-gray-200 transition mb-2"
          >
            {showHistory ? "▼" : "▶"} Completed ({completed.length})
          </button>
          {showHistory && (
            <div className="space-y-2">
              {completed.map((wo) => (
                <WorkOrderRow key={wo.id} wo={wo} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function WorkOrderRow({ wo }: { wo: WorkOrder }) {
  const [expanded, setExpanded] = useState(false);
  const isDone = wo.status === "done";
  const subtasksDone = wo.subtasks?.filter((s) => s.is_done).length ?? 0;
  const subtasksTotal = wo.subtasks?.length ?? 0;

  return (
    <div
      className={`bg-gray-800/80 rounded-lg border border-gray-700/50 cursor-pointer hover:border-gray-600 transition ${
        isDone ? "opacity-60" : ""
      }`}
      onClick={() => setExpanded(!expanded)}
    >
      <div className="p-2.5">
        <div className="flex items-start gap-2">
          <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${STATUS_COLORS[wo.status]}`} />
          <div className="flex-1 min-w-0">
            <p className={`text-xs font-medium ${isDone ? "text-gray-400 line-through" : "text-gray-100"}`}>
              {wo.title}
            </p>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="text-[10px] text-gray-500">
                {STATUS_LABELS[wo.status]}
              </span>
              {wo.assigned_to_name && (
                <span className="text-[10px] text-gray-500">
                  → {wo.assigned_to_name}
                </span>
              )}
              {wo.priority === "urgent" && (
                <span className="text-[9px] font-bold text-red-400 bg-red-900/30 px-1 py-0.5 rounded">
                  URGENT
                </span>
              )}
              {subtasksTotal > 0 && (
                <span className="text-[10px] text-gray-500">
                  {subtasksDone}/{subtasksTotal} tasks
                </span>
              )}
            </div>
          </div>
        </div>

        {expanded && (
          <div className="mt-2 pt-2 border-t border-gray-700/50 space-y-1.5">
            {wo.description && (
              <p className="text-[11px] text-gray-400">{wo.description}</p>
            )}

            {/* Subtask checklist */}
            {subtasksTotal > 0 && (
              <div className="space-y-0.5">
                {wo.subtasks.map((st) => (
                  <div key={st.id} className="flex items-center gap-1.5">
                    <span className={`text-[10px] ${st.is_done ? "text-green-500" : "text-gray-600"}`}>
                      {st.is_done ? "✓" : "○"}
                    </span>
                    <span className={`text-[11px] ${st.is_done ? "text-gray-500 line-through" : "text-gray-300"}`}>
                      {st.title}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Linked DTCs */}
            {wo.linked_dtcs && wo.linked_dtcs.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {wo.linked_dtcs.map((dtc, i) => (
                  <span
                    key={`${dtc.spn}-${i}`}
                    className="text-[9px] bg-red-900/30 text-red-400 px-1 py-0.5 rounded"
                  >
                    SPN {dtc.spn} / FMI {dtc.fmi}
                  </span>
                ))}
              </div>
            )}

            {/* Blocker */}
            {wo.status === "blocked" && wo.blocker_reason && (
              <div className="bg-red-900/20 rounded px-2 py-1">
                <p className="text-[10px] text-red-400">{wo.blocker_reason}</p>
              </div>
            )}

            {/* Meta */}
            <div className="flex items-center gap-3 text-[10px] text-gray-600">
              <span>Created by {wo.created_by_name}</span>
              {wo.completed_at && (
                <span>Completed {new Date(wo.completed_at).toLocaleDateString()}</span>
              )}
              <span>{new Date(wo.created_at).toLocaleDateString()}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
