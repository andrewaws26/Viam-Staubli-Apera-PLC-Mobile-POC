"use client";

import { useState, useEffect, useCallback } from "react";

interface Session {
  id: string;
  sessionType: string;
  status: string;
  title: string | null;
  description: string | null;
  tokensUsed: number | null;
  costCents: number | null;
  outputSummary: string | null;
  startedAt: string;
  endedAt: string | null;
  createdBy: string;
}

const STATUS_COLORS: Record<string, { dot: string; text: string }> = {
  running:   { dot: "bg-blue-400",   text: "text-blue-400" },
  completed: { dot: "bg-green-400",  text: "text-green-400" },
  failed:    { dot: "bg-red-400",    text: "text-red-400" },
  cancelled: { dot: "bg-gray-500",   text: "text-gray-500" },
};

const TYPE_LABELS: Record<string, { label: string; bg: string; text: string }> = {
  "claude-code":    { label: "Claude Code",    bg: "bg-violet-700/30",  text: "text-violet-400" },
  "vercel-cron":    { label: "Vercel Cron",    bg: "bg-blue-700/30",    text: "text-blue-400" },
  "github-action":  { label: "GitHub Action",  bg: "bg-gray-700/30",    text: "text-gray-400" },
  "manual":         { label: "Manual",          bg: "bg-amber-700/30",   text: "text-amber-400" },
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function duration(start: string, end: string | null): string {
  if (!end) return "ongoing";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "<1m";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

export default function SessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Session | null>(null);

  // Log new session modal
  const [modalOpen, setModalOpen] = useState(false);
  const [formType, setFormType] = useState("claude-code");
  const [formTitle, setFormTitle] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filterStatus !== "all") params.set("status", filterStatus);
    if (filterType !== "all") params.set("type", filterType);
    params.set("limit", "50");
    const res = await fetch(`/api/dev-portal/sessions?${params}`);
    if (res.ok) {
      const data = await res.json();
      setSessions(data.sessions || []);
    }
    setLoading(false);
  }, [filterStatus, filterType]);

  useEffect(() => { fetchSessions(); }, [fetchSessions]);

  const loadDetail = async (id: string) => {
    setSelectedId(id);
    const res = await fetch(`/api/dev-portal/sessions/${id}`);
    if (res.ok) {
      const data = await res.json();
      setDetail(data.session);
    }
  };

  const handleCreate = async () => {
    setSaving(true);
    const res = await fetch("/api/dev-portal/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionType: formType,
        title: formTitle || null,
        description: formDesc || null,
      }),
    });
    if (res.ok) {
      setModalOpen(false);
      setFormTitle("");
      setFormDesc("");
      fetchSessions();
    }
    setSaving(false);
  };

  const updateStatus = async (id: string, status: string) => {
    await fetch(`/api/dev-portal/sessions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    fetchSessions();
    if (selectedId === id) loadDetail(id);
  };

  // Summary stats
  const running = sessions.filter((s) => s.status === "running").length;
  const totalTokens = sessions.reduce((sum, s) => sum + (s.tokensUsed || 0), 0);
  const totalCost = sessions.reduce((sum, s) => sum + (s.costCents || 0), 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight">AI Sessions</h1>
          <p className="text-sm text-gray-500 mt-1">
            Track Claude Code and automated AI sessions
          </p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="px-4 py-2 text-sm font-semibold rounded-lg bg-cyan-600 hover:bg-cyan-500 transition-colors"
        >
          + Log Session
        </button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
          <div className="text-2xl font-black text-blue-400">{running}</div>
          <div className="text-xs text-gray-500 mt-1">Active Sessions</div>
        </div>
        <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
          <div className="text-2xl font-black text-gray-200">
            {totalTokens > 1000 ? `${(totalTokens / 1000).toFixed(1)}k` : totalTokens}
          </div>
          <div className="text-xs text-gray-500 mt-1">Total Tokens</div>
        </div>
        <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
          <div className="text-2xl font-black text-green-400">
            ${(totalCost / 100).toFixed(2)}
          </div>
          <div className="text-xs text-gray-500 mt-1">Total Cost</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-4 flex-wrap">
        <div className="flex gap-2">
          {["all", "running", "completed", "failed"].map((s) => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                filterStatus === s
                  ? "border-cyan-600 bg-cyan-600/20 text-cyan-400"
                  : "border-gray-700 bg-gray-800/50 text-gray-400 hover:border-gray-600"
              }`}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          {["all", "claude-code", "vercel-cron", "github-action", "manual"].map((t) => (
            <button
              key={t}
              onClick={() => setFilterType(t)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                filterType === t
                  ? "border-cyan-600 bg-cyan-600/20 text-cyan-400"
                  : "border-gray-700 bg-gray-800/50 text-gray-400 hover:border-gray-600"
              }`}
            >
              {t === "all" ? "All Types" : (TYPE_LABELS[t]?.label || t)}
            </button>
          ))}
        </div>
      </div>

      {/* Two-column: list + detail */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Session List */}
        <div className="lg:col-span-3 space-y-2">
          {loading ? (
            <div className="text-center py-12 text-gray-500 text-sm">Loading...</div>
          ) : sessions.length === 0 ? (
            <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-8 text-center">
              <p className="text-sm text-gray-500">No sessions recorded</p>
              <p className="text-xs text-gray-700 mt-1">Sessions will appear here as they run</p>
            </div>
          ) : (
            sessions.map((s) => {
              const sc = STATUS_COLORS[s.status] || STATUS_COLORS.cancelled;
              const tc = TYPE_LABELS[s.sessionType] || TYPE_LABELS.manual;
              return (
                <button
                  key={s.id}
                  onClick={() => loadDetail(s.id)}
                  className={`w-full text-left rounded-lg border p-3 transition-all ${
                    selectedId === s.id
                      ? "border-cyan-600/50 bg-cyan-900/10"
                      : "border-gray-800 bg-gray-900/40 hover:border-gray-700"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="relative flex h-2 w-2 shrink-0">
                      {s.status === "running" && (
                        <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${sc.dot} opacity-75`} />
                      )}
                      <span className={`relative inline-flex rounded-full h-2 w-2 ${sc.dot}`} />
                    </span>
                    <span className="text-sm font-semibold text-gray-200 truncate flex-1">
                      {s.title || `${tc.label} Session`}
                    </span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${tc.bg} ${tc.text}`}>
                      {tc.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 ml-4">
                    <span className={`text-xs capitalize ${sc.text}`}>{s.status}</span>
                    <span className="text-xs text-gray-500">
                      {duration(s.startedAt, s.endedAt)}
                    </span>
                    {s.tokensUsed && (
                      <span className="text-xs text-gray-500">
                        {s.tokensUsed > 1000 ? `${(s.tokensUsed / 1000).toFixed(1)}k` : s.tokensUsed} tokens
                      </span>
                    )}
                    <span className="text-xs text-gray-700 ml-auto">
                      {timeAgo(s.startedAt)}
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Detail Panel */}
        <div className="lg:col-span-2">
          {!detail || selectedId === null ? (
            <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-12 text-center">
              <p className="text-sm text-gray-500">Select a session to view details</p>
            </div>
          ) : (
            <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4 space-y-4">
              <div>
                <h2 className="text-lg font-bold text-gray-100">
                  {detail.title || "Untitled Session"}
                </h2>
                {detail.description && (
                  <p className="text-sm text-gray-500 mt-1">{detail.description}</p>
                )}
              </div>

              {/* Metadata grid */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="text-xs text-gray-500 uppercase block">Status</span>
                  <span className={`text-sm font-semibold capitalize ${(STATUS_COLORS[detail.status] || STATUS_COLORS.cancelled).text}`}>
                    {detail.status}
                  </span>
                </div>
                <div>
                  <span className="text-xs text-gray-500 uppercase block">Type</span>
                  <span className="text-sm text-gray-300">
                    {(TYPE_LABELS[detail.sessionType] || TYPE_LABELS.manual).label}
                  </span>
                </div>
                <div>
                  <span className="text-xs text-gray-500 uppercase block">Duration</span>
                  <span className="text-sm text-gray-300">
                    {duration(detail.startedAt, detail.endedAt)}
                  </span>
                </div>
                <div>
                  <span className="text-xs text-gray-500 uppercase block">Cost</span>
                  <span className="text-sm text-gray-300">
                    {detail.costCents ? `$${(detail.costCents / 100).toFixed(2)}` : "--"}
                  </span>
                </div>
                <div>
                  <span className="text-xs text-gray-500 uppercase block">Tokens</span>
                  <span className="text-sm text-gray-300">
                    {detail.tokensUsed ? detail.tokensUsed.toLocaleString() : "--"}
                  </span>
                </div>
                <div>
                  <span className="text-xs text-gray-500 uppercase block">Started</span>
                  <span className="text-sm text-gray-300">
                    {new Date(detail.startedAt).toLocaleString()}
                  </span>
                </div>
              </div>

              {/* Output summary */}
              {detail.outputSummary && (
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-2">
                    Output Summary
                  </h3>
                  <div className="p-3 rounded-lg bg-gray-950 border border-gray-800 text-xs text-gray-300 whitespace-pre-wrap">
                    {detail.outputSummary}
                  </div>
                </div>
              )}

              {/* Status actions */}
              {detail.status === "running" && (
                <div className="flex gap-2 pt-2">
                  <button
                    onClick={() => updateStatus(detail.id, "completed")}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg bg-green-700/30 text-green-400 border border-green-700/40 hover:border-green-600/50"
                  >
                    Mark Completed
                  </button>
                  <button
                    onClick={() => updateStatus(detail.id, "failed")}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-700/30 text-red-400 border border-red-700/40 hover:border-red-600/50"
                  >
                    Mark Failed
                  </button>
                  <button
                    onClick={() => updateStatus(detail.id, "cancelled")}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-700/30 text-gray-400 border border-gray-700/40 hover:border-gray-600/50"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Log Session Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-md p-6 space-y-4">
            <h2 className="text-lg font-bold">Log New Session</h2>

            <div>
              <label className="text-xs text-gray-500 block mb-1">Session Type</label>
              <select
                value={formType}
                onChange={(e) => setFormType(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-700 bg-gray-800/50 text-gray-200"
              >
                {Object.entries(TYPE_LABELS).map(([key, val]) => (
                  <option key={key} value={key}>{val.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs text-gray-500 block mb-1">Title</label>
              <input
                type="text"
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-700 bg-gray-800/50 text-gray-200"
                placeholder="e.g. Dev Portal Phase 2 build"
              />
            </div>

            <div>
              <label className="text-xs text-gray-500 block mb-1">Description</label>
              <textarea
                value={formDesc}
                onChange={(e) => setFormDesc(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-700 bg-gray-800/50 text-gray-200"
                placeholder="What is this session for?"
              />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setModalOpen(false)}
                className="px-4 py-2 text-sm rounded-lg border border-gray-700 text-gray-400 hover:border-gray-600"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={saving}
                className="px-4 py-2 text-sm font-semibold rounded-lg bg-cyan-600 hover:bg-cyan-500 transition-colors disabled:opacity-50"
              >
                {saving ? "Creating..." : "Create Session"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
