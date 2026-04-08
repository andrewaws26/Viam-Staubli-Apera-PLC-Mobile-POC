"use client";

import { useState, useRef, useCallback, useEffect } from "react";

// ── Types ─────────────────────────────────────────────────────────────

interface LineItem {
  description: string;
  amount: number | null;
}

interface ReceiptData {
  vendor_name: string | null;
  date: string | null;
  total_amount: number | null;
  tax_amount: number | null;
  subtotal: number | null;
  line_items: LineItem[];
  payment_method: string | null;
  category_suggestion: string | null;
}

interface ScanHistoryEntry {
  id: string;
  vendor_name: string | null;
  date: string | null;
  total_amount: number | null;
  category: string | null;
  scanned_at: string;
  data: ReceiptData;
}

// ── Constants ─────────────────────────────────────────────────────────

const CATEGORIES = [
  "fuel",
  "meals",
  "office_supplies",
  "tools",
  "auto_parts",
  "lodging",
  "other",
] as const;

const CATEGORY_LABELS: Record<string, string> = {
  fuel: "Fuel",
  meals: "Meals & Entertainment",
  office_supplies: "Office Supplies",
  tools: "Tools & Equipment",
  auto_parts: "Auto Parts",
  lodging: "Lodging & Travel",
  other: "Other",
};

const STORAGE_KEY = "ironsight_receipt_scans";

// ── Helpers ───────────────────────────────────────────────────────────

function fmtCurrency(n: number | null): string {
  if (n === null || n === undefined) return "--";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(n);
}

function fmtDate(d: string | null): string {
  if (!d) return "--";
  try {
    return new Date(d + "T00:00:00").toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return d;
  }
}

function loadHistory(): ScanHistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as ScanHistoryEntry[];
  } catch {
    return [];
  }
}

function saveHistory(entries: ScanHistoryEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, 10)));
  } catch {
    // localStorage full or unavailable
  }
}

// ── Main Page ─────────────────────────────────────────────────────────

export default function ReceiptOcrPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [mimeType, setMimeType] = useState<string>("");
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<ReceiptData | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [history, setHistory] = useState<ScanHistoryEntry[]>([]);
  const [viewingHistory, setViewingHistory] = useState<ScanHistoryEntry | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // Load history on mount
  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  // Auto-dismiss toast
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // ── File handling ─────────────────────────────────────────────────

  const processFile = useCallback((file: File) => {
    const validTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!validTypes.includes(file.type)) {
      setError("Please upload a JPG, PNG, or WebP image.");
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setError("Image must be under 20MB.");
      return;
    }

    setError(null);
    setResult(null);
    setViewingHistory(null);
    setMimeType(file.type);

    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      setImagePreview(dataUrl);
      // Extract base64 from data URL (remove "data:image/...;base64," prefix)
      const base64 = dataUrl.split(",")[1];
      setImageBase64(base64);
    };
    reader.readAsDataURL(file);
  }, []);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) processFile(file);
    },
    [processFile],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file) processFile(file);
    },
    [processFile],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  // ── Scan ──────────────────────────────────────────────────────────

  const handleScan = useCallback(async () => {
    if (!imageBase64 || !mimeType) return;

    setScanning(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/accounting/receipt-ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: imageBase64, mime_type: mimeType }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to scan receipt");
        return;
      }

      const extracted = data.data as ReceiptData;
      setResult(extracted);
      setSelectedCategory(extracted.category_suggestion || "other");

      // Save to history
      const entry: ScanHistoryEntry = {
        id: crypto.randomUUID(),
        vendor_name: extracted.vendor_name,
        date: extracted.date,
        total_amount: extracted.total_amount,
        category: extracted.category_suggestion,
        scanned_at: new Date().toISOString(),
        data: extracted,
      };
      const updated = [entry, ...loadHistory()].slice(0, 10);
      saveHistory(updated);
      setHistory(updated);
    } catch (err) {
      console.error("Receipt scan error:", err);
      setError("Network error. Please try again.");
    } finally {
      setScanning(false);
    }
  }, [imageBase64, mimeType]);

  // ── Actions ───────────────────────────────────────────────────────

  const handleCreateExpense = useCallback(() => {
    setToast(
      "Expense entry created. Receipt data would be sent to the expense system with category: " +
        CATEGORY_LABELS[selectedCategory || "other"] +
        ".",
    );
  }, [selectedCategory]);

  const handleReset = useCallback(() => {
    setImagePreview(null);
    setImageBase64(null);
    setMimeType("");
    setResult(null);
    setError(null);
    setSelectedCategory("");
    setViewingHistory(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const handleViewHistory = useCallback((entry: ScanHistoryEntry) => {
    setViewingHistory(entry);
    setResult(entry.data);
    setSelectedCategory(entry.data.category_suggestion || "other");
    setImagePreview(null);
    setImageBase64(null);
  }, []);

  // ── Active result (from scan or history view) ─────────────────────

  const activeResult = result;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">Receipt Scanner</h1>
          <p className="text-sm text-gray-400 mt-1">
            Upload a receipt image to automatically extract vendor, items, and totals using AI vision.
          </p>
        </div>

        {/* Toast */}
        {toast && (
          <div className="fixed top-20 right-6 z-50 max-w-sm bg-green-900/90 border border-green-700 text-green-100 px-4 py-3 rounded-xl shadow-2xl shadow-black/50 text-sm animate-in slide-in-from-right">
            <div className="flex items-start gap-2">
              <svg className="w-5 h-5 text-green-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{toast}</span>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* ── Left: Upload & Preview ──────────────────────────────── */}
          <div className="space-y-4">
            {/* Upload area */}
            <div
              onClick={() => fileInputRef.current?.click()}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              className={`relative border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all ${
                dragOver
                  ? "border-violet-400 bg-violet-950/30"
                  : imagePreview
                  ? "border-gray-700 bg-gray-900/50"
                  : "border-gray-700 bg-gray-900/30 hover:border-violet-500/50 hover:bg-gray-900/50"
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleFileSelect}
                className="hidden"
              />

              {imagePreview ? (
                <div className="space-y-3">
                  <img
                    src={imagePreview}
                    alt="Receipt preview"
                    className="max-h-80 mx-auto rounded-lg shadow-lg"
                  />
                  <p className="text-xs text-gray-500">Click or drag to replace</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="w-16 h-16 mx-auto rounded-2xl bg-gray-800/80 flex items-center justify-center">
                    <svg className="w-8 h-8 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-300">
                      Drop receipt image here
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      or click to browse -- JPG, PNG, WebP up to 20MB
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Error */}
            {error && (
              <div className="bg-red-950/50 border border-red-800/60 rounded-xl px-4 py-3 text-sm text-red-300">
                {error}
              </div>
            )}

            {/* Scan button */}
            {imageBase64 && !scanning && (
              <button
                onClick={handleScan}
                className="w-full py-3 rounded-xl font-semibold text-sm bg-violet-600 hover:bg-violet-500 text-white transition-colors shadow-lg shadow-violet-900/30"
              >
                Scan Receipt
              </button>
            )}

            {/* Scanning state */}
            {scanning && (
              <div className="flex items-center justify-center gap-3 py-4">
                <div className="w-5 h-5 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
                <span className="text-sm text-violet-300 font-medium">
                  Analyzing receipt with AI vision...
                </span>
              </div>
            )}

            {/* Action buttons (after results) */}
            {activeResult && !viewingHistory && (
              <div className="flex gap-3">
                <button
                  onClick={handleCreateExpense}
                  className="flex-1 py-2.5 rounded-xl font-semibold text-sm bg-green-600 hover:bg-green-500 text-white transition-colors"
                >
                  Create Expense Entry
                </button>
                <button
                  onClick={handleReset}
                  className="flex-1 py-2.5 rounded-xl font-semibold text-sm bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors border border-gray-700"
                >
                  Scan Another
                </button>
              </div>
            )}

            {viewingHistory && (
              <button
                onClick={handleReset}
                className="w-full py-2.5 rounded-xl font-semibold text-sm bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors border border-gray-700"
              >
                Back to Scanner
              </button>
            )}
          </div>

          {/* ── Right: Results Panel ──────────────────────────────── */}
          <div className="space-y-4">
            {activeResult ? (
              <>
                {/* Vendor & Date header */}
                <div className="bg-gray-900/60 border border-gray-800 rounded-2xl p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-xl font-bold text-white">
                        {activeResult.vendor_name || "Unknown Vendor"}
                      </h2>
                      <p className="text-sm text-gray-400 mt-0.5">
                        {fmtDate(activeResult.date)}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-2xl font-bold text-violet-300">
                        {fmtCurrency(activeResult.total_amount)}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">Total</p>
                    </div>
                  </div>
                </div>

                {/* Line items */}
                {activeResult.line_items && activeResult.line_items.length > 0 && (
                  <div className="bg-gray-900/60 border border-gray-800 rounded-2xl overflow-hidden">
                    <div className="px-5 py-3 border-b border-gray-800/80">
                      <h3 className="text-sm font-semibold text-gray-300">
                        Line Items ({activeResult.line_items.length})
                      </h3>
                    </div>
                    <div className="divide-y divide-gray-800/60">
                      {activeResult.line_items.map((item, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between px-5 py-2.5 text-sm"
                        >
                          <span className="text-gray-300 truncate mr-4">
                            {item.description || "Item"}
                          </span>
                          <span className="text-gray-400 font-mono shrink-0">
                            {fmtCurrency(item.amount)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Totals */}
                <div className="bg-gray-900/60 border border-gray-800 rounded-2xl p-5 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Subtotal</span>
                    <span className="text-gray-300 font-mono">
                      {fmtCurrency(activeResult.subtotal)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Tax</span>
                    <span className="text-gray-300 font-mono">
                      {fmtCurrency(activeResult.tax_amount)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm pt-2 border-t border-gray-800">
                    <span className="text-white font-semibold">Total</span>
                    <span className="text-violet-300 font-bold font-mono">
                      {fmtCurrency(activeResult.total_amount)}
                    </span>
                  </div>
                </div>

                {/* Payment method & Category */}
                <div className="bg-gray-900/60 border border-gray-800 rounded-2xl p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-400">Payment Method</span>
                    <span className="text-sm font-medium text-gray-200 capitalize">
                      {activeResult.payment_method || "Unknown"}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-4">
                    <span className="text-sm text-gray-400 shrink-0">Category</span>
                    <select
                      value={selectedCategory}
                      onChange={(e) => setSelectedCategory(e.target.value)}
                      className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-violet-500 focus:border-violet-500"
                    >
                      {CATEGORIES.map((cat) => (
                        <option key={cat} value={cat}>
                          {CATEGORY_LABELS[cat]}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </>
            ) : (
              <div className="bg-gray-900/40 border border-gray-800/60 rounded-2xl p-12 text-center">
                <div className="w-16 h-16 mx-auto rounded-2xl bg-gray-800/50 flex items-center justify-center mb-4">
                  <svg className="w-8 h-8 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <p className="text-sm text-gray-500">
                  Upload and scan a receipt to see extracted data here.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* ── History ──────────────────────────────────────────────── */}
        {history.length > 0 && (
          <div className="mt-10">
            <h2 className="text-lg font-bold text-white mb-4">Recent Scans</h2>
            <div className="bg-gray-900/60 border border-gray-800 rounded-2xl overflow-hidden">
              <div className="divide-y divide-gray-800/60">
                {history.map((entry) => (
                  <button
                    key={entry.id}
                    onClick={() => handleViewHistory(entry)}
                    className={`w-full flex items-center justify-between px-5 py-3.5 text-left hover:bg-gray-800/40 transition-colors ${
                      viewingHistory?.id === entry.id ? "bg-violet-950/20 border-l-2 border-violet-500" : ""
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-gray-200 truncate">
                        {entry.vendor_name || "Unknown Vendor"}
                      </p>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-xs text-gray-500">
                          {fmtDate(entry.date)}
                        </span>
                        {entry.category && (
                          <span className="text-xs text-gray-600 capitalize">
                            {CATEGORY_LABELS[entry.category] || entry.category}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0 ml-4">
                      <p className="text-sm font-bold text-violet-300">
                        {fmtCurrency(entry.total_amount)}
                      </p>
                      <p className="text-xs text-gray-600">
                        {new Date(entry.scanned_at).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        })}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
