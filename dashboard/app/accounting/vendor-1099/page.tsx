"use client";

import { useState, useEffect, useCallback } from "react";


// ── Types ────────────────────────────────────────────────────────────

interface Vendor1099 {
  vendor_id: string;
  company_name: string;
  contact_name: string | null;
  tax_id: string | null;
  address: string | null;
  ytd_payments: number;
  threshold_met: boolean;
  needs_1099: boolean;
  missing_tax_id: boolean;
}

interface Vendor1099Summary {
  total_vendors: number;
  threshold_met_count: number;
  missing_tax_id_count: number;
  total_1099_amount: number;
}

interface Vendor1099Response {
  fiscal_year: number;
  vendors: Vendor1099[];
  summary: Vendor1099Summary;
}

// ── Helpers ──────────────────────────────────────────────────────────

function fmt(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

// ── Page ─────────────────────────────────────────────────────────────

export default function Vendor1099Page() {
  const [fiscalYear, setFiscalYear] = useState(new Date().getFullYear());
  const [data, setData] = useState<Vendor1099Response | null>(null);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/accounting/vendor-1099?fiscal_year=${fiscalYear}`);
      if (res.ok) {
        setData(await res.json());
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [fiscalYear]);

  useEffect(() => { loadData(); }, [loadData]);

  const vendors = data?.vendors ?? [];
  const summary = data?.summary ?? { total_vendors: 0, threshold_met_count: 0, missing_tax_id_count: 0, total_1099_amount: 0 };

  // Sort by ytd_payments descending
  const sortedVendors = [...vendors].sort((a, b) => b.ytd_payments - a.ytd_payments);

  // Missing tax ID count (threshold met but no TIN)
  const missingTinCount = vendors.filter((v) => v.missing_tax_id && v.threshold_met).length;

  return (
    <div className="min-h-screen bg-gray-950 text-white">

      <main className="px-4 sm:px-6 py-6 max-w-7xl mx-auto">
        {/* Alert Banner */}
        {!loading && missingTinCount > 0 && (
          <div className="mb-6 px-4 py-3 rounded-xl bg-red-900/30 border border-red-800/60 flex items-start gap-3">
            <span className="text-red-400 text-lg leading-none mt-0.5">&#9888;</span>
            <p className="text-sm text-red-300">
              <span className="font-bold">{missingTinCount} vendor{missingTinCount !== 1 ? "s" : ""}</span>{" "}
              have met the $600 threshold but are missing a Tax ID. Request W-9 forms before year end.
            </p>
          </div>
        )}

        {/* Year Selector */}
        <div className="flex items-center gap-3 mb-6">
          <label className="text-xs uppercase tracking-wider text-gray-500 font-medium">Fiscal Year</label>
          <input
            type="number"
            value={fiscalYear}
            onChange={(e) => setFiscalYear(parseInt(e.target.value) || new Date().getFullYear())}
            min={2020}
            max={2099}
            className="w-28 px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white font-mono"
          />
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {[
            { label: "Total 1099 Vendors", value: summary.total_vendors, color: "text-gray-200" },
            { label: "Threshold Met (>=$600)", value: summary.threshold_met_count, color: "text-emerald-400", badge: true, badgeColor: "bg-emerald-900/50 text-emerald-300" },
            { label: "Missing Tax ID", value: summary.missing_tax_id_count, color: "text-red-400", badge: true, badgeColor: "bg-red-900/50 text-red-300" },
            { label: "Total 1099 Amount", value: fmt(summary.total_1099_amount), color: "text-gray-200" },
          ].map((c) => (
            <div key={c.label} className="rounded-xl bg-gray-900/50 border border-gray-800 p-4">
              <p className="text-xs uppercase tracking-wider text-gray-500 font-medium">{c.label}</p>
              {c.badge ? (
                <div className="flex items-center gap-2 mt-1">
                  <p className={`text-xl font-black ${c.color}`}>{c.value}</p>
                  <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase ${c.badgeColor}`}>
                    {c.label === "Threshold Met (>=$600)" ? "FILING" : "ACTION"}
                  </span>
                </div>
              ) : (
                <p className={`text-xl font-black mt-1 ${c.color}`}>{c.value}</p>
              )}
            </div>
          ))}
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
          </div>
        )}

        {/* Vendor Table */}
        {!loading && (
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead>
                <tr className="text-xs uppercase tracking-wider text-gray-500 border-b border-gray-800">
                  <th className="text-left px-4 py-3 font-medium">Vendor Name</th>
                  <th className="text-left px-4 py-3 font-medium">Contact</th>
                  <th className="text-left px-4 py-3 font-medium">Tax ID</th>
                  <th className="text-left px-4 py-3 font-medium">Address</th>
                  <th className="text-right px-4 py-3 font-medium">YTD Payments</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {sortedVendors.map((v) => (
                  <tr
                    key={v.vendor_id}
                    className={`border-t border-gray-800/50 hover:bg-gray-800/20 transition-colors ${
                      v.threshold_met ? "bg-gray-800/10" : ""
                    }`}
                  >
                    <td className="px-4 py-3 text-gray-200 font-medium">{v.company_name}</td>
                    <td className="px-4 py-3 text-gray-400">{v.contact_name || "—"}</td>
                    <td className="px-4 py-3">
                      {v.tax_id ? (
                        <span className="text-gray-400 font-mono text-xs">{v.tax_id}</span>
                      ) : v.threshold_met ? (
                        <span className="px-2 py-0.5 rounded text-xs font-bold uppercase bg-red-900/50 text-red-300">
                          MISSING
                        </span>
                      ) : (
                        <span className="text-gray-500">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{v.address || "—"}</td>
                    <td className="px-4 py-3 text-right text-gray-200 font-mono">{fmt(v.ytd_payments)}</td>
                    <td className="px-4 py-3">
                      {v.needs_1099 && !v.missing_tax_id && (
                        <span className="px-2 py-0.5 rounded text-xs font-bold uppercase bg-emerald-900/50 text-emerald-300">
                          1099 REQUIRED
                        </span>
                      )}
                      {v.missing_tax_id && v.threshold_met && (
                        <span className="px-2 py-0.5 rounded text-xs font-bold uppercase bg-red-900/50 text-red-300">
                          NEED TIN
                        </span>
                      )}
                      {!v.threshold_met && (
                        <span className="px-2 py-0.5 rounded text-xs font-bold uppercase bg-gray-800 text-gray-400">
                          BELOW $600
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {sortedVendors.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                      No 1099 vendors found for fiscal year {fiscalYear}.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Export Note */}
        {!loading && (
          <div className="mt-6 p-4 rounded-xl bg-gray-900/50 border border-gray-800">
            <p className="text-xs uppercase tracking-wider text-gray-500 font-medium mb-1">Filing Reminder</p>
            <p className="text-sm text-gray-400">
              1099-NEC forms must be filed by January 31. For electronic filing via the IRS FIRE system, use the export function (coming soon).
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
