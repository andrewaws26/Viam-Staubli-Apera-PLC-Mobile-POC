"use client";

import { useState, useEffect } from "react";
import AppNav from "@/components/AppNav";
import { generateInvoicePDF } from "@/lib/invoice-pdf";

interface Customer { id: string; company_name: string; payment_terms: string }
interface InvoiceRow {
  id: string;
  invoice_number: number;
  customer_id: string;
  customers?: { company_name: string };
  invoice_date: string;
  due_date: string;
  status: string;
  subtotal: number;
  total: number;
  amount_paid: number;
  balance_due: number;
}

interface LineItem { description: string; quantity: number; unit_price: number }

const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  draft:   { bg: "bg-gray-800", text: "text-gray-300" },
  sent:    { bg: "bg-blue-900/50", text: "text-blue-300" },
  partial: { bg: "bg-amber-900/50", text: "text-amber-300" },
  paid:    { bg: "bg-green-900/50", text: "text-green-300" },
  overdue: { bg: "bg-red-900/50", text: "text-red-300" },
  voided:  { bg: "bg-gray-800", text: "text-gray-500" },
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

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showPayment, setShowPayment] = useState<string | null>(null);

  // Create form
  const [customerId, setCustomerId] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split("T")[0]);
  const [dueDate, setDueDate] = useState(addDays(new Date().toISOString().split("T")[0], 30));
  const [lines, setLines] = useState<LineItem[]>([{ description: "", quantity: 1, unit_price: 0 }]);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // Payment form
  const [payAmount, setPayAmount] = useState("");
  const [payDate, setPayDate] = useState(new Date().toISOString().split("T")[0]);
  const [payMethod, setPayMethod] = useState("check");
  const [payRef, setPayRef] = useState("");

  async function loadData() {
    setLoading(true);
    try {
      const [invRes, custRes] = await Promise.all([
        fetch("/api/accounting/invoices"),
        fetch("/api/accounting/customers?active_only=true"),
      ]);
      if (invRes.ok) setInvoices(await invRes.json());
      if (custRes.ok) setCustomers(await custRes.json());
    } catch { /* ignore */ }
    setLoading(false);
  }

  useEffect(() => { loadData(); }, []);

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
      const res = await fetch("/api/accounting/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customer_id: customerId, invoice_date: invoiceDate, due_date: dueDate, notes, lines }),
      });
      if (res.ok) {
        setShowCreate(false);
        setLines([{ description: "", quantity: 1, unit_price: 0 }]);
        setNotes("");
        loadData();
      }
    } catch { /* ignore */ }
    setSaving(false);
  }

  async function handleAction(id: string, action: string) {
    try {
      const res = await fetch("/api/accounting/invoices", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      if (res.ok) loadData();
    } catch { /* ignore */ }
  }

  async function handlePayment(invoiceId: string) {
    if (!payAmount) return;
    setSaving(true);
    try {
      const res = await fetch("/api/accounting/invoices", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: invoiceId,
          action: "payment",
          amount: Number(payAmount),
          payment_date: payDate,
          payment_method: payMethod,
          reference: payRef || undefined,
        }),
      });
      if (res.ok) {
        setShowPayment(null);
        setPayAmount(""); setPayRef("");
        loadData();
      }
    } catch { /* ignore */ }
    setSaving(false);
  }

  // Summary stats
  const totalOutstanding = invoices
    .filter((i) => ["sent", "partial", "overdue"].includes(i.status))
    .reduce((s, i) => s + Number(i.balance_due), 0);
  const totalOverdue = invoices
    .filter((i) => i.status === "overdue" || (["sent", "partial"].includes(i.status) && i.due_date < new Date().toISOString().split("T")[0]))
    .reduce((s, i) => s + Number(i.balance_due), 0);

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <AppNav pageTitle="Invoices (AR)" />

      <main className="px-4 sm:px-6 py-6 max-w-6xl mx-auto">
        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <div className="p-4 rounded-xl bg-gray-900/50 border border-gray-800">
            <div className="text-[10px] text-gray-600 uppercase tracking-wider mb-1">Total Invoices</div>
            <div className="text-xl font-bold text-gray-100">{invoices.length}</div>
          </div>
          <div className="p-4 rounded-xl bg-gray-900/50 border border-gray-800">
            <div className="text-[10px] text-gray-600 uppercase tracking-wider mb-1">Outstanding</div>
            <div className="text-xl font-bold text-blue-400">{fmtCurrency(totalOutstanding)}</div>
          </div>
          <div className="p-4 rounded-xl bg-gray-900/50 border border-gray-800">
            <div className="text-[10px] text-gray-600 uppercase tracking-wider mb-1">Overdue</div>
            <div className="text-xl font-bold text-red-400">{fmtCurrency(totalOverdue)}</div>
          </div>
          <div className="p-4 rounded-xl bg-gray-900/50 border border-gray-800">
            <div className="text-[10px] text-gray-600 uppercase tracking-wider mb-1">Paid (All Time)</div>
            <div className="text-xl font-bold text-green-400">
              {fmtCurrency(invoices.filter((i) => i.status === "paid").reduce((s, i) => s + Number(i.total), 0))}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 mb-6">
          <button onClick={() => setShowCreate(!showCreate)}
            className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold uppercase tracking-wider">
            + New Invoice
          </button>
        </div>

        {/* Create form */}
        {showCreate && (
          <div className="mb-6 p-6 rounded-xl bg-gray-900/50 border border-gray-800 space-y-4">
            <h3 className="text-sm font-bold uppercase tracking-wider text-gray-300">New Invoice</h3>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-[10px] text-gray-600 uppercase tracking-wider mb-1">Customer *</label>
                <select value={customerId} onChange={(e) => {
                  setCustomerId(e.target.value);
                  const cust = customers.find((c) => c.id === e.target.value);
                  if (cust) {
                    const days = parseInt(cust.payment_terms.replace(/\D/g, "")) || 30;
                    setDueDate(addDays(invoiceDate, days));
                  }
                }}
                  className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white">
                  <option value="">Select customer...</option>
                  {customers.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] text-gray-600 uppercase tracking-wider mb-1">Invoice Date</label>
                <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white [color-scheme:dark]" />
              </div>
              <div>
                <label className="block text-[10px] text-gray-600 uppercase tracking-wider mb-1">Due Date</label>
                <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white [color-scheme:dark]" />
              </div>
            </div>

            {/* Line items */}
            <div>
              <label className="block text-[10px] text-gray-600 uppercase tracking-wider mb-2">Line Items</label>
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
              <label className="block text-[10px] text-gray-600 uppercase tracking-wider mb-1">Notes</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
                className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white" />
            </div>

            <div className="flex gap-2">
              <button onClick={handleCreate} disabled={saving || !customerId || lines.every((l) => !l.description)}
                className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-bold uppercase tracking-wider">
                {saving ? "Creating..." : "Create Invoice"}
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

        {/* Invoice list */}
        {!loading && (
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden overflow-x-auto">
            <table className="w-full text-sm min-w-[800px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-gray-600 border-b border-gray-800">
                  <th className="text-left px-4 py-3 font-medium w-20">#</th>
                  <th className="text-left px-4 py-3 font-medium">Customer</th>
                  <th className="text-left px-4 py-3 font-medium w-24">Date</th>
                  <th className="text-left px-4 py-3 font-medium w-24">Due</th>
                  <th className="text-left px-4 py-3 font-medium w-24">Status</th>
                  <th className="text-right px-4 py-3 font-medium w-28">Total</th>
                  <th className="text-right px-4 py-3 font-medium w-28">Balance</th>
                  <th className="text-right px-4 py-3 font-medium w-36">Actions</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => {
                  const style = STATUS_STYLES[inv.status] || STATUS_STYLES.draft;
                  return (
                    <tr key={inv.id} className="border-t border-gray-800/50 hover:bg-gray-800/20 transition-colors">
                      <td className="px-4 py-3 font-mono text-gray-400">{inv.invoice_number}</td>
                      <td className="px-4 py-3 text-gray-200">{inv.customers?.company_name || "—"}</td>
                      <td className="px-4 py-3 text-gray-400 text-xs">{fmtDate(inv.invoice_date)}</td>
                      <td className="px-4 py-3 text-gray-400 text-xs">{fmtDate(inv.due_date)}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${style.bg} ${style.text}`}>
                          {inv.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-gray-300">{fmtCurrency(Number(inv.total))}</td>
                      <td className="px-4 py-3 text-right font-mono text-gray-300">
                        {Number(inv.balance_due) > 0 ? fmtCurrency(Number(inv.balance_due)) : "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex gap-2 justify-end">
                          {inv.status === "draft" && (
                            <button onClick={() => handleAction(inv.id, "send")}
                              className="text-xs text-blue-400 hover:text-blue-300 font-bold uppercase">Send</button>
                          )}
                          {["sent", "partial", "overdue"].includes(inv.status) && (
                            <button onClick={() => { setShowPayment(inv.id); setPayAmount(String(inv.balance_due)); }}
                              className="text-xs text-green-400 hover:text-green-300 font-bold uppercase">Pay</button>
                          )}
                          {inv.status !== "voided" && inv.status !== "paid" && (
                            <button onClick={() => handleAction(inv.id, "void")}
                              className="text-xs text-red-400 hover:text-red-300 font-bold uppercase">Void</button>
                          )}
                          {inv.status !== "draft" && (
                            <button onClick={() => generateInvoicePDF(inv.id)}
                              className="text-xs text-purple-400 hover:text-purple-300 font-bold uppercase">PDF</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {invoices.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-gray-600">
                      No invoices yet. Create your first invoice above.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Payment modal */}
        {showPayment && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-900 rounded-xl border border-gray-700 p-6 w-full max-w-md space-y-4">
              <h3 className="text-sm font-bold uppercase tracking-wider text-gray-300">Record Payment</h3>
              <div>
                <label className="block text-[10px] text-gray-600 uppercase tracking-wider mb-1">Amount</label>
                <input type="number" step="0.01" value={payAmount} onChange={(e) => setPayAmount(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-white" />
              </div>
              <div>
                <label className="block text-[10px] text-gray-600 uppercase tracking-wider mb-1">Date</label>
                <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-white [color-scheme:dark]" />
              </div>
              <div>
                <label className="block text-[10px] text-gray-600 uppercase tracking-wider mb-1">Method</label>
                <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-white">
                  <option value="check">Check</option>
                  <option value="ach">ACH</option>
                  <option value="wire">Wire</option>
                  <option value="cash">Cash</option>
                  <option value="credit_card">Credit Card</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] text-gray-600 uppercase tracking-wider mb-1">Reference / Check #</label>
                <input value={payRef} onChange={(e) => setPayRef(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-white" />
              </div>
              <div className="flex gap-2">
                <button onClick={() => handlePayment(showPayment)} disabled={saving || !payAmount}
                  className="px-5 py-2 rounded-lg bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-sm font-bold uppercase tracking-wider">
                  {saving ? "Recording..." : "Record Payment"}
                </button>
                <button onClick={() => setShowPayment(null)}
                  className="px-4 py-2 rounded-lg border border-gray-700 text-gray-400 text-sm font-bold uppercase tracking-wider">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
