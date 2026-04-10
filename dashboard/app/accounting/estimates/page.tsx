"use client";

import { useState, useEffect } from "react";

interface Customer { id: string; company_name: string; payment_terms: string }
interface EstimateRow {
  id: string;
  estimate_number: number;
  customer_id: string;
  customers?: { company_name: string };
  estimate_date: string;
  expiry_date: string | null;
  status: string;
  subtotal: number;
  total: number;
  converted_invoice_id: string | null;
}

interface LineItem { description: string; quantity: number; unit_price: number }

const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  draft:     { bg: "bg-gray-800",        text: "text-gray-300" },
  sent:      { bg: "bg-blue-900/50",     text: "text-blue-300" },
  accepted:  { bg: "bg-emerald-900/50",  text: "text-emerald-300" },
  rejected:  { bg: "bg-red-900/50",      text: "text-red-300" },
  expired:   { bg: "bg-amber-900/50",    text: "text-amber-300" },
  converted: { bg: "bg-purple-900/50",   text: "text-purple-300" },
};

function fmtCurrency(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
}

function fmtDate(iso: string): string {
  return new Date(iso + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function addDays(date: string, days: number): string {
  const d = new Date(date + "T12:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

export default function EstimatesPage() {
  const [estimates, setEstimates] = useState<EstimateRow[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Create form state
  const [customerId, setCustomerId] = useState("");
  const [estimateDate, setEstimateDate] = useState(new Date().toISOString().split("T")[0]);
  const [expiryDate, setExpiryDate] = useState(addDays(new Date().toISOString().split("T")[0], 30));
  const [lines, setLines] = useState<LineItem[]>([{ description: "", quantity: 1, unit_price: 0 }]);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  async function loadData() {
    setLoading(true);
    try {
      const [estRes, custRes] = await Promise.all([
        fetch("/api/accounting/estimates"),
        fetch("/api/accounting/customers?active_only=true"),
      ]);
      if (estRes.ok) setEstimates(await estRes.json());
      if (custRes.ok) setCustomers(await custRes.json());
    } catch { /* ignore */ }
    setLoading(false);
  }

  useEffect(() => { loadData(); }, []);

  // Auto-dismiss success message
  useEffect(() => {
    if (successMsg) {
      const timer = setTimeout(() => setSuccessMsg(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [successMsg]);

  function updateLine(idx: number, field: keyof LineItem, value: string | number) {
    setLines((prev) => prev.map((l, i) => i === idx ? { ...l, [field]: value } : l));
  }

  function addLine() { setLines((p) => [...p, { description: "", quantity: 1, unit_price: 0 }]); }
  function removeLine(idx: number) { setLines((p) => p.filter((_, i) => i !== idx)); }

  const subtotal = lines.reduce((s, l) => s + l.quantity * l.unit_price, 0);

  async function handleCreate() {
    if (!customerId || lines.length === 0) return;
    setSaving(true);
    try {
      const res = await fetch("/api/accounting/estimates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_id: customerId,
          estimate_date: estimateDate,
          expiry_date: expiryDate,
          notes,
          lines,
        }),
      });
      if (res.ok) {
        setShowCreate(false);
        setCustomerId("");
        setLines([{ description: "", quantity: 1, unit_price: 0 }]);
        setNotes("");
        loadData();
      }
    } catch { /* ignore */ }
    setSaving(false);
  }

  async function handleAction(id: string, action: string) {
    try {
      const res = await fetch("/api/accounting/estimates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      if (res.ok) {
        const data = await res.json();
        if (action === "convert" && data.invoice) {
          setSuccessMsg(`Converted to Invoice #${data.invoice.invoice_number}`);
        }
        loadData();
      }
    } catch { /* ignore */ }
  }

  async function handleDelete(id: string, status: string) {
    const msg = status === "draft"
      ? "Delete this draft estimate?"
      : "Void this estimate?";
    if (!confirm(msg)) return;
    try {
      const res = await fetch("/api/accounting/estimates", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (res.ok) loadData();
    } catch { /* ignore */ }
  }

  // Summary stats
  const totalEstimates = estimates.length;
  const openCount = estimates.filter((e) => ["draft", "sent"].includes(e.status)).length;
  const acceptedCount = estimates.filter((e) => e.status === "accepted").length;
  const convertedCount = estimates.filter((e) => e.status === "converted").length;

  return (
    <div className="min-h-screen bg-gray-950 text-white">

      <main className="px-4 sm:px-6 py-6 max-w-6xl mx-auto">
        {/* Success banner */}
        {successMsg && (
          <div className="mb-4 p-3 rounded-lg bg-emerald-900/40 border border-emerald-700 text-emerald-300 text-sm font-medium flex items-center justify-between">
            <span>{successMsg}</span>
            <button onClick={() => setSuccessMsg(null)} className="text-emerald-400 hover:text-emerald-200 font-bold ml-4">X</button>
          </div>
        )}

        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <div className="p-4 rounded-xl bg-gray-900/50 border border-gray-800">
            <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Total Estimates</div>
            <div className="text-xl font-bold text-gray-100">{totalEstimates}</div>
          </div>
          <div className="p-4 rounded-xl bg-gray-900/50 border border-gray-800">
            <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Open (Draft + Sent)</div>
            <div className="text-xl font-bold text-blue-400">{openCount}</div>
          </div>
          <div className="p-4 rounded-xl bg-gray-900/50 border border-gray-800">
            <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Accepted</div>
            <div className="text-xl font-bold text-emerald-400">{acceptedCount}</div>
          </div>
          <div className="p-4 rounded-xl bg-gray-900/50 border border-gray-800">
            <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Converted to Invoice</div>
            <div className="text-xl font-bold text-purple-400">{convertedCount}</div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 mb-6">
          <button onClick={() => setShowCreate(!showCreate)}
            className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold uppercase tracking-wider">
            + New Estimate
          </button>
        </div>

        {/* Create form */}
        {showCreate && (
          <div className="mb-6 p-6 rounded-xl bg-gray-900/50 border border-gray-800 space-y-4">
            <h3 className="text-sm font-bold uppercase tracking-wider text-gray-300">New Estimate</h3>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">Customer *</label>
                <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white">
                  <option value="">Select customer...</option>
                  {customers.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">Estimate Date</label>
                <input type="date" value={estimateDate} onChange={(e) => setEstimateDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white [color-scheme:dark]" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">Expiry Date</label>
                <input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white [color-scheme:dark]" />
              </div>
            </div>

            {/* Line items */}
            <div>
              <label className="block text-xs text-gray-500 uppercase tracking-wider mb-2">Line Items</label>
              <div className="space-y-2">
                {lines.map((line, idx) => (
                  <div key={idx} className="flex gap-2 items-center">
                    <input placeholder="Description" value={line.description} onChange={(e) => updateLine(idx, "description", e.target.value)}
                      className="flex-1 px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white" />
                    <input type="number" placeholder="Qty" value={line.quantity} onChange={(e) => updateLine(idx, "quantity", Number(e.target.value))}
                      className="w-20 px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white text-right" />
                    <input type="number" placeholder="Price" value={line.unit_price || ""} onChange={(e) => updateLine(idx, "unit_price", Number(e.target.value))}
                      className="w-28 px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white text-right" step="0.01" />
                    <span className="w-28 text-right font-mono text-gray-400 text-sm">{fmtCurrency(line.quantity * line.unit_price)}</span>
                    {lines.length > 1 && (
                      <button onClick={() => removeLine(idx)} className="text-red-500 hover:text-red-400 text-xs font-bold">X</button>
                    )}
                  </div>
                ))}
              </div>
              <button onClick={addLine} className="mt-2 text-xs text-teal-400 hover:text-teal-300 font-bold uppercase">
                + Add Line
              </button>
            </div>

            {/* Subtotal */}
            <div className="flex justify-end">
              <div className="text-right">
                <span className="text-xs text-gray-500 uppercase mr-4">Total:</span>
                <span className="font-mono text-lg font-bold text-white">{fmtCurrency(subtotal)}</span>
              </div>
            </div>

            <div>
              <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">Notes</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
                className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white" />
            </div>

            <div className="flex gap-2">
              <button onClick={handleCreate} disabled={saving || !customerId || lines.every((l) => !l.description)}
                className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-bold uppercase tracking-wider">
                {saving ? "Creating..." : "Create Estimate"}
              </button>
              <button onClick={() => setShowCreate(false)}
                className="px-4 py-2 rounded-lg border border-gray-700 text-gray-400 text-sm font-bold uppercase tracking-wider">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
          </div>
        )}

        {/* Estimate list */}
        {!loading && (
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden overflow-x-auto">
            <table className="w-full text-sm min-w-[800px]">
              <thead>
                <tr className="text-xs uppercase tracking-wider text-gray-500 border-b border-gray-800">
                  <th className="text-left px-4 py-3 font-medium w-20">#</th>
                  <th className="text-left px-4 py-3 font-medium">Customer</th>
                  <th className="text-left px-4 py-3 font-medium w-24">Date</th>
                  <th className="text-left px-4 py-3 font-medium w-24">Expiry</th>
                  <th className="text-left px-4 py-3 font-medium w-24">Status</th>
                  <th className="text-right px-4 py-3 font-medium w-28">Total</th>
                  <th className="text-right px-4 py-3 font-medium w-44">Actions</th>
                </tr>
              </thead>
              <tbody>
                {estimates.map((est) => {
                  const style = STATUS_STYLES[est.status] || STATUS_STYLES.draft;
                  return (
                    <tr key={est.id} className="border-t border-gray-800/50 hover:bg-gray-800/20 transition-colors">
                      <td className="px-4 py-3 font-mono text-gray-400">{est.estimate_number}</td>
                      <td className="px-4 py-3 text-gray-200">{est.customers?.company_name || "\u2014"}</td>
                      <td className="px-4 py-3 text-gray-400 text-xs">{fmtDate(est.estimate_date)}</td>
                      <td className="px-4 py-3 text-gray-400 text-xs">{est.expiry_date ? fmtDate(est.expiry_date) : "\u2014"}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase ${style.bg} ${style.text}`}>
                          {est.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-gray-300">{fmtCurrency(Number(est.total))}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex gap-2 justify-end flex-wrap">
                          {est.status === "draft" && (
                            <button onClick={() => handleAction(est.id, "send")}
                              className="text-xs text-blue-400 hover:text-blue-300 font-bold uppercase">Send</button>
                          )}
                          {est.status === "sent" && (
                            <>
                              <button onClick={() => handleAction(est.id, "accept")}
                                className="text-xs text-emerald-400 hover:text-emerald-300 font-bold uppercase">Accept</button>
                              <button onClick={() => handleAction(est.id, "reject")}
                                className="text-xs text-red-400 hover:text-red-300 font-bold uppercase">Reject</button>
                              <button onClick={() => handleAction(est.id, "expire")}
                                className="text-xs text-amber-400 hover:text-amber-300 font-bold uppercase">Expire</button>
                            </>
                          )}
                          {est.status === "accepted" && (
                            <button onClick={() => handleAction(est.id, "convert")}
                              className="text-xs text-purple-400 hover:text-purple-300 font-bold uppercase">Convert to Invoice</button>
                          )}
                          {["draft", "sent"].includes(est.status) && (
                            <button onClick={() => handleDelete(est.id, est.status)}
                              className="text-xs text-red-400/60 hover:text-red-300 font-bold uppercase">
                              {est.status === "draft" ? "Del" : "Void"}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {estimates.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                      No estimates yet. Create your first estimate above.
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
