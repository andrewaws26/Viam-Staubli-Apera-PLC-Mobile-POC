"use client";

import { useState, useEffect, useRef } from "react";
import AppNav from "@/components/AppNav";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GlAccount {
  id: string;
  account_number: string;
  name: string;
  account_type?: string;
}

interface Rule {
  id: string;
  name: string;
  match_type: string;
  match_pattern: string;
  category: string;
  gl_account_id: string | null;
  chart_of_accounts?: { account_number: string; name: string } | null;
  priority: number;
  is_active: boolean;
  created_at: string;
}

interface CcAccount {
  id: string;
  name: string;
  last_four: string | null;
  gl_account_id: string | null;
  chart_of_accounts?: { account_number: string; name: string } | null;
  is_active: boolean;
}

interface CcTransaction {
  id: string;
  credit_card_account_id: string;
  credit_card_accounts?: { name: string; last_four: string | null } | null;
  transaction_date: string;
  posted_date: string | null;
  description: string;
  amount: number;
  category: string | null;
  gl_account_id: string | null;
  chart_of_accounts?: { account_number: string; name: string } | null;
  status: string;
  journal_entry_id: string | null;
  import_batch: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtCurrency(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
}

function fmtDate(iso: string): string {
  return new Date(iso + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  pending:     { bg: "bg-amber-900/50",    text: "text-amber-300" },
  categorized: { bg: "bg-blue-900/50",     text: "text-blue-300" },
  posted:      { bg: "bg-emerald-900/50",  text: "text-emerald-300" },
  excluded:    { bg: "bg-gray-800",        text: "text-gray-400" },
};

const MATCH_TYPE_LABELS: Record<string, string> = {
  contains: "Contains",
  starts_with: "Starts With",
  exact: "Exact Match",
  regex: "Regex",
};

type Tab = "rules" | "cc_accounts" | "import" | "transactions";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ExpenseRulesPage() {
  // Tab state
  const [activeTab, setActiveTab] = useState<Tab>("rules");

  // Data
  const [rules, setRules] = useState<Rule[]>([]);
  const [ccAccounts, setCcAccounts] = useState<CcAccount[]>([]);
  const [transactions, setTransactions] = useState<CcTransaction[]>([]);
  const [glAccounts, setGlAccounts] = useState<GlAccount[]>([]);
  const [loading, setLoading] = useState(true);

  // Success / error banners
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // ── Rule form state ─────────────────────────────────────────
  const [showCreateRule, setShowCreateRule] = useState(false);
  const [ruleName, setRuleName] = useState("");
  const [ruleMatchType, setRuleMatchType] = useState("contains");
  const [rulePattern, setRulePattern] = useState("");
  const [ruleCategory, setRuleCategory] = useState("");
  const [ruleGlAccountId, setRuleGlAccountId] = useState("");
  const [rulePriority, setRulePriority] = useState(50);
  const [savingRule, setSavingRule] = useState(false);

  // ── CC Account form state ───────────────────────────────────
  const [showCreateCC, setShowCreateCC] = useState(false);
  const [ccName, setCcName] = useState("");
  const [ccLastFour, setCcLastFour] = useState("");
  const [ccGlAccountId, setCcGlAccountId] = useState("");
  const [savingCC, setSavingCC] = useState(false);

  // ── Import state ────────────────────────────────────────────
  const [importCcAccountId, setImportCcAccountId] = useState("");
  const [csvPreview, setCsvPreview] = useState<{ date: string; description: string; amount: number }[]>([]);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Transaction review state ────────────────────────────────
  const [selectedTxIds, setSelectedTxIds] = useState<Set<string>>(new Set());
  const [posting, setPosting] = useState(false);
  const [categorizing, setCategorizing] = useState(false);
  const [txStatusFilter, setTxStatusFilter] = useState("all");

  // ── Editing state ───────────────────────────────────────────
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [editFields, setEditFields] = useState<Partial<Rule>>({});

  // ── Data loading ────────────────────────────────────────────

  async function loadData() {
    setLoading(true);
    try {
      const [rulesRes, ccRes, txRes, glRes] = await Promise.all([
        fetch("/api/accounting/expense-rules?section=rules"),
        fetch("/api/accounting/expense-rules?section=cc_accounts"),
        fetch("/api/accounting/expense-rules?section=transactions"),
        fetch("/api/accounting/expense-rules?section=gl_accounts"),
      ]);

      if (rulesRes.ok) setRules(await rulesRes.json());
      if (ccRes.ok) setCcAccounts(await ccRes.json());
      if (txRes.ok) setTransactions(await txRes.json());
      if (glRes.ok) setGlAccounts(await glRes.json());
    } catch { /* ignore */ }
    setLoading(false);
  }

  useEffect(() => { loadData(); }, []);

  // Auto-dismiss banners
  useEffect(() => {
    if (successMsg) {
      const t = setTimeout(() => setSuccessMsg(null), 6000);
      return () => clearTimeout(t);
    }
  }, [successMsg]);
  useEffect(() => {
    if (errorMsg) {
      const t = setTimeout(() => setErrorMsg(null), 8000);
      return () => clearTimeout(t);
    }
  }, [errorMsg]);

  // ── Rule CRUD ───────────────────────────────────────────────

  async function handleCreateRule() {
    if (!ruleName || !rulePattern || !ruleCategory) return;
    setSavingRule(true);
    try {
      const res = await fetch("/api/accounting/expense-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          name: ruleName,
          match_type: ruleMatchType,
          match_pattern: rulePattern,
          category: ruleCategory,
          gl_account_id: ruleGlAccountId || null,
          priority: rulePriority,
        }),
      });
      if (res.ok) {
        setSuccessMsg("Rule created");
        setShowCreateRule(false);
        setRuleName(""); setRulePattern(""); setRuleCategory(""); setRuleGlAccountId(""); setRulePriority(50);
        loadData();
      } else {
        const data = await res.json();
        setErrorMsg(data.error || "Failed to create rule");
      }
    } catch { setErrorMsg("Network error"); }
    setSavingRule(false);
  }

  async function handleToggleRule(id: string, currentActive: boolean) {
    try {
      await fetch("/api/accounting/expense-rules", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, section: "rule", is_active: !currentActive }),
      });
      loadData();
    } catch { /* ignore */ }
  }

  async function handleDeleteRule(id: string) {
    if (!confirm("Delete this rule?")) return;
    try {
      await fetch("/api/accounting/expense-rules", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, section: "rule" }),
      });
      loadData();
    } catch { /* ignore */ }
  }

  async function handleSaveEditRule() {
    if (!editingRuleId) return;
    try {
      const res = await fetch("/api/accounting/expense-rules", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editingRuleId, section: "rule", ...editFields }),
      });
      if (res.ok) {
        setEditingRuleId(null);
        setEditFields({});
        loadData();
      }
    } catch { /* ignore */ }
  }

  // ── CC Account CRUD ─────────────────────────────────────────

  async function handleCreateCCAccount() {
    if (!ccName) return;
    setSavingCC(true);
    try {
      const res = await fetch("/api/accounting/expense-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_cc_account",
          name: ccName,
          last_four: ccLastFour || null,
          gl_account_id: ccGlAccountId || null,
        }),
      });
      if (res.ok) {
        setSuccessMsg("Credit card account created");
        setShowCreateCC(false);
        setCcName(""); setCcLastFour(""); setCcGlAccountId("");
        loadData();
      } else {
        const data = await res.json();
        setErrorMsg(data.error || "Failed to create CC account");
      }
    } catch { setErrorMsg("Network error"); }
    setSavingCC(false);
  }

  // ── CSV Import ──────────────────────────────────────────────

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      if (!text) return;

      const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
      if (lines.length < 2) { setErrorMsg("CSV must have a header row and at least one data row"); return; }

      // Parse header
      const header = lines[0].toLowerCase().split(",").map((h) => h.trim().replace(/"/g, ""));
      const dateIdx = header.findIndex((h) => h === "date" || h === "transaction date" || h === "trans date");
      const descIdx = header.findIndex((h) => h === "description" || h === "desc" || h === "merchant" || h === "name");
      const amtIdx = header.findIndex((h) => h === "amount" || h === "charge" || h === "debit");

      if (dateIdx === -1 || descIdx === -1 || amtIdx === -1) {
        setErrorMsg("CSV must have columns: date, description, amount");
        return;
      }

      const rows: { date: string; description: string; amount: number }[] = [];
      for (let i = 1; i < lines.length; i++) {
        // Simple CSV parse (handles quoted fields with commas)
        const cols = parseCSVLine(lines[i]);
        if (cols.length <= Math.max(dateIdx, descIdx, amtIdx)) continue;

        const rawDate = cols[dateIdx].trim();
        const desc = cols[descIdx].trim();
        const amt = parseFloat(cols[amtIdx].replace(/[$,]/g, "").trim());

        if (!rawDate || !desc || isNaN(amt)) continue;

        // Normalize date to YYYY-MM-DD
        const dateStr = normalizeDate(rawDate);
        if (!dateStr) continue;

        rows.push({ date: dateStr, description: desc, amount: amt });
      }

      setCsvPreview(rows);
      if (rows.length === 0) setErrorMsg("No valid rows found in CSV");
    };
    reader.readAsText(file);
  }

  function parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQuotes = !inQuotes; continue; }
      if (ch === "," && !inQuotes) { result.push(current); current = ""; continue; }
      current += ch;
    }
    result.push(current);
    return result;
  }

  function normalizeDate(raw: string): string | null {
    // Try YYYY-MM-DD first
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    // Try MM/DD/YYYY or M/D/YYYY
    const parts = raw.split("/");
    if (parts.length === 3) {
      const m = parts[0].padStart(2, "0");
      const d = parts[1].padStart(2, "0");
      const y = parts[2].length === 2 ? "20" + parts[2] : parts[2];
      return `${y}-${m}-${d}`;
    }
    // Try Date parse as fallback
    const d = new Date(raw);
    if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
    return null;
  }

  async function handleImport() {
    if (!importCcAccountId || csvPreview.length === 0) return;
    setImporting(true);
    try {
      const res = await fetch("/api/accounting/expense-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "import_csv",
          credit_card_account_id: importCcAccountId,
          transactions: csvPreview,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setSuccessMsg(data.message);
        setCsvPreview([]);
        if (fileRef.current) fileRef.current.value = "";
        loadData();
        setActiveTab("transactions");
      } else {
        setErrorMsg(data.error || "Import failed");
      }
    } catch { setErrorMsg("Network error"); }
    setImporting(false);
  }

  // ── Transaction Review ──────────────────────────────────────

  async function handleCategorize() {
    setCategorizing(true);
    try {
      const res = await fetch("/api/accounting/expense-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "categorize" }),
      });
      const data = await res.json();
      if (res.ok) {
        setSuccessMsg(data.message);
        loadData();
      } else {
        setErrorMsg(data.error || "Categorization failed");
      }
    } catch { setErrorMsg("Network error"); }
    setCategorizing(false);
  }

  async function handlePostTransactions() {
    if (selectedTxIds.size === 0) return;
    if (!confirm(`Post ${selectedTxIds.size} transaction(s) as journal entries?`)) return;
    setPosting(true);
    try {
      const res = await fetch("/api/accounting/expense-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "post_transactions", transaction_ids: Array.from(selectedTxIds) }),
      });
      const data = await res.json();
      if (res.ok) {
        setSuccessMsg(data.message);
        setSelectedTxIds(new Set());
        loadData();
      } else {
        setErrorMsg(data.error || "Posting failed");
      }
    } catch { setErrorMsg("Network error"); }
    setPosting(false);
  }

  async function handleUpdateTxCategory(txId: string, category: string, glAccountId: string) {
    try {
      await fetch("/api/accounting/expense-rules", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: txId,
          section: "transaction",
          category,
          gl_account_id: glAccountId,
          status: "categorized",
        }),
      });
      loadData();
    } catch { /* ignore */ }
  }

  async function handleExcludeTx(txId: string) {
    try {
      await fetch("/api/accounting/expense-rules", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: txId, section: "transaction", status: "excluded" }),
      });
      loadData();
    } catch { /* ignore */ }
  }

  function toggleSelectTx(txId: string) {
    setSelectedTxIds((prev) => {
      const next = new Set(prev);
      if (next.has(txId)) next.delete(txId); else next.add(txId);
      return next;
    });
  }

  function selectAllCategorized() {
    const ids = filteredTransactions.filter((t) => t.status === "categorized").map((t) => t.id);
    setSelectedTxIds(new Set(ids));
  }

  // ── Filtered transactions ───────────────────────────────────
  const filteredTransactions = txStatusFilter === "all"
    ? transactions
    : transactions.filter((t) => t.status === txStatusFilter);

  // ── Summary stats ───────────────────────────────────────────
  const pendingCount = transactions.filter((t) => t.status === "pending").length;
  const categorizedCount = transactions.filter((t) => t.status === "categorized").length;
  const postedCount = transactions.filter((t) => t.status === "posted").length;
  const totalCharges = transactions
    .filter((t) => t.status !== "excluded" && Number(t.amount) > 0)
    .reduce((s, t) => s + Number(t.amount), 0);

  // Expense GL accounts for dropdowns
  const expenseAccounts = glAccounts.filter((a) => a.account_type === "expense");
  const liabilityAccounts = glAccounts.filter((a) => a.account_type === "liability");

  // ── Render ──────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <AppNav pageTitle="Expense Rules" />

      <main className="px-4 sm:px-6 py-6 max-w-7xl mx-auto">
        {/* Banners */}
        {successMsg && (
          <div className="mb-4 p-3 rounded-lg bg-emerald-900/40 border border-emerald-700 text-emerald-300 text-sm font-medium flex items-center justify-between">
            <span>{successMsg}</span>
            <button onClick={() => setSuccessMsg(null)} className="text-emerald-400 hover:text-emerald-200 font-bold ml-4">X</button>
          </div>
        )}
        {errorMsg && (
          <div className="mb-4 p-3 rounded-lg bg-red-900/40 border border-red-700 text-red-300 text-sm font-medium flex items-center justify-between">
            <span>{errorMsg}</span>
            <button onClick={() => setErrorMsg(null)} className="text-red-400 hover:text-red-200 font-bold ml-4">X</button>
          </div>
        )}

        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <div className="p-4 rounded-xl bg-gray-900/50 border border-gray-800">
            <div className="text-[10px] text-gray-600 uppercase tracking-wider mb-1">Rules</div>
            <div className="text-xl font-bold text-gray-100">{rules.length}</div>
          </div>
          <div className="p-4 rounded-xl bg-gray-900/50 border border-gray-800">
            <div className="text-[10px] text-gray-600 uppercase tracking-wider mb-1">Pending</div>
            <div className="text-xl font-bold text-amber-400">{pendingCount}</div>
          </div>
          <div className="p-4 rounded-xl bg-gray-900/50 border border-gray-800">
            <div className="text-[10px] text-gray-600 uppercase tracking-wider mb-1">Categorized</div>
            <div className="text-xl font-bold text-blue-400">{categorizedCount}</div>
          </div>
          <div className="p-4 rounded-xl bg-gray-900/50 border border-gray-800">
            <div className="text-[10px] text-gray-600 uppercase tracking-wider mb-1">Total Charges</div>
            <div className="text-xl font-bold text-emerald-400">{fmtCurrency(totalCharges)}</div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 border-b border-gray-800">
          {([
            { key: "rules", label: "Rules Manager" },
            { key: "cc_accounts", label: "Credit Cards" },
            { key: "import", label: "Import Transactions" },
            { key: "transactions", label: `Transaction Review (${pendingCount + categorizedCount})` },
          ] as { key: Tab; label: string }[]).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2.5 text-sm font-bold uppercase tracking-wider border-b-2 transition-colors ${
                activeTab === tab.key
                  ? "border-violet-500 text-violet-300"
                  : "border-transparent text-gray-500 hover:text-gray-300"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
          </div>
        )}

        {!loading && (
          <>
            {/* ═══════════════════════════════════════════════════════════
                TAB: Rules Manager
                ═══════════════════════════════════════════════════════ */}
            {activeTab === "rules" && (
              <div>
                <div className="flex gap-3 mb-4">
                  <button
                    onClick={() => setShowCreateRule(!showCreateRule)}
                    className="px-5 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-bold uppercase tracking-wider"
                  >
                    + New Rule
                  </button>
                </div>

                {/* Create rule form */}
                {showCreateRule && (
                  <div className="mb-6 p-6 rounded-xl bg-gray-900/50 border border-gray-800 space-y-4">
                    <h3 className="text-sm font-bold uppercase tracking-wider text-gray-300">New Categorization Rule</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-[10px] text-gray-600 uppercase tracking-wider mb-1">Rule Name *</label>
                        <input value={ruleName} onChange={(e) => setRuleName(e.target.value)} placeholder="e.g., Gas stations"
                          className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white" />
                      </div>
                      <div>
                        <label className="block text-[10px] text-gray-600 uppercase tracking-wider mb-1">Match Type *</label>
                        <select value={ruleMatchType} onChange={(e) => setRuleMatchType(e.target.value)}
                          className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white">
                          <option value="contains">Contains</option>
                          <option value="starts_with">Starts With</option>
                          <option value="exact">Exact Match</option>
                          <option value="regex">Regex</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] text-gray-600 uppercase tracking-wider mb-1">Pattern *</label>
                        <input value={rulePattern} onChange={(e) => setRulePattern(e.target.value)} placeholder="e.g., SHELL"
                          className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white" />
                      </div>
                      <div>
                        <label className="block text-[10px] text-gray-600 uppercase tracking-wider mb-1">Category *</label>
                        <input value={ruleCategory} onChange={(e) => setRuleCategory(e.target.value)} placeholder="e.g., Fuel"
                          className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white" />
                      </div>
                      <div>
                        <label className="block text-[10px] text-gray-600 uppercase tracking-wider mb-1">GL Account</label>
                        <select value={ruleGlAccountId} onChange={(e) => setRuleGlAccountId(e.target.value)}
                          className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white">
                          <option value="">Select account...</option>
                          {expenseAccounts.map((a) => (
                            <option key={a.id} value={a.id}>{a.account_number} {a.name}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] text-gray-600 uppercase tracking-wider mb-1">Priority (0-100)</label>
                        <input type="number" value={rulePriority} onChange={(e) => setRulePriority(Number(e.target.value))} min={0} max={100}
                          className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white" />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={handleCreateRule} disabled={savingRule || !ruleName || !rulePattern || !ruleCategory}
                        className="px-5 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-bold uppercase tracking-wider">
                        {savingRule ? "Creating..." : "Create Rule"}
                      </button>
                      <button onClick={() => setShowCreateRule(false)}
                        className="px-4 py-2 rounded-lg border border-gray-700 text-gray-400 text-sm font-bold uppercase tracking-wider">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* Rules table */}
                <div className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden overflow-x-auto">
                  <table className="w-full text-sm min-w-[900px]">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-wider text-gray-600 border-b border-gray-800">
                        <th className="text-left px-4 py-3 font-medium">Name</th>
                        <th className="text-left px-4 py-3 font-medium w-24">Type</th>
                        <th className="text-left px-4 py-3 font-medium">Pattern</th>
                        <th className="text-left px-4 py-3 font-medium">Category</th>
                        <th className="text-left px-4 py-3 font-medium">GL Account</th>
                        <th className="text-center px-4 py-3 font-medium w-16">Pri</th>
                        <th className="text-center px-4 py-3 font-medium w-16">Active</th>
                        <th className="text-right px-4 py-3 font-medium w-36">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rules.map((rule) => {
                        const isEditing = editingRuleId === rule.id;
                        return (
                          <tr key={rule.id} className="border-t border-gray-800/50 hover:bg-gray-800/20 transition-colors">
                            <td className="px-4 py-3 text-gray-200">
                              {isEditing ? (
                                <input value={editFields.name ?? rule.name} onChange={(e) => setEditFields((p) => ({ ...p, name: e.target.value }))}
                                  className="w-full px-2 py-1 rounded bg-gray-800 border border-gray-700 text-sm text-white" />
                              ) : rule.name}
                            </td>
                            <td className="px-4 py-3">
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-gray-800 text-gray-300">
                                {MATCH_TYPE_LABELS[rule.match_type] || rule.match_type}
                              </span>
                            </td>
                            <td className="px-4 py-3 font-mono text-xs text-gray-400">
                              {isEditing ? (
                                <input value={editFields.match_pattern ?? rule.match_pattern} onChange={(e) => setEditFields((p) => ({ ...p, match_pattern: e.target.value }))}
                                  className="w-full px-2 py-1 rounded bg-gray-800 border border-gray-700 text-sm text-white font-mono" />
                              ) : rule.match_pattern}
                            </td>
                            <td className="px-4 py-3 text-gray-300">
                              {isEditing ? (
                                <input value={editFields.category ?? rule.category} onChange={(e) => setEditFields((p) => ({ ...p, category: e.target.value }))}
                                  className="w-full px-2 py-1 rounded bg-gray-800 border border-gray-700 text-sm text-white" />
                              ) : rule.category}
                            </td>
                            <td className="px-4 py-3 text-xs text-gray-400">
                              {rule.chart_of_accounts
                                ? `${rule.chart_of_accounts.account_number} ${rule.chart_of_accounts.name}`
                                : "\u2014"}
                            </td>
                            <td className="px-4 py-3 text-center font-mono text-gray-400">
                              {isEditing ? (
                                <input type="number" value={editFields.priority ?? rule.priority} onChange={(e) => setEditFields((p) => ({ ...p, priority: Number(e.target.value) }))}
                                  className="w-14 px-1 py-1 rounded bg-gray-800 border border-gray-700 text-sm text-white text-center" />
                              ) : rule.priority}
                            </td>
                            <td className="px-4 py-3 text-center">
                              <button onClick={() => handleToggleRule(rule.id, rule.is_active)}
                                className={`w-10 h-5 rounded-full relative transition-colors ${rule.is_active ? "bg-violet-600" : "bg-gray-700"}`}>
                                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${rule.is_active ? "left-5" : "left-0.5"}`} />
                              </button>
                            </td>
                            <td className="px-4 py-3 text-right">
                              {isEditing ? (
                                <div className="flex gap-2 justify-end">
                                  <button onClick={handleSaveEditRule} className="text-xs text-emerald-400 hover:text-emerald-300 font-bold uppercase">Save</button>
                                  <button onClick={() => { setEditingRuleId(null); setEditFields({}); }} className="text-xs text-gray-400 hover:text-gray-300 font-bold uppercase">Cancel</button>
                                </div>
                              ) : (
                                <div className="flex gap-2 justify-end">
                                  <button onClick={() => { setEditingRuleId(rule.id); setEditFields({}); }}
                                    className="text-xs text-blue-400 hover:text-blue-300 font-bold uppercase">Edit</button>
                                  <button onClick={() => handleDeleteRule(rule.id)}
                                    className="text-xs text-red-400/60 hover:text-red-300 font-bold uppercase">Del</button>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      {rules.length === 0 && (
                        <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-600">No rules yet. Create your first rule above.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ═══════════════════════════════════════════════════════════
                TAB: Credit Card Accounts
                ═══════════════════════════════════════════════════════ */}
            {activeTab === "cc_accounts" && (
              <div>
                <div className="flex gap-3 mb-4">
                  <button
                    onClick={() => setShowCreateCC(!showCreateCC)}
                    className="px-5 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-bold uppercase tracking-wider"
                  >
                    + New Credit Card
                  </button>
                </div>

                {showCreateCC && (
                  <div className="mb-6 p-6 rounded-xl bg-gray-900/50 border border-gray-800 space-y-4">
                    <h3 className="text-sm font-bold uppercase tracking-wider text-gray-300">New Credit Card Account</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-[10px] text-gray-600 uppercase tracking-wider mb-1">Card Name *</label>
                        <input value={ccName} onChange={(e) => setCcName(e.target.value)} placeholder="e.g., Company Chase Visa"
                          className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white" />
                      </div>
                      <div>
                        <label className="block text-[10px] text-gray-600 uppercase tracking-wider mb-1">Last 4 Digits</label>
                        <input value={ccLastFour} onChange={(e) => setCcLastFour(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="1234" maxLength={4}
                          className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white font-mono" />
                      </div>
                      <div>
                        <label className="block text-[10px] text-gray-600 uppercase tracking-wider mb-1">Liability GL Account</label>
                        <select value={ccGlAccountId} onChange={(e) => setCcGlAccountId(e.target.value)}
                          className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white">
                          <option value="">Select account...</option>
                          {liabilityAccounts.map((a) => (
                            <option key={a.id} value={a.id}>{a.account_number} {a.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={handleCreateCCAccount} disabled={savingCC || !ccName}
                        className="px-5 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-bold uppercase tracking-wider">
                        {savingCC ? "Creating..." : "Create Card"}
                      </button>
                      <button onClick={() => setShowCreateCC(false)}
                        className="px-4 py-2 rounded-lg border border-gray-700 text-gray-400 text-sm font-bold uppercase tracking-wider">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* CC accounts list */}
                <div className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-wider text-gray-600 border-b border-gray-800">
                        <th className="text-left px-4 py-3 font-medium">Card Name</th>
                        <th className="text-left px-4 py-3 font-medium w-24">Last 4</th>
                        <th className="text-left px-4 py-3 font-medium">Liability Account</th>
                        <th className="text-center px-4 py-3 font-medium w-20">Active</th>
                        <th className="text-right px-4 py-3 font-medium w-28">Transactions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ccAccounts.map((cc) => {
                        const txCount = transactions.filter((t) => t.credit_card_account_id === cc.id).length;
                        return (
                          <tr key={cc.id} className="border-t border-gray-800/50 hover:bg-gray-800/20 transition-colors">
                            <td className="px-4 py-3 text-gray-200 font-medium">{cc.name}</td>
                            <td className="px-4 py-3 font-mono text-gray-400">{cc.last_four ? `****${cc.last_four}` : "\u2014"}</td>
                            <td className="px-4 py-3 text-xs text-gray-400">
                              {cc.chart_of_accounts
                                ? `${cc.chart_of_accounts.account_number} ${cc.chart_of_accounts.name}`
                                : "\u2014"}
                            </td>
                            <td className="px-4 py-3 text-center">
                              <span className={`inline-block w-2 h-2 rounded-full ${cc.is_active ? "bg-emerald-500" : "bg-gray-600"}`} />
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-gray-400">{txCount}</td>
                          </tr>
                        );
                      })}
                      {ccAccounts.length === 0 && (
                        <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-600">No credit card accounts. Create one to start importing transactions.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ═══════════════════════════════════════════════════════════
                TAB: Import Transactions
                ═══════════════════════════════════════════════════════ */}
            {activeTab === "import" && (
              <div className="space-y-6">
                <div className="p-6 rounded-xl bg-gray-900/50 border border-gray-800 space-y-4">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-gray-300">Import Credit Card CSV</h3>
                  <p className="text-xs text-gray-500">
                    Upload a CSV export from your credit card provider. Expected columns: <code className="text-violet-400">Date</code>, <code className="text-violet-400">Description</code>, <code className="text-violet-400">Amount</code>. Duplicates are auto-skipped. Rules are auto-applied on import.
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] text-gray-600 uppercase tracking-wider mb-1">Credit Card Account *</label>
                      <select value={importCcAccountId} onChange={(e) => setImportCcAccountId(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white">
                        <option value="">Select card...</option>
                        {ccAccounts.filter((c) => c.is_active).map((c) => (
                          <option key={c.id} value={c.id}>{c.name}{c.last_four ? ` (****${c.last_four})` : ""}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] text-gray-600 uppercase tracking-wider mb-1">CSV File *</label>
                      <input ref={fileRef} type="file" accept=".csv" onChange={handleFileChange}
                        className="w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-bold file:bg-gray-800 file:text-gray-300 hover:file:bg-gray-700" />
                    </div>
                  </div>

                  {/* CSV Preview */}
                  {csvPreview.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-gray-400">Preview ({csvPreview.length} rows)</h4>
                        <button onClick={handleImport} disabled={importing || !importCcAccountId}
                          className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-bold uppercase tracking-wider">
                          {importing ? "Importing..." : `Import ${csvPreview.length} Transactions`}
                        </button>
                      </div>
                      <div className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden overflow-x-auto max-h-80 overflow-y-auto">
                        <table className="w-full text-sm">
                          <thead className="sticky top-0 bg-gray-900">
                            <tr className="text-[10px] uppercase tracking-wider text-gray-600 border-b border-gray-800">
                              <th className="text-left px-4 py-2 font-medium w-28">Date</th>
                              <th className="text-left px-4 py-2 font-medium">Description</th>
                              <th className="text-right px-4 py-2 font-medium w-28">Amount</th>
                            </tr>
                          </thead>
                          <tbody>
                            {csvPreview.slice(0, 50).map((row, i) => (
                              <tr key={i} className="border-t border-gray-800/50">
                                <td className="px-4 py-2 text-gray-400 text-xs">{fmtDate(row.date)}</td>
                                <td className="px-4 py-2 text-gray-200 text-xs truncate max-w-xs">{row.description}</td>
                                <td className={`px-4 py-2 text-right font-mono text-xs ${row.amount < 0 ? "text-emerald-400" : "text-gray-300"}`}>
                                  {fmtCurrency(row.amount)}
                                </td>
                              </tr>
                            ))}
                            {csvPreview.length > 50 && (
                              <tr><td colSpan={3} className="px-4 py-2 text-center text-gray-600 text-xs">...and {csvPreview.length - 50} more rows</td></tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ═══════════════════════════════════════════════════════════
                TAB: Transaction Review
                ═══════════════════════════════════════════════════════ */}
            {activeTab === "transactions" && (
              <div>
                {/* Action bar */}
                <div className="flex flex-wrap gap-3 mb-4 items-center">
                  <button onClick={handleCategorize} disabled={categorizing || pendingCount === 0}
                    className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-bold uppercase tracking-wider">
                    {categorizing ? "Running..." : `Run Rules (${pendingCount} pending)`}
                  </button>
                  <button onClick={selectAllCategorized} disabled={categorizedCount === 0}
                    className="px-4 py-2 rounded-lg border border-gray-700 text-gray-300 hover:text-white text-sm font-bold uppercase tracking-wider disabled:opacity-50">
                    Select All Categorized
                  </button>
                  <button onClick={handlePostTransactions} disabled={posting || selectedTxIds.size === 0}
                    className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-bold uppercase tracking-wider">
                    {posting ? "Posting..." : `Post Selected (${selectedTxIds.size})`}
                  </button>

                  {/* Status filter */}
                  <div className="ml-auto">
                    <select value={txStatusFilter} onChange={(e) => setTxStatusFilter(e.target.value)}
                      className="px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white">
                      <option value="all">All Statuses</option>
                      <option value="pending">Pending ({pendingCount})</option>
                      <option value="categorized">Categorized ({categorizedCount})</option>
                      <option value="posted">Posted ({postedCount})</option>
                      <option value="excluded">Excluded</option>
                    </select>
                  </div>
                </div>

                {/* Transactions table */}
                <div className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden overflow-x-auto">
                  <table className="w-full text-sm min-w-[1000px]">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-wider text-gray-600 border-b border-gray-800">
                        <th className="text-center px-3 py-3 font-medium w-10">
                          <input type="checkbox" checked={selectedTxIds.size > 0 && selectedTxIds.size === filteredTransactions.filter((t) => t.status === "categorized").length}
                            onChange={(e) => {
                              if (e.target.checked) selectAllCategorized();
                              else setSelectedTxIds(new Set());
                            }}
                            className="rounded border-gray-600" />
                        </th>
                        <th className="text-left px-3 py-3 font-medium w-24">Date</th>
                        <th className="text-left px-3 py-3 font-medium">Description</th>
                        <th className="text-left px-3 py-3 font-medium w-24">Card</th>
                        <th className="text-right px-3 py-3 font-medium w-24">Amount</th>
                        <th className="text-left px-3 py-3 font-medium w-32">Category</th>
                        <th className="text-left px-3 py-3 font-medium w-44">GL Account</th>
                        <th className="text-center px-3 py-3 font-medium w-24">Status</th>
                        <th className="text-right px-3 py-3 font-medium w-24">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTransactions.map((tx) => {
                        const style = STATUS_STYLES[tx.status] || STATUS_STYLES.pending;
                        const isSelectable = tx.status === "categorized";
                        return (
                          <tr key={tx.id} className={`border-t border-gray-800/50 hover:bg-gray-800/20 transition-colors ${selectedTxIds.has(tx.id) ? "bg-violet-900/20" : ""}`}>
                            <td className="text-center px-3 py-2">
                              {isSelectable ? (
                                <input type="checkbox" checked={selectedTxIds.has(tx.id)} onChange={() => toggleSelectTx(tx.id)}
                                  className="rounded border-gray-600" />
                              ) : (
                                <span className="text-gray-700">-</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-gray-400 text-xs">{fmtDate(tx.transaction_date)}</td>
                            <td className="px-3 py-2 text-gray-200 text-xs truncate max-w-xs" title={tx.description}>{tx.description}</td>
                            <td className="px-3 py-2 text-xs text-gray-500">
                              {tx.credit_card_accounts?.last_four ? `****${tx.credit_card_accounts.last_four}` : tx.credit_card_accounts?.name || "\u2014"}
                            </td>
                            <td className={`px-3 py-2 text-right font-mono text-xs ${Number(tx.amount) < 0 ? "text-emerald-400" : "text-gray-300"}`}>
                              {fmtCurrency(Number(tx.amount))}
                            </td>
                            <td className="px-3 py-2">
                              {tx.status === "pending" || tx.status === "categorized" ? (
                                <input value={tx.category || ""} placeholder="Category..."
                                  onChange={(e) => {
                                    // Optimistic UI update
                                    setTransactions((prev) => prev.map((t) => t.id === tx.id ? { ...t, category: e.target.value } : t));
                                  }}
                                  onBlur={(e) => {
                                    if (e.target.value && tx.gl_account_id) {
                                      handleUpdateTxCategory(tx.id, e.target.value, tx.gl_account_id);
                                    }
                                  }}
                                  className="w-full px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-white" />
                              ) : (
                                <span className="text-xs text-gray-400">{tx.category || "\u2014"}</span>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              {tx.status === "pending" || tx.status === "categorized" ? (
                                <select value={tx.gl_account_id || ""}
                                  onChange={(e) => {
                                    const acct = expenseAccounts.find((a) => a.id === e.target.value);
                                    if (acct) {
                                      handleUpdateTxCategory(tx.id, tx.category || acct.name, acct.id);
                                    }
                                  }}
                                  className="w-full px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-white">
                                  <option value="">Select...</option>
                                  {expenseAccounts.map((a) => (
                                    <option key={a.id} value={a.id}>{a.account_number} {a.name}</option>
                                  ))}
                                </select>
                              ) : (
                                <span className="text-xs text-gray-400">
                                  {tx.chart_of_accounts ? `${tx.chart_of_accounts.account_number} ${tx.chart_of_accounts.name}` : "\u2014"}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-center">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${style.bg} ${style.text}`}>
                                {tx.status}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right">
                              {(tx.status === "pending" || tx.status === "categorized") && (
                                <button onClick={() => handleExcludeTx(tx.id)}
                                  className="text-[10px] text-red-400/60 hover:text-red-300 font-bold uppercase">
                                  Excl
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      {filteredTransactions.length === 0 && (
                        <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-600">
                          {transactions.length === 0
                            ? "No transactions yet. Import a CSV from the Import tab."
                            : "No transactions match the current filter."}
                        </td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
