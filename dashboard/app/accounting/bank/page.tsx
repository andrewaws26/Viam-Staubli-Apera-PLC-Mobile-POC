"use client";

import { useState, useEffect, useCallback } from "react";

interface BankAccount {
  id: string;
  name: string;
  institution: string | null;
  account_last4: string | null;
  account_type: string;
  current_balance: number;
  chart_of_accounts?: { account_number: string; name: string };
}

interface BankTransaction {
  id: string;
  bank_account_id: string;
  transaction_date: string;
  description: string;
  amount: number;
  type: string;
  reference: string | null;
  cleared: boolean;
  matched_je_id: string | null;
  reconciliation_id: string | null;
  import_source: string | null;
}

function fmt(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

export default function BankReconciliationPage() {
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<string>("");
  const [transactions, setTransactions] = useState<BankTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [showImport, setShowImport] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState("");

  // Reconciliation state
  const [showRecon, setShowRecon] = useState(false);
  const [reconStatementDate, setReconStatementDate] = useState(new Date().toISOString().split("T")[0]);
  const [reconStatementBal, setReconStatementBal] = useState("");
  const [reconBeginBal, setReconBeginBal] = useState("");
  const [reconId, setReconId] = useState<string | null>(null);

  const loadAccounts = useCallback(async () => {
    try {
      const res = await fetch("/api/accounting/bank");
      if (res.ok) {
        const data = await res.json();
        setAccounts(data);
        if (data.length > 0 && !selectedAccount) {
          setSelectedAccount(data[0].id);
        }
      }
    } catch { /* ignore */ }
  }, [selectedAccount]);

  const loadTransactions = useCallback(async () => {
    if (!selectedAccount) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/accounting/bank?account_id=${selectedAccount}`);
      if (res.ok) setTransactions(await res.json());
    } catch { /* ignore */ }
    setLoading(false);
  }, [selectedAccount]);

  useEffect(() => {
    loadAccounts().then(() => setLoading(false));
  }, [loadAccounts]);

  useEffect(() => {
    if (selectedAccount) loadTransactions();
  }, [selectedAccount, loadTransactions]);

  function parseCSV(text: string): { date: string; description: string; amount: number; reference?: string }[] {
    const lines = text.trim().split("\n");
    if (lines.length < 2) return [];

    // Try to detect header row
    const header = lines[0].toLowerCase();
    const hasHeader = header.includes("date") || header.includes("description") || header.includes("amount");
    const dataLines = hasHeader ? lines.slice(1) : lines;

    return dataLines.map((line) => {
      const parts = line.split(",").map((p) => p.trim().replace(/^"|"$/g, ""));
      // Common formats: Date, Description, Amount or Date, Description, Debit, Credit
      if (parts.length >= 3) {
        const amount = parseFloat(parts[2]);
        if (parts.length >= 4 && parts[3]) {
          // Debit/Credit format
          const debit = parseFloat(parts[2]) || 0;
          const credit = parseFloat(parts[3]) || 0;
          return {
            date: parts[0],
            description: parts[1],
            amount: credit - debit, // positive = deposit
            reference: parts[4] || undefined,
          };
        }
        return {
          date: parts[0],
          description: parts[1],
          amount: isNaN(amount) ? 0 : amount,
          reference: parts[3] || undefined,
        };
      }
      return { date: "", description: line, amount: 0 };
    }).filter((tx) => tx.date && tx.amount !== 0);
  }

  async function handleImport() {
    if (!csvText.trim() || !selectedAccount) return;
    setImporting(true);
    setImportResult("");

    const parsed = parseCSV(csvText);
    if (parsed.length === 0) {
      setImportResult("No valid transactions found in CSV.");
      setImporting(false);
      return;
    }

    try {
      const res = await fetch("/api/accounting/bank", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bank_account_id: selectedAccount,
          action: "import",
          transactions: parsed,
        }),
      });
      const result = await res.json();
      setImportResult(`Imported: ${result.imported}, Skipped (duplicates): ${result.skipped}`);
      if (result.imported > 0) loadTransactions();
    } catch {
      setImportResult("Import failed.");
    }
    setImporting(false);
  }

  async function toggleCleared(txId: string, currentCleared: boolean) {
    try {
      await fetch("/api/accounting/bank", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: txId,
          action: currentCleared ? "unclear" : "clear",
        }),
      });
      loadTransactions();
    } catch { /* ignore */ }
  }

  async function startReconciliation() {
    if (!selectedAccount || !reconStatementBal || !reconBeginBal) return;
    try {
      const res = await fetch("/api/accounting/bank", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "start_reconciliation",
          bank_account_id: selectedAccount,
          statement_date: reconStatementDate,
          statement_balance: parseFloat(reconStatementBal),
          beginning_balance: parseFloat(reconBeginBal),
        }),
      });
      if (res.ok) {
        const session = await res.json();
        setReconId(session.id);
      }
    } catch { /* ignore */ }
  }

  async function completeReconciliation() {
    if (!reconId) return;
    try {
      const res = await fetch("/api/accounting/bank", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "complete_reconciliation",
          reconciliation_id: reconId,
        }),
      });
      if (res.ok) {
        const result = await res.json();
        if (result.status === "completed") {
          setShowRecon(false);
          setReconId(null);
          loadTransactions();
        } else {
          alert(`Reconciliation not balanced. Difference: ${fmt(Number(result.difference))}`);
        }
      }
    } catch { /* ignore */ }
  }

  // Compute summary
  const unclearedDeposits = transactions.filter((t) => !t.cleared && t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const unclearedWithdrawals = transactions.filter((t) => !t.cleared && t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
  const clearedBalance = transactions.filter((t) => t.cleared).reduce((s, t) => s + t.amount, 0);

  return (
    <div className="min-h-screen bg-gray-950 text-white">

      <main className="px-4 sm:px-6 py-6 max-w-7xl mx-auto">
        {/* Account Selector */}
        <div className="flex flex-wrap items-end gap-4 mb-6">
          <div>
            <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">Bank Account</label>
            <select value={selectedAccount} onChange={(e) => setSelectedAccount(e.target.value)}
              className="px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white min-w-[250px]">
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} {a.account_last4 ? `(***${a.account_last4})` : ""} — {a.institution || ""}
                </option>
              ))}
            </select>
          </div>
          <button onClick={() => setShowImport(!showImport)}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold uppercase tracking-wider">
            Import CSV
          </button>
          <button onClick={() => setShowRecon(!showRecon)}
            className="px-4 py-2 rounded-lg border border-gray-700 hover:border-gray-500 text-gray-400 text-sm font-bold uppercase tracking-wider">
            Reconcile
          </button>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {[
            { label: "Total Transactions", value: transactions.length, color: "text-gray-200" },
            { label: "Cleared Balance", value: fmt(clearedBalance), color: "text-emerald-400" },
            { label: "Uncleared Deposits", value: fmt(unclearedDeposits), color: "text-blue-400" },
            { label: "Uncleared Withdrawals", value: fmt(unclearedWithdrawals), color: "text-amber-400" },
          ].map((c) => (
            <div key={c.label} className="rounded-xl bg-gray-900/50 border border-gray-800 p-4">
              <p className="text-xs uppercase tracking-wider text-gray-500 font-medium">{c.label}</p>
              <p className={`text-xl font-black mt-1 ${c.color}`}>{c.value}</p>
            </div>
          ))}
        </div>

        {/* CSV Import */}
        {showImport && (
          <div className="mb-6 p-5 rounded-xl bg-gray-900/50 border border-gray-800 space-y-3">
            <h3 className="text-sm font-bold uppercase tracking-wider text-gray-300">Import Bank Statement (CSV)</h3>
            <p className="text-xs text-gray-500">Format: Date, Description, Amount (or Date, Description, Debit, Credit)</p>
            <textarea value={csvText} onChange={(e) => setCsvText(e.target.value)} rows={6} placeholder="2026-04-01,&quot;Deposit from NS Corp&quot;,12750.00
2026-04-02,&quot;NAPA Auto Parts&quot;,-2340.00"
              className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white font-mono" />
            <div className="flex items-center gap-3">
              <button onClick={handleImport} disabled={importing || !csvText.trim()}
                className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-bold uppercase tracking-wider">
                {importing ? "Importing..." : "Import"}
              </button>
              {importResult && <span className="text-sm text-gray-400">{importResult}</span>}
            </div>
          </div>
        )}

        {/* Reconciliation Panel */}
        {showRecon && (
          <div className="mb-6 p-5 rounded-xl bg-gray-900/50 border border-gray-800 space-y-4">
            <h3 className="text-sm font-bold uppercase tracking-wider text-gray-300">Bank Reconciliation</h3>
            {!reconId ? (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">Statement Date</label>
                  <input type="date" value={reconStatementDate} onChange={(e) => setReconStatementDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white [color-scheme:dark]" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">Statement Ending Balance</label>
                  <input type="number" value={reconStatementBal} onChange={(e) => setReconStatementBal(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white" step="0.01" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">Beginning Balance</label>
                  <input type="number" value={reconBeginBal} onChange={(e) => setReconBeginBal(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white" step="0.01" />
                </div>
                <div>
                  <button onClick={startReconciliation} disabled={!reconStatementBal || !reconBeginBal}
                    className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-bold uppercase tracking-wider">
                    Start Reconciliation
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <p className="text-sm text-gray-400 mb-3">
                  Check the &quot;Cleared&quot; box on each transaction that appears on your bank statement, then click Complete.
                </p>
                <button onClick={completeReconciliation}
                  className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold uppercase tracking-wider">
                  Complete Reconciliation
                </button>
              </div>
            )}
          </div>
        )}

        {/* Transaction List */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
          </div>
        ) : (
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden overflow-x-auto">
            <table className="w-full text-sm min-w-[700px]">
              <thead>
                <tr className="text-xs uppercase tracking-wider text-gray-500 border-b border-gray-800">
                  <th className="text-center px-3 py-3 font-medium w-12">Cleared</th>
                  <th className="text-left px-4 py-3 font-medium">Date</th>
                  <th className="text-left px-4 py-3 font-medium">Description</th>
                  <th className="text-left px-4 py-3 font-medium">Ref</th>
                  <th className="text-right px-4 py-3 font-medium">Amount</th>
                  <th className="text-left px-4 py-3 font-medium">Source</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => (
                  <tr key={tx.id} className={`border-t border-gray-800/50 hover:bg-gray-800/20 transition-colors ${tx.cleared ? "opacity-60" : ""}`}>
                    <td className="px-3 py-2 text-center">
                      <input type="checkbox" checked={tx.cleared}
                        onChange={() => toggleCleared(tx.id, tx.cleared)}
                        className="w-4 h-4 rounded border-gray-700 bg-gray-900" />
                    </td>
                    <td className="px-4 py-2 text-gray-400">{tx.transaction_date}</td>
                    <td className="px-4 py-2 text-gray-200">{tx.description}</td>
                    <td className="px-4 py-2 text-gray-500 text-xs font-mono">{tx.reference || "—"}</td>
                    <td className={`px-4 py-2 text-right font-mono ${tx.amount >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {fmt(tx.amount)}
                    </td>
                    <td className="px-4 py-2">
                      <span className="px-2 py-0.5 rounded text-xs font-bold uppercase bg-gray-800 text-gray-400">
                        {tx.import_source || "manual"}
                      </span>
                    </td>
                  </tr>
                ))}
                {transactions.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                      No transactions. Import a bank statement CSV to get started.
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
