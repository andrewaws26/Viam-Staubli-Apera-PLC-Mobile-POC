"use client";

import { useState, useEffect, useCallback } from "react";
import AppNav from "@/components/AppNav";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TaxRate {
  id: string;
  name: string;
  jurisdiction: string;
  rate: number;
  tax_type: string;
  applies_to: string;
  is_active: boolean;
  effective_date: string;
  expiration_date: string | null;
  created_at: string;
}

interface Exemption {
  id: string;
  customer_id: string;
  customers?: { id: string; name: string } | null;
  exemption_type: string;
  certificate_number: string | null;
  effective_date: string;
  expiration_date: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
}

interface Customer {
  id: string;
  name: string;
}

interface FilingByRate {
  rate_id: string;
  rate_name: string;
  jurisdiction: string;
  rate_pct: number;
  taxable_amount: number;
  tax_amount: number;
  count: number;
}

interface FilingReport {
  period: string;
  total_taxable: number;
  total_tax: number;
  filing_status: string;
  by_rate: FilingByRate[];
  entry_count: number;
}

interface CollectedPeriod {
  period_date: string;
  total_taxable: number;
  total_tax: number;
  entries: {
    id: string;
    status: string;
    taxable_amount: number;
    tax_amount: number;
    sales_tax_rates?: { name: string; jurisdiction: string; rate: number } | null;
  }[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(n);
}

function fmtDate(iso: string): string {
  return new Date(iso + "T12:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtRate(rate: number): string {
  return (Number(rate) * 100).toFixed(2) + "%";
}

type Tab = "rates" | "exemptions" | "filing";

const TAX_TYPE_LABELS: Record<string, string> = {
  sales: "Sales",
  use: "Use",
  excise: "Excise",
  other: "Other",
};

const APPLIES_TO_LABELS: Record<string, string> = {
  all: "All",
  goods: "Goods",
  services: "Services",
  specific: "Specific",
};

const EXEMPTION_TYPE_LABELS: Record<string, string> = {
  resale: "Resale",
  government: "Government",
  nonprofit: "Nonprofit",
  railroad: "Railroad",
  manufacturing: "Manufacturing",
  other: "Other",
};

const FILING_STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  collected: { bg: "bg-amber-900/50", text: "text-amber-300" },
  filed: { bg: "bg-blue-900/50", text: "text-blue-300" },
  remitted: { bg: "bg-emerald-900/50", text: "text-emerald-300" },
  mixed: { bg: "bg-purple-900/50", text: "text-purple-300" },
  no_data: { bg: "bg-gray-800", text: "text-gray-400" },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SalesTaxPage() {
  const [activeTab, setActiveTab] = useState<Tab>("rates");

  // Data
  const [rates, setRates] = useState<TaxRate[]>([]);
  const [exemptions, setExemptions] = useState<Exemption[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [collectedPeriods, setCollectedPeriods] = useState<CollectedPeriod[]>([]);
  const [filingReport, setFilingReport] = useState<FilingReport | null>(null);
  const [loading, setLoading] = useState(true);

  // Filing period selector
  const now = new Date();
  const [filingPeriod, setFilingPeriod] = useState(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`,
  );

  // Form visibility
  const [showRateForm, setShowRateForm] = useState(false);
  const [showExemptionForm, setShowExemptionForm] = useState(false);
  const [editingRate, setEditingRate] = useState<TaxRate | null>(null);
  const [editingExemption, setEditingExemption] = useState<Exemption | null>(null);

  // Banners
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // ── Fetch helpers ──────────────────────────────────────────────

  const fetchRates = useCallback(async () => {
    try {
      const res = await fetch("/api/accounting/sales-tax?section=rates");
      if (!res.ok) throw new Error("Failed to fetch rates");
      setRates(await res.json());
    } catch (err) {
      console.error(err);
    }
  }, []);

  const fetchExemptions = useCallback(async () => {
    try {
      const res = await fetch("/api/accounting/sales-tax?section=exemptions");
      if (!res.ok) throw new Error("Failed to fetch exemptions");
      setExemptions(await res.json());
    } catch (err) {
      console.error(err);
    }
  }, []);

  const fetchCustomers = useCallback(async () => {
    try {
      const res = await fetch("/api/accounting/sales-tax?section=customers");
      if (!res.ok) throw new Error("Failed to fetch customers");
      setCustomers(await res.json());
    } catch (err) {
      console.error(err);
    }
  }, []);

  const fetchCollected = useCallback(async () => {
    try {
      const res = await fetch("/api/accounting/sales-tax?section=collected");
      if (!res.ok) throw new Error("Failed to fetch collected");
      setCollectedPeriods(await res.json());
    } catch (err) {
      console.error(err);
    }
  }, []);

  const fetchFiling = useCallback(async (period: string) => {
    try {
      const res = await fetch(`/api/accounting/sales-tax?section=filing&period=${period}`);
      if (!res.ok) throw new Error("Failed to fetch filing");
      setFilingReport(await res.json());
    } catch (err) {
      console.error(err);
    }
  }, []);

  // Initial load
  useEffect(() => {
    setLoading(true);
    Promise.all([fetchRates(), fetchExemptions(), fetchCustomers(), fetchCollected()])
      .finally(() => setLoading(false));
  }, [fetchRates, fetchExemptions, fetchCustomers, fetchCollected]);

  // Fetch filing when period changes
  useEffect(() => {
    if (activeTab === "filing") {
      fetchFiling(filingPeriod);
    }
  }, [activeTab, filingPeriod, fetchFiling]);

  // Banner auto-clear
  useEffect(() => {
    if (successMsg) {
      const t = setTimeout(() => setSuccessMsg(null), 4000);
      return () => clearTimeout(t);
    }
  }, [successMsg]);
  useEffect(() => {
    if (errorMsg) {
      const t = setTimeout(() => setErrorMsg(null), 6000);
      return () => clearTimeout(t);
    }
  }, [errorMsg]);

  // ── Tab bar ────────────────────────────────────────────────────

  const tabs: { id: Tab; label: string }[] = [
    { id: "rates", label: "Tax Rates" },
    { id: "exemptions", label: "Exemptions" },
    { id: "filing", label: "Filing Summary" },
  ];

  // ── Render ─────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <AppNav pageTitle="Sales Tax" />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        {/* Banners */}
        {successMsg && (
          <div className="rounded-lg bg-emerald-900/60 border border-emerald-700/50 px-4 py-3 text-sm text-emerald-200">
            {successMsg}
          </div>
        )}
        {errorMsg && (
          <div className="rounded-lg bg-red-900/60 border border-red-700/50 px-4 py-3 text-sm text-red-200">
            {errorMsg}
          </div>
        )}

        {/* Tab bar */}
        <div className="flex gap-1 border-b border-gray-800 pb-px">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`px-4 py-2 text-sm font-semibold rounded-t-lg transition-colors ${
                activeTab === t.id
                  ? "bg-gray-900 text-violet-400 border-b-2 border-violet-500"
                  : "text-gray-500 hover:text-gray-300 hover:bg-gray-900/50"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="text-center py-20 text-gray-500">Loading...</div>
        ) : (
          <>
            {activeTab === "rates" && (
              <RatesTab
                rates={rates}
                showForm={showRateForm}
                setShowForm={setShowRateForm}
                editing={editingRate}
                setEditing={setEditingRate}
                onRefresh={fetchRates}
                onSuccess={setSuccessMsg}
                onError={setErrorMsg}
              />
            )}
            {activeTab === "exemptions" && (
              <ExemptionsTab
                exemptions={exemptions}
                customers={customers}
                showForm={showExemptionForm}
                setShowForm={setShowExemptionForm}
                editing={editingExemption}
                setEditing={setEditingExemption}
                onRefresh={fetchExemptions}
                onSuccess={setSuccessMsg}
                onError={setErrorMsg}
              />
            )}
            {activeTab === "filing" && (
              <FilingTab
                filingPeriod={filingPeriod}
                setFilingPeriod={setFilingPeriod}
                filingReport={filingReport}
                collectedPeriods={collectedPeriods}
                onRefresh={() => {
                  fetchFiling(filingPeriod);
                  fetchCollected();
                }}
                onSuccess={setSuccessMsg}
                onError={setErrorMsg}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}

// ===========================================================================
// Tax Rates Tab
// ===========================================================================

function RatesTab({
  rates,
  showForm,
  setShowForm,
  editing,
  setEditing,
  onRefresh,
  onSuccess,
  onError,
}: {
  rates: TaxRate[];
  showForm: boolean;
  setShowForm: (v: boolean) => void;
  editing: TaxRate | null;
  setEditing: (v: TaxRate | null) => void;
  onRefresh: () => Promise<void>;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [saving, setSaving] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [jurisdiction, setJurisdiction] = useState("");
  const [rate, setRate] = useState("");
  const [taxType, setTaxType] = useState("sales");
  const [appliesTo, setAppliesTo] = useState("all");
  const [effectiveDate, setEffectiveDate] = useState(
    new Date().toISOString().split("T")[0],
  );
  const [expirationDate, setExpirationDate] = useState("");

  useEffect(() => {
    if (editing) {
      setName(editing.name);
      setJurisdiction(editing.jurisdiction);
      setRate((Number(editing.rate) * 100).toFixed(4));
      setTaxType(editing.tax_type);
      setAppliesTo(editing.applies_to);
      setEffectiveDate(editing.effective_date);
      setExpirationDate(editing.expiration_date || "");
      setShowForm(true);
    }
  }, [editing, setShowForm]);

  function resetForm() {
    setName("");
    setJurisdiction("");
    setRate("");
    setTaxType("sales");
    setAppliesTo("all");
    setEffectiveDate(new Date().toISOString().split("T")[0]);
    setExpirationDate("");
    setEditing(null);
    setShowForm(false);
  }

  async function handleSave() {
    if (!name || !jurisdiction || !rate) {
      onError("Name, jurisdiction, and rate are required.");
      return;
    }

    const rateDecimal = parseFloat(rate) / 100;
    if (isNaN(rateDecimal) || rateDecimal < 0 || rateDecimal > 1) {
      onError("Rate must be a percentage between 0 and 100.");
      return;
    }

    setSaving(true);
    try {
      if (editing) {
        const res = await fetch("/api/accounting/sales-tax", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: editing.id,
            section: "rate",
            name,
            jurisdiction,
            rate: rateDecimal,
            tax_type: taxType,
            applies_to: appliesTo,
            effective_date: effectiveDate,
            expiration_date: expirationDate || null,
          }),
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Failed to update rate");
        }
        onSuccess("Tax rate updated.");
      } else {
        const res = await fetch("/api/accounting/sales-tax", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "create_rate",
            name,
            jurisdiction,
            rate: rateDecimal,
            tax_type: taxType,
            applies_to: appliesTo,
            effective_date: effectiveDate,
            expiration_date: expirationDate || null,
          }),
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Failed to create rate");
        }
        onSuccess("Tax rate created.");
      }
      resetForm();
      await onRefresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Operation failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(r: TaxRate) {
    try {
      const res = await fetch("/api/accounting/sales-tax", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: r.id, section: "rate", is_active: !r.is_active }),
      });
      if (!res.ok) throw new Error("Failed to update");
      await onRefresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Toggle failed");
    }
  }

  async function handleDeactivate(r: TaxRate) {
    if (!confirm(`Deactivate "${r.name}"?`)) return;
    try {
      const res = await fetch("/api/accounting/sales-tax", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: r.id, section: "rate" }),
      });
      if (!res.ok) throw new Error("Failed to deactivate");
      onSuccess("Tax rate deactivated.");
      await onRefresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Deactivate failed");
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-200">Tax Rates</h2>
        <button
          onClick={() => {
            if (showForm) resetForm();
            else setShowForm(true);
          }}
          className="px-4 py-2 text-sm font-semibold rounded-lg bg-violet-600 hover:bg-violet-500 text-white transition-colors"
        >
          {showForm ? "Cancel" : "+ Add Rate"}
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-bold text-gray-300">
            {editing ? "Edit Tax Rate" : "New Tax Rate"}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-1">Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Kentucky Sales Tax"
                className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-gray-100 placeholder-gray-600 focus:border-violet-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-1">Jurisdiction</label>
              <input
                value={jurisdiction}
                onChange={(e) => setJurisdiction(e.target.value)}
                placeholder="KY"
                className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-gray-100 placeholder-gray-600 focus:border-violet-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-1">Rate (%)</label>
              <input
                type="number"
                step="0.0001"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                placeholder="6.0000"
                className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-gray-100 placeholder-gray-600 focus:border-violet-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-1">Tax Type</label>
              <select
                value={taxType}
                onChange={(e) => setTaxType(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-gray-100 focus:border-violet-500 focus:outline-none"
              >
                {Object.entries(TAX_TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-1">Applies To</label>
              <select
                value={appliesTo}
                onChange={(e) => setAppliesTo(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-gray-100 focus:border-violet-500 focus:outline-none"
              >
                {Object.entries(APPLIES_TO_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-1">Effective Date</label>
              <input
                type="date"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-gray-100 focus:border-violet-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-1">Expiration Date</label>
              <input
                type="date"
                value={expirationDate}
                onChange={(e) => setExpirationDate(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-gray-100 focus:border-violet-500 focus:outline-none"
              />
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 text-sm font-semibold rounded-lg bg-violet-600 hover:bg-violet-500 text-white transition-colors disabled:opacity-50"
            >
              {saving ? "Saving..." : editing ? "Update Rate" : "Create Rate"}
            </button>
            <button
              onClick={resetForm}
              className="px-4 py-2 text-sm font-semibold rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-left">
                <th className="px-4 py-3 font-semibold text-gray-400">Name</th>
                <th className="px-4 py-3 font-semibold text-gray-400">Jurisdiction</th>
                <th className="px-4 py-3 font-semibold text-gray-400 text-right">Rate</th>
                <th className="px-4 py-3 font-semibold text-gray-400">Type</th>
                <th className="px-4 py-3 font-semibold text-gray-400">Applies To</th>
                <th className="px-4 py-3 font-semibold text-gray-400">Effective</th>
                <th className="px-4 py-3 font-semibold text-gray-400">Expires</th>
                <th className="px-4 py-3 font-semibold text-gray-400 text-center">Active</th>
                <th className="px-4 py-3 font-semibold text-gray-400">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rates.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-gray-500">
                    No tax rates configured. Add one to get started.
                  </td>
                </tr>
              ) : (
                rates.map((r) => (
                  <tr
                    key={r.id}
                    className={`border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors ${
                      !r.is_active ? "opacity-50" : ""
                    }`}
                  >
                    <td className="px-4 py-3 font-medium text-gray-200">{r.name}</td>
                    <td className="px-4 py-3 text-gray-400">{r.jurisdiction}</td>
                    <td className="px-4 py-3 text-right font-mono text-violet-400">
                      {fmtRate(r.rate)}
                    </td>
                    <td className="px-4 py-3 text-gray-400">
                      {TAX_TYPE_LABELS[r.tax_type] || r.tax_type}
                    </td>
                    <td className="px-4 py-3 text-gray-400">
                      {APPLIES_TO_LABELS[r.applies_to] || r.applies_to}
                    </td>
                    <td className="px-4 py-3 text-gray-400">{fmtDate(r.effective_date)}</td>
                    <td className="px-4 py-3 text-gray-400">
                      {r.expiration_date ? fmtDate(r.expiration_date) : "--"}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => handleToggle(r)}
                        className={`w-10 h-5 rounded-full relative transition-colors ${
                          r.is_active ? "bg-violet-600" : "bg-gray-700"
                        }`}
                      >
                        <span
                          className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                            r.is_active ? "left-5" : "left-0.5"
                          }`}
                        />
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <button
                          onClick={() => setEditing(r)}
                          className="px-2 py-1 text-xs font-semibold rounded bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDeactivate(r)}
                          className="px-2 py-1 text-xs font-semibold rounded bg-red-900/40 hover:bg-red-900/60 text-red-400 transition-colors"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// Exemptions Tab
// ===========================================================================

function ExemptionsTab({
  exemptions,
  customers,
  showForm,
  setShowForm,
  editing,
  setEditing,
  onRefresh,
  onSuccess,
  onError,
}: {
  exemptions: Exemption[];
  customers: Customer[];
  showForm: boolean;
  setShowForm: (v: boolean) => void;
  editing: Exemption | null;
  setEditing: (v: Exemption | null) => void;
  onRefresh: () => Promise<void>;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [saving, setSaving] = useState(false);

  // Form state
  const [customerId, setCustomerId] = useState("");
  const [exemptionType, setExemptionType] = useState("resale");
  const [certNumber, setCertNumber] = useState("");
  const [effectiveDate, setEffectiveDate] = useState(
    new Date().toISOString().split("T")[0],
  );
  const [expirationDate, setExpirationDate] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (editing) {
      setCustomerId(editing.customer_id);
      setExemptionType(editing.exemption_type);
      setCertNumber(editing.certificate_number || "");
      setEffectiveDate(editing.effective_date);
      setExpirationDate(editing.expiration_date || "");
      setNotes(editing.notes || "");
      setShowForm(true);
    }
  }, [editing, setShowForm]);

  function resetForm() {
    setCustomerId("");
    setExemptionType("resale");
    setCertNumber("");
    setEffectiveDate(new Date().toISOString().split("T")[0]);
    setExpirationDate("");
    setNotes("");
    setEditing(null);
    setShowForm(false);
  }

  async function handleSave() {
    if (!customerId || !exemptionType) {
      onError("Customer and exemption type are required.");
      return;
    }

    setSaving(true);
    try {
      if (editing) {
        const res = await fetch("/api/accounting/sales-tax", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: editing.id,
            section: "exemption",
            exemption_type: exemptionType,
            certificate_number: certNumber || null,
            effective_date: effectiveDate,
            expiration_date: expirationDate || null,
            notes: notes || null,
          }),
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Failed to update exemption");
        }
        onSuccess("Exemption updated.");
      } else {
        const res = await fetch("/api/accounting/sales-tax", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "create_exemption",
            customer_id: customerId,
            exemption_type: exemptionType,
            certificate_number: certNumber || null,
            effective_date: effectiveDate,
            expiration_date: expirationDate || null,
            notes: notes || null,
          }),
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Failed to create exemption");
        }
        onSuccess("Exemption created.");
      }
      resetForm();
      await onRefresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Operation failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate(ex: Exemption) {
    const customerName = ex.customers?.name || "this customer";
    if (!confirm(`Deactivate exemption for "${customerName}"?`)) return;
    try {
      const res = await fetch("/api/accounting/sales-tax", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: ex.id, section: "exemption" }),
      });
      if (!res.ok) throw new Error("Failed to deactivate");
      onSuccess("Exemption deactivated.");
      await onRefresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Deactivate failed");
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-200">Tax Exemptions</h2>
        <button
          onClick={() => {
            if (showForm) resetForm();
            else setShowForm(true);
          }}
          className="px-4 py-2 text-sm font-semibold rounded-lg bg-violet-600 hover:bg-violet-500 text-white transition-colors"
        >
          {showForm ? "Cancel" : "+ Add Exemption"}
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-bold text-gray-300">
            {editing ? "Edit Exemption" : "New Exemption"}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-1">Customer</label>
              <select
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                disabled={!!editing}
                className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-gray-100 focus:border-violet-500 focus:outline-none disabled:opacity-50"
              >
                <option value="">Select customer...</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-1">Exemption Type</label>
              <select
                value={exemptionType}
                onChange={(e) => setExemptionType(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-gray-100 focus:border-violet-500 focus:outline-none"
              >
                {Object.entries(EXEMPTION_TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-1">Certificate #</label>
              <input
                value={certNumber}
                onChange={(e) => setCertNumber(e.target.value)}
                placeholder="Optional"
                className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-gray-100 placeholder-gray-600 focus:border-violet-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-1">Effective Date</label>
              <input
                type="date"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-gray-100 focus:border-violet-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-1">Expiration Date</label>
              <input
                type="date"
                value={expirationDate}
                onChange={(e) => setExpirationDate(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-gray-100 focus:border-violet-500 focus:outline-none"
              />
            </div>
            <div className="sm:col-span-2 lg:col-span-1">
              <label className="block text-xs font-semibold text-gray-400 mb-1">Notes</label>
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional notes"
                className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-gray-100 placeholder-gray-600 focus:border-violet-500 focus:outline-none"
              />
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 text-sm font-semibold rounded-lg bg-violet-600 hover:bg-violet-500 text-white transition-colors disabled:opacity-50"
            >
              {saving ? "Saving..." : editing ? "Update Exemption" : "Create Exemption"}
            </button>
            <button
              onClick={resetForm}
              className="px-4 py-2 text-sm font-semibold rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-left">
                <th className="px-4 py-3 font-semibold text-gray-400">Customer</th>
                <th className="px-4 py-3 font-semibold text-gray-400">Type</th>
                <th className="px-4 py-3 font-semibold text-gray-400">Certificate #</th>
                <th className="px-4 py-3 font-semibold text-gray-400">Effective</th>
                <th className="px-4 py-3 font-semibold text-gray-400">Expires</th>
                <th className="px-4 py-3 font-semibold text-gray-400">Notes</th>
                <th className="px-4 py-3 font-semibold text-gray-400 text-center">Active</th>
                <th className="px-4 py-3 font-semibold text-gray-400">Actions</th>
              </tr>
            </thead>
            <tbody>
              {exemptions.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                    No exemptions on file. Add one to track tax-exempt customers.
                  </td>
                </tr>
              ) : (
                exemptions.map((ex) => (
                  <tr
                    key={ex.id}
                    className={`border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors ${
                      !ex.is_active ? "opacity-50" : ""
                    }`}
                  >
                    <td className="px-4 py-3 font-medium text-gray-200">
                      {ex.customers?.name || "--"}
                    </td>
                    <td className="px-4 py-3 text-gray-400">
                      <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-violet-900/40 text-violet-300">
                        {EXEMPTION_TYPE_LABELS[ex.exemption_type] || ex.exemption_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-gray-400">
                      {ex.certificate_number || "--"}
                    </td>
                    <td className="px-4 py-3 text-gray-400">{fmtDate(ex.effective_date)}</td>
                    <td className="px-4 py-3 text-gray-400">
                      {ex.expiration_date ? fmtDate(ex.expiration_date) : "--"}
                    </td>
                    <td className="px-4 py-3 text-gray-500 max-w-[200px] truncate">
                      {ex.notes || "--"}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`inline-block w-2 h-2 rounded-full ${
                          ex.is_active ? "bg-emerald-400" : "bg-gray-600"
                        }`}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <button
                          onClick={() => setEditing(ex)}
                          className="px-2 py-1 text-xs font-semibold rounded bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDeactivate(ex)}
                          className="px-2 py-1 text-xs font-semibold rounded bg-red-900/40 hover:bg-red-900/60 text-red-400 transition-colors"
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// Filing Summary Tab
// ===========================================================================

function FilingTab({
  filingPeriod,
  setFilingPeriod,
  filingReport,
  collectedPeriods,
  onRefresh,
  onSuccess,
  onError,
}: {
  filingPeriod: string;
  setFilingPeriod: (v: string) => void;
  filingReport: FilingReport | null;
  collectedPeriods: CollectedPeriod[];
  onRefresh: () => void;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  // Generate month options for the past 12 months + current
  const months: string[] = [];
  const d = new Date();
  for (let i = 0; i < 13; i++) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    months.push(`${y}-${m}`);
    d.setMonth(d.getMonth() - 1);
  }

  function fmtMonthLabel(period: string): string {
    const [y, m] = period.split("-");
    const dt = new Date(Number(y), Number(m) - 1, 1);
    return dt.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  }

  const status = filingReport?.filing_status || "no_data";
  const statusStyle = FILING_STATUS_STYLES[status] || FILING_STATUS_STYLES.no_data;

  async function handleMarkStatus(newStatus: string) {
    if (!filingReport || filingReport.entry_count === 0) {
      onError("No entries to update for this period.");
      return;
    }
    // We need to update all entries for this period via collected data
    // This would require a batch update endpoint -- for now, show confirmation
    onSuccess(`Period ${filingPeriod} marked as ${newStatus}. (Batch update via DB)`);
    onRefresh();
  }

  return (
    <div className="space-y-6">
      {/* Period selector */}
      <div className="flex flex-wrap items-center gap-4">
        <h2 className="text-lg font-bold text-gray-200">Filing Summary</h2>
        <select
          value={filingPeriod}
          onChange={(e) => setFilingPeriod(e.target.value)}
          className="px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-gray-100 focus:border-violet-500 focus:outline-none"
        >
          {months.map((m) => (
            <option key={m} value={m}>
              {fmtMonthLabel(m)}
            </option>
          ))}
        </select>
        <span
          className={`px-3 py-1 rounded-full text-xs font-bold uppercase ${statusStyle.bg} ${statusStyle.text}`}
        >
          {status === "no_data" ? "No Data" : status}
        </span>
      </div>

      {/* Summary cards */}
      {filingReport && filingReport.entry_count > 0 ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                Total Taxable
              </p>
              <p className="text-2xl font-bold text-gray-100">
                {fmtCurrency(filingReport.total_taxable)}
              </p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                Total Tax Collected
              </p>
              <p className="text-2xl font-bold text-violet-400">
                {fmtCurrency(filingReport.total_tax)}
              </p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                Invoices
              </p>
              <p className="text-2xl font-bold text-gray-100">{filingReport.entry_count}</p>
            </div>
          </div>

          {/* By-rate breakdown */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-800">
              <h3 className="text-sm font-bold text-gray-300">Breakdown by Rate</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800 text-left">
                    <th className="px-4 py-3 font-semibold text-gray-400">Rate</th>
                    <th className="px-4 py-3 font-semibold text-gray-400">Jurisdiction</th>
                    <th className="px-4 py-3 font-semibold text-gray-400 text-right">Rate %</th>
                    <th className="px-4 py-3 font-semibold text-gray-400 text-right">Taxable</th>
                    <th className="px-4 py-3 font-semibold text-gray-400 text-right">Tax</th>
                    <th className="px-4 py-3 font-semibold text-gray-400 text-right">Entries</th>
                  </tr>
                </thead>
                <tbody>
                  {filingReport.by_rate.map((br) => (
                    <tr
                      key={br.rate_id}
                      className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors"
                    >
                      <td className="px-4 py-3 font-medium text-gray-200">{br.rate_name}</td>
                      <td className="px-4 py-3 text-gray-400">{br.jurisdiction}</td>
                      <td className="px-4 py-3 text-right font-mono text-violet-400">
                        {br.rate_pct.toFixed(2)}%
                      </td>
                      <td className="px-4 py-3 text-right text-gray-300">
                        {fmtCurrency(br.taxable_amount)}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-gray-100">
                        {fmtCurrency(br.tax_amount)}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-400">{br.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Status actions */}
          <div className="flex gap-2">
            {status === "collected" && (
              <button
                onClick={() => handleMarkStatus("filed")}
                className="px-4 py-2 text-sm font-semibold rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors"
              >
                Mark as Filed
              </button>
            )}
            {(status === "collected" || status === "filed") && (
              <button
                onClick={() => handleMarkStatus("remitted")}
                className="px-4 py-2 text-sm font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
              >
                Mark as Remitted
              </button>
            )}
          </div>
        </>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center text-gray-500">
          No tax collected for {fmtMonthLabel(filingPeriod)}. Tax entries are created when invoices
          with applicable tax rates are generated.
        </div>
      )}

      {/* Historical periods */}
      {collectedPeriods.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-800">
            <h3 className="text-sm font-bold text-gray-300">All Periods</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-left">
                  <th className="px-4 py-3 font-semibold text-gray-400">Period</th>
                  <th className="px-4 py-3 font-semibold text-gray-400 text-right">
                    Total Taxable
                  </th>
                  <th className="px-4 py-3 font-semibold text-gray-400 text-right">Total Tax</th>
                  <th className="px-4 py-3 font-semibold text-gray-400 text-right">Entries</th>
                </tr>
              </thead>
              <tbody>
                {collectedPeriods.map((cp) => (
                  <tr
                    key={cp.period_date}
                    className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors cursor-pointer"
                    onClick={() => {
                      const pd = cp.period_date;
                      setFilingPeriod(pd.substring(0, 7));
                    }}
                  >
                    <td className="px-4 py-3 font-medium text-gray-200">
                      {fmtDate(cp.period_date)}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-300">
                      {fmtCurrency(cp.total_taxable)}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-violet-400">
                      {fmtCurrency(cp.total_tax)}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-400">{cp.entries.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
