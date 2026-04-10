"use client";

import { useState, useEffect, useCallback } from "react";

interface FleetTruck {
  id: string;
  name: string;
  vin: string | null;
  year: number | null;
  make: string;
  model: string;
  license_plate: string | null;
  viam_part_id: string;
  viam_machine_address: string;
  home_base: string;
  status: "active" | "inactive" | "maintenance" | "decommissioned";
  has_tps: boolean;
  has_cell: boolean;
  has_j1939: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

type TruckFormData = Omit<FleetTruck, "created_at" | "updated_at">;

const EMPTY_FORM: TruckFormData = {
  id: "",
  name: "",
  vin: null,
  year: null,
  make: "Mack",
  model: "Granite",
  license_plate: null,
  viam_part_id: "",
  viam_machine_address: "",
  home_base: "Shepherdsville, KY",
  status: "active",
  has_tps: true,
  has_cell: false,
  has_j1939: true,
  notes: null,
};

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-600",
  inactive: "bg-yellow-600",
  maintenance: "bg-orange-600",
  decommissioned: "bg-red-600",
};

const CAP_COLORS: Record<string, string> = {
  TPS: "bg-blue-600",
  Cell: "bg-cyan-600",
  J1939: "bg-amber-600",
};

export default function FleetManager() {
  const [trucks, setTrucks] = useState<FleetTruck[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<TruckFormData>({ ...EMPTY_FORM });
  const [submitting, setSubmitting] = useState(false);
  const [confirmDecommission, setConfirmDecommission] = useState<string | null>(null);

  const fetchTrucks = useCallback(async () => {
    try {
      const res = await fetch("/api/fleet/manage");
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const data = await res.json();
      setTrucks(Array.isArray(data) ? data : []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load trucks");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTrucks();
  }, [fetchTrucks]);

  function openAddForm() {
    setForm({ ...EMPTY_FORM });
    setEditingId(null);
    setShowForm(true);
    setError(null);
  }

  function openEditForm(truck: FleetTruck) {
    setForm({
      id: truck.id,
      name: truck.name,
      vin: truck.vin,
      year: truck.year,
      make: truck.make,
      model: truck.model,
      license_plate: truck.license_plate,
      viam_part_id: truck.viam_part_id,
      viam_machine_address: truck.viam_machine_address,
      home_base: truck.home_base,
      status: truck.status,
      has_tps: truck.has_tps,
      has_cell: truck.has_cell,
      has_j1939: truck.has_j1939,
      notes: truck.notes,
    });
    setEditingId(truck.id);
    setShowForm(true);
    setError(null);
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const isEdit = editingId !== null;
      const method = isEdit ? "PATCH" : "POST";
      const payload: Record<string, unknown> = { ...form };
      // Convert empty strings to null for optional fields
      if (!payload.vin) payload.vin = null;
      if (!payload.license_plate) payload.license_plate = null;
      if (!payload.notes) payload.notes = null;
      if (!payload.year) payload.year = null;

      const res = await fetch("/api/fleet/manage", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Error ${res.status}`);
      }

      closeForm();
      await fetchTrucks();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save truck");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDecommission(id: string) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/fleet/manage?id=${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Error ${res.status}`);
      }
      setConfirmDecommission(null);
      await fetchTrucks();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to decommission");
    } finally {
      setSubmitting(false);
    }
  }

  function updateField(field: keyof TruckFormData, value: unknown) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  // Input style constants
  const inputClass =
    "min-h-[44px] w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-200 text-xs placeholder-gray-600 focus:outline-none focus:border-purple-500";
  const labelClass = "block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1";
  const checkboxLabelClass = "flex items-center gap-2 text-xs text-gray-300 cursor-pointer";

  if (loading) {
    return (
      <div className="bg-gray-900/50 rounded-2xl border border-gray-800 p-6">
        <div className="text-center py-12 text-gray-600 text-sm">Loading fleet...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-200">Fleet Management</h2>
          <p className="text-xs text-gray-600 mt-0.5">
            {trucks.length} truck{trucks.length !== 1 ? "s" : ""} registered
          </p>
        </div>
        <button
          onClick={openAddForm}
          className="min-h-[44px] px-5 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold uppercase tracking-wider transition-colors"
        >
          + Add Truck
        </button>
      </div>

      {/* Error banner */}
      {error && !showForm && (
        <div className="bg-red-900/30 border border-red-800 rounded-lg px-4 py-2">
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}

      {/* Add/Edit Form Modal */}
      {showForm && (
        <div className="bg-gray-900/50 rounded-2xl border border-gray-800 p-4 sm:p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wider">
              {editingId ? `Edit Truck ${editingId}` : "Add New Truck"}
            </h3>
            <button
              onClick={closeForm}
              className="text-gray-600 hover:text-gray-400 transition-colors p-1"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {error && (
            <div className="bg-red-900/30 border border-red-800 rounded-lg px-4 py-2 mb-4">
              <p className="text-xs text-red-400">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Row 1: ID, Name, Status */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className={labelClass}>Truck ID *</label>
                <input
                  type="text"
                  value={form.id}
                  onChange={(e) => updateField("id", e.target.value)}
                  placeholder='e.g. "01"'
                  required
                  disabled={editingId !== null}
                  className={`${inputClass} ${editingId ? "opacity-50 cursor-not-allowed" : ""}`}
                />
              </div>
              <div>
                <label className={labelClass}>Name *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => updateField("name", e.target.value)}
                  placeholder='e.g. "Truck 01 – Mack"'
                  required
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Status</label>
                <select
                  value={form.status}
                  onChange={(e) => updateField("status", e.target.value)}
                  className={`${inputClass} cursor-pointer`}
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="maintenance">Maintenance</option>
                  <option value="decommissioned">Decommissioned</option>
                </select>
              </div>
            </div>

            {/* Row 2: Year, Make, Model */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className={labelClass}>Year</label>
                <input
                  type="number"
                  value={form.year ?? ""}
                  onChange={(e) =>
                    updateField("year", e.target.value ? Number(e.target.value) : null)
                  }
                  placeholder="e.g. 2013"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Make</label>
                <input
                  type="text"
                  value={form.make}
                  onChange={(e) => updateField("make", e.target.value)}
                  placeholder="Mack"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Model</label>
                <input
                  type="text"
                  value={form.model}
                  onChange={(e) => updateField("model", e.target.value)}
                  placeholder="Granite"
                  className={inputClass}
                />
              </div>
            </div>

            {/* Row 3: VIN, License Plate, Home Base */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className={labelClass}>VIN</label>
                <input
                  type="text"
                  value={form.vin ?? ""}
                  onChange={(e) => updateField("vin", e.target.value || null)}
                  placeholder="Vehicle Identification Number"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>License Plate</label>
                <input
                  type="text"
                  value={form.license_plate ?? ""}
                  onChange={(e) => updateField("license_plate", e.target.value || null)}
                  placeholder="Plate number"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Home Base</label>
                <input
                  type="text"
                  value={form.home_base}
                  onChange={(e) => updateField("home_base", e.target.value)}
                  placeholder="Shepherdsville, KY"
                  className={inputClass}
                />
              </div>
            </div>

            {/* Row 4: Viam Part ID, Machine Address */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Viam Part ID</label>
                <input
                  type="text"
                  value={form.viam_part_id}
                  onChange={(e) => updateField("viam_part_id", e.target.value)}
                  placeholder="Viam machine part ID"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Viam Machine Address</label>
                <input
                  type="text"
                  value={form.viam_machine_address}
                  onChange={(e) => updateField("viam_machine_address", e.target.value)}
                  placeholder="machine.xxxx.viam.cloud"
                  className={inputClass}
                />
              </div>
            </div>

            {/* Row 5: Capabilities */}
            <div>
              <label className={labelClass}>Capabilities</label>
              <div className="flex flex-wrap gap-4 mt-1">
                <label className={checkboxLabelClass}>
                  <input
                    type="checkbox"
                    checked={form.has_tps}
                    onChange={(e) => updateField("has_tps", e.target.checked)}
                    className="rounded border-gray-600 bg-gray-800 text-purple-600 focus:ring-purple-500"
                  />
                  TPS (Tie Plate System)
                </label>
                <label className={checkboxLabelClass}>
                  <input
                    type="checkbox"
                    checked={form.has_cell}
                    onChange={(e) => updateField("has_cell", e.target.checked)}
                    className="rounded border-gray-600 bg-gray-800 text-purple-600 focus:ring-purple-500"
                  />
                  Robot Cell
                </label>
                <label className={checkboxLabelClass}>
                  <input
                    type="checkbox"
                    checked={form.has_j1939}
                    onChange={(e) => updateField("has_j1939", e.target.checked)}
                    className="rounded border-gray-600 bg-gray-800 text-purple-600 focus:ring-purple-500"
                  />
                  J1939 Engine Diagnostics
                </label>
              </div>
            </div>

            {/* Row 6: Notes */}
            <div>
              <label className={labelClass}>Notes</label>
              <textarea
                value={form.notes ?? ""}
                onChange={(e) => updateField("notes", e.target.value || null)}
                placeholder="Optional notes about this truck..."
                rows={2}
                className={`${inputClass} resize-none`}
              />
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-2">
              <button
                type="submit"
                disabled={submitting}
                className="min-h-[44px] px-6 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white text-xs font-bold uppercase tracking-wider transition-colors"
              >
                {submitting
                  ? "Saving..."
                  : editingId
                    ? "Update Truck"
                    : "Create Truck"}
              </button>
              <button
                type="button"
                onClick={closeForm}
                className="min-h-[44px] px-5 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 text-xs font-bold uppercase tracking-wider transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Truck Table */}
      {trucks.length === 0 ? (
        <div className="bg-gray-900/50 rounded-2xl border border-gray-800 p-6">
          <div className="text-center py-8 text-gray-600 text-sm">
            No trucks registered. Click &quot;Add Truck&quot; to get started.
          </div>
        </div>
      ) : (
        <div className="bg-gray-900/50 rounded-2xl border border-gray-800 overflow-hidden">
          {/* Desktop table */}
          <div className="hidden lg:block overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="text-left px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wider">ID</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wider">Name</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wider">Year / Make / Model</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wider">VIN</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wider">Home Base</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wider">Capabilities</th>
                  <th className="text-right px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody>
                {trucks.map((truck) => (
                  <tr key={truck.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                    <td className="px-4 py-3 font-mono font-bold text-gray-300">{truck.id}</td>
                    <td className="px-4 py-3 text-gray-200 font-semibold">{truck.name}</td>
                    <td className="px-4 py-3 text-gray-400">
                      {[truck.year, truck.make, truck.model].filter(Boolean).join(" ")}
                    </td>
                    <td className="px-4 py-3 text-gray-500 font-mono text-xs">
                      {truck.vin ? `...${truck.vin.slice(-6)}` : "---"}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold text-white ${STATUS_COLORS[truck.status]}`}>
                        {truck.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400">{truck.home_base}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 flex-wrap">
                        {truck.has_tps && (
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold text-white ${CAP_COLORS.TPS}`}>
                            TPS
                          </span>
                        )}
                        {truck.has_cell && (
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold text-white ${CAP_COLORS.Cell}`}>
                            Cell
                          </span>
                        )}
                        {truck.has_j1939 && (
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold text-white ${CAP_COLORS.J1939}`}>
                            J1939
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => openEditForm(truck)}
                          className="px-2.5 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-gray-200 text-xs font-bold uppercase tracking-wider transition-colors"
                        >
                          Edit
                        </button>
                        {truck.status !== "decommissioned" && (
                          <>
                            {confirmDecommission === truck.id ? (
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => handleDecommission(truck.id)}
                                  disabled={submitting}
                                  className="px-2.5 py-1 rounded bg-red-700 hover:bg-red-600 disabled:opacity-40 text-white text-xs font-bold uppercase tracking-wider transition-colors"
                                >
                                  {submitting ? "..." : "Confirm"}
                                </button>
                                <button
                                  onClick={() => setConfirmDecommission(null)}
                                  className="px-2.5 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-500 text-xs font-bold uppercase tracking-wider transition-colors"
                                >
                                  No
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setConfirmDecommission(truck.id)}
                                className="px-2.5 py-1 rounded bg-gray-800 hover:bg-red-900/50 text-gray-500 hover:text-red-400 text-xs font-bold uppercase tracking-wider transition-colors"
                              >
                                Decom
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile card view */}
          <div className="lg:hidden divide-y divide-gray-800/50">
            {trucks.map((truck) => (
              <div key={truck.id} className="p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-sm text-gray-300">{truck.id}</span>
                    <span className="text-sm font-semibold text-gray-200">{truck.name}</span>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-xs font-bold text-white ${STATUS_COLORS[truck.status]}`}>
                    {truck.status}
                  </span>
                </div>
                <div className="text-xs text-gray-500">
                  {[truck.year, truck.make, truck.model].filter(Boolean).join(" ")}
                  {truck.vin && <span className="ml-2 font-mono">VIN: ...{truck.vin.slice(-6)}</span>}
                </div>
                <div className="text-xs text-gray-600">{truck.home_base}</div>
                <div className="flex items-center justify-between">
                  <div className="flex gap-1">
                    {truck.has_tps && (
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold text-white ${CAP_COLORS.TPS}`}>TPS</span>
                    )}
                    {truck.has_cell && (
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold text-white ${CAP_COLORS.Cell}`}>Cell</span>
                    )}
                    {truck.has_j1939 && (
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold text-white ${CAP_COLORS.J1939}`}>J1939</span>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => openEditForm(truck)}
                      className="min-h-[44px] px-3 py-2 rounded bg-gray-800 hover:bg-gray-700 text-gray-400 text-xs font-bold uppercase tracking-wider transition-colors"
                    >
                      Edit
                    </button>
                    {truck.status !== "decommissioned" && (
                      <>
                        {confirmDecommission === truck.id ? (
                          <div className="flex gap-1">
                            <button
                              onClick={() => handleDecommission(truck.id)}
                              disabled={submitting}
                              className="min-h-[44px] px-3 py-2 rounded bg-red-700 hover:bg-red-600 disabled:opacity-40 text-white text-xs font-bold uppercase tracking-wider transition-colors"
                            >
                              {submitting ? "..." : "Confirm"}
                            </button>
                            <button
                              onClick={() => setConfirmDecommission(null)}
                              className="min-h-[44px] px-3 py-2 rounded bg-gray-800 text-gray-500 text-xs font-bold uppercase tracking-wider transition-colors"
                            >
                              No
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmDecommission(truck.id)}
                            className="min-h-[44px] px-3 py-2 rounded bg-gray-800 hover:bg-red-900/50 text-gray-500 hover:text-red-400 text-xs font-bold uppercase tracking-wider transition-colors"
                          >
                            Decom
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
