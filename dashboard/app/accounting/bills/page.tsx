"use client";

import { useState, useEffect, useCallback } from "react";

interface Vendor {
  id: string;
  company_name: string;
}

interface Bill {
  id: string;
  vendor_id: string;
  bill_number: string | null;
  bill_date: string;
  due_date: string;
  status: string;
  subtotal: number;
  tax_amount: number;
  total: number;
  amount_paid: number;
  balance_due: number;
  notes: string | null;
  journal_entry_id: string | null;
  created_by_name: string;
  created_at: string;
  vendors?: { company_name: string };
  bill_line_items?: { count: number }[];
}

interface Account {
  id: string;
  account_number: string;
  name: string;
  account_type: string;
}

interface LineItem {
  description: string;
  quantity: number;
  unit_price: number;
  account_id: string;
}

const PAYMENT_METHODS = ["check", "ach", "wire", "cash", "credit_card", "other"];
const STATUS_COLORS: Record<string, string> = {
  open: "bg-blue-900/50 text-blue-300",
  partial: "bg-amber-900/50 text-amber-300",
  paid: "bg-emerald-900/50 text-emerald-300",
  voided: "bg-red-900/50 text-red-300",
};

function fmt(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

export default function BillsPage() {
  const [bills, setBills] = useState<Bill[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [expenseAccounts, setExpenseAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showPayment, setShowPayment] = useState<string | null>(null);

  // Create form state
  const [formVendor, setFormVendor] = useState("");
  const [formBillNumber, setFormBillNumber] = useState("");
  const [formBillDate, setFormBillDate] = useState(new Date().toISOString().split("T")[0]);
  const [formDueDate, setFormDueDate] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [formLines, setFormLines] = useState<LineItem[]>([
    { description: "", quantity: 1, unit_price: 0, account_id: "" },
  ]);
  const [saving, setSaving] = useState(false);

  // Payment form state
  const [pmtDate, setPmtDate] = useState(new Date().toISOString().split("T")[0]);
  const [pmtAmount, setPmtAmount] = useState("");
  const [pmtMethod, setPmtMethod] = useState("check");
  const [pmtCheckNum, setPmtCheckNum] = useState("");
  const [pmtRef, setPmtRef] = useState("");
  const [pmtNotes, setPmtNotes] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [billsRes, vendorsRes, accountsRes] = await Promise.all([
        fetch("/api/accounting/bills"),
        fetch("/api/accounting/vendors?active_only=true"),
        fetch("/api/accounting/accounts?type=expense&active_only=true"),
      ]);
      if (billsRes.ok) setBills(await billsRes.json());
      if (vendorsRes.ok) setVendors(await vendorsRes.json());
      if (accountsRes.ok) setExpenseAccounts(await accountsRes.json());
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  function resetCreate() {
    setFormVendor("");
    setFormBillNumber("");
    setFormBillDate(new Date().toISOString().split("T")[0]);
    setFormDueDate("");
    setFormNotes("");
    setFormLines([{ description: "", quantity: 1, unit_price: 0, account_id: "" }]);
    setShowCreate(false);
  }

  function updateLine(idx: number, field: keyof LineItem, value: string | number) {
    const updated = [...formLines];
    const line = { ...updated[idx] };
    if (field === "description" || field === "account_id") {
      line[field] = value as string;
    } else {
      line[field] = value as number;
    }
    updated[idx] = line;
    setFormLines(updated);
  }

  function addLine() {
    setFormLines([...formLines, { description: "", quantity: 1, unit_price: 0, account_id: "" }]);
  }

  function removeLine(idx: number) {
    if (formLines.length <= 1) return;
    setFormLines(formLines.filter((_, i) => i !== idx));
  }

  const formSubtotal = formLines.reduce((s, l) => s + l.quantity * l.unit_price, 0);

  async function handleCreate() {
    if (!formVendor || !formBillDate || !formDueDate || formLines.some((l) => !l.description || !l.account_id)) return;
    setSaving(true);
    try {
      const res = await fetch("/api/accounting/bills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendor_id: formVendor,
          bill_number: formBillNumber.trim() || null,
          bill_date: formBillDate,
          due_date: formDueDate,
          notes: formNotes.trim() || null,
          lines: formLines.map((l) => ({
            description: l.description,
            quantity: l.quantity,
            unit_price: l.unit_price,
            account_id: l.account_id,
          })),
        }),
      });
      if (res.ok) {
        resetCreate();
        loadData();
      }
    } catch { /* ignore */ }
    setSaving(false);
  }

  async function handlePayment(billId: string) {
    const amount = parseFloat(pmtAmount);
    if (!amount || amount <= 0) return;
    setSaving(true);
    try {
      const res = await fetch("/api/accounting/bills", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: billId,
          action: "payment",
          payment_date: pmtDate,
          amount,
          payment_method: pmtMethod,
          check_number: pmtCheckNum.trim() || null,
          reference: pmtRef.trim() || null,
          notes: pmtNotes.trim() || null,
        }),
      });
      if (res.ok) {
        setShowPayment(null);
        setPmtAmount("");
        setPmtCheckNum("");
        setPmtRef("");
        setPmtNotes("");
        loadData();
      }
    } catch { /* ignore */ }
    setSaving(false);
  }

  async function handleVoid(billId: string) {
    setSaving(true);
    try {
      const res = await fetch("/api/accounting/bills", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: billId, action: "void" }),
      });
      if (res.ok) loadData();
    } catch { /* ignore */ }
    setSaving(false);
  }

  // Summary stats
  const totalBills = bills.length;
  const totalOutstanding = bills.filter((b) => ["open", "partial"].includes(b.status)).reduce((s, b) => s + Number(b.balance_due), 0);
  const totalOverdue = bills.filter((b) => ["open", "partial"].includes(b.status) && b.due_date < new Date().toISOString().split("T")[0]).reduce((s, b) => s + Number(b.balance_due), 0);
  const totalPaid = bills.filter((b) => b.status === "paid").reduce((s, b) => s + Number(b.total), 0);

  return (
    <div className="min-h-screen bg-gray-950 text-white">

      <main className="px-4 sm:px-6 py-6 max-w-7xl mx-auto">
        {/* Summary Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {[
            { label: "Total Bills", value: totalBills, color: "text-gray-200" },
            { label: "Outstanding", value: fmt(totalOutstanding), color: "text-blue-400" },
            { label: "Overdue", value: fmt(totalOverdue), color: "text-red-400" },
            { label: "Paid", value: fmt(totalPaid), color: "text-emerald-400" },
          ].map((c) => (
            <div key={c.label} className="rounded-xl bg-gray-900/50 border border-gray-800 p-4">
              <p className="text-[10px] uppercase tracking-wider text-gray-600 font-medium">{c.label}</p>
              <p className={`text-xl font-black mt-1 ${c.color}`}>{c.value}</p>
            </div>
          ))}
        </div>

        {/* Action Bar */}
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => { resetCreate(); setShowCreate(true); }}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold uppercase tracking-wider"
          >
            + New Bill
          </button>
          <a href="/accounting/customers" className="px-4 py-2 rounded-lg border border-gray-700 hover:border-gray-500 text-gray-400 text-sm font-bold uppercase tracking-wider">
            Manage Vendors
          </a>
        </div>

        {/* Create Form */}
        {showCreate && (
          <div className="mb-6 p-6 rounded-xl bg-gray-900/50 border border-gray-800 space-y-4">
            <h3 className="text-sm font-bold uppercase tracking-wider text-gray-300">New Bill</h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="block text-[10px] text-gray-600 uppercase tracking-wider mb-1">Vendor *</label>
                <select value={formVendor} onChange={(e) => setFormVendor(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white">
                  <option value="">Select vendor...</option>
                  {vendors.map((v) => <option key={v.id} value={v.id}>{v.company_name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] text-gray-600 uppercase tracking-wider mb-1">Vendor Invoice #</label>
                <input value={formBillNumber} onChange={(e) => setFormBillNumber(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white" placeholder="e.g. INV-2026-001" />
              </div>
              <div>
                <label className="block text-[10px] text-gray-600 uppercase tracking-wider mb-1">Bill Date *</label>
                <input type="date" value={formBillDate} onChange={(e) => setFormBillDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white" />
              </div>
              <div>
                <label className="block text-[10px] text-gray-600 uppercase tracking-wider mb-1">Due Date *</label>
                <input type="date" value={formDueDate} onChange={(e) => setFormDueDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white" />
              </div>
            </div>

            {/* Line Items */}
            <div>
              <label className="block text-[10px] text-gray-600 uppercase tracking-wider mb-2">Line Items *</label>
              <div className="space-y-2">
                {formLines.map((line, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                    <div className="col-span-4">
                      {idx === 0 && <span className="text-[9px] text-gray-600 uppercase">Description</span>}
                      <input value={line.description} onChange={(e) => updateLine(idx, "description", e.target.value)}
                        className="w-full px-2 py-1.5 rounded bg-gray-900 border border-gray-800 text-sm text-white" />
                    </div>
                    <div className="col-span-2">
                      {idx === 0 && <span className="text-[9px] text-gray-600 uppercase">Qty</span>}
                      <input type="number" value={line.quantity} onChange={(e) => updateLine(idx, "quantity", parseFloat(e.target.value) || 0)}
                        className="w-full px-2 py-1.5 rounded bg-gray-900 border border-gray-800 text-sm text-white" min="0" step="0.01" />
                    </div>
                    <div className="col-span-2">
                      {idx === 0 && <span className="text-[9px] text-gray-600 uppercase">Unit Price</span>}
                      <input type="number" value={line.unit_price} onChange={(e) => updateLine(idx, "unit_price", parseFloat(e.target.value) || 0)}
                        className="w-full px-2 py-1.5 rounded bg-gray-900 border border-gray-800 text-sm text-white" min="0" step="0.01" />
                    </div>
                    <div className="col-span-3">
                      {idx === 0 && <span className="text-[9px] text-gray-600 uppercase">Expense Account</span>}
                      <select value={line.account_id} onChange={(e) => updateLine(idx, "account_id", e.target.value)}
                        className="w-full px-2 py-1.5 rounded bg-gray-900 border border-gray-800 text-sm text-white">
                        <option value="">Account...</option>
                        {expenseAccounts.map((a) => (
                          <option key={a.id} value={a.id}>{a.account_number} — {a.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="col-span-1 flex justify-center">
                      <button onClick={() => removeLine(idx)} className="text-red-500 hover:text-red-400 text-xs font-bold">&times;</button>
                    </div>
                  </div>
                ))}
              </div>
              <button onClick={addLine} className="mt-2 text-xs text-teal-400 hover:text-teal-300 font-bold uppercase">+ Add Line</button>
            </div>

            <div>
              <label className="block text-[10px] text-gray-600 uppercase tracking-wider mb-1">Notes</label>
              <textarea value={formNotes} onChange={(e) => setFormNotes(e.target.value)} rows={2}
                className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white" />
            </div>

            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-400">Subtotal: <span className="text-white font-bold">{fmt(formSubtotal)}</span></p>
              <div className="flex gap-2">
                <button onClick={handleCreate} disabled={saving || !formVendor || !formBillDate || !formDueDate}
                  className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-bold uppercase tracking-wider">
                  {saving ? "Saving..." : "Create Bill"}
                </button>
                <button onClick={resetCreate}
                  className="px-4 py-2 rounded-lg border border-gray-700 hover:border-gray-500 text-gray-400 text-sm font-bold uppercase tracking-wider">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
          </div>
        )}

        {/* Bills List */}
        {!loading && (
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden overflow-x-auto">
            <table className="w-full text-sm min-w-[800px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-gray-600 border-b border-gray-800">
                  <th className="text-left px-4 py-3 font-medium">Vendor</th>
                  <th className="text-left px-4 py-3 font-medium">Bill #</th>
                  <th className="text-left px-4 py-3 font-medium">Date</th>
                  <th className="text-left px-4 py-3 font-medium">Due</th>
                  <th className="text-right px-4 py-3 font-medium">Total</th>
                  <th className="text-right px-4 py-3 font-medium">Balance</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                  <th className="text-left px-4 py-3 font-medium w-32">Actions</th>
                </tr>
              </thead>
              <tbody>
                {bills.map((bill) => {
                  const isOverdue = ["open", "partial"].includes(bill.status) && bill.due_date < new Date().toISOString().split("T")[0];
                  return (
                    <tr key={bill.id} className="border-t border-gray-800/50 hover:bg-gray-800/20 transition-colors">
                      <td className="px-4 py-3 text-gray-200 font-medium">{bill.vendors?.company_name || "—"}</td>
                      <td className="px-4 py-3 text-gray-400 text-xs font-mono">{bill.bill_number || "—"}</td>
                      <td className="px-4 py-3 text-gray-400">{bill.bill_date}</td>
                      <td className={`px-4 py-3 ${isOverdue ? "text-red-400 font-bold" : "text-gray-400"}`}>
                        {bill.due_date}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-200 font-mono">{fmt(Number(bill.total))}</td>
                      <td className="px-4 py-3 text-right font-mono">
                        <span className={Number(bill.balance_due) > 0 ? "text-amber-400" : "text-gray-600"}>
                          {fmt(Number(bill.balance_due))}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${STATUS_COLORS[bill.status] || "bg-gray-800 text-gray-300"}`}>
                          {bill.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          {["open", "partial"].includes(bill.status) && (
                            <button
                              onClick={() => {
                                setShowPayment(bill.id);
                                setPmtAmount(String(Number(bill.balance_due)));
                              }}
                              className="text-xs text-emerald-400 hover:text-emerald-300 font-bold uppercase"
                            >
                              Pay
                            </button>
                          )}
                          {bill.status !== "voided" && bill.status !== "paid" && (
                            <button onClick={() => handleVoid(bill.id)}
                              className="text-xs text-red-400 hover:text-red-300 font-bold uppercase">
                              Void
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {bills.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-gray-600">
                      No bills yet. Click &quot;+ New Bill&quot; to create one.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Payment Modal */}
        {showPayment && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-gray-900 border border-gray-800 rounded-2xl shadow-2xl p-6 w-full max-w-md space-y-4">
              <h3 className="text-sm font-bold uppercase tracking-wider text-gray-300">Record Payment</h3>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] text-gray-600 uppercase tracking-wider mb-1">Payment Date</label>
                  <input type="date" value={pmtDate} onChange={(e) => setPmtDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-white" />
                </div>
                <div>
                  <label className="block text-[10px] text-gray-600 uppercase tracking-wider mb-1">Amount</label>
                  <input type="number" value={pmtAmount} onChange={(e) => setPmtAmount(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-white" min="0.01" step="0.01" />
                </div>
                <div>
                  <label className="block text-[10px] text-gray-600 uppercase tracking-wider mb-1">Method</label>
                  <select value={pmtMethod} onChange={(e) => setPmtMethod(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-white">
                    {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m.replace("_", " ")}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-gray-600 uppercase tracking-wider mb-1">Check #</label>
                  <input value={pmtCheckNum} onChange={(e) => setPmtCheckNum(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-white" />
                </div>
                <div className="col-span-2">
                  <label className="block text-[10px] text-gray-600 uppercase tracking-wider mb-1">Reference</label>
                  <input value={pmtRef} onChange={(e) => setPmtRef(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-white" />
                </div>
                <div className="col-span-2">
                  <label className="block text-[10px] text-gray-600 uppercase tracking-wider mb-1">Notes</label>
                  <textarea value={pmtNotes} onChange={(e) => setPmtNotes(e.target.value)} rows={2}
                    className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-white" />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => setShowPayment(null)}
                  className="px-4 py-2 rounded-lg border border-gray-700 hover:border-gray-500 text-gray-400 text-sm font-bold uppercase tracking-wider">
                  Cancel
                </button>
                <button onClick={() => handlePayment(showPayment)} disabled={saving || !pmtAmount || parseFloat(pmtAmount) <= 0}
                  className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-bold uppercase tracking-wider">
                  {saving ? "Processing..." : "Record Payment"}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
