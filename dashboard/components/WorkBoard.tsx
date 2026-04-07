"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useUser, useAuth } from "@clerk/nextjs";
import {
  DragDropContext,
  Droppable,
  Draggable,
  type DropResult,
} from "@hello-pangea/dnd";
import type { WorkOrder, WorkOrderStatus } from "@ironsight/shared/work-order";

type Status = WorkOrderStatus;
const STATUSES: Status[] = ["open", "in_progress", "blocked", "done"];
const STATUS_LABELS: Record<Status, string> = {
  open: "Open",
  in_progress: "In Progress",
  blocked: "Blocked",
  done: "Done",
};
const STATUS_COLORS: Record<Status, string> = {
  open: "bg-gray-500",
  in_progress: "bg-amber-500",
  blocked: "bg-red-500",
  done: "bg-green-500",
};
const PRIORITY_COLORS: Record<string, string> = {
  urgent: "border-l-red-500",
  normal: "border-l-purple-500",
  low: "border-l-gray-600",
};

export default function WorkBoard() {
  const { user } = useUser();
  const { getToken } = useAuth();
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const role =
    ((user?.publicMetadata as Record<string, unknown>)?.role as string) || "operator";
  const canCreate = role !== "operator";

  const fetchOrders = useCallback(async () => {
    try {
      const token = await getToken();
      const res = await fetch("/api/work-orders", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setWorkOrders(data);
    } catch (err) {
      console.error("[WorkBoard]", err);
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    fetchOrders();
    const interval = setInterval(fetchOrders, 15000);
    return () => clearInterval(interval);
  }, [fetchOrders]);

  const grouped = useMemo(() => {
    const g: Record<Status, WorkOrder[]> = { open: [], in_progress: [], blocked: [], done: [] };
    for (const wo of workOrders) g[wo.status]?.push(wo);
    return g;
  }, [workOrders]);

  const updateStatus = useCallback(
    async (id: string, status: Status, extra?: Record<string, unknown>) => {
      try {
        const token = await getToken();
        await fetch(`/api/work-orders?id=${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ status, ...extra }),
        });
        fetchOrders();
      } catch (err) {
        console.error("[WorkBoard] update failed", err);
      }
    },
    [getToken, fetchOrders],
  );

  const onDragEnd = useCallback(
    (result: DropResult) => {
      const { draggableId, destination } = result;
      if (!destination) return;

      const newStatus = destination.droppableId as Status;
      const wo = workOrders.find((w) => w.id === draggableId);
      if (!wo || wo.status === newStatus) return;

      // Moving to blocked requires a reason
      if (newStatus === "blocked") {
        const reason = prompt("What's blocking this?");
        if (!reason) return;
        updateStatus(draggableId, newStatus, { blocker_reason: reason });
        return;
      }

      // Optimistic update for snappy feel
      setWorkOrders((prev) =>
        prev.map((w) => (w.id === draggableId ? { ...w, status: newStatus } : w)),
      );
      updateStatus(draggableId, newStatus);
    },
    [workOrders, updateStatus],
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="w-10 h-10 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-100">Work Board</h1>
          <p className="text-sm text-gray-500 mt-1">
            {workOrders.filter((w) => w.status !== "done").length} active work orders
            <span className="text-gray-600 ml-2">· drag cards to change status</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <a
            href="/"
            className="text-sm text-gray-400 hover:text-gray-200 transition"
          >
            Dashboard
          </a>
          {canCreate && (
            <button
              onClick={() => setShowCreate(true)}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-sm font-semibold rounded-lg transition"
            >
              + New Work Order
            </button>
          )}
        </div>
      </div>

      {/* Kanban Board with Drag & Drop */}
      <DragDropContext onDragEnd={onDragEnd}>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {STATUSES.map((status) => (
            <div key={status} className="flex flex-col">
              {/* Column Header */}
              <div className="flex items-center gap-2 mb-3 px-1">
                <div className={`w-2 h-2 rounded-full ${STATUS_COLORS[status]}`} />
                <span className="text-sm font-bold text-gray-200">
                  {STATUS_LABELS[status]}
                </span>
                <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full">
                  {grouped[status].length}
                </span>
              </div>

              {/* Droppable Column */}
              <Droppable droppableId={status}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={`flex flex-col gap-2 min-h-[200px] rounded-lg p-1 transition-colors ${
                      snapshot.isDraggingOver
                        ? "bg-gray-800/50 ring-1 ring-purple-500/30"
                        : ""
                    }`}
                  >
                    {grouped[status].map((wo, index) => (
                      <Draggable key={wo.id} draggableId={wo.id} index={index}>
                        {(dragProvided, dragSnapshot) => (
                          <div
                            ref={dragProvided.innerRef}
                            {...dragProvided.draggableProps}
                            {...dragProvided.dragHandleProps}
                          >
                            <WorkOrderCard
                              wo={wo}
                              isDragging={dragSnapshot.isDragging}
                              onStatusChange={(s, extra) => updateStatus(wo.id, s, extra)}
                              onToggleSubtask={(subtaskId) => updateStatus(wo.id, wo.status, { toggle_subtask_id: subtaskId })}
                            />
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                    {grouped[status].length === 0 && !snapshot.isDraggingOver && (
                      <p className="text-xs text-gray-600 text-center py-8">
                        No items
                      </p>
                    )}
                  </div>
                )}
              </Droppable>
            </div>
          ))}
        </div>
      </DragDropContext>

      {/* Create Modal */}
      {showCreate && (
        <CreateModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            fetchOrders();
          }}
        />
      )}
    </div>
  );
}

// ── Work Order Card ──────────────────────────────────────────────────

function WorkOrderCard({
  wo,
  isDragging,
  onStatusChange,
  onToggleSubtask,
}: {
  wo: WorkOrder;
  isDragging: boolean;
  onStatusChange: (status: Status, extra?: Record<string, unknown>) => void;
  onToggleSubtask: (subtaskId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const subtasksDone = wo.subtasks?.filter((s) => s.is_done).length ?? 0;
  const subtasksTotal = wo.subtasks?.length ?? 0;

  // Next logical status
  const nextStatus: Status | null =
    wo.status === "open"
      ? "in_progress"
      : wo.status === "in_progress"
        ? "done"
        : wo.status === "blocked"
          ? "in_progress"
          : null;

  const nextLabel =
    wo.status === "open"
      ? "Start"
      : wo.status === "in_progress"
        ? "Done"
        : wo.status === "blocked"
          ? "Unblock"
          : null;

  return (
    <div
      className={`bg-gray-800 rounded-lg border border-l-4 ${PRIORITY_COLORS[wo.priority]} cursor-grab active:cursor-grabbing transition ${
        isDragging
          ? "border-purple-500 shadow-lg shadow-purple-500/20 ring-1 ring-purple-500/40 rotate-1 scale-[1.02]"
          : "border-gray-700 hover:border-gray-600"
      }`}
      onClick={() => setExpanded(!expanded)}
    >
      <div className="p-3">
        {/* Title */}
        <p className="text-sm font-semibold text-gray-100 leading-tight">
          {wo.title}
        </p>

        {/* Meta row */}
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          {wo.priority === "urgent" && (
            <span className="text-[10px] font-bold text-red-400 bg-red-900/30 px-1.5 py-0.5 rounded">
              URGENT
            </span>
          )}
          <span className="text-[11px] text-gray-500">
            {wo.assigned_to_name || "Unassigned"}
          </span>
          {subtasksTotal > 0 && (
            <span className="text-[11px] text-gray-500">
              {subtasksDone}/{subtasksTotal} tasks
            </span>
          )}
          {wo.note_count > 0 && (
            <span className="text-[11px] text-gray-500">
              {wo.note_count} note{wo.note_count !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        {/* Blocker banner */}
        {wo.status === "blocked" && wo.blocker_reason && (
          <div className="mt-2 bg-red-900/20 rounded px-2 py-1">
            <p className="text-[11px] text-red-400 font-medium">
              {wo.blocker_reason}
            </p>
          </div>
        )}

        {/* Expanded details */}
        {expanded && (
          <div className="mt-3 pt-3 border-t border-gray-700 space-y-2">
            {wo.description && (
              <p className="text-xs text-gray-400">{wo.description}</p>
            )}

            {/* Subtask checklist */}
            {subtasksTotal > 0 && (
              <div className="space-y-1">
                {wo.subtasks.map((st) => (
                  <button
                    key={st.id}
                    className="flex items-center gap-2 w-full text-left hover:bg-gray-700/30 rounded px-1 py-0.5 -mx-1 transition"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleSubtask(st.id);
                    }}
                  >
                    <div
                      className={`w-4 h-4 rounded border shrink-0 ${
                        st.is_done
                          ? "bg-green-600 border-green-600"
                          : "border-gray-600 hover:border-gray-400"
                      } flex items-center justify-center transition`}
                    >
                      {st.is_done && (
                        <span className="text-[10px] text-white">✓</span>
                      )}
                    </div>
                    <span
                      className={`text-xs ${
                        st.is_done
                          ? "text-gray-600 line-through"
                          : "text-gray-300"
                      }`}
                    >
                      {st.title}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/* Linked DTCs */}
            {wo.linked_dtcs && wo.linked_dtcs.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {wo.linked_dtcs.map((dtc, i) => (
                  <span
                    key={`${dtc.spn}-${i}`}
                    className="text-[10px] bg-red-900/30 text-red-400 px-1.5 py-0.5 rounded"
                  >
                    SPN {dtc.spn} / FMI {dtc.fmi}
                  </span>
                ))}
              </div>
            )}

            {/* Quick actions */}
            <div className="flex gap-2 pt-1">
              {nextStatus && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onStatusChange(nextStatus);
                  }}
                  className="text-xs px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-md font-medium transition"
                >
                  {nextLabel}
                </button>
              )}
              {wo.status === "in_progress" && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    const reason = prompt("What's blocking this?");
                    if (reason) {
                      onStatusChange("blocked", { blocker_reason: reason });
                    }
                  }}
                  className="text-xs px-3 py-1.5 bg-red-900/50 hover:bg-red-900/70 text-red-300 rounded-md font-medium transition"
                >
                  Block
                </button>
              )}
              {wo.status === "done" && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onStatusChange("open");
                  }}
                  className="text-xs px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-md font-medium transition"
                >
                  Reopen
                </button>
              )}
            </div>

            <p className="text-[10px] text-gray-600">
              Created by {wo.created_by_name} · {timeAgo(wo.created_at)}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Create Modal ─────────────────────────────────────────────────────

function CreateModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const { getToken } = useAuth();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<"low" | "normal" | "urgent">("normal");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      const token = await getToken();
      const res = await fetch("/api/work-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
          priority,
        }),
      });
      if (!res.ok) throw new Error("Failed to create");
      onCreated();
    } catch (err) {
      alert("Failed to create work order");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-xl border border-gray-700 w-full max-w-lg p-6 space-y-4">
        <h2 className="text-lg font-bold text-gray-100">New Work Order</h2>

        <div>
          <label className="text-xs text-gray-400 font-semibold uppercase tracking-wider">
            What needs to be done?
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g., Check coolant leak on Truck 12"
            className="w-full mt-1 px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm text-gray-100 placeholder-gray-600 focus:border-purple-500 focus:outline-none"
            autoFocus
          />
        </div>

        <div>
          <label className="text-xs text-gray-400 font-semibold uppercase tracking-wider">
            Details (optional)
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Any additional context..."
            rows={3}
            className="w-full mt-1 px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm text-gray-100 placeholder-gray-600 focus:border-purple-500 focus:outline-none resize-none"
          />
        </div>

        <div>
          <label className="text-xs text-gray-400 font-semibold uppercase tracking-wider">
            Priority
          </label>
          <div className="flex gap-2 mt-1">
            {(["low", "normal", "urgent"] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPriority(p)}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${
                  priority === p
                    ? p === "urgent"
                      ? "bg-red-600 text-white"
                      : "bg-purple-600 text-white"
                    : "bg-gray-900 text-gray-400 hover:bg-gray-700"
                }`}
              >
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm font-semibold rounded-lg transition"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!title.trim() || submitting}
            className="flex-1 py-2.5 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-semibold rounded-lg transition"
          >
            {submitting ? "Creating..." : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
