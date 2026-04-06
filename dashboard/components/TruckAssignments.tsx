"use client";

import { useState, useEffect, useCallback } from "react";

interface TruckAssignment {
  id: string;
  user_id: string;
  user_name: string;
  user_role: string;
  truck_id: string;
  assigned_by: string;
  assigned_at: string;
}

interface TruckListItem {
  id: string;
  name: string;
}

const ROLE_COLORS: Record<string, string> = {
  developer: "bg-purple-600",
  manager: "bg-blue-600",
  mechanic: "bg-green-600",
  operator: "bg-gray-600",
};

export default function TruckAssignments() {
  const [assignments, setAssignments] = useState<TruckAssignment[]>([]);
  const [trucks, setTrucks] = useState<TruckListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [formUserId, setFormUserId] = useState("");
  const [formUserName, setFormUserName] = useState("");
  const [formUserRole, setFormUserRole] = useState("operator");
  const [formTruckId, setFormTruckId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fetchAssignments = useCallback(async () => {
    try {
      const res = await fetch("/api/truck-assignments");
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const data = await res.json();
      setAssignments(Array.isArray(data) ? data : []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAssignments();
    fetch("/api/fleet/trucks")
      .then((r) => r.json())
      .then((data) => {
        const list = Array.isArray(data) ? data : [];
        setTrucks(list);
        if (list.length > 0 && !formTruckId) setFormTruckId(list[0].id);
      })
      .catch(() => {});
  }, [fetchAssignments]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleAssign(e: React.FormEvent) {
    e.preventDefault();
    if (!formUserId.trim() || !formUserName.trim() || !formTruckId) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/truck-assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: formUserId.trim(),
          user_name: formUserName.trim(),
          user_role: formUserRole,
          truck_id: formTruckId,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Error ${res.status}`);
      }
      setFormUserId("");
      setFormUserName("");
      await fetchAssignments();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to assign");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUnassign(id: string) {
    try {
      const res = await fetch(`/api/truck-assignments?id=${id}`, { method: "DELETE" });
      if (!res.ok) return;
      await fetchAssignments();
    } catch { /* silent */ }
  }

  // Group assignments by truck
  const byTruck = new Map<string, TruckAssignment[]>();
  for (const a of assignments) {
    const list = byTruck.get(a.truck_id) ?? [];
    list.push(a);
    byTruck.set(a.truck_id, list);
  }

  const truckName = (id: string) => trucks.find((t) => t.id === id)?.name ?? id;

  if (loading) {
    return (
      <div className="text-center py-12 text-gray-600 text-sm">Loading assignments...</div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Assign form */}
      <div className="bg-gray-900/50 rounded-2xl border border-gray-800 p-4 sm:p-6">
        <h3 className="text-sm font-bold text-gray-300 mb-3 uppercase tracking-wider">Assign User to Truck</h3>
        <form onSubmit={handleAssign} className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={formUserId}
            onChange={(e) => setFormUserId(e.target.value)}
            placeholder="Clerk User ID"
            required
            className="min-h-[44px] flex-1 px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-200 text-xs placeholder-gray-600 focus:outline-none focus:border-purple-500"
          />
          <input
            type="text"
            value={formUserName}
            onChange={(e) => setFormUserName(e.target.value)}
            placeholder="User name"
            required
            className="min-h-[44px] flex-1 px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-200 text-xs placeholder-gray-600 focus:outline-none focus:border-purple-500"
          />
          <select
            value={formUserRole}
            onChange={(e) => setFormUserRole(e.target.value)}
            className="min-h-[44px] px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-200 text-xs focus:outline-none focus:border-purple-500 cursor-pointer"
          >
            <option value="operator">Operator</option>
            <option value="mechanic">Mechanic</option>
            <option value="manager">Manager</option>
            <option value="developer">Developer</option>
          </select>
          <select
            value={formTruckId}
            onChange={(e) => setFormTruckId(e.target.value)}
            className="min-h-[44px] px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-200 text-xs focus:outline-none focus:border-purple-500 cursor-pointer"
          >
            {trucks.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <button
            type="submit"
            disabled={submitting}
            className="min-h-[44px] px-5 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white text-xs font-bold uppercase tracking-wider transition-colors whitespace-nowrap"
          >
            {submitting ? "Assigning..." : "Assign"}
          </button>
        </form>
        {error && (
          <p className="text-xs text-red-400 mt-2">{error}</p>
        )}
      </div>

      {/* Assignments by truck */}
      {assignments.length === 0 ? (
        <div className="text-center py-8 text-gray-600 text-sm">
          No assignments yet. Assign operators and mechanics to trucks above.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[...byTruck.entries()].map(([tid, assigns]) => (
            <div key={tid} className="bg-gray-900/50 rounded-2xl border border-gray-800 p-4">
              <h4 className="text-sm font-bold text-gray-200 mb-3">{truckName(tid)}</h4>
              <div className="space-y-2">
                {assigns.map((a) => (
                  <div key={a.id} className="flex items-center justify-between gap-2 bg-gray-800/50 rounded-lg px-3 py-2 group">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-xs font-semibold text-gray-300 truncate">{a.user_name}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold text-white ${ROLE_COLORS[a.user_role] ?? "bg-gray-600"}`}>
                        {a.user_role}
                      </span>
                    </div>
                    <button
                      onClick={() => handleUnassign(a.id)}
                      className="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-400 transition-all p-1"
                      title="Unassign"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
