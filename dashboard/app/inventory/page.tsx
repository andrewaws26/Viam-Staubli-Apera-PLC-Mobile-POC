"use client";

import { useState, useEffect, useMemo } from "react";
import AppNav from "@/components/AppNav";
import type {
  Part,
  PartCategory,
  PartStatus,
  PartUsage,
  UsageType,
  StockLocation,
  CreatePartPayload,
  CreatePartUsagePayload,
} from "@ironsight/shared";
import {
  PART_CATEGORY_LABELS,
  PART_CATEGORY_COLORS,
  PART_STATUS_LABELS,
  PART_STATUS_COLORS,
  USAGE_TYPE_LABELS,
  STOCK_LOCATION_LABELS,
} from "@ironsight/shared";

// ── Helpers ──────────────────────────────────────────────────────────

function fmtCurrency(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  });
}

function fmtDate(iso: string): string {
  return new Date(iso + "T12:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const ALL_CATEGORIES: PartCategory[] = [
  "hydraulic",
  "electrical",
  "engine",
  "transmission",
  "brake",
  "suspension",
  "body",
  "safety",
  "consumable",
  "tool",
  "other",
];

const ALL_LOCATIONS: StockLocation[] = [
  "shop",
  "truck",
  "warehouse",
  "field",
  "other",
];

const ALL_USAGE_TYPES: UsageType[] = [
  "maintenance",
  "repair",
  "replacement",
  "inspection",
  "other",
];

// ── Quantity color helper ────────────────────────────────────────────

function qtyClasses(qty: number, reorderPt: number): string {
  if (qty === 0) return "text-red-400 bg-red-900/30";
  if (qty <= reorderPt) return "text-amber-400 bg-amber-900/30";
  return "text-emerald-400 bg-emerald-900/30";
}

// ── Alert Data ───────────────────────────────────────────────────────

interface AlertData {
  low_stock: Part[];
  out_of_stock: Part[];
}

// ── Add Part Modal ───────────────────────────────────────────────────

function AddPartModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState<CreatePartPayload>({
    part_number: "",
    name: "",
    category: "other",
    unit_cost: 0,
    unit: "each",
    quantity_on_hand: 0,
    reorder_point: 5,
    reorder_quantity: 10,
    location: "shop",
    supplier: "",
    description: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to create part");
      }
      onCreated();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-lg mx-4 bg-gray-900 border border-gray-700 rounded-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto"
      >
        <h2 className="text-lg font-black uppercase tracking-widest text-gray-100">
          Add Part
        </h2>

        {error && (
          <p className="text-sm text-red-400 bg-red-900/30 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">
              Part Number
            </label>
            <input
              type="text"
              required
              value={form.part_number}
              onChange={(e) =>
                setForm({ ...form, part_number: e.target.value })
              }
              placeholder="HYD-001"
              className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm font-mono placeholder-gray-600 focus:outline-none focus:border-gray-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">
              Name
            </label>
            <input
              type="text"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Hydraulic Hose 3/8"
              className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-gray-500"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">
              Category
            </label>
            <select
              value={form.category}
              onChange={(e) =>
                setForm({ ...form, category: e.target.value as PartCategory })
              }
              className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:border-gray-500"
            >
              {ALL_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {PART_CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">
              Location
            </label>
            <select
              value={form.location}
              onChange={(e) =>
                setForm({ ...form, location: e.target.value as StockLocation })
              }
              className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:border-gray-500"
            >
              {ALL_LOCATIONS.map((l) => (
                <option key={l} value={l}>
                  {STOCK_LOCATION_LABELS[l]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">
              Unit Cost
            </label>
            <input
              type="number"
              required
              min="0"
              step="0.01"
              value={form.unit_cost}
              onChange={(e) =>
                setForm({ ...form, unit_cost: parseFloat(e.target.value) || 0 })
              }
              className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm font-mono placeholder-gray-600 focus:outline-none focus:border-gray-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">
              Unit
            </label>
            <input
              type="text"
              value={form.unit || "each"}
              onChange={(e) => setForm({ ...form, unit: e.target.value })}
              className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-gray-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">
              Qty on Hand
            </label>
            <input
              type="number"
              min="0"
              value={form.quantity_on_hand}
              onChange={(e) =>
                setForm({
                  ...form,
                  quantity_on_hand: parseInt(e.target.value) || 0,
                })
              }
              className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm font-mono placeholder-gray-600 focus:outline-none focus:border-gray-500"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">
              Reorder Point
            </label>
            <input
              type="number"
              min="0"
              value={form.reorder_point}
              onChange={(e) =>
                setForm({
                  ...form,
                  reorder_point: parseInt(e.target.value) || 0,
                })
              }
              className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm font-mono placeholder-gray-600 focus:outline-none focus:border-gray-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">
              Supplier
            </label>
            <input
              type="text"
              value={form.supplier || ""}
              onChange={(e) => setForm({ ...form, supplier: e.target.value })}
              placeholder="NAPA, Grainger..."
              className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-gray-500"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">
            Description
          </label>
          <textarea
            value={form.description || ""}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={2}
            className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-gray-500 resize-none"
          />
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="flex-1 px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-bold uppercase tracking-wider transition-colors"
          >
            {saving ? "Saving..." : "Create Part"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-lg border border-gray-700 hover:border-gray-500 text-gray-400 hover:text-white text-sm font-bold uppercase tracking-wider transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Log Usage Modal ──────────────────────────────────────────────────

function LogUsageModal({
  parts,
  onClose,
  onCreated,
}: {
  parts: Part[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState<CreatePartUsagePayload>({
    part_id: parts[0]?.id || "",
    quantity_used: 1,
    usage_type: "maintenance",
    usage_date: new Date().toISOString().split("T")[0],
    truck_name: "",
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/inventory/usage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to log usage");
      }
      onCreated();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md mx-4 bg-gray-900 border border-gray-700 rounded-2xl p-6 space-y-4"
      >
        <h2 className="text-lg font-black uppercase tracking-widest text-gray-100">
          Log Usage
        </h2>

        {error && (
          <p className="text-sm text-red-400 bg-red-900/30 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <div>
          <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">
            Part
          </label>
          <select
            value={form.part_id}
            onChange={(e) => setForm({ ...form, part_id: e.target.value })}
            className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:border-gray-500"
          >
            {parts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.part_number} — {p.name}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">
              Quantity
            </label>
            <input
              type="number"
              required
              min="1"
              value={form.quantity_used}
              onChange={(e) =>
                setForm({
                  ...form,
                  quantity_used: parseInt(e.target.value) || 1,
                })
              }
              className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm font-mono placeholder-gray-600 focus:outline-none focus:border-gray-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">
              Usage Type
            </label>
            <select
              value={form.usage_type}
              onChange={(e) =>
                setForm({ ...form, usage_type: e.target.value as UsageType })
              }
              className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:border-gray-500"
            >
              {ALL_USAGE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {USAGE_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">
              Truck
            </label>
            <input
              type="text"
              value={form.truck_name || ""}
              onChange={(e) =>
                setForm({ ...form, truck_name: e.target.value })
              }
              placeholder="Truck name..."
              className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-gray-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">
              Date
            </label>
            <input
              type="date"
              value={form.usage_date}
              onChange={(e) =>
                setForm({ ...form, usage_date: e.target.value })
              }
              className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:border-gray-500 [color-scheme:dark]"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">
            Notes
          </label>
          <textarea
            value={form.notes || ""}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            rows={2}
            className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-gray-500 resize-none"
          />
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="flex-1 px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-bold uppercase tracking-wider transition-colors"
          >
            {saving ? "Saving..." : "Log Usage"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-lg border border-gray-700 hover:border-gray-500 text-gray-400 hover:text-white text-sm font-bold uppercase tracking-wider transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Part Detail Panel ────────────────────────────────────────────────

function PartDetailPanel({
  part,
  onClose,
}: {
  part: Part;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg mx-4 bg-gray-900 border border-gray-700 rounded-2xl p-6 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-black uppercase tracking-widest text-gray-100">
              {part.name}
            </h2>
            <p className="text-xs text-gray-500 font-mono mt-0.5">
              {part.part_number}
            </p>
          </div>
          <span
            className="inline-block px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-wider"
            style={{
              backgroundColor: PART_STATUS_COLORS[part.status] + "20",
              color: PART_STATUS_COLORS[part.status],
            }}
          >
            {PART_STATUS_LABELS[part.status]}
          </span>
        </div>

        {part.description && (
          <p className="text-sm text-gray-400">{part.description}</p>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="bg-gray-800/50 rounded-lg px-3 py-2">
            <div className="text-[10px] text-gray-600 uppercase tracking-wider">
              Category
            </div>
            <div className="flex items-center gap-2 mt-1">
              <div
                className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: PART_CATEGORY_COLORS[part.category] }}
              />
              <span className="text-sm text-gray-200">
                {PART_CATEGORY_LABELS[part.category]}
              </span>
            </div>
          </div>
          <div className="bg-gray-800/50 rounded-lg px-3 py-2">
            <div className="text-[10px] text-gray-600 uppercase tracking-wider">
              Location
            </div>
            <div className="text-sm text-gray-200 mt-1">
              {STOCK_LOCATION_LABELS[part.location]}
            </div>
          </div>
          <div className="bg-gray-800/50 rounded-lg px-3 py-2">
            <div className="text-[10px] text-gray-600 uppercase tracking-wider">
              On Hand
            </div>
            <div
              className={`text-sm font-mono mt-1 ${
                part.quantity_on_hand === 0
                  ? "text-red-400"
                  : part.quantity_on_hand <= part.reorder_point
                  ? "text-amber-400"
                  : "text-emerald-400"
              }`}
            >
              {part.quantity_on_hand} {part.unit}
            </div>
          </div>
          <div className="bg-gray-800/50 rounded-lg px-3 py-2">
            <div className="text-[10px] text-gray-600 uppercase tracking-wider">
              Reorder Point
            </div>
            <div className="text-sm text-gray-200 font-mono mt-1">
              {part.reorder_point} {part.unit}
            </div>
          </div>
          <div className="bg-gray-800/50 rounded-lg px-3 py-2">
            <div className="text-[10px] text-gray-600 uppercase tracking-wider">
              Unit Cost
            </div>
            <div className="text-sm text-gray-200 font-mono mt-1">
              {fmtCurrency(part.unit_cost)}
            </div>
          </div>
          <div className="bg-gray-800/50 rounded-lg px-3 py-2">
            <div className="text-[10px] text-gray-600 uppercase tracking-wider">
              Total Value
            </div>
            <div className="text-sm text-gray-200 font-mono mt-1">
              {fmtCurrency(part.unit_cost * part.quantity_on_hand)}
            </div>
          </div>
        </div>

        {part.supplier && (
          <div className="bg-gray-800/50 rounded-lg px-3 py-2">
            <div className="text-[10px] text-gray-600 uppercase tracking-wider">
              Supplier
            </div>
            <div className="text-sm text-gray-200 mt-1">{part.supplier}</div>
          </div>
        )}

        <div className="flex items-center gap-4 text-[10px] text-gray-600 uppercase tracking-wider">
          {part.last_ordered && (
            <span>Last ordered: {fmtDate(part.last_ordered)}</span>
          )}
          {part.last_used && (
            <span>Last used: {fmtDate(part.last_used)}</span>
          )}
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-4 py-2.5 rounded-lg border border-gray-700 hover:border-gray-500 text-gray-400 hover:text-white text-sm font-bold uppercase tracking-wider transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Parts Catalog Tab ────────────────────────────────────────────────

function PartsCatalogTab({
  search,
  categoryFilter,
  statusFilter,
  locationFilter,
}: {
  search: string;
  categoryFilter: PartCategory | "all";
  statusFilter: PartStatus | "all";
  locationFilter: StockLocation | "all";
}) {
  const [parts, setParts] = useState<Part[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [selectedPart, setSelectedPart] = useState<Part | null>(null);

  function fetchParts() {
    setLoading(true);
    fetch("/api/inventory")
      .then((r) => r.json())
      .then((data) => setParts(Array.isArray(data) ? data : []))
      .catch(() => setParts([]))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    fetchParts();
  }, []);

  const filtered = useMemo(() => {
    let result = parts;
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.part_number.toLowerCase().includes(q)
      );
    }
    if (categoryFilter !== "all") {
      result = result.filter((p) => p.category === categoryFilter);
    }
    if (statusFilter !== "all") {
      result = result.filter((p) => p.status === statusFilter);
    }
    if (locationFilter !== "all") {
      result = result.filter((p) => p.location === locationFilter);
    }
    return result;
  }, [parts, search, categoryFilter, statusFilter, locationFilter]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
        <button
          onClick={() => setShowAdd(true)}
          className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold uppercase tracking-wider transition-colors whitespace-nowrap"
        >
          + Add Part
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-gray-600 text-sm">
            No parts found{search ? " matching your search" : ""}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-gray-600 border-b border-gray-800">
                <th className="text-left px-4 py-3 font-medium w-28">
                  Part #
                </th>
                <th className="text-left px-4 py-3 font-medium">Name</th>
                <th className="text-left px-4 py-3 font-medium w-28">
                  Category
                </th>
                <th className="text-right px-4 py-3 font-medium w-20">Qty</th>
                <th className="text-right px-4 py-3 font-medium w-24">
                  Reorder Pt
                </th>
                <th className="text-right px-4 py-3 font-medium w-24">Cost</th>
                <th className="text-left px-4 py-3 font-medium w-24">
                  Location
                </th>
                <th className="text-center px-4 py-3 font-medium w-28">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((part) => (
                <tr
                  key={part.id}
                  className="border-t border-gray-800/50 hover:bg-gray-800/30 transition-colors cursor-pointer"
                  onClick={() => setSelectedPart(part)}
                >
                  <td className="px-4 py-2.5 font-mono text-gray-400 text-xs">
                    {part.part_number}
                  </td>
                  <td className="px-4 py-2.5 text-gray-200">{part.name}</td>
                  <td className="px-4 py-2.5">
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{
                          backgroundColor:
                            PART_CATEGORY_COLORS[part.category],
                        }}
                      />
                      <span className="text-xs text-gray-400">
                        {PART_CATEGORY_LABELS[part.category]}
                      </span>
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <span
                      className={`inline-block px-2 py-0.5 rounded font-mono text-xs ${qtyClasses(
                        part.quantity_on_hand,
                        part.reorder_point
                      )}`}
                    >
                      {part.quantity_on_hand}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-gray-500 text-xs">
                    {part.reorder_point}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-gray-300 text-xs">
                    {fmtCurrency(part.unit_cost)}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-400">
                    {STOCK_LOCATION_LABELS[part.location]}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <span
                      className="inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider"
                      style={{
                        backgroundColor:
                          PART_STATUS_COLORS[part.status] + "20",
                        color: PART_STATUS_COLORS[part.status],
                      }}
                    >
                      {PART_STATUS_LABELS[part.status]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && (
        <AddPartModal
          onClose={() => setShowAdd(false)}
          onCreated={fetchParts}
        />
      )}

      {selectedPart && (
        <PartDetailPanel
          part={selectedPart}
          onClose={() => setSelectedPart(null)}
        />
      )}
    </div>
  );
}

// ── Usage Log Tab ────────────────────────────────────────────────────

function UsageLogTab({ parts }: { parts: Part[] }) {
  const [usage, setUsage] = useState<PartUsage[]>([]);
  const [loading, setLoading] = useState(true);
  const [showLog, setShowLog] = useState(false);

  function fetchUsage() {
    setLoading(true);
    fetch("/api/inventory/usage")
      .then((r) => r.json())
      .then((data) => setUsage(Array.isArray(data) ? data : []))
      .catch(() => setUsage([]))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    fetchUsage();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
        <button
          onClick={() => setShowLog(true)}
          className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold uppercase tracking-wider transition-colors whitespace-nowrap"
        >
          + Log Usage
        </button>
      </div>

      {usage.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-gray-600 text-sm">No usage records found</p>
        </div>
      ) : (
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden overflow-x-auto">
          <table className="w-full text-sm min-w-[800px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-gray-600 border-b border-gray-800">
                <th className="text-left px-4 py-3 font-medium w-28">Date</th>
                <th className="text-left px-4 py-3 font-medium">Part</th>
                <th className="text-right px-4 py-3 font-medium w-20">
                  Qty Used
                </th>
                <th className="text-left px-4 py-3 font-medium w-28">Type</th>
                <th className="text-left px-4 py-3 font-medium w-28">
                  Truck
                </th>
                <th className="text-left px-4 py-3 font-medium w-28">
                  Used By
                </th>
                <th className="text-left px-4 py-3 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody>
              {usage.map((u) => (
                <tr
                  key={u.id}
                  className="border-t border-gray-800/50 hover:bg-gray-800/30 transition-colors"
                >
                  <td className="px-4 py-2.5 text-gray-400 font-mono text-xs">
                    {fmtDate(u.usage_date)}
                  </td>
                  <td className="px-4 py-2.5 text-gray-200">
                    <span className="text-gray-500 font-mono text-xs">
                      {u.part_number}
                    </span>{" "}
                    {u.part_name}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-gray-300">
                    {u.quantity_used}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="text-xs text-gray-400">
                      {USAGE_TYPE_LABELS[u.usage_type]}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-400">
                    {u.truck_name || "--"}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-400">
                    {u.used_by_name || "--"}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-500 truncate max-w-[200px]">
                    {u.notes || "--"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showLog && (
        <LogUsageModal
          parts={parts}
          onClose={() => setShowLog(false)}
          onCreated={fetchUsage}
        />
      )}
    </div>
  );
}

// ── Alerts & Reorder Tab ─────────────────────────────────────────────

function AlertsTab() {
  const [alerts, setAlerts] = useState<AlertData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch("/api/inventory/alerts")
      .then((r) => r.json())
      .then((data) => setAlerts(data))
      .catch(() => setAlerts(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
      </div>
    );
  }

  const outOfStock = alerts?.out_of_stock || [];
  const lowStock = alerts?.low_stock || [];

  if (outOfStock.length === 0 && lowStock.length === 0) {
    return (
      <div className="text-center py-20">
        <div className="text-4xl mb-3 text-gray-700">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="w-12 h-12 mx-auto text-emerald-600"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
              clipRule="evenodd"
            />
          </svg>
        </div>
        <p className="text-gray-500 text-sm font-bold uppercase tracking-wider">
          All stock levels healthy
        </p>
        <p className="text-gray-600 text-xs mt-1">
          No items need reordering at this time
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Out of Stock */}
      {outOfStock.length > 0 && (
        <div>
          <h3 className="text-sm font-bold uppercase tracking-wider text-red-400 mb-3 flex items-center gap-2">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="w-4 h-4"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
            Out of Stock
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {outOfStock.map((p) => (
              <div
                key={p.id}
                className="rounded-xl border border-red-800/50 bg-red-950/30 p-4 space-y-2"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-sm font-bold text-gray-100">
                      {p.name}
                    </div>
                    <div className="text-[10px] text-gray-500 font-mono">
                      {p.part_number}
                    </div>
                  </div>
                  <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-red-900/60 text-red-300">
                    Out of Stock
                  </span>
                </div>
                <div className="flex items-center gap-4 text-xs">
                  <span className="text-gray-500">
                    Reorder Pt:{" "}
                    <span className="text-gray-300 font-mono">
                      {p.reorder_point}
                    </span>
                  </span>
                  <span className="text-gray-500">
                    Suggested Order:{" "}
                    <span className="text-gray-300 font-mono">
                      {p.reorder_quantity}
                    </span>
                  </span>
                </div>
                {p.supplier && (
                  <div className="text-[10px] text-gray-600">
                    Supplier: {p.supplier}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Low Stock */}
      {lowStock.length > 0 && (
        <div>
          <h3 className="text-sm font-bold uppercase tracking-wider text-amber-400 mb-3 flex items-center gap-2">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="w-4 h-4"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
            Low Stock — Reorder Suggested
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {lowStock.map((p) => (
              <div
                key={p.id}
                className="rounded-xl border border-amber-800/50 bg-amber-950/30 p-4 space-y-2"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-sm font-bold text-gray-100">
                      {p.name}
                    </div>
                    <div className="text-[10px] text-gray-500 font-mono">
                      {p.part_number}
                    </div>
                  </div>
                  <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-900/60 text-amber-300">
                    Low Stock
                  </span>
                </div>
                <div className="flex items-center gap-4 text-xs">
                  <span className="text-gray-500">
                    Current:{" "}
                    <span className="text-amber-400 font-mono font-bold">
                      {p.quantity_on_hand}
                    </span>
                  </span>
                  <span className="text-gray-500">
                    Reorder Pt:{" "}
                    <span className="text-gray-300 font-mono">
                      {p.reorder_point}
                    </span>
                  </span>
                  <span className="text-gray-500">
                    Suggested Order:{" "}
                    <span className="text-gray-300 font-mono">
                      {p.reorder_quantity}
                    </span>
                  </span>
                </div>
                {p.supplier && (
                  <div className="text-[10px] text-gray-600">
                    Supplier: {p.supplier}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────

type Tab = "catalog" | "usage" | "alerts";

export default function InventoryPage() {
  const [tab, setTab] = useState<Tab>("catalog");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<PartCategory | "all">(
    "all"
  );
  const [statusFilter, setStatusFilter] = useState<PartStatus | "all">("all");
  const [locationFilter, setLocationFilter] = useState<StockLocation | "all">(
    "all"
  );

  // Fetch parts for the usage modal dropdown
  const [allParts, setAllParts] = useState<Part[]>([]);
  useEffect(() => {
    fetch("/api/inventory")
      .then((r) => r.json())
      .then((data) => setAllParts(Array.isArray(data) ? data : []))
      .catch(() => setAllParts([]));
  }, []);

  // Alert banner data
  const [alertData, setAlertData] = useState<AlertData | null>(null);
  useEffect(() => {
    fetch("/api/inventory/alerts")
      .then((r) => r.json())
      .then((data) => setAlertData(data))
      .catch(() => setAlertData(null));
  }, []);

  const lowCount = alertData?.low_stock?.length || 0;
  const outCount = alertData?.out_of_stock?.length || 0;

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <AppNav pageTitle="Inventory" />

      <main className="px-4 sm:px-6 py-6 max-w-6xl mx-auto">
        {/* Alert Banner */}
        {(lowCount > 0 || outCount > 0) && (
          <div className="mb-6 flex items-center gap-3 px-4 py-3 rounded-xl border border-amber-800/50 bg-amber-950/30">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="w-5 h-5 text-amber-400 flex-shrink-0"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
            <span className="text-sm text-amber-200">
              {lowCount > 0 && (
                <span className="font-bold">{lowCount} items low stock</span>
              )}
              {lowCount > 0 && outCount > 0 && ", "}
              {outCount > 0 && (
                <span className="font-bold text-red-300">
                  {outCount} items out of stock
                </span>
              )}
            </span>
            <button
              onClick={() => setTab("alerts")}
              className="ml-auto text-xs text-amber-400 hover:text-amber-200 font-bold uppercase tracking-wider transition-colors"
            >
              View Alerts
            </button>
          </div>
        )}

        {/* Search & Filters */}
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <div className="flex-1 min-w-[200px] relative">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-600"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z"
                clipRule="evenodd"
              />
            </svg>
            <input
              type="text"
              placeholder="Search by name or part number..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-gray-600"
            />
          </div>
          <select
            value={categoryFilter}
            onChange={(e) =>
              setCategoryFilter(e.target.value as PartCategory | "all")
            }
            className="px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white focus:outline-none focus:border-gray-600"
          >
            <option value="all">All Categories</option>
            {ALL_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {PART_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as PartStatus | "all")
            }
            className="px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white focus:outline-none focus:border-gray-600"
          >
            <option value="all">All Statuses</option>
            <option value="in_stock">In Stock</option>
            <option value="low_stock">Low Stock</option>
            <option value="out_of_stock">Out of Stock</option>
          </select>
          <select
            value={locationFilter}
            onChange={(e) =>
              setLocationFilter(e.target.value as StockLocation | "all")
            }
            className="px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white focus:outline-none focus:border-gray-600"
          >
            <option value="all">All Locations</option>
            {ALL_LOCATIONS.map((l) => (
              <option key={l} value={l}>
                {STOCK_LOCATION_LABELS[l]}
              </option>
            ))}
          </select>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center gap-1 mb-6 bg-gray-900 rounded-xl p-1 w-fit">
          <button
            onClick={() => setTab("catalog")}
            className={`px-5 py-2 rounded-lg text-sm font-bold uppercase tracking-wider transition-colors ${
              tab === "catalog"
                ? "bg-gray-800 text-white"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            Parts Catalog
          </button>
          <button
            onClick={() => setTab("usage")}
            className={`px-5 py-2 rounded-lg text-sm font-bold uppercase tracking-wider transition-colors ${
              tab === "usage"
                ? "bg-gray-800 text-white"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            Usage Log
          </button>
          <button
            onClick={() => setTab("alerts")}
            className={`px-5 py-2 rounded-lg text-sm font-bold uppercase tracking-wider transition-colors flex items-center gap-2 ${
              tab === "alerts"
                ? "bg-gray-800 text-white"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            Alerts & Reorder
            {(lowCount > 0 || outCount > 0) && (
              <span className="inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            )}
          </button>
        </div>

        {/* Tab Content */}
        {tab === "catalog" && (
          <PartsCatalogTab
            search={search}
            categoryFilter={categoryFilter}
            statusFilter={statusFilter}
            locationFilter={locationFilter}
          />
        )}
        {tab === "usage" && <UsageLogTab parts={allParts} />}
        {tab === "alerts" && <AlertsTab />}
      </main>
    </div>
  );
}
