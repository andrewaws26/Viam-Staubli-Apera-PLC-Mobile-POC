"use client";

import { useState, useEffect, useCallback } from "react";
import { useUser } from "@clerk/nextjs";

interface MaintenanceEvent {
  id: string;
  truck_id: string;
  event_type: string;
  description: string | null;
  mileage: number | null;
  engine_hours: number | null;
  performed_by: string;
  performed_at: string;
  next_due_mileage: number | null;
  next_due_date: string | null;
  created_by: string;
  created_at: string;
}

const EVENT_TYPES: { value: string; label: string }[] = [
  { value: "oil_change", label: "Oil Change" },
  { value: "filter_replace", label: "Filter Replace" },
  { value: "def_fill", label: "DEF Fill" },
  { value: "coolant_flush", label: "Coolant Flush" },
  { value: "brake_inspection", label: "Brake Inspection" },
  { value: "tire_rotation", label: "Tire Rotation" },
  { value: "belt_replace", label: "Belt Replace" },
  { value: "battery_replace", label: "Battery Replace" },
  { value: "general_service", label: "General Service" },
  { value: "other", label: "Other" },
];

const EVENT_ICONS: Record<string, string> = {
  oil_change: "🛢️",
  filter_replace: "🔧",
  def_fill: "💧",
  coolant_flush: "❄️",
  brake_inspection: "🛑",
  tire_rotation: "🔄",
  belt_replace: "⚙️",
  battery_replace: "🔋",
  general_service: "🔩",
  other: "📋",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function isDueOrOverdue(event: MaintenanceEvent): "overdue" | "due_soon" | null {
  if (event.next_due_date) {
    const due = new Date(event.next_due_date);
    const now = new Date();
    const daysUntil = (due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    if (daysUntil < 0) return "overdue";
    if (daysUntil < 14) return "due_soon";
  }
  return null;
}

export default function MaintenanceTracker({ truckId }: { truckId?: string }) {
  const { user } = useUser();
  const [events, setEvents] = useState<MaintenanceEvent[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const userRole = (user?.publicMetadata as Record<string, unknown>)?.role as string || "operator";
  const canDelete = userRole === "developer" || userRole === "manager";

  const [form, setForm] = useState({
    event_type: "oil_change",
    description: "",
    mileage: "",
    engine_hours: "",
    performed_by: "",
    performed_at: new Date().toISOString().split("T")[0],
    next_due_mileage: "",
    next_due_date: "",
  });

  const effectiveTruckId = truckId ?? "default";

  const fetchEvents = useCallback(async () => {
    try {
      const res = await fetch(`/api/maintenance?truck_id=${effectiveTruckId}`);
      if (!res.ok) return;
      const data = await res.json();
      setEvents(Array.isArray(data) ? data : []);
      setError(null);
    } catch {
      setError("Failed to load maintenance history");
    }
  }, [effectiveTruckId]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  async function handleSubmit() {
    if (!form.event_type || !form.performed_by.trim() || posting) return;
    setPosting(true);
    try {
      const res = await fetch("/api/maintenance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          truck_id: effectiveTruckId,
          event_type: form.event_type,
          description: form.description.trim() || null,
          mileage: form.mileage ? Number(form.mileage) : null,
          engine_hours: form.engine_hours ? Number(form.engine_hours) : null,
          performed_by: form.performed_by.trim(),
          performed_at: form.performed_at ? new Date(form.performed_at).toISOString() : null,
          next_due_mileage: form.next_due_mileage ? Number(form.next_due_mileage) : null,
          next_due_date: form.next_due_date ? new Date(form.next_due_date).toISOString() : null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Error ${res.status}`);
      }
      setForm({ event_type: "oil_change", description: "", mileage: "", engine_hours: "", performed_by: "", performed_at: new Date().toISOString().split("T")[0], next_due_mileage: "", next_due_date: "" });
      setShowForm(false);
      await fetchEvents();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to log maintenance");
    } finally {
      setPosting(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      const res = await fetch(`/api/maintenance?id=${id}`, { method: "DELETE" });
      if (!res.ok) return;
      await fetchEvents();
    } catch { /* silent */ }
  }

  const overdueCount = events.filter((e) => isDueOrOverdue(e) === "overdue").length;
  const dueSoonCount = events.filter((e) => isDueOrOverdue(e) === "due_soon").length;

  return (
    <div className="bg-gray-900/30 rounded-2xl border border-gray-800 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full min-h-[44px] px-3 sm:px-5 py-3 flex items-center justify-between gap-2 hover:bg-gray-800/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm sm:text-base font-bold text-gray-200">Maintenance History</span>
          {events.length > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-blue-600/30 text-blue-300 text-xs font-bold">
              {events.length}
            </span>
          )}
          {overdueCount > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-red-600/30 text-red-300 text-xs font-bold">
              {overdueCount} overdue
            </span>
          )}
          {dueSoonCount > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-amber-600/30 text-amber-300 text-xs font-bold">
              {dueSoonCount} due soon
            </span>
          )}
        </div>
        <svg
          className={`w-4 h-4 text-gray-500 transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="px-3 sm:px-5 pb-4 space-y-3">
          {error && (
            <div className="text-xs text-red-400 bg-red-900/20 rounded-lg px-3 py-2">{error}</div>
          )}

          {/* Add button */}
          <button
            onClick={() => setShowForm(!showForm)}
            className="min-h-[44px] px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold uppercase tracking-wider transition-colors"
          >
            {showForm ? "Cancel" : "+ Log Maintenance"}
          </button>

          {/* Form */}
          {showForm && (
            <div className="bg-gray-800/50 rounded-xl p-3 sm:p-4 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-wider block mb-1">Type</label>
                  <select
                    value={form.event_type}
                    onChange={(e) => setForm({ ...form, event_type: e.target.value })}
                    className="w-full min-h-[44px] px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-gray-200 text-xs"
                  >
                    {EVENT_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-wider block mb-1">Performed By</label>
                  <input
                    type="text"
                    value={form.performed_by}
                    onChange={(e) => setForm({ ...form, performed_by: e.target.value })}
                    placeholder="Name"
                    className="w-full min-h-[44px] px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-gray-200 text-xs placeholder-gray-600"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-wider block mb-1">Date</label>
                  <input
                    type="date"
                    value={form.performed_at}
                    onChange={(e) => setForm({ ...form, performed_at: e.target.value })}
                    className="w-full min-h-[44px] px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-gray-200 text-xs"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-wider block mb-1">Mileage</label>
                  <input
                    type="number"
                    value={form.mileage}
                    onChange={(e) => setForm({ ...form, mileage: e.target.value })}
                    placeholder="Odometer"
                    className="w-full min-h-[44px] px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-gray-200 text-xs placeholder-gray-600"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-wider block mb-1">Engine Hours</label>
                  <input
                    type="number"
                    value={form.engine_hours}
                    onChange={(e) => setForm({ ...form, engine_hours: e.target.value })}
                    placeholder="Hours"
                    className="w-full min-h-[44px] px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-gray-200 text-xs placeholder-gray-600"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-wider block mb-1">Next Due Date</label>
                  <input
                    type="date"
                    value={form.next_due_date}
                    onChange={(e) => setForm({ ...form, next_due_date: e.target.value })}
                    className="w-full min-h-[44px] px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-gray-200 text-xs"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wider block mb-1">Notes</label>
                <input
                  type="text"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Optional notes..."
                  className="w-full min-h-[44px] px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-gray-200 text-xs placeholder-gray-600"
                />
              </div>
              <button
                onClick={handleSubmit}
                disabled={posting || !form.performed_by.trim()}
                className="min-h-[44px] px-6 py-2 rounded-lg bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white text-xs font-bold uppercase tracking-wider transition-colors"
              >
                {posting ? "Saving..." : "Save"}
              </button>
            </div>
          )}

          {/* Events list */}
          {events.length === 0 ? (
            <p className="text-xs text-gray-500 py-4 text-center">
              No maintenance records. Log your first service event.
            </p>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {events.map((event) => {
                const status = isDueOrOverdue(event);
                return (
                  <div
                    key={event.id}
                    className={`bg-gray-800/50 rounded-lg px-3 py-2.5 group ${
                      status === "overdue" ? "border border-red-600/30" :
                      status === "due_soon" ? "border border-amber-600/30" :
                      "border border-transparent"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm">{EVENT_ICONS[event.event_type] || "📋"}</span>
                        <span className="text-xs font-semibold text-gray-200">
                          {EVENT_TYPES.find((t) => t.value === event.event_type)?.label || event.event_type}
                        </span>
                        <span className="text-xs text-gray-500">{formatDate(event.performed_at)}</span>
                        {status === "overdue" && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-red-600/30 text-red-300">OVERDUE</span>
                        )}
                        {status === "due_soon" && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-600/30 text-amber-300">DUE SOON</span>
                        )}
                      </div>
                      {canDelete && (
                        <button
                          onClick={() => handleDelete(event.id)}
                          className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 transition-all p-1"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                      <span>by {event.performed_by}</span>
                      {event.mileage && <span>{event.mileage.toLocaleString()} mi</span>}
                      {event.engine_hours && <span>{event.engine_hours} hrs</span>}
                      {event.next_due_date && <span>Next: {formatDate(event.next_due_date)}</span>}
                      {event.next_due_mileage && <span>Next: {event.next_due_mileage.toLocaleString()} mi</span>}
                    </div>
                    {event.description && (
                      <p className="text-xs text-gray-400 mt-1">{event.description}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
