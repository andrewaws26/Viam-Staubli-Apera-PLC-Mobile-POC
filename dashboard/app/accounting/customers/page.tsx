"use client";

import { useState, useEffect } from "react";

interface Customer {
  id: string;
  company_name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  billing_address: string | null;
  payment_terms: string;
  credit_limit: number | null;
  tax_id: string | null;
  notes: string | null;
  is_active: boolean;
}

interface Vendor {
  id: string;
  company_name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  payment_terms: string;
  default_expense_account_id: string | null;
  tax_id: string | null;
  is_1099_vendor: boolean;
  notes: string | null;
  is_active: boolean;
}

type Tab = "customers" | "vendors";

const TERMS_OPTIONS = ["Due on Receipt", "Net 15", "Net 30", "Net 45", "Net 60", "Net 90"];

export default function CustomersVendorsPage() {
  const [tab, setTab] = useState<Tab>("customers");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<Customer | Vendor | null>(null);

  // Form state
  const [formName, setFormName] = useState("");
  const [formContact, setFormContact] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formAddress, setFormAddress] = useState("");
  const [formTerms, setFormTerms] = useState("Net 30");
  const [formNotes, setFormNotes] = useState("");
  const [formIs1099, setFormIs1099] = useState(false);
  const [formTaxId, setFormTaxId] = useState("");
  const [saving, setSaving] = useState(false);

  async function loadData() {
    setLoading(true);
    try {
      const [custRes, vendRes] = await Promise.all([
        fetch("/api/accounting/customers"),
        fetch("/api/accounting/vendors"),
      ]);
      if (custRes.ok) setCustomers(await custRes.json());
      if (vendRes.ok) setVendors(await vendRes.json());
    } catch { /* ignore */ }
    setLoading(false);
  }

  useEffect(() => { loadData(); }, []);

  function resetForm() {
    setFormName(""); setFormContact(""); setFormEmail(""); setFormPhone("");
    setFormAddress(""); setFormTerms("Net 30"); setFormNotes(""); setFormIs1099(false);
    setFormTaxId(""); setEditItem(null); setShowForm(false);
  }

  function startEdit(item: Customer | Vendor) {
    setEditItem(item);
    setFormName(item.company_name);
    setFormContact(item.contact_name || "");
    setFormEmail(item.email || "");
    setFormPhone(item.phone || "");
    setFormAddress(tab === "customers" ? (item as Customer).billing_address || "" : (item as Vendor).address || "");
    setFormTerms(item.payment_terms);
    setFormNotes(item.notes || "");
    setFormTaxId(item.tax_id || "");
    if (tab === "vendors") setFormIs1099((item as Vendor).is_1099_vendor);
    setShowForm(true);
  }

  async function handleSave() {
    if (!formName.trim()) return;
    setSaving(true);

    const endpoint = tab === "customers" ? "/api/accounting/customers" : "/api/accounting/vendors";
    const isEdit = !!editItem;
    const method = isEdit ? "PATCH" : "POST";

    const payload: Record<string, unknown> = {
      company_name: formName.trim(),
      contact_name: formContact.trim() || null,
      email: formEmail.trim() || null,
      phone: formPhone.trim() || null,
      payment_terms: formTerms,
      notes: formNotes.trim() || null,
      tax_id: formTaxId.trim() || null,
    };

    if (tab === "customers") {
      payload.billing_address = formAddress.trim() || null;
    } else {
      payload.address = formAddress.trim() || null;
      payload.is_1099_vendor = formIs1099;
    }

    if (isEdit) payload.id = editItem!.id;

    try {
      const res = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        resetForm();
        loadData();
      }
    } catch { /* ignore */ }
    setSaving(false);
  }

  const items = tab === "customers" ? customers : vendors;
  const activeItems = items.filter((i) => i.is_active);
  const inactiveItems = items.filter((i) => !i.is_active);

  return (
    <div className="min-h-screen bg-gray-950 text-white">

      <main className="px-4 sm:px-6 py-6 max-w-6xl mx-auto">
        {/* Tabs */}
        <div className="flex items-center gap-1 mb-6 bg-gray-900 rounded-xl p-1 w-fit">
          {(["customers", "vendors"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => { setTab(t); resetForm(); }}
              className={`px-5 py-2 rounded-lg text-sm font-bold uppercase tracking-wider transition-colors ${
                tab === t ? "bg-gray-800 text-white" : "text-gray-500 hover:text-gray-300"
              }`}
            >
              {t === "customers" ? "Customers" : "Vendors"}
            </button>
          ))}
          <button
            onClick={() => { resetForm(); setShowForm(true); }}
            className="ml-4 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold uppercase tracking-wider"
          >
            + Add {tab === "customers" ? "Customer" : "Vendor"}
          </button>
        </div>

        {/* Form */}
        {showForm && (
          <div className="mb-6 p-6 rounded-xl bg-gray-900/50 border border-gray-800 space-y-4">
            <h3 className="text-sm font-bold uppercase tracking-wider text-gray-300">
              {editItem ? "Edit" : "New"} {tab === "customers" ? "Customer" : "Vendor"}
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-600 uppercase tracking-wider mb-1">Company Name *</label>
                <input value={formName} onChange={(e) => setFormName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white" />
              </div>
              <div>
                <label className="block text-xs text-gray-600 uppercase tracking-wider mb-1">Contact Name</label>
                <input value={formContact} onChange={(e) => setFormContact(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white" />
              </div>
              <div>
                <label className="block text-xs text-gray-600 uppercase tracking-wider mb-1">Email</label>
                <input type="email" value={formEmail} onChange={(e) => setFormEmail(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white" />
              </div>
              <div>
                <label className="block text-xs text-gray-600 uppercase tracking-wider mb-1">Phone</label>
                <input value={formPhone} onChange={(e) => setFormPhone(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white" />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs text-gray-600 uppercase tracking-wider mb-1">
                  {tab === "customers" ? "Billing Address" : "Address"}
                </label>
                <input value={formAddress} onChange={(e) => setFormAddress(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white" />
              </div>
              <div>
                <label className="block text-xs text-gray-600 uppercase tracking-wider mb-1">Payment Terms</label>
                <select value={formTerms} onChange={(e) => setFormTerms(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white">
                  {TERMS_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-600 uppercase tracking-wider mb-1">Tax ID / EIN</label>
                <input value={formTaxId} onChange={(e) => setFormTaxId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white" placeholder="XX-XXXXXXX" />
              </div>
              {tab === "vendors" && (
                <div className="flex items-center gap-2">
                  <input type="checkbox" checked={formIs1099} onChange={(e) => setFormIs1099(e.target.checked)}
                    className="w-4 h-4 rounded border-gray-700 bg-gray-900" />
                  <label className="text-sm text-gray-300">1099 Vendor (independent contractor)</label>
                </div>
              )}
              <div className="sm:col-span-2">
                <label className="block text-xs text-gray-600 uppercase tracking-wider mb-1">Notes</label>
                <textarea value={formNotes} onChange={(e) => setFormNotes(e.target.value)} rows={2}
                  className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white" />
              </div>
            </div>

            <div className="flex gap-2">
              <button onClick={handleSave} disabled={saving || !formName.trim()}
                className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-bold uppercase tracking-wider">
                {saving ? "Saving..." : editItem ? "Update" : "Create"}
              </button>
              <button onClick={resetForm}
                className="px-4 py-2 rounded-lg border border-gray-700 hover:border-gray-500 text-gray-400 text-sm font-bold uppercase tracking-wider">
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

        {/* List */}
        {!loading && (
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden overflow-x-auto">
            <table className="w-full text-sm min-w-[700px]">
              <thead>
                <tr className="text-xs uppercase tracking-wider text-gray-600 border-b border-gray-800">
                  <th className="text-left px-4 py-3 font-medium">Company</th>
                  <th className="text-left px-4 py-3 font-medium">Contact</th>
                  <th className="text-left px-4 py-3 font-medium">Email</th>
                  <th className="text-left px-4 py-3 font-medium">Terms</th>
                  {tab === "vendors" && <th className="text-left px-4 py-3 font-medium">1099</th>}
                  <th className="text-left px-4 py-3 font-medium w-20">Actions</th>
                </tr>
              </thead>
              <tbody>
                {activeItems.map((item) => (
                  <tr key={item.id} className="border-t border-gray-800/50 hover:bg-gray-800/20 transition-colors">
                    <td className="px-4 py-3 text-gray-200 font-medium">{item.company_name}</td>
                    <td className="px-4 py-3 text-gray-400">{item.contact_name || "—"}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{item.email || "—"}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded text-xs font-bold uppercase bg-gray-800 text-gray-300">
                        {item.payment_terms}
                      </span>
                    </td>
                    {tab === "vendors" && (
                      <td className="px-4 py-3">
                        {(item as Vendor).is_1099_vendor && (
                          <span className="px-2 py-0.5 rounded text-xs font-bold uppercase bg-amber-900/50 text-amber-300">1099</span>
                        )}
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <button onClick={() => startEdit(item)}
                        className="text-xs text-teal-400 hover:text-teal-300 font-bold uppercase">
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
                {activeItems.length === 0 && (
                  <tr>
                    <td colSpan={tab === "vendors" ? 6 : 5} className="px-4 py-8 text-center text-gray-600">
                      No {tab} yet. Click &quot;+ Add&quot; to create one.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Inactive section */}
        {!loading && inactiveItems.length > 0 && (
          <div className="mt-6">
            <h3 className="text-xs font-bold uppercase tracking-wider text-gray-600 mb-2">
              Inactive ({inactiveItems.length})
            </h3>
            <div className="rounded-xl border border-gray-800/50 bg-gray-900/30 overflow-hidden">
              {inactiveItems.map((item) => (
                <div key={item.id} className="px-4 py-2 border-t border-gray-800/30 flex items-center justify-between">
                  <span className="text-sm text-gray-600">{item.company_name}</span>
                  <button onClick={() => startEdit(item)}
                    className="text-xs text-gray-600 hover:text-gray-400 font-bold uppercase">
                    Edit
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
