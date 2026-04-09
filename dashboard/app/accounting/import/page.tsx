"use client";

import { useState, useEffect, useCallback, useRef } from "react";

// ── Types ──────────────────────────────────────────────────────────────

type ImportType = "chart_of_accounts" | "customers" | "vendors";

interface ImportResult {
  batch_id: string;
  import_type: string;
  file_name: string;
  status: string;
  row_count: number;
  imported_count: number;
  skipped_count: number;
  error_count: number;
  errors: { row: number; name: string; reason: string }[];
}

interface ImportBatch {
  id: string;
  import_type: string;
  file_name: string;
  row_count: number;
  imported_count: number;
  skipped_count: number;
  error_count: number;
  errors: { row: number; name: string; reason: string }[];
  status: string;
  created_by_name: string;
  rolled_back_at: string | null;
  created_at: string;
  completed_at: string | null;
}

// ── Constants ──────────────────────────────────────────────────────────

const TYPE_OPTIONS: { value: ImportType; label: string; description: string }[] = [
  {
    value: "chart_of_accounts",
    label: "Chart of Accounts",
    description: "Import accounts with Name, Type, Description, Balance columns",
  },
  {
    value: "customers",
    label: "Customers",
    description: "Import customers with Name, Email, Phone, Address, Payment Terms",
  },
  {
    value: "vendors",
    label: "Vendors",
    description: "Import vendors with Name, Email, Phone, Address, Payment Terms, Tax ID",
  },
];

const TYPE_LABELS: Record<string, string> = {
  chart_of_accounts: "Chart of Accounts",
  customers: "Customers",
  vendors: "Vendors",
  invoices: "Invoices",
  bills: "Bills",
  journal_entries: "Journal Entries",
  bank_transactions: "Bank Transactions",
  employees: "Employees",
};

const STATUS_COLORS: Record<string, string> = {
  completed: "text-green-400",
  failed: "text-red-400",
  rolled_back: "text-yellow-400",
  processing: "text-blue-400",
  pending: "text-zinc-400",
};

// ── CSV Parser ─────────────────────────────────────────────────────────

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  // Parse header
  const headers = parseCSVLine(lines[0]);
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j].trim()] = (values[j] ?? "").trim();
    }
    // Skip completely empty rows
    if (Object.values(row).some((v) => v.length > 0)) {
      rows.push(row);
    }
  }

  return rows;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        result.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
  }
  result.push(current);
  return result;
}

// ── Helpers ────────────────────────────────────────────────────────────

function fmtDate(iso: string | null): string {
  if (!iso) return "--";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// ── Component ──────────────────────────────────────────────────────────

export default function ImportPage() {
  // Wizard state
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [importType, setImportType] = useState<ImportType>("chart_of_accounts");
  const [fileName, setFileName] = useState("");
  const [parsedRows, setParsedRows] = useState<Record<string, string>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // History state
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [rollingBack, setRollingBack] = useState<string | null>(null);

  // ── Fetch import history ─────────────────────────────────────────────

  const fetchBatches = useCallback(async () => {
    try {
      const res = await fetch("/api/accounting/import");
      if (res.ok) {
        const data = await res.json();
        setBatches(data);
      }
    } catch {
      // Silently ignore fetch errors for history
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    fetchBatches();
  }, [fetchBatches]);

  // ── File handling ────────────────────────────────────────────────────

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError("");
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith(".csv")) {
      setError("Please select a CSV file.");
      return;
    }

    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const rows = parseCSV(text);

      if (rows.length === 0) {
        setError("CSV file is empty or has no data rows.");
        return;
      }

      const hdrs = Object.keys(rows[0]);
      setHeaders(hdrs);
      setParsedRows(rows);
      setStep(3);
    };
    reader.onerror = () => setError("Failed to read file.");
    reader.readAsText(file);
  };

  // ── Import execution ─────────────────────────────────────────────────

  const runImport = async () => {
    setImporting(true);
    setError("");

    try {
      const res = await fetch("/api/accounting/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          import_type: importType,
          file_name: fileName,
          rows: parsedRows,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Import failed");
        setImporting(false);
        return;
      }

      setResult(data);
      setStep(4);
      fetchBatches();
    } catch {
      setError("Network error during import.");
    } finally {
      setImporting(false);
    }
  };

  // ── Rollback ─────────────────────────────────────────────────────────

  const rollback = async (batchId: string) => {
    if (!confirm("Roll back this import? All imported records will be deleted.")) return;
    setRollingBack(batchId);

    try {
      const res = await fetch("/api/accounting/import", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batch_id: batchId }),
      });

      if (res.ok) {
        fetchBatches();
      } else {
        const data = await res.json();
        alert(data.error || "Rollback failed");
      }
    } catch {
      alert("Network error during rollback");
    } finally {
      setRollingBack(null);
    }
  };

  // ── Reset wizard ─────────────────────────────────────────────────────

  const resetWizard = () => {
    setStep(1);
    setFileName("");
    setParsedRows([]);
    setHeaders([]);
    setResult(null);
    setError("");
    if (fileRef.current) fileRef.current.value = "";
  };

  // ── Render ───────────────────────────────────────────────────────────

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-zinc-100">QuickBooks Data Import</h1>
        <p className="text-zinc-400 mt-1">
          Import chart of accounts, customers, and vendors from QuickBooks CSV exports.
        </p>
      </div>

      {/* Wizard Card */}
      <div className="bg-zinc-800 border border-zinc-700 rounded-lg overflow-hidden">
        {/* Step indicators */}
        <div className="flex border-b border-zinc-700">
          {[
            { n: 1, label: "Select Type" },
            { n: 2, label: "Upload CSV" },
            { n: 3, label: "Preview" },
            { n: 4, label: "Results" },
          ].map(({ n, label }) => (
            <div
              key={n}
              className={`flex-1 px-4 py-3 text-center text-sm font-medium border-b-2 transition-colors ${
                step === n
                  ? "border-orange-500 text-orange-400 bg-zinc-800"
                  : step > n
                    ? "border-green-600 text-green-400 bg-zinc-800/50"
                    : "border-transparent text-zinc-500 bg-zinc-900/50"
              }`}
            >
              <span className="mr-1.5 text-xs">
                {step > n ? "\u2713" : n}
              </span>
              {label}
            </div>
          ))}
        </div>

        <div className="p-6">
          {/* ── Step 1: Select Type ──────────────────────────────────── */}
          {step === 1 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-zinc-100">
                What are you importing?
              </h2>
              <div className="grid gap-3">
                {TYPE_OPTIONS.map((opt) => (
                  <label
                    key={opt.value}
                    className={`flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-colors ${
                      importType === opt.value
                        ? "border-orange-500 bg-orange-500/10"
                        : "border-zinc-700 bg-zinc-900 hover:border-zinc-600"
                    }`}
                  >
                    <input
                      type="radio"
                      name="import_type"
                      value={opt.value}
                      checked={importType === opt.value}
                      onChange={() => setImportType(opt.value)}
                      className="mt-1 accent-orange-500"
                    />
                    <div>
                      <div className="text-zinc-100 font-medium">{opt.label}</div>
                      <div className="text-zinc-400 text-sm mt-0.5">
                        {opt.description}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
              <div className="flex justify-end pt-2">
                <button
                  onClick={() => setStep(2)}
                  className="px-5 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg font-medium transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          )}

          {/* ── Step 2: Upload CSV ──────────────────────────────────── */}
          {step === 2 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-zinc-100">
                Upload your CSV file
              </h2>
              <p className="text-zinc-400 text-sm">
                Export from QuickBooks: go to the relevant list (Chart of Accounts,
                Customers, Vendors), then use File &gt; Export to Excel/CSV.
              </p>

              <div className="border-2 border-dashed border-zinc-600 rounded-lg p-8 text-center hover:border-zinc-500 transition-colors">
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv"
                  onChange={handleFile}
                  className="hidden"
                  id="csv-upload"
                />
                <label
                  htmlFor="csv-upload"
                  className="cursor-pointer flex flex-col items-center gap-3"
                >
                  <svg
                    className="w-10 h-10 text-zinc-500"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                    />
                  </svg>
                  <span className="text-zinc-300 font-medium">
                    Click to choose a CSV file
                  </span>
                  <span className="text-zinc-500 text-sm">
                    Importing: {TYPE_OPTIONS.find((o) => o.value === importType)?.label}
                  </span>
                </label>
              </div>

              {error && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-red-400 text-sm">
                  {error}
                </div>
              )}

              <div className="flex justify-between pt-2">
                <button
                  onClick={() => {
                    setStep(1);
                    setError("");
                  }}
                  className="px-5 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 rounded-lg font-medium transition-colors"
                >
                  Back
                </button>
              </div>
            </div>
          )}

          {/* ── Step 3: Preview ─────────────────────────────────────── */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-zinc-100">
                    Preview Import
                  </h2>
                  <p className="text-zinc-400 text-sm mt-0.5">
                    {fileName} &mdash; {parsedRows.length} row
                    {parsedRows.length !== 1 ? "s" : ""} detected
                  </p>
                </div>
                <span className="text-xs bg-zinc-700 text-zinc-300 px-2.5 py-1 rounded-full">
                  {TYPE_OPTIONS.find((o) => o.value === importType)?.label}
                </span>
              </div>

              {/* Column mapping */}
              <div className="bg-zinc-900 rounded-lg border border-zinc-700 p-4">
                <h3 className="text-sm font-medium text-zinc-300 mb-2">
                  Detected Columns
                </h3>
                <div className="flex flex-wrap gap-2">
                  {headers.map((h) => (
                    <span
                      key={h}
                      className="text-xs bg-zinc-800 text-zinc-300 border border-zinc-600 px-2.5 py-1 rounded"
                    >
                      {h}
                    </span>
                  ))}
                </div>
              </div>

              {/* Preview table */}
              <div className="overflow-x-auto rounded-lg border border-zinc-700">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-zinc-900">
                      <th className="px-3 py-2 text-left text-xs font-medium text-zinc-400 border-b border-zinc-700">
                        #
                      </th>
                      {headers.map((h) => (
                        <th
                          key={h}
                          className="px-3 py-2 text-left text-xs font-medium text-zinc-400 border-b border-zinc-700 whitespace-nowrap"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parsedRows.slice(0, 10).map((row, i) => (
                      <tr
                        key={i}
                        className="border-b border-zinc-800 hover:bg-zinc-800/50"
                      >
                        <td className="px-3 py-2 text-zinc-500">{i + 1}</td>
                        {headers.map((h) => (
                          <td
                            key={h}
                            className="px-3 py-2 text-zinc-300 whitespace-nowrap max-w-[200px] truncate"
                          >
                            {row[h] || "--"}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {parsedRows.length > 10 && (
                  <div className="px-3 py-2 text-center text-zinc-500 text-xs bg-zinc-900">
                    Showing first 10 of {parsedRows.length} rows
                  </div>
                )}
              </div>

              {error && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-red-400 text-sm">
                  {error}
                </div>
              )}

              <div className="flex justify-between pt-2">
                <button
                  onClick={() => {
                    setStep(2);
                    setError("");
                    setParsedRows([]);
                    setHeaders([]);
                    setFileName("");
                    if (fileRef.current) fileRef.current.value = "";
                  }}
                  className="px-5 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 rounded-lg font-medium transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={runImport}
                  disabled={importing}
                  className="px-5 py-2 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors flex items-center gap-2"
                >
                  {importing && (
                    <svg
                      className="w-4 h-4 animate-spin"
                      viewBox="0 0 24 24"
                      fill="none"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      />
                    </svg>
                  )}
                  {importing
                    ? `Importing ${parsedRows.length} rows...`
                    : `Import ${parsedRows.length} Rows`}
                </button>
              </div>
            </div>
          )}

          {/* ── Step 4: Results ─────────────────────────────────────── */}
          {step === 4 && result && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-zinc-100">
                Import {result.status === "completed" ? "Complete" : "Failed"}
              </h2>

              {/* Summary cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-zinc-900 rounded-lg border border-zinc-700 p-4 text-center">
                  <div className="text-2xl font-bold text-zinc-100">
                    {result.row_count}
                  </div>
                  <div className="text-xs text-zinc-400 mt-1">Total Rows</div>
                </div>
                <div className="bg-zinc-900 rounded-lg border border-green-800/50 p-4 text-center">
                  <div className="text-2xl font-bold text-green-400">
                    {result.imported_count}
                  </div>
                  <div className="text-xs text-zinc-400 mt-1">Imported</div>
                </div>
                <div className="bg-zinc-900 rounded-lg border border-yellow-800/50 p-4 text-center">
                  <div className="text-2xl font-bold text-yellow-400">
                    {result.skipped_count}
                  </div>
                  <div className="text-xs text-zinc-400 mt-1">
                    Skipped (Duplicates)
                  </div>
                </div>
                <div className="bg-zinc-900 rounded-lg border border-red-800/50 p-4 text-center">
                  <div className="text-2xl font-bold text-red-400">
                    {result.error_count}
                  </div>
                  <div className="text-xs text-zinc-400 mt-1">Errors</div>
                </div>
              </div>

              {/* Error details */}
              {result.errors.length > 0 && (
                <div className="bg-red-500/5 border border-red-500/20 rounded-lg overflow-hidden">
                  <div className="px-4 py-2 bg-red-500/10 text-red-400 text-sm font-medium border-b border-red-500/20">
                    Errors ({result.errors.length})
                  </div>
                  <div className="max-h-48 overflow-y-auto">
                    {result.errors.map((err, i) => (
                      <div
                        key={i}
                        className="px-4 py-2 text-sm border-b border-red-500/10 last:border-0"
                      >
                        <span className="text-zinc-500">Row {err.row}:</span>{" "}
                        <span className="text-zinc-300">{err.name}</span>{" "}
                        <span className="text-red-400">&mdash; {err.reason}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end pt-2">
                <button
                  onClick={resetWizard}
                  className="px-5 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg font-medium transition-colors"
                >
                  Import More Data
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Import History ──────────────────────────────────────────── */}
      <div className="bg-zinc-800 border border-zinc-700 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-700">
          <h2 className="text-lg font-semibold text-zinc-100">Import History</h2>
        </div>

        {loadingHistory ? (
          <div className="p-8 text-center text-zinc-500">Loading history...</div>
        ) : batches.length === 0 ? (
          <div className="p-8 text-center text-zinc-500">
            No imports yet. Use the wizard above to import QuickBooks data.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-zinc-900">
                  {["Type", "File", "Rows", "Imported", "Skipped", "Errors", "Status", "By", "Date", ""].map(
                    (h) => (
                      <th
                        key={h}
                        className="px-4 py-2.5 text-left text-xs font-medium text-zinc-400 border-b border-zinc-700 whitespace-nowrap"
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr
                    key={b.id}
                    className="border-b border-zinc-800 hover:bg-zinc-800/50"
                  >
                    <td className="px-4 py-2.5 text-zinc-300 whitespace-nowrap">
                      {TYPE_LABELS[b.import_type] || b.import_type}
                    </td>
                    <td className="px-4 py-2.5 text-zinc-400 max-w-[160px] truncate">
                      {b.file_name || "--"}
                    </td>
                    <td className="px-4 py-2.5 text-zinc-300">{b.row_count}</td>
                    <td className="px-4 py-2.5 text-green-400">{b.imported_count}</td>
                    <td className="px-4 py-2.5 text-yellow-400">{b.skipped_count}</td>
                    <td className="px-4 py-2.5 text-red-400">{b.error_count}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <span className={STATUS_COLORS[b.status] || "text-zinc-400"}>
                        {b.status === "rolled_back"
                          ? "Rolled Back"
                          : b.status.charAt(0).toUpperCase() + b.status.slice(1)}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-zinc-400 whitespace-nowrap">
                      {b.created_by_name}
                    </td>
                    <td className="px-4 py-2.5 text-zinc-500 whitespace-nowrap">
                      {fmtDate(b.created_at)}
                    </td>
                    <td className="px-4 py-2.5">
                      {b.status === "completed" && b.imported_count > 0 && (
                        <button
                          onClick={() => rollback(b.id)}
                          disabled={rollingBack === b.id}
                          className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50 whitespace-nowrap"
                        >
                          {rollingBack === b.id ? "Rolling back..." : "Rollback"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
