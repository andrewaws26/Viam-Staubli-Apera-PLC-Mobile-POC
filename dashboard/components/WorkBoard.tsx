"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
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

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
  imageUrl?: string;
}

export default function WorkBoard() {
  const { user } = useUser();
  const { getToken } = useAuth();
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [viewMode, setViewMode] = useState<"board" | "my_work">("board");
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);

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

  const fetchTeamMembers = useCallback(async () => {
    try {
      const token = await getToken();
      const res = await fetch("/api/team-members", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setTeamMembers(data);
      }
    } catch {
      // Non-critical — assignment just won't show dropdown
    }
  }, [getToken]);

  useEffect(() => {
    fetchOrders();
    fetchTeamMembers();
    const interval = setInterval(fetchOrders, 15000);
    return () => clearInterval(interval);
  }, [fetchOrders, fetchTeamMembers]);

  const grouped = useMemo(() => {
    const g: Record<Status, WorkOrder[]> = { open: [], in_progress: [], blocked: [], done: [] };
    for (const wo of workOrders) g[wo.status]?.push(wo);
    return g;
  }, [workOrders]);

  // My Work: assigned to me + unassigned backlog (excludes done)
  const myWork = useMemo(() => {
    if (!user) return [];
    return workOrders.filter(
      (wo) => wo.status !== "done" && (wo.assigned_to === user.id || wo.assigned_to === null),
    );
  }, [workOrders, user]);

  const updateOrder = useCallback(
    async (id: string, patch: Record<string, unknown>) => {
      try {
        const token = await getToken();
        await fetch(`/api/work-orders?id=${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(patch),
        });
        fetchOrders();
      } catch (err) {
        console.error("[WorkBoard] update failed", err);
      }
    },
    [getToken, fetchOrders],
  );

  const updateStatus = useCallback(
    (id: string, status: Status, extra?: Record<string, unknown>) => {
      updateOrder(id, { status, ...extra });
    },
    [updateOrder],
  );

  const onDragEnd = useCallback(
    (result: DropResult) => {
      const { draggableId, destination } = result;
      if (!destination) return;

      const newStatus = destination.droppableId as Status;
      const wo = workOrders.find((w) => w.id === draggableId);
      if (!wo || wo.status === newStatus) return;

      if (newStatus === "blocked") {
        const reason = prompt("What's blocking this?");
        if (!reason) return;
        updateStatus(draggableId, newStatus, { blocker_reason: reason });
        return;
      }

      // Optimistic update
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
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-100">Work Board</h1>
          <p className="text-sm text-gray-500 mt-1">
            {workOrders.filter((w) => w.status !== "done").length} active
            {viewMode === "board" && (
              <span className="text-gray-600 ml-2">· drag cards to change status</span>
            )}
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

      {/* View Toggle */}
      <div className="flex gap-1 mb-4 bg-gray-900 rounded-lg p-1 w-fit">
        <button
          onClick={() => setViewMode("board")}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition ${
            viewMode === "board"
              ? "bg-purple-600 text-white"
              : "text-gray-400 hover:text-gray-200"
          }`}
        >
          Board
        </button>
        <button
          onClick={() => setViewMode("my_work")}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition ${
            viewMode === "my_work"
              ? "bg-purple-600 text-white"
              : "text-gray-400 hover:text-gray-200"
          }`}
        >
          My Work{myWork.length > 0 && ` (${myWork.length})`}
        </button>
      </div>

      {viewMode === "board" ? (
        /* Kanban Board with Drag & Drop */
        <DragDropContext onDragEnd={onDragEnd}>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4" style={{ minHeight: "calc(100vh - 200px)" }}>
            {STATUSES.map((status) => (
              <div key={status} className="flex flex-col flex-1">
                <div className="flex items-center gap-2 mb-3 px-1">
                  <div className={`w-2 h-2 rounded-full ${STATUS_COLORS[status]}`} />
                  <span className="text-sm font-bold text-gray-200">
                    {STATUS_LABELS[status]}
                  </span>
                  <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full">
                    {grouped[status].length}
                  </span>
                </div>

                <Droppable droppableId={status}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={`flex flex-col gap-2 min-h-[300px] flex-1 rounded-lg p-2 transition-colors ${
                        snapshot.isDraggingOver
                          ? "bg-gray-800/60 ring-2 ring-purple-500/40"
                          : "bg-gray-900/20"
                      }`}
                    >
                      {grouped[status].map((wo, index) => (
                        <Draggable key={wo.id} draggableId={wo.id} index={index}>
                          {(dragProvided, dragSnapshot) => (
                            <div
                              ref={dragProvided.innerRef}
                              {...dragProvided.draggableProps}
                              {...dragProvided.dragHandleProps}
                              style={{
                                ...dragProvided.draggableProps.style,
                                touchAction: "none",
                              }}
                            >
                              <WorkOrderCard
                                wo={wo}
                                isDragging={dragSnapshot.isDragging}
                                teamMembers={teamMembers}
                                onStatusChange={(s, extra) => updateStatus(wo.id, s, extra)}
                                onToggleSubtask={(subtaskId) => updateOrder(wo.id, { status: wo.status, toggle_subtask_id: subtaskId })}
                                onAssign={(userId, userName) => updateOrder(wo.id, { assigned_to: userId, assigned_to_name: userName })}
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
      ) : (
        /* My Work View */
        <div className="max-w-2xl">
          {myWork.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-3xl mb-3">📋</p>
              <p className="text-gray-400 font-medium">No work assigned</p>
              <p className="text-sm text-gray-600 mt-1">
                Work orders assigned to you or available to pick up will appear here.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {myWork.map((wo) => (
                <WorkOrderCard
                  key={wo.id}
                  wo={wo}
                  isDragging={false}
                  showStatus
                  teamMembers={teamMembers}
                  onStatusChange={(s, extra) => updateStatus(wo.id, s, extra)}
                  onToggleSubtask={(subtaskId) => updateOrder(wo.id, { status: wo.status, toggle_subtask_id: subtaskId })}
                  onAssign={(userId, userName) => updateOrder(wo.id, { assigned_to: userId, assigned_to_name: userName })}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Create Modal */}
      {showCreate && (
        <CreateModal
          teamMembers={teamMembers}
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
  showStatus,
  teamMembers,
  onStatusChange,
  onToggleSubtask,
  onAssign,
}: {
  wo: WorkOrder;
  isDragging: boolean;
  showStatus?: boolean;
  teamMembers: TeamMember[];
  onStatusChange: (status: Status, extra?: Record<string, unknown>) => void;
  onToggleSubtask: (subtaskId: string) => void;
  onAssign: (userId: string | null, userName: string | null) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showAssignMenu, setShowAssignMenu] = useState(false);
  const assignRef = useRef<HTMLDivElement>(null);

  // Optimistic subtask state so toggles feel instant
  const [localSubtasks, setLocalSubtasks] = useState(wo.subtasks);
  useEffect(() => { setLocalSubtasks(wo.subtasks); }, [wo.subtasks]);
  const subtasksDone = localSubtasks?.filter((s) => s.is_done).length ?? 0;
  const subtasksTotal = localSubtasks?.length ?? 0;

  const handleToggleSubtask = (subtaskId: string) => {
    setLocalSubtasks((prev) =>
      prev.map((s) => (s.id === subtaskId ? { ...s, is_done: !s.is_done } : s)),
    );
    onToggleSubtask(subtaskId);
  };

  // Close assign menu on outside click
  useEffect(() => {
    if (!showAssignMenu) return;
    const handler = (e: MouseEvent) => {
      if (assignRef.current && !assignRef.current.contains(e.target as Node)) {
        setShowAssignMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showAssignMenu]);

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

  const statusBadgeColor =
    wo.status === "done" ? "bg-green-900/40 text-green-400"
    : wo.status === "blocked" ? "bg-red-900/40 text-red-400"
    : wo.status === "in_progress" ? "bg-amber-900/40 text-amber-400"
    : "bg-gray-700 text-gray-400";

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
        {/* Title + status badge */}
        <div className="flex items-start gap-2">
          <p className="text-sm font-semibold text-gray-100 leading-tight flex-1">
            {wo.title}
          </p>
          {showStatus && (
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${statusBadgeColor}`}>
              {STATUS_LABELS[wo.status]}
            </span>
          )}
        </div>

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
                {localSubtasks.map((st) => (
                  <button
                    key={st.id}
                    className="flex items-center gap-2 w-full text-left hover:bg-gray-700/30 rounded px-1 py-0.5 -mx-1 transition"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggleSubtask(st.id);
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
            <div className="flex gap-2 pt-1 flex-wrap">
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

              {/* Assign button */}
              <div ref={assignRef} className="relative">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowAssignMenu(!showAssignMenu);
                  }}
                  className="text-xs px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-md font-medium transition flex items-center gap-1"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" />
                  </svg>
                  {wo.assigned_to_name ? "Reassign" : "Assign"}
                </button>

                {/* Assignment dropdown */}
                {showAssignMenu && (
                  <div
                    className="absolute left-0 bottom-full mb-1 w-56 bg-gray-800 border border-gray-600 rounded-lg shadow-xl z-50 py-1 max-h-48 overflow-y-auto"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {wo.assigned_to && (
                      <button
                        className="w-full text-left px-3 py-2 text-xs text-gray-400 hover:bg-gray-700 transition"
                        onClick={() => {
                          onAssign(null, null);
                          setShowAssignMenu(false);
                        }}
                      >
                        Unassign
                      </button>
                    )}
                    {teamMembers.map((m) => (
                      <button
                        key={m.id}
                        className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-700 transition flex items-center gap-2 ${
                          m.id === wo.assigned_to ? "text-purple-400" : "text-gray-200"
                        }`}
                        onClick={() => {
                          onAssign(m.id, m.name);
                          setShowAssignMenu(false);
                        }}
                      >
                        <span className="w-5 h-5 rounded-full bg-gray-600 flex items-center justify-center text-[10px] text-gray-300 shrink-0">
                          {m.name.charAt(0).toUpperCase()}
                        </span>
                        <span className="truncate">{m.name}</span>
                        <span className="text-gray-600 text-[10px] ml-auto shrink-0">{m.role}</span>
                      </button>
                    ))}
                    {teamMembers.length === 0 && (
                      <p className="text-xs text-gray-500 px-3 py-2">No team members found</p>
                    )}
                  </div>
                )}
              </div>
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
  teamMembers,
  onClose,
  onCreated,
}: {
  teamMembers: TeamMember[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { getToken } = useAuth();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<"low" | "normal" | "urgent">("normal");
  const [assignedTo, setAssignedTo] = useState<string>("");
  const [subtasks, setSubtasks] = useState<string[]>([]);
  const [suggesting, setSuggesting] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const selectedMember = teamMembers.find((m) => m.id === assignedTo);

  const suggestSteps = async () => {
    if (!title.trim()) return;
    setSuggesting(true);
    try {
      const token = await getToken();
      const res = await fetch("/api/ai-suggest-steps", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      if (Array.isArray(data.steps)) {
        setSubtasks(data.steps);
      }
    } catch {
      alert("Failed to generate steps. Try again.");
    } finally {
      setSuggesting(false);
    }
  };

  const handleSubmit = async () => {
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      const token = await getToken();
      const payload: Record<string, unknown> = {
        title: title.trim(),
        description: description.trim() || null,
        priority,
        subtasks: subtasks.filter((s) => s.trim()).map((s) => ({ title: s.trim() })),
      };
      if (assignedTo && selectedMember) {
        payload.assigned_to = assignedTo;
        payload.assigned_to_name = selectedMember.name;
      }
      const res = await fetch("/api/work-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Failed to create");
      onCreated();
    } catch {
      alert("Failed to create work order");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-xl border border-gray-700 w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto">
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

        <div className="grid grid-cols-2 gap-4">
          {/* Priority */}
          <div>
            <label className="text-xs text-gray-400 font-semibold uppercase tracking-wider">
              Priority
            </label>
            <div className="flex gap-1 mt-1">
              {(["low", "normal", "urgent"] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setPriority(p)}
                  className={`flex-1 py-2 rounded-lg text-xs font-medium transition ${
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

          {/* Assign To */}
          <div>
            <label className="text-xs text-gray-400 font-semibold uppercase tracking-wider">
              Assign To
            </label>
            <select
              value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value)}
              className="w-full mt-1 px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm text-gray-100 focus:border-purple-500 focus:outline-none appearance-none"
            >
              <option value="">Unassigned</option>
              {teamMembers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.role})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Subtasks */}
        <div>
          <div className="flex items-center justify-between">
            <label className="text-xs text-gray-400 font-semibold uppercase tracking-wider">
              Steps {subtasks.length > 0 && `(${subtasks.length})`}
            </label>
            <button
              onClick={suggestSteps}
              disabled={!title.trim() || suggesting}
              className="text-xs px-3 py-1.5 bg-indigo-600/20 hover:bg-indigo-600/30 disabled:bg-gray-800 disabled:text-gray-600 text-indigo-300 rounded-md font-medium transition flex items-center gap-1.5 border border-indigo-500/30 disabled:border-gray-700"
            >
              {suggesting ? (
                <>
                  <span className="w-3 h-3 rounded-full border border-indigo-400 border-t-transparent animate-spin" />
                  Thinking...
                </>
              ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M11 3a1 1 0 10-2 0v1a1 1 0 102 0V3zM15.657 5.757a1 1 0 00-1.414-1.414l-.707.707a1 1 0 001.414 1.414l.707-.707zM18 10a1 1 0 01-1 1h-1a1 1 0 110-2h1a1 1 0 011 1zM5.05 6.464A1 1 0 106.464 5.05l-.707-.707a1 1 0 00-1.414 1.414l.707.707zM5 10a1 1 0 01-1 1H3a1 1 0 110-2h1a1 1 0 011 1zM8 16v-1h4v1a2 2 0 11-4 0zM12 14c.015-.34.208-.646.477-.859a4 4 0 10-4.954 0c.27.213.462.519.476.859h4.002z" />
                  </svg>
                  Suggest Steps (Beta)
                </>
              )}
            </button>
          </div>

          {subtasks.length > 0 && (
            <div className="mt-2 space-y-1.5">
              {subtasks.map((step, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-600 w-4 text-right shrink-0">
                    {i + 1}.
                  </span>
                  <input
                    type="text"
                    value={step}
                    onChange={(e) => {
                      const next = [...subtasks];
                      next[i] = e.target.value;
                      setSubtasks(next);
                    }}
                    className="flex-1 px-2 py-1.5 bg-gray-900 border border-gray-700 rounded text-xs text-gray-200 focus:border-purple-500 focus:outline-none"
                  />
                  <button
                    onClick={() => setSubtasks(subtasks.filter((_, j) => j !== i))}
                    className="text-gray-600 hover:text-red-400 transition shrink-0"
                    title="Remove step"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                  </button>
                </div>
              ))}
              <button
                onClick={() => setSubtasks([...subtasks, ""])}
                className="text-[11px] text-gray-500 hover:text-gray-300 transition pl-6"
              >
                + Add step
              </button>
            </div>
          )}
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
