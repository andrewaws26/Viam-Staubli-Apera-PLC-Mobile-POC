"use client";

import { useState, useEffect } from "react";
import { useUser } from "@clerk/nextjs";
import TopNav from "@/components/nav/TopNav";
import Breadcrumb from "@/components/nav/Breadcrumb";
import type { SavedReport, ReportCategory } from "@ironsight/shared";
import { REPORT_CATEGORY_LABELS } from "@ironsight/shared";

/* ── Types ─────────────────────────────────────────────────────── */

interface GenerateResult {
  sql: string;
  results: Record<string, unknown>[];
  row_count: number;
  execution_time_ms: number;
}

/* ── Example Prompts ───────────────────────────────────────────── */

const EXAMPLE_PROMPTS = [
  "Show me overdue invoices over $5,000",
  "Compare overtime hours by employee for March 2026",
  "Which employees have pending timesheets?",
  "Show total invoiced vs. paid by customer",
  "List trucks with more than 5 DTCs in the last 30 days",
  "Show payroll totals by employee for Q1 2026",
  "What's the average per diem cost per railroad for March?",
  "Show training certifications expiring in the next 60 days",
];

/* ── CSV Export ────────────────────────────────────────────────── */

function downloadCSV(results: Record<string, unknown>[], filename: string) {
  if (!results.length) return;
  const keys = Object.keys(results[0]);
  const header = keys.join(",");
  const rows = results.map((row) =>
    keys.map((k) => {
      const val = row[k];
      if (val === null || val === undefined) return "";
      const str = String(val);
      return str.includes(",") || str.includes('"') || str.includes("\n")
        ? `"${str.replace(/"/g, '""')}"`
        : str;
    }).join(","),
  );
  const csv = [header, ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* ── Main Page ─────────────────────────────────────────────────── */

export default function ReportsPage() {
  const { user, isLoaded } = useUser();
  const role =
    ((user?.publicMetadata as Record<string, unknown>)?.role as string) ||
    "operator";

  // Generate state
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSQL, setShowSQL] = useState(false);

  // Save modal state
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveDesc, setSaveDesc] = useState("");
  const [saveCategory, setSaveCategory] = useState<string>("custom");
  const [saveShared, setSaveShared] = useState(false);
  const [saving, setSaving] = useState(false);

  // Saved reports state
  const [savedReports, setSavedReports] = useState<SavedReport[]>([]);
  const [filterCategory, setFilterCategory] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [loadingReports, setLoadingReports] = useState(true);

  // Sort state for results table
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortAsc, setSortAsc] = useState(true);

  // ── Fetch saved reports ───────────────────────────────────────
  useEffect(() => {
    fetchReports();
  }, [filterCategory, searchTerm]);

  async function fetchReports() {
    setLoadingReports(true);
    const params = new URLSearchParams();
    if (filterCategory) params.set("category", filterCategory);
    if (searchTerm) params.set("search", searchTerm);
    try {
      const res = await fetch(`/api/reports?${params}`);
      if (res.ok) setSavedReports(await res.json());
    } catch { /* ignore */ }
    setLoadingReports(false);
  }

  // ── Generate report ───────────────────────────────────────────
  async function handleGenerate() {
    if (!prompt.trim()) return;
    setGenerating(true);
    setError(null);
    setResult(null);
    setSortCol(null);

    try {
      const res = await fetch("/api/reports/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error + (data.reason ? `: ${data.reason}` : "") + (data.details ? `\n${data.details}` : ""));
        if (data.sql) setResult({ sql: data.sql, results: [], row_count: 0, execution_time_ms: 0 });
      } else {
        setResult(data);
      }
    } catch (err) {
      setError("Network error — please try again");
    }
    setGenerating(false);
  }

  // ── Save report ───────────────────────────────────────────────
  async function handleSave() {
    if (!result || !saveName.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: saveName,
          description: saveDesc || undefined,
          prompt,
          generated_sql: result.sql,
          category: saveCategory,
          is_shared: saveShared,
        }),
      });
      if (res.ok) {
        setShowSaveModal(false);
        setSaveName("");
        setSaveDesc("");
        fetchReports();
      }
    } catch { /* ignore */ }
    setSaving(false);
  }

  // ── Re-run saved report ───────────────────────────────────────
  async function handleRerun(report: SavedReport) {
    setPrompt(report.prompt);
    setGenerating(true);
    setError(null);
    setResult(null);
    setSortCol(null);

    try {
      const res = await fetch(`/api/reports/${report.id}/run`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error + (data.details ? `\n${data.details}` : ""));
      } else {
        setResult(data);
      }
    } catch {
      setError("Network error");
    }
    setGenerating(false);
    fetchReports(); // refresh run count
  }

  // ── Delete saved report ───────────────────────────────────────
  async function handleDelete(id: string) {
    await fetch(`/api/reports?id=${id}`, { method: "DELETE" });
    fetchReports();
  }

  // ── Sort results ──────────────────────────────────────────────
  const sortedResults = result?.results ? [...result.results] : [];
  if (sortCol && sortedResults.length) {
    sortedResults.sort((a, b) => {
      const va = a[sortCol] ?? "";
      const vb = b[sortCol] ?? "";
      const cmp = String(va).localeCompare(String(vb), undefined, { numeric: true });
      return sortAsc ? cmp : -cmp;
    });
  }

  const columns = result?.results?.length ? Object.keys(result.results[0]) : [];

  // ── Loading guard: wait for Clerk ────────────────────────────
  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-gray-950">
        <TopNav />
        <Breadcrumb />
        <div className="flex items-center justify-center py-32">
          <div className="w-10 h-10 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
        </div>
      </div>
    );
  }

  // ── Guard: only manager/developer ─────────────────────────────
  if (role !== "developer" && role !== "manager") {
    return (
      <div className="min-h-screen bg-gray-950">
        <TopNav />
        <div className="flex items-center justify-center py-20">
          <p className="text-gray-500">You don't have access to Reports.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <TopNav />
      <Breadcrumb />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-8">
        {/* ── Header ─────────────────────────────────────────── */}
        <div>
          <h1 className="text-2xl font-black tracking-tight">AI Report Generator</h1>
          <p className="text-sm text-gray-500 mt-1">
            Ask anything about your company data in plain English.
          </p>
        </div>

        {/* ── Prompt Input ───────────────────────────────────── */}
        <div className="space-y-3">
          <div className="relative">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleGenerate();
                }
              }}
              placeholder="Ask anything about your company data..."
              className="w-full px-4 py-3 bg-gray-900 border border-gray-800 rounded-xl text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/30 resize-none"
              rows={2}
            />
            <button
              onClick={handleGenerate}
              disabled={generating || !prompt.trim()}
              className="absolute right-3 bottom-3 px-4 py-1.5 bg-violet-600 hover:bg-violet-500 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg text-xs font-semibold transition-colors"
            >
              {generating ? (
                <span className="flex items-center gap-2">
                  <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Generating...
                </span>
              ) : (
                "Generate Report"
              )}
            </button>
          </div>

          {/* Example chips */}
          <div className="flex flex-wrap gap-2">
            {EXAMPLE_PROMPTS.map((ex) => (
              <button
                key={ex}
                onClick={() => setPrompt(ex)}
                className="px-3 py-1 bg-gray-900 border border-gray-800 rounded-full text-xs text-gray-500 hover:text-gray-300 hover:border-gray-700 transition-colors"
              >
                {ex}
              </button>
            ))}
          </div>
        </div>

        {/* ── Error Display ──────────────────────────────────── */}
        {error && (
          <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
            <p className="text-sm text-red-400 whitespace-pre-wrap">{error}</p>
            <button
              onClick={() => { setError(null); }}
              className="mt-2 text-xs text-red-400/70 hover:text-red-400 underline"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* ── Results ────────────────────────────────────────── */}
        {result && result.results.length > 0 && (
          <div className="space-y-3">
            {/* Toolbar */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="px-2 py-0.5 bg-violet-500/10 text-violet-400 rounded text-xs font-semibold">
                  {result.row_count} rows
                </span>
                <span className="px-2 py-0.5 bg-gray-800 text-gray-400 rounded text-xs">
                  {result.execution_time_ms}ms
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowSQL(!showSQL)}
                  className="px-3 py-1 text-xs text-gray-400 hover:text-gray-200 border border-gray-800 rounded-lg hover:bg-gray-800/50 transition-colors"
                >
                  {showSQL ? "Hide SQL" : "Show SQL"}
                </button>
                <button
                  onClick={() => downloadCSV(result.results, "report.csv")}
                  className="px-3 py-1 text-xs text-gray-400 hover:text-gray-200 border border-gray-800 rounded-lg hover:bg-gray-800/50 transition-colors"
                >
                  Download CSV
                </button>
                <button
                  onClick={() => setShowSaveModal(true)}
                  className="px-3 py-1 text-xs font-semibold text-white bg-violet-600 hover:bg-violet-500 rounded-lg transition-colors"
                >
                  Save Report
                </button>
              </div>
            </div>

            {/* SQL Code Block */}
            {showSQL && (
              <pre className="p-4 bg-gray-900 border border-gray-800 rounded-xl text-xs text-gray-400 overflow-x-auto">
                {result.sql}
              </pre>
            )}

            {/* Data Table */}
            <div className="border border-gray-800 rounded-xl overflow-hidden">
              <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-gray-900 border-b border-gray-800">
                    <tr>
                      {columns.map((col) => (
                        <th
                          key={col}
                          onClick={() => {
                            if (sortCol === col) setSortAsc(!sortAsc);
                            else { setSortCol(col); setSortAsc(true); }
                          }}
                          className="px-4 py-2.5 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-200 select-none whitespace-nowrap"
                        >
                          {col.replace(/_/g, " ")}
                          {sortCol === col && (
                            <span className="ml-1 text-violet-400">
                              {sortAsc ? "\u2191" : "\u2193"}
                            </span>
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800/50">
                    {sortedResults.map((row, ri) => (
                      <tr key={ri} className="hover:bg-gray-800/50">
                        {columns.map((col) => (
                          <td key={col} className="px-4 py-2 text-gray-300 whitespace-nowrap">
                            {row[col] === null ? (
                              <span className="text-gray-500 italic">null</span>
                            ) : (
                              String(row[col])
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Empty result */}
        {result && result.results.length === 0 && !error && (
          <div className="text-center py-8">
            <p className="text-gray-500 text-sm">No results found for this query.</p>
            {result.sql && (
              <pre className="mt-3 p-3 bg-gray-900 border border-gray-800 rounded-lg text-xs text-gray-500 inline-block text-left max-w-2xl overflow-x-auto">
                {result.sql}
              </pre>
            )}
          </div>
        )}

        {/* ── Saved Reports Library ──────────────────────────── */}
        <div className="space-y-4 pt-4 border-t border-gray-800">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">Saved Reports</h2>
            <div className="flex items-center gap-2">
              <select
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value)}
                className="px-2 py-1 bg-gray-900 border border-gray-800 rounded-lg text-xs text-gray-400"
              >
                <option value="">All Categories</option>
                {(Object.entries(REPORT_CATEGORY_LABELS) as [ReportCategory, string][]).map(
                  ([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ),
                )}
              </select>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search..."
                className="px-3 py-1 bg-gray-900 border border-gray-800 rounded-lg text-xs text-gray-400 placeholder-gray-600 w-40"
              />
            </div>
          </div>

          {loadingReports ? (
            <div className="flex justify-center py-8">
              <div className="w-6 h-6 border-2 border-gray-700 border-t-gray-400 rounded-full animate-spin" />
            </div>
          ) : savedReports.length === 0 ? (
            <p className="text-center text-gray-500 text-sm py-8">
              No saved reports yet. Generate a report and save it to build your library.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {savedReports.map((report) => (
                <div
                  key={report.id}
                  className="p-4 bg-gray-900 border border-gray-800 rounded-xl hover:border-gray-700 transition-colors"
                >
                  <div className="flex items-start justify-between mb-2">
                    <h3 className="text-sm font-semibold text-gray-200 line-clamp-1">
                      {report.name}
                    </h3>
                    {report.category && (
                      <span className="shrink-0 ml-2 px-2 py-0.5 bg-violet-500/10 text-violet-400 rounded text-xs font-semibold uppercase">
                        {report.category}
                      </span>
                    )}
                  </div>
                  {report.description && (
                    <p className="text-xs text-gray-500 line-clamp-2 mb-2">
                      {report.description}
                    </p>
                  )}
                  <p className="text-xs text-gray-500 mb-3 line-clamp-1 italic">
                    "{report.prompt}"
                  </p>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 text-xs text-gray-500">
                      <span>by {report.created_by_name}</span>
                      {report.run_count > 0 && (
                        <span>{report.run_count} runs</span>
                      )}
                      {report.is_shared && (
                        <span className="text-violet-500">shared</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleRerun(report)}
                        className="px-2 py-1 text-xs font-semibold text-violet-400 hover:text-violet-300 bg-violet-500/10 hover:bg-violet-500/20 rounded transition-colors"
                      >
                        Run
                      </button>
                      {report.created_by === user?.id && (
                        <button
                          onClick={() => handleDelete(report.id)}
                          className="px-2 py-1 text-xs text-gray-500 hover:text-red-400 rounded transition-colors"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* ── Save Modal ────────────────────────────────────────── */}
      {showSaveModal && (
        <>
          <div
            className="fixed inset-0 bg-black/60 z-50"
            onClick={() => setShowSaveModal(false)}
          />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-md p-6 space-y-4">
              <h3 className="text-lg font-bold">Save Report</h3>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Name</label>
                <input
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:border-violet-500/50"
                  placeholder="e.g., Overdue AR Over $5K"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Description</label>
                <input
                  value={saveDesc}
                  onChange={(e) => setSaveDesc(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:border-violet-500/50"
                  placeholder="Optional description"
                />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-xs text-gray-500 mb-1">Category</label>
                  <select
                    value={saveCategory}
                    onChange={(e) => setSaveCategory(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200"
                  >
                    {(Object.entries(REPORT_CATEGORY_LABELS) as [ReportCategory, string][]).map(
                      ([key, label]) => (
                        <option key={key} value={key}>{label}</option>
                      ),
                    )}
                  </select>
                </div>
                <div className="flex items-end pb-1">
                  <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={saveShared}
                      onChange={(e) => setSaveShared(e.target.checked)}
                      className="rounded"
                    />
                    Share
                  </label>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => setShowSaveModal(false)}
                  className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || !saveName.trim()}
                  className="px-4 py-2 text-sm font-semibold text-white bg-violet-600 hover:bg-violet-500 disabled:bg-gray-700 rounded-lg transition-colors"
                >
                  {saving ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
