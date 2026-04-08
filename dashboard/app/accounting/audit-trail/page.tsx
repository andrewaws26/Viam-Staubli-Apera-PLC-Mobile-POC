"use client";

import { useState, useEffect, useCallback } from "react";

interface AuditEntry {
  id: string;
  user_id: string;
  user_name: string;
  user_role: string;
  action: string;
  truck_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

interface AuditResponse {
  entries: AuditEntry[];
  total: number;
  limit: number;
  offset: number;
}

const CATEGORIES = [
  { value: "", label: "All Categories" },
  { value: "invoicing", label: "Invoicing" },
  { value: "bills", label: "Bills" },
  { value: "journal_entries", label: "Journal Entries" },
  { value: "payroll", label: "Payroll" },
  { value: "assets", label: "Assets" },
  { value: "estimates", label: "Estimates" },
  { value: "periods", label: "Periods" },
  { value: "accounts", label: "Accounts" },
  { value: "recurring", label: "Recurring" },
];

const ACTION_OPTIONS = [
  { value: "", label: "All Actions" },
  // Accounts
  { value: "account_created", label: "Account Created" },
  { value: "account_updated", label: "Account Updated" },
  { value: "account_deactivated", label: "Account Deactivated" },
  // Journal Entries
  { value: "journal_entry_created", label: "JE Created" },
  { value: "journal_entry_posted", label: "JE Posted" },
  { value: "journal_entry_voided", label: "JE Voided" },
  { value: "journal_entry_deleted", label: "JE Deleted" },
  // Invoices
  { value: "invoice_created", label: "Invoice Created" },
  { value: "invoice_sent", label: "Invoice Sent" },
  { value: "invoice_payment_recorded", label: "Invoice Payment" },
  { value: "invoice_voided", label: "Invoice Voided" },
  // Bills
  { value: "bill_created", label: "Bill Created" },
  { value: "bill_payment_recorded", label: "Bill Payment" },
  { value: "bill_voided", label: "Bill Voided" },
  // Estimates
  { value: "estimate_created", label: "Estimate Created" },
  { value: "estimate_sent", label: "Estimate Sent" },
  { value: "estimate_accepted", label: "Estimate Accepted" },
  { value: "estimate_rejected", label: "Estimate Rejected" },
  { value: "estimate_expired", label: "Estimate Expired" },
  { value: "estimate_converted", label: "Estimate Converted" },
  { value: "estimate_voided", label: "Estimate Voided" },
  { value: "estimate_deleted", label: "Estimate Deleted" },
  // Assets
  { value: "fixed_asset_created", label: "Asset Created" },
  { value: "fixed_asset_updated", label: "Asset Updated" },
  { value: "fixed_asset_disposed", label: "Asset Disposed" },
  { value: "depreciation_run", label: "Depreciation Run" },
  // Recurring
  { value: "recurring_entry_created", label: "Recurring Created" },
  { value: "recurring_entries_generated", label: "Recurring Generated" },
  { value: "recurring_entry_deleted", label: "Recurring Deleted" },
  // Periods
  { value: "accounting_period_close", label: "Period Closed" },
  { value: "accounting_period_lock", label: "Period Locked" },
  { value: "accounting_period_reopen", label: "Period Reopened" },
  { value: "year_end_close", label: "Year-End Close" },
  // Payroll
  { value: "payroll_run_created", label: "Payroll Run Created" },
  { value: "payroll_run_approved", label: "Payroll Run Approved" },
];

const ROLE_STYLES: Record<string, string> = {
  developer: "bg-violet-900/50 text-violet-300",
  manager: "bg-blue-900/50 text-blue-300",
  operator: "bg-gray-800 text-gray-400",
  mechanic: "bg-amber-900/50 text-amber-300",
};

const PAGE_SIZE = 50;

function getActionColor(action: string): string {
  if (action.includes("created") || action.includes("recorded"))
    return "text-green-400";
  if (action.includes("updated") || action.includes("posted") || action.includes("generated"))
    return "text-blue-400";
  if (action.includes("deleted") || action.includes("voided") || action.includes("disposed"))
    return "text-red-400";
  if (action.includes("sent") || action.includes("approved") || action.includes("accepted") || action.includes("converted"))
    return "text-violet-400";
  if (action.includes("rejected") || action.includes("expired"))
    return "text-amber-400";
  return "text-gray-400";
}

function getActionBg(action: string): string {
  if (action.includes("created") || action.includes("recorded"))
    return "bg-green-900/20";
  if (action.includes("updated") || action.includes("posted") || action.includes("generated"))
    return "bg-blue-900/20";
  if (action.includes("deleted") || action.includes("voided") || action.includes("disposed"))
    return "bg-red-900/20";
  if (action.includes("sent") || action.includes("approved") || action.includes("accepted") || action.includes("converted"))
    return "bg-violet-900/20";
  return "bg-gray-900/20";
}

function formatAction(action: string): string {
  return action
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }) + " " + d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function fmtCurrency(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
}

function extractDetails(action: string, details: Record<string, unknown>): string {
  if (!details || Object.keys(details).length === 0) return "-";

  // Invoice actions
  if (action.startsWith("invoice_")) {
    const parts: string[] = [];
    if (details.invoice_number) parts.push(`INV #${details.invoice_number}`);
    if (details.customer_name) parts.push(String(details.customer_name));
    if (details.total) parts.push(fmtCurrency(Number(details.total)));
    if (details.amount) parts.push(fmtCurrency(Number(details.amount)));
    if (details.new_status) parts.push(`Status: ${details.new_status}`);
    if (parts.length > 0) return parts.join(" / ");
  }

  // Journal entry actions
  if (action.startsWith("journal_entry_")) {
    const parts: string[] = [];
    if (details.description) parts.push(String(details.description));
    if (details.entry_date) parts.push(String(details.entry_date));
    if (details.total_amount) parts.push(fmtCurrency(Number(details.total_amount)));
    if (details.reference) parts.push(`Ref: ${details.reference}`);
    if (details.line_count) parts.push(`${details.line_count} lines`);
    if (details.reason) parts.push(`Reason: ${details.reason}`);
    if (parts.length > 0) return parts.join(" / ");
  }

  // Bill actions
  if (action.startsWith("bill_")) {
    const parts: string[] = [];
    if (details.vendor_ref) parts.push(`Ref: ${details.vendor_ref}`);
    if (details.vendor_name) parts.push(String(details.vendor_name));
    if (details.total) parts.push(fmtCurrency(Number(details.total)));
    if (details.amount) parts.push(fmtCurrency(Number(details.amount)));
    if (parts.length > 0) return parts.join(" / ");
  }

  // Estimate actions
  if (action.startsWith("estimate_")) {
    const parts: string[] = [];
    if (details.estimate_number) parts.push(`EST #${details.estimate_number}`);
    if (details.customer_name) parts.push(String(details.customer_name));
    if (details.total) parts.push(fmtCurrency(Number(details.total)));
    if (details.invoice_number) parts.push(`-> INV #${details.invoice_number}`);
    if (parts.length > 0) return parts.join(" / ");
  }

  // Fixed asset actions
  if (action.startsWith("fixed_asset_")) {
    const parts: string[] = [];
    if (details.name) parts.push(String(details.name));
    if (details.asset_name) parts.push(String(details.asset_name));
    if (details.purchase_cost) parts.push(fmtCurrency(Number(details.purchase_cost)));
    if (details.disposal_amount !== undefined) parts.push(`Disposed: ${fmtCurrency(Number(details.disposal_amount))}`);
    if (details.gain_loss !== undefined) parts.push(`G/L: ${fmtCurrency(Number(details.gain_loss))}`);
    if (parts.length > 0) return parts.join(" / ");
  }

  // Depreciation
  if (action === "depreciation_run") {
    const parts: string[] = [];
    if (details.period_date) parts.push(String(details.period_date));
    if (details.total_depreciation) parts.push(fmtCurrency(Number(details.total_depreciation)));
    if (details.assets_processed) parts.push(`${details.assets_processed} assets`);
    if (parts.length > 0) return parts.join(" / ");
  }

  // Account actions
  if (action.startsWith("account_")) {
    const parts: string[] = [];
    if (details.account_number) parts.push(`#${details.account_number}`);
    if (details.name) parts.push(String(details.name));
    if (details.account_name) parts.push(String(details.account_name));
    if (details.type) parts.push(String(details.type));
    if (parts.length > 0) return parts.join(" / ");
  }

  // Recurring
  if (action.startsWith("recurring_")) {
    const parts: string[] = [];
    if (details.description) parts.push(String(details.description));
    if (details.count) parts.push(`${details.count} entries`);
    if (details.total_amount) parts.push(fmtCurrency(Number(details.total_amount)));
    if (parts.length > 0) return parts.join(" / ");
  }

  // Period actions
  if (action.startsWith("accounting_period_") || action.startsWith("year_end_")) {
    const parts: string[] = [];
    if (details.period) parts.push(String(details.period));
    if (details.year) parts.push(`FY ${details.year}`);
    if (details.month) parts.push(String(details.month));
    if (parts.length > 0) return parts.join(" / ");
  }

  // Payroll
  if (action.startsWith("payroll_")) {
    const parts: string[] = [];
    if (details.employee_name) parts.push(String(details.employee_name));
    if (details.gross_pay) parts.push(`Gross: ${fmtCurrency(Number(details.gross_pay))}`);
    if (details.total_gross) parts.push(`Total: ${fmtCurrency(Number(details.total_gross))}`);
    if (details.employee_count) parts.push(`${details.employee_count} employees`);
    if (parts.length > 0) return parts.join(" / ");
  }

  // Fallback: show key/value pairs, truncated
  const fallback = JSON.stringify(details);
  return fallback.length > 80 ? fallback.slice(0, 77) + "..." : fallback;
}

function buildCsvContent(entries: AuditEntry[]): string {
  const headers = ["Timestamp", "User", "Role", "Action", "Details"];
  const rows = entries.map((e) => [
    e.created_at,
    e.user_name,
    e.user_role,
    e.action,
    `"${extractDetails(e.action, e.details).replace(/"/g, '""')}"`,
  ]);
  return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
}

export default function AuditTrailPage() {
  const [data, setData] = useState<AuditResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  // Filters
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [category, setCategory] = useState("");
  const [userName, setUserName] = useState("");
  const [action, setAction] = useState("");
  const [page, setPage] = useState(0);

  const fetchData = useCallback(async (pageNum: number) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(pageNum * PAGE_SIZE));
      if (startDate) params.set("start_date", startDate);
      if (endDate) params.set("end_date", endDate);
      if (category) params.set("category", category);
      if (userName) params.set("user_id", userName);
      if (action) params.set("action", action);

      const res = await fetch(`/api/accounting/audit-trail?${params.toString()}`);
      if (res.ok) {
        setData(await res.json());
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [startDate, endDate, category, userName, action]);

  useEffect(() => {
    fetchData(page);
  }, [fetchData, page]);

  function handleFilter() {
    setPage(0);
    fetchData(0);
  }

  function handleReset() {
    setStartDate("");
    setEndDate("");
    setCategory("");
    setUserName("");
    setAction("");
    setPage(0);
  }

  async function handleExport() {
    setExporting(true);
    try {
      // Fetch all matching results (up to 200) for export
      const params = new URLSearchParams();
      params.set("limit", "200");
      params.set("offset", "0");
      if (startDate) params.set("start_date", startDate);
      if (endDate) params.set("end_date", endDate);
      if (category) params.set("category", category);
      if (userName) params.set("user_id", userName);
      if (action) params.set("action", action);

      const res = await fetch(`/api/accounting/audit-trail?${params.toString()}`);
      if (res.ok) {
        const result: AuditResponse = await res.json();
        const csv = buildCsvContent(result.entries);
        const blob = new Blob([csv], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `audit-trail-${new Date().toISOString().split("T")[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch { /* ignore */ }
    setExporting(false);
  }

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;
  const entries = data?.entries ?? [];

  return (
    <div className="min-h-screen bg-gray-950 text-white">

      <main className="px-4 sm:px-6 py-6 max-w-7xl mx-auto">
        {/* Summary Card */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <div className="rounded-xl bg-gray-900/50 border border-gray-800 p-4">
            <p className="text-[10px] uppercase tracking-wider text-gray-600 font-medium">Total Records</p>
            <p className="text-xl font-black mt-1 text-gray-200">{data?.total ?? "-"}</p>
          </div>
          <div className="rounded-xl bg-gray-900/50 border border-gray-800 p-4">
            <p className="text-[10px] uppercase tracking-wider text-gray-600 font-medium">Showing</p>
            <p className="text-xl font-black mt-1 text-violet-400">{entries.length}</p>
          </div>
          <div className="rounded-xl bg-gray-900/50 border border-gray-800 p-4">
            <p className="text-[10px] uppercase tracking-wider text-gray-600 font-medium">Page</p>
            <p className="text-xl font-black mt-1 text-blue-400">{totalPages > 0 ? page + 1 : 0} / {totalPages}</p>
          </div>
          <div className="rounded-xl bg-gray-900/50 border border-gray-800 p-4">
            <p className="text-[10px] uppercase tracking-wider text-gray-600 font-medium">Filters Active</p>
            <p className="text-xl font-black mt-1 text-amber-400">
              {[startDate, endDate, category, userName, action].filter(Boolean).length}
            </p>
          </div>
        </div>

        {/* Filters */}
        <div className="mb-6 p-5 rounded-xl bg-gray-900/50 border border-gray-800 space-y-4">
          <h3 className="text-sm font-bold uppercase tracking-wider text-gray-300">Filters</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <div>
              <label className="block text-[10px] text-gray-600 uppercase tracking-wider mb-1">Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white [color-scheme:dark]"
              />
            </div>
            <div>
              <label className="block text-[10px] text-gray-600 uppercase tracking-wider mb-1">End Date</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white [color-scheme:dark]"
              />
            </div>
            <div>
              <label className="block text-[10px] text-gray-600 uppercase tracking-wider mb-1">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white"
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-gray-600 uppercase tracking-wider mb-1">User Name</label>
              <input
                type="text"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                placeholder="Search by name..."
                className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white placeholder-gray-700"
              />
            </div>
            <div>
              <label className="block text-[10px] text-gray-600 uppercase tracking-wider mb-1">Action</label>
              <select
                value={action}
                onChange={(e) => setAction(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white"
              >
                {ACTION_OPTIONS.map((a) => (
                  <option key={a.value} value={a.value}>{a.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={handleFilter}
              className="px-5 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-bold uppercase tracking-wider"
            >
              Apply Filters
            </button>
            <button
              onClick={handleReset}
              className="px-4 py-2 rounded-lg border border-gray-700 hover:border-gray-500 text-gray-400 text-sm font-bold uppercase tracking-wider"
            >
              Reset
            </button>
            <button
              onClick={handleExport}
              disabled={exporting || entries.length === 0}
              className="px-4 py-2 rounded-lg border border-gray-700 hover:border-gray-500 text-gray-400 text-sm font-bold uppercase tracking-wider disabled:opacity-50"
            >
              {exporting ? "Exporting..." : "Export CSV"}
            </button>
          </div>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
          </div>
        )}

        {/* Results Table */}
        {!loading && (
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-gray-600 border-b border-gray-800">
                  <th className="text-left px-4 py-3 font-medium w-44">Timestamp</th>
                  <th className="text-left px-4 py-3 font-medium w-36">User</th>
                  <th className="text-left px-4 py-3 font-medium w-24">Role</th>
                  <th className="text-left px-4 py-3 font-medium w-48">Action</th>
                  <th className="text-left px-4 py-3 font-medium">Details</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id} className="border-t border-gray-800/50 hover:bg-gray-800/20 transition-colors">
                    <td className="px-4 py-3 text-gray-400 text-xs font-mono whitespace-nowrap">
                      {formatTimestamp(entry.created_at)}
                    </td>
                    <td className="px-4 py-3 text-gray-200 text-xs">
                      {entry.user_name}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${ROLE_STYLES[entry.user_role] || ROLE_STYLES.operator}`}>
                        {entry.user_role}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${getActionColor(entry.action)} ${getActionBg(entry.action)}`}>
                        {formatAction(entry.action)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs max-w-md truncate">
                      {extractDetails(entry.action, entry.details)}
                    </td>
                  </tr>
                ))}
                {entries.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center text-gray-600">
                      No audit trail entries found. Adjust your filters or check back later.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {!loading && totalPages > 1 && (
          <div className="flex items-center justify-between mt-4">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-4 py-2 rounded-lg border border-gray-700 hover:border-gray-500 text-gray-400 text-sm font-bold uppercase tracking-wider disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <span className="text-xs text-gray-500">
              Page {page + 1} of {totalPages} ({data?.total ?? 0} total records)
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="px-4 py-2 rounded-lg border border-gray-700 hover:border-gray-500 text-gray-400 text-sm font-bold uppercase tracking-wider disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
