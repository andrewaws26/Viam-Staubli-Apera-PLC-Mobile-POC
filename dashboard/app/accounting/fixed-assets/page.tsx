"use client";

import { useState, useEffect, useCallback } from "react";

interface FixedAsset {
  id: string;
  name: string;
  description: string | null;
  asset_tag: string | null;
  category: string;
  purchase_date: string;
  in_service_date: string;
  purchase_cost: number;
  salvage_value: number;
  useful_life_months: number;
  depreciation_method: string;
  accumulated_depreciation: number;
  book_value: number;
  status: string;
  disposal_date: string | null;
  disposal_amount: number | null;
  disposal_method: string | null;
  gain_loss: number | null;
  linked_truck_id: string | null;
  created_by_name: string | null;
  created_at: string;
  depreciation_entries?: { count: number }[];
}

interface DepreciationEntry {
  id: string;
  period_date: string;
  depreciation_amount: number;
  accumulated_total: number;
  book_value_after: number;
  journal_entry_id: string | null;
}

interface AssetDetail extends Omit<FixedAsset, 'depreciation_entries'> {
  depreciation_entries: DepreciationEntry[];
}

interface SummaryStats {
  total_assets: number;
  total_cost: number;
  total_book_value: number;
  total_accumulated_depr: number;
  by_category: Record<string, number>;
  by_status: Record<string, number>;
}

function fmt(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

const CATEGORIES = ["vehicle", "equipment", "building", "land", "furniture", "computer", "other"];
const METHODS = [
  { value: "straight_line", label: "Straight-Line" },
  { value: "declining_balance", label: "Double Declining Balance" },
  { value: "sum_of_years", label: "Sum-of-Years Digits" },
];

const STATUS_COLORS: Record<string, string> = {
  active: "bg-emerald-900/40 text-emerald-400",
  fully_depreciated: "bg-amber-900/40 text-amber-400",
  disposed: "bg-red-900/40 text-red-400",
  written_off: "bg-gray-800 text-gray-500",
};

export default function FixedAssetsPage() {
  const [assets, setAssets] = useState<FixedAsset[]>([]);
  const [summary, setSummary] = useState<SummaryStats | null>(null);
  const [selectedAsset, setSelectedAsset] = useState<AssetDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showDepreciate, setShowDepreciate] = useState(false);
  const [showDispose, setShowDispose] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  // Create form
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formAssetTag, setFormAssetTag] = useState("");
  const [formCategory, setFormCategory] = useState("vehicle");
  const [formPurchaseDate, setFormPurchaseDate] = useState("");
  const [formInServiceDate, setFormInServiceDate] = useState("");
  const [formPurchaseCost, setFormPurchaseCost] = useState("");
  const [formSalvageValue, setFormSalvageValue] = useState("0");
  const [formUsefulLifeMonths, setFormUsefulLifeMonths] = useState("60");
  const [formMethod, setFormMethod] = useState("straight_line");
  const [formTruckId, setFormTruckId] = useState("");

  // Depreciate form
  const [deprPeriod, setDeprPeriod] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  });

  // Dispose form
  const [disposeDate, setDisposeDate] = useState(new Date().toISOString().split("T")[0]);
  const [disposeAmount, setDisposeAmount] = useState("");
  const [disposeMethod, setDisposeMethod] = useState("sold");

  const loadAssets = useCallback(async () => {
    try {
      const res = await fetch("/api/accounting/fixed-assets");
      if (res.ok) setAssets(await res.json());
    } catch { /* ignore */ }
  }, []);

  const loadSummary = useCallback(async () => {
    try {
      const res = await fetch("/api/accounting/fixed-assets?summary=true");
      if (res.ok) setSummary(await res.json());
    } catch { /* ignore */ }
  }, []);

  const loadAssetDetail = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/accounting/fixed-assets?id=${id}`);
      if (res.ok) setSelectedAsset(await res.json());
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    Promise.all([loadAssets(), loadSummary()]).then(() => setLoading(false));
  }, [loadAssets, loadSummary]);

  function resetCreateForm() {
    setFormName(""); setFormDescription(""); setFormAssetTag("");
    setFormCategory("vehicle"); setFormPurchaseDate(""); setFormInServiceDate("");
    setFormPurchaseCost(""); setFormSalvageValue("0"); setFormUsefulLifeMonths("60");
    setFormMethod("straight_line"); setFormTruckId("");
  }

  async function handleCreate() {
    if (!formName || !formPurchaseDate || !formInServiceDate || !formPurchaseCost) return;
    setSaving(true);
    setMessage("");
    try {
      const res = await fetch("/api/accounting/fixed-assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          name: formName,
          description: formDescription || undefined,
          asset_tag: formAssetTag || undefined,
          category: formCategory,
          purchase_date: formPurchaseDate,
          in_service_date: formInServiceDate,
          purchase_cost: parseFloat(formPurchaseCost),
          salvage_value: parseFloat(formSalvageValue) || 0,
          useful_life_months: parseInt(formUsefulLifeMonths) || 60,
          depreciation_method: formMethod,
          linked_truck_id: formTruckId || undefined,
        }),
      });
      if (res.ok) {
        setMessage("Asset created.");
        resetCreateForm();
        setShowCreate(false);
        loadAssets();
        loadSummary();
      } else {
        const err = await res.json();
        setMessage(err.error || "Failed to create asset.");
      }
    } catch { setMessage("Failed to create asset."); }
    setSaving(false);
  }

  async function handleDepreciate() {
    setSaving(true);
    setMessage("");
    try {
      const res = await fetch("/api/accounting/fixed-assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "depreciate", period_date: deprPeriod }),
      });
      const result = await res.json();
      if (res.ok) {
        setMessage(`Depreciated ${result.processed} assets for ${fmt(result.total_depreciation)}.`);
        setShowDepreciate(false);
        loadAssets();
        loadSummary();
        if (selectedAsset) loadAssetDetail(selectedAsset.id);
      } else {
        setMessage(result.error || "Failed to run depreciation.");
      }
    } catch { setMessage("Failed to run depreciation."); }
    setSaving(false);
  }

  async function handleDispose() {
    if (!selectedAsset || !disposeDate || !disposeMethod) return;
    setSaving(true);
    setMessage("");
    try {
      const res = await fetch("/api/accounting/fixed-assets", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: selectedAsset.id,
          action: "dispose",
          disposal_date: disposeDate,
          disposal_amount: parseFloat(disposeAmount) || 0,
          disposal_method: disposeMethod,
        }),
      });
      if (res.ok) {
        setMessage("Asset disposed.");
        setShowDispose(false);
        loadAssets();
        loadSummary();
        loadAssetDetail(selectedAsset.id);
      } else {
        const err = await res.json();
        setMessage(err.error || "Failed to dispose asset.");
      }
    } catch { setMessage("Failed to dispose asset."); }
    setSaving(false);
  }

  const depreciationCount = (a: FixedAsset) => {
    const entries = a.depreciation_entries as { count: number }[] | undefined;
    return entries?.[0]?.count ?? 0;
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white">

      <main className="px-4 sm:px-6 py-6 max-w-7xl mx-auto">
        {/* Summary Cards */}
        {summary && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            {[
              { label: "Total Assets", value: summary.total_assets, color: "text-gray-200" },
              { label: "Total Cost", value: fmt(summary.total_cost), color: "text-blue-400" },
              { label: "Book Value", value: fmt(summary.total_book_value), color: "text-emerald-400" },
              { label: "Accum. Depreciation", value: fmt(summary.total_accumulated_depr), color: "text-amber-400" },
            ].map((c) => (
              <div key={c.label} className="rounded-xl bg-gray-900/50 border border-gray-800 p-4">
                <p className="text-xs uppercase tracking-wider text-gray-600 font-medium">{c.label}</p>
                <p className={`text-xl font-black mt-1 ${c.color}`}>{c.value}</p>
              </div>
            ))}
          </div>
        )}

        {/* Action Bar */}
        <div className="flex flex-wrap gap-3 mb-6">
          <button onClick={() => { setShowCreate(!showCreate); setShowDepreciate(false); }}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold uppercase tracking-wider">
            Add Asset
          </button>
          <button onClick={() => { setShowDepreciate(!showDepreciate); setShowCreate(false); }}
            className="px-4 py-2 rounded-lg border border-gray-700 hover:border-gray-500 text-gray-400 text-sm font-bold uppercase tracking-wider">
            Run Depreciation
          </button>
          {selectedAsset && selectedAsset.status === "active" && (
            <button onClick={() => setShowDispose(!showDispose)}
              className="px-4 py-2 rounded-lg border border-red-800 hover:border-red-600 text-red-400 text-sm font-bold uppercase tracking-wider">
              Dispose Asset
            </button>
          )}
        </div>

        {message && (
          <div className="mb-4 px-4 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-gray-300">
            {message}
          </div>
        )}

        {/* Create Asset Form */}
        {showCreate && (
          <div className="mb-6 p-5 rounded-xl bg-gray-900/50 border border-gray-800 space-y-4">
            <h3 className="text-sm font-bold uppercase tracking-wider text-gray-300">New Fixed Asset</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs text-gray-600 uppercase tracking-wider mb-1">Name *</label>
                <input type="text" value={formName} onChange={(e) => setFormName(e.target.value)}
                  placeholder="2019 Mack Granite GU713"
                  className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white" />
              </div>
              <div>
                <label className="block text-xs text-gray-600 uppercase tracking-wider mb-1">Asset Tag</label>
                <input type="text" value={formAssetTag} onChange={(e) => setFormAssetTag(e.target.value)}
                  placeholder="FA-001"
                  className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white" />
              </div>
              <div>
                <label className="block text-xs text-gray-600 uppercase tracking-wider mb-1">Category *</label>
                <select value={formCategory} onChange={(e) => setFormCategory(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white">
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-600 uppercase tracking-wider mb-1">Purchase Date *</label>
                <input type="date" value={formPurchaseDate} onChange={(e) => setFormPurchaseDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white [color-scheme:dark]" />
              </div>
              <div>
                <label className="block text-xs text-gray-600 uppercase tracking-wider mb-1">In-Service Date *</label>
                <input type="date" value={formInServiceDate} onChange={(e) => setFormInServiceDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white [color-scheme:dark]" />
              </div>
              <div>
                <label className="block text-xs text-gray-600 uppercase tracking-wider mb-1">Purchase Cost *</label>
                <input type="number" value={formPurchaseCost} onChange={(e) => setFormPurchaseCost(e.target.value)}
                  step="0.01" placeholder="85000.00"
                  className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white" />
              </div>
              <div>
                <label className="block text-xs text-gray-600 uppercase tracking-wider mb-1">Salvage Value</label>
                <input type="number" value={formSalvageValue} onChange={(e) => setFormSalvageValue(e.target.value)}
                  step="0.01" placeholder="5000.00"
                  className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white" />
              </div>
              <div>
                <label className="block text-xs text-gray-600 uppercase tracking-wider mb-1">Useful Life (months)</label>
                <input type="number" value={formUsefulLifeMonths} onChange={(e) => setFormUsefulLifeMonths(e.target.value)}
                  placeholder="60"
                  className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white" />
              </div>
              <div>
                <label className="block text-xs text-gray-600 uppercase tracking-wider mb-1">Depreciation Method</label>
                <select value={formMethod} onChange={(e) => setFormMethod(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white">
                  {METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-600 uppercase tracking-wider mb-1">Linked Truck ID</label>
                <input type="text" value={formTruckId} onChange={(e) => setFormTruckId(e.target.value)}
                  placeholder="Optional"
                  className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white" />
              </div>
              <div className="sm:col-span-2 lg:col-span-3">
                <label className="block text-xs text-gray-600 uppercase tracking-wider mb-1">Description</label>
                <input type="text" value={formDescription} onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="Optional description"
                  className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white" />
              </div>
            </div>
            <button onClick={handleCreate} disabled={saving || !formName || !formPurchaseDate || !formInServiceDate || !formPurchaseCost}
              className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-bold uppercase tracking-wider">
              {saving ? "Creating..." : "Create Asset"}
            </button>
          </div>
        )}

        {/* Run Depreciation Form */}
        {showDepreciate && (
          <div className="mb-6 p-5 rounded-xl bg-gray-900/50 border border-gray-800 space-y-4">
            <h3 className="text-sm font-bold uppercase tracking-wider text-gray-300">Run Monthly Depreciation</h3>
            <p className="text-xs text-gray-500">
              Calculates depreciation for all active assets and creates a single journal entry.
            </p>
            <div className="flex items-end gap-4">
              <div>
                <label className="block text-xs text-gray-600 uppercase tracking-wider mb-1">Period (1st of Month)</label>
                <input type="date" value={deprPeriod} onChange={(e) => setDeprPeriod(e.target.value)}
                  className="px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white [color-scheme:dark]" />
              </div>
              <button onClick={handleDepreciate} disabled={saving}
                className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-bold uppercase tracking-wider">
                {saving ? "Running..." : "Run Depreciation"}
              </button>
            </div>
          </div>
        )}

        {/* Dispose Asset Form */}
        {showDispose && selectedAsset && (
          <div className="mb-6 p-5 rounded-xl bg-gray-900/50 border border-red-900/30 space-y-4">
            <h3 className="text-sm font-bold uppercase tracking-wider text-red-400">
              Dispose: {selectedAsset.name}
            </h3>
            <p className="text-xs text-gray-500">
              Book value: {fmt(Number(selectedAsset.book_value))}. Creates a disposal journal entry.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs text-gray-600 uppercase tracking-wider mb-1">Disposal Date</label>
                <input type="date" value={disposeDate} onChange={(e) => setDisposeDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white [color-scheme:dark]" />
              </div>
              <div>
                <label className="block text-xs text-gray-600 uppercase tracking-wider mb-1">Amount Received</label>
                <input type="number" value={disposeAmount} onChange={(e) => setDisposeAmount(e.target.value)}
                  step="0.01" placeholder="0.00"
                  className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white" />
              </div>
              <div>
                <label className="block text-xs text-gray-600 uppercase tracking-wider mb-1">Disposal Method</label>
                <select value={disposeMethod} onChange={(e) => setDisposeMethod(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white">
                  {["sold", "scrapped", "traded", "donated"].map((m) => (
                    <option key={m} value={m}>{m.charAt(0).toUpperCase() + m.slice(1)}</option>
                  ))}
                </select>
              </div>
            </div>
            <button onClick={handleDispose} disabled={saving}
              className="px-5 py-2 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-sm font-bold uppercase tracking-wider">
              {saving ? "Processing..." : "Confirm Disposal"}
            </button>
          </div>
        )}

        {/* Asset Detail Panel */}
        {selectedAsset && (
          <div className="mb-6 p-5 rounded-xl bg-gray-900/50 border border-gray-800 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold uppercase tracking-wider text-gray-300">
                {selectedAsset.name}
                {selectedAsset.asset_tag && <span className="ml-2 text-gray-600 font-mono text-xs">({selectedAsset.asset_tag})</span>}
              </h3>
              <button onClick={() => setSelectedAsset(null)} className="text-gray-600 hover:text-gray-400 text-sm">Close</button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div><span className="text-gray-600 text-xs uppercase">Category</span><p className="text-gray-300 capitalize">{selectedAsset.category}</p></div>
              <div><span className="text-gray-600 text-xs uppercase">Status</span><p><span className={`px-2 py-0.5 rounded text-xs font-bold uppercase ${STATUS_COLORS[selectedAsset.status] || ""}`}>{selectedAsset.status.replace("_", " ")}</span></p></div>
              <div><span className="text-gray-600 text-xs uppercase">Purchase Cost</span><p className="text-gray-300">{fmt(Number(selectedAsset.purchase_cost))}</p></div>
              <div><span className="text-gray-600 text-xs uppercase">Book Value</span><p className="text-emerald-400">{fmt(Number(selectedAsset.book_value))}</p></div>
              <div><span className="text-gray-600 text-xs uppercase">Salvage Value</span><p className="text-gray-300">{fmt(Number(selectedAsset.salvage_value))}</p></div>
              <div><span className="text-gray-600 text-xs uppercase">Accum. Depr.</span><p className="text-amber-400">{fmt(Number(selectedAsset.accumulated_depreciation))}</p></div>
              <div><span className="text-gray-600 text-xs uppercase">Method</span><p className="text-gray-300">{selectedAsset.depreciation_method.replace(/_/g, " ")}</p></div>
              <div><span className="text-gray-600 text-xs uppercase">Useful Life</span><p className="text-gray-300">{selectedAsset.useful_life_months} months</p></div>
            </div>

            {/* Depreciation Schedule */}
            {selectedAsset.depreciation_entries && selectedAsset.depreciation_entries.length > 0 && (
              <div>
                <h4 className="text-xs uppercase tracking-wider text-gray-600 font-medium mb-2 mt-2">Depreciation Schedule</h4>
                <div className="rounded-lg border border-gray-800 overflow-hidden overflow-x-auto">
                  <table className="w-full text-sm min-w-[500px]">
                    <thead>
                      <tr className="text-xs uppercase tracking-wider text-gray-600 border-b border-gray-800">
                        <th className="text-left px-4 py-2 font-medium">Period</th>
                        <th className="text-right px-4 py-2 font-medium">Depreciation</th>
                        <th className="text-right px-4 py-2 font-medium">Accum. Total</th>
                        <th className="text-right px-4 py-2 font-medium">Book Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedAsset.depreciation_entries.map((e) => (
                        <tr key={e.id} className="border-t border-gray-800/50 hover:bg-gray-800/20">
                          <td className="px-4 py-2 text-gray-400">{e.period_date}</td>
                          <td className="px-4 py-2 text-right text-red-400 font-mono">{fmt(Number(e.depreciation_amount))}</td>
                          <td className="px-4 py-2 text-right text-amber-400 font-mono">{fmt(Number(e.accumulated_total))}</td>
                          <td className="px-4 py-2 text-right text-emerald-400 font-mono">{fmt(Number(e.book_value_after))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Asset List */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
          </div>
        ) : (
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden overflow-x-auto">
            <table className="w-full text-sm min-w-[800px]">
              <thead>
                <tr className="text-xs uppercase tracking-wider text-gray-600 border-b border-gray-800">
                  <th className="text-left px-4 py-3 font-medium">Name</th>
                  <th className="text-left px-4 py-3 font-medium">Category</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                  <th className="text-right px-4 py-3 font-medium">Cost</th>
                  <th className="text-right px-4 py-3 font-medium">Book Value</th>
                  <th className="text-right px-4 py-3 font-medium">Accum. Depr.</th>
                  <th className="text-left px-4 py-3 font-medium">Method</th>
                  <th className="text-center px-4 py-3 font-medium">Entries</th>
                </tr>
              </thead>
              <tbody>
                {assets.map((a) => (
                  <tr key={a.id}
                    onClick={() => loadAssetDetail(a.id)}
                    className="border-t border-gray-800/50 hover:bg-gray-800/20 transition-colors cursor-pointer">
                    <td className="px-4 py-2">
                      <span className="text-gray-200">{a.name}</span>
                      {a.asset_tag && <span className="ml-2 text-gray-600 text-xs font-mono">{a.asset_tag}</span>}
                    </td>
                    <td className="px-4 py-2 text-gray-400 capitalize">{a.category}</td>
                    <td className="px-4 py-2">
                      <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase ${STATUS_COLORS[a.status] || ""}`}>
                        {a.status.replace("_", " ")}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-gray-300">{fmt(Number(a.purchase_cost))}</td>
                    <td className="px-4 py-2 text-right font-mono text-emerald-400">{fmt(Number(a.book_value))}</td>
                    <td className="px-4 py-2 text-right font-mono text-amber-400">{fmt(Number(a.accumulated_depreciation))}</td>
                    <td className="px-4 py-2 text-gray-400 text-xs">{a.depreciation_method.replace(/_/g, " ")}</td>
                    <td className="px-4 py-2 text-center text-gray-500">{depreciationCount(a)}</td>
                  </tr>
                ))}
                {assets.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-gray-600">
                      No fixed assets. Click &quot;Add Asset&quot; to register your first capital asset.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
