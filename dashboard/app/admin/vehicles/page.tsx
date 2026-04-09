"use client";

import { useState, useEffect, useCallback } from "react";
import { useUser } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import TopNav from "@/components/nav/TopNav";
import { useToast } from "@/components/Toast";

/* ── Types ──────────────────────────────────────────────────────── */

interface Vehicle {
  id: string;
  vehicle_number: string;
  vehicle_type: "chase" | "semi" | "other";
  is_active: boolean;
  created_at?: string;
}

type FilterTab = "all" | "chase" | "semi";

/* ── Main Page ──────────────────────────────────────────────────── */

export default function VehicleAdminPage() {
  const { user, isLoaded } = useUser();
  const router = useRouter();

  const role =
    ((user?.publicMetadata as Record<string, unknown>)?.role as string) ||
    "operator";
  const isAuthorized = role === "developer" || role === "manager";

  const { toast } = useToast();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Add form
  const [newNumber, setNewNumber] = useState("");
  const [newType, setNewType] = useState<"chase" | "semi" | "other">("chase");

  // Filter
  const [activeTab, setActiveTab] = useState<FilterTab>("all");

  // Redirect unauthorized users
  useEffect(() => {
    if (isLoaded && !isAuthorized) {
      router.replace("/");
    }
  }, [isLoaded, isAuthorized, router]);

  /* ── Fetch ──────────────────────────────────────────────────── */

  const fetchVehicles = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/vehicles");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data: Vehicle[] = await res.json();
      setVehicles(data);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to load vehicles", "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (isLoaded && isAuthorized) {
      fetchVehicles();
    }
  }, [isLoaded, isAuthorized, fetchVehicles]);

  /* ── Add Vehicle ────────────────────────────────────────────── */

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newNumber.trim()) return;
    setSaving(true);

    try {
      const res = await fetch("/api/admin/vehicles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vehicle_number: newNumber.trim(),
          vehicle_type: newType,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }

      setNewNumber("");
      setNewType("chase");
      toast("Vehicle added", "success");
      await fetchVehicles();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to add vehicle", "error");
    } finally {
      setSaving(false);
    }
  }

  /* ── Toggle Active ──────────────────────────────────────────── */

  async function handleToggle(vehicle: Vehicle) {
    setSaving(true);

    try {
      const res = await fetch("/api/admin/vehicles", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: vehicle.id, is_active: !vehicle.is_active }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }

      toast(`${vehicle.vehicle_number} ${vehicle.is_active ? "deactivated" : "activated"}`, "success");
      await fetchVehicles();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to update vehicle", "error");
    } finally {
      setSaving(false);
    }
  }

  /* ── Change Type ────────────────────────────────────────────── */

  async function handleTypeChange(vehicle: Vehicle, newVehicleType: string) {
    setSaving(true);

    try {
      const res = await fetch("/api/admin/vehicles", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: vehicle.id, vehicle_type: newVehicleType }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }

      toast(`${vehicle.vehicle_number} type updated`, "success");
      await fetchVehicles();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to update vehicle type", "error");
    } finally {
      setSaving(false);
    }
  }

  /* ── Delete ────────────────────────────────────────────────── */

  async function handleDelete(vehicle: Vehicle) {
    if (!confirm(`Delete "${vehicle.vehicle_number}"? This cannot be undone.`)) return;
    setSaving(true);

    try {
      const res = await fetch(`/api/admin/vehicles?id=${vehicle.id}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }

      toast(`${vehicle.vehicle_number} deleted`, "success");
      await fetchVehicles();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to delete vehicle", "error");
    } finally {
      setSaving(false);
    }
  }

  /* ── Filtered list ──────────────────────────────────────────── */

  const filtered =
    activeTab === "all"
      ? vehicles
      : vehicles.filter((v) => v.vehicle_type === activeTab);

  const counts = {
    all: vehicles.length,
    chase: vehicles.filter((v) => v.vehicle_type === "chase").length,
    semi: vehicles.filter((v) => v.vehicle_type === "semi").length,
  };

  /* ── Loading / auth gate ────────────────────────────────────── */

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="w-10 h-10 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
      </div>
    );
  }

  if (!isAuthorized) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <p className="text-gray-500">Redirecting...</p>
      </div>
    );
  }

  /* ── Render ─────────────────────────────────────────────────── */

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <TopNav />

      <main className="max-w-screen-xl mx-auto px-4 sm:px-6 py-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Vehicle Management</h1>
            <p className="text-gray-400 text-sm mt-1">
              Add, edit, and manage company chase trucks and semi trucks.
            </p>
          </div>
          <a
            href="/"
            className="text-sm text-gray-500 hover:text-gray-300 transition-colors"
          >
            Back to Home
          </a>
        </div>

        {/* Add Vehicle Card */}
        <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-6 mb-8">
          <h2 className="text-lg font-semibold mb-4">Add Vehicle</h2>
          <form onSubmit={handleAdd} className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              placeholder="Vehicle number (e.g. T-101)"
              value={newNumber}
              onChange={(e) => setNewNumber(e.target.value)}
              className="flex-1 px-4 py-3 rounded-lg bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
              required
            />
            <select
              value={newType}
              onChange={(e) => setNewType(e.target.value as "chase" | "semi" | "other")}
              className="px-4 py-3 rounded-lg bg-gray-800 border border-gray-700 text-white focus:outline-none focus:border-purple-500"
            >
              <option value="chase">Chase Truck</option>
              <option value="semi">Semi Truck</option>
              <option value="other">Other</option>
            </select>
            <button
              type="submit"
              disabled={saving || !newNumber.trim()}
              className="px-6 py-3 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
            >
              {saving ? "Adding..." : "Add Vehicle"}
            </button>
          </form>
        </div>

        {/* Filter Tabs */}
        <div className="flex gap-1 mb-6">
          {(["all", "chase", "semi"] as FilterTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === tab
                  ? "bg-purple-600 text-white"
                  : "bg-gray-800 text-gray-400 hover:text-gray-200 hover:bg-gray-700"
              }`}
            >
              {tab === "all" ? "All" : tab === "chase" ? "Chase" : "Semi"}
              <span className="ml-1.5 text-xs opacity-70">({counts[tab]})</span>
            </button>
          ))}
        </div>

        {/* Vehicle Table */}
        <div className="bg-gray-900/50 border border-gray-800 rounded-xl overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-8 h-8 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              {vehicles.length === 0
                ? "No vehicles yet. Add one above."
                : "No vehicles match this filter."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800 text-gray-400 text-left">
                    <th className="px-6 py-3 font-semibold">Number</th>
                    <th className="px-6 py-3 font-semibold">Type</th>
                    <th className="px-6 py-3 font-semibold">Status</th>
                    <th className="px-6 py-3 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((vehicle) => (
                    <tr key={vehicle.id} className="border-b border-gray-800 hover:bg-gray-800/30 transition-colors">
                      {/* Number */}
                      <td className="px-6 py-4 font-medium">{vehicle.vehicle_number}</td>

                      {/* Type dropdown */}
                      <td className="px-6 py-4">
                        <select
                          value={vehicle.vehicle_type}
                          onChange={(e) => handleTypeChange(vehicle, e.target.value)}
                          disabled={saving}
                          className="px-2 py-1 rounded bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:border-purple-500 disabled:opacity-50"
                        >
                          <option value="chase">Chase</option>
                          <option value="semi">Semi</option>
                          <option value="other">Other</option>
                        </select>
                      </td>

                      {/* Active toggle */}
                      <td className="px-6 py-4">
                        <button
                          onClick={() => handleToggle(vehicle)}
                          disabled={saving}
                          className="flex items-center gap-2 group disabled:opacity-50"
                        >
                          {/* Toggle switch */}
                          <div
                            className={`relative w-10 h-5 rounded-full transition-colors ${
                              vehicle.is_active ? "bg-green-600" : "bg-gray-600"
                            }`}
                          >
                            <div
                              className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                                vehicle.is_active ? "translate-x-5" : "translate-x-0.5"
                              }`}
                            />
                          </div>
                          <span
                            className={
                              vehicle.is_active
                                ? "px-2 py-0.5 rounded text-xs font-bold bg-green-900/50 text-green-300"
                                : "px-2 py-0.5 rounded text-xs font-bold bg-gray-700 text-gray-400"
                            }
                          >
                            {vehicle.is_active ? "Active" : "Inactive"}
                          </span>
                        </button>
                      </td>

                      {/* Delete */}
                      <td className="px-6 py-4 text-right">
                        {vehicle.is_active && (
                          <button
                            onClick={() => handleDelete(vehicle)}
                            disabled={saving}
                            className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white font-medium text-xs disabled:opacity-50 transition-colors"
                          >
                            Deactivate
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Summary footer */}
        {!loading && vehicles.length > 0 && (
          <div className="mt-4 text-xs text-gray-500 flex gap-4">
            <span>{vehicles.filter((v) => v.is_active).length} active</span>
            <span>{vehicles.filter((v) => !v.is_active).length} inactive</span>
            <span>{vehicles.length} total</span>
          </div>
        )}
      </main>
    </div>
  );
}
