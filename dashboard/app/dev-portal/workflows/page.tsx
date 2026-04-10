"use client";

import { useState, useEffect, useCallback } from "react";

interface WorkflowRun {
  id: string;
  status: string;
  trigger: string;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  startedAt: string;
  endedAt: string | null;
}

interface Workflow {
  id: string;
  name: string;
  description: string | null;
  engine: string;
  cronExpression: string | null;
  isActive: boolean;
  config: Record<string, unknown>;
  promptTemplateId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  recentRuns: WorkflowRun[];
  lastRun: { status: string; startedAt: string } | null;
}

const ENGINES = ["vercel-cron", "github-actions", "dev-pi"] as const;

const ENGINE_META: Record<string, { label: string; bg: string; text: string; icon: string; desc: string }> = {
  "vercel-cron":    { label: "Vercel Cron", bg: "bg-gray-700/30", text: "text-gray-300", icon: "⏱", desc: "Serverless functions on Vercel's cron scheduler" },
  "github-actions": { label: "GitHub Actions", bg: "bg-purple-700/30", text: "text-purple-400", icon: "⚙", desc: "CI/CD workflows on GitHub's runners" },
  "dev-pi":         { label: "Dev Pi 5", bg: "bg-green-700/30", text: "text-green-400", icon: "🖥", desc: "Always-on automation on your personal Pi 5" },
};

const STATUS_COLORS: Record<string, { dot: string; text: string }> = {
  running:   { dot: "bg-blue-400", text: "text-blue-400" },
  completed: { dot: "bg-green-400", text: "text-green-400" },
  failed:    { dot: "bg-red-400", text: "text-red-400" },
  cancelled: { dot: "bg-gray-500", text: "text-gray-500" },
};

const CRON_PRESETS = [
  { label: "Every 5 min", value: "*/5 * * * *" },
  { label: "Every 15 min", value: "*/15 * * * *" },
  { label: "Every hour", value: "0 * * * *" },
  { label: "Every 6 hours", value: "0 */6 * * *" },
  { label: "Daily 3 AM", value: "0 3 * * *" },
  { label: "Daily 8 AM", value: "0 8 * * *" },
  { label: "Weekdays 9 AM", value: "0 9 * * 1-5" },
  { label: "Weekly Monday", value: "0 6 * * 1" },
  { label: "Monthly 1st", value: "0 0 1 * *" },
];

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function describeCron(expr: string): string {
  const preset = CRON_PRESETS.find((p) => p.value === expr);
  if (preset) return preset.label;
  const parts = expr.split(" ");
  if (parts.length !== 5) return expr;
  const [min, hour, dom, , dow] = parts;
  if (min === "*" && hour === "*") return "Every minute";
  if (min.startsWith("*/")) return `Every ${min.slice(2)} min`;
  if (hour.startsWith("*/")) return `Every ${hour.slice(2)} hours`;
  if (dow === "1-5") return `Weekdays at ${hour}:${min.padStart(2, "0")}`;
  if (dom === "1") return `Monthly at ${hour}:${min.padStart(2, "0")}`;
  return `${hour}:${min.padStart(2, "0")} daily`;
}

function duration(start: string, end: string | null): string {
  if (!end) return "running...";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  return `${Math.round(ms / 60000)}m`;
}

export default function WorkflowsPage() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterEngine, setFilterEngine] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [triggering, setTriggering] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [isLocal, setIsLocal] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [liveOutput, setLiveOutput] = useState<Record<string, unknown> | null>(null);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editWorkflow, setEditWorkflow] = useState<Workflow | null>(null);
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formEngine, setFormEngine] = useState<string>("vercel-cron");
  const [formCron, setFormCron] = useState("");
  const [formActive, setFormActive] = useState(false);
  const [formCommand, setFormCommand] = useState("");
  const [formPrompt, setFormPrompt] = useState("");
  const [saving, setSaving] = useState(false);

  // Detect local execution engine
  useEffect(() => {
    const local = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
    setIsLocal(local);
    if (local) {
      fetch("/api/dev-portal/workflows/execute")
        .then((r) => r.ok ? r.json() : null)
        .then((d) => { if (d?.available) setIsLocal(true); })
        .catch(() => {});
    }
  }, []);

  // Poll active run for live output
  useEffect(() => {
    if (!activeRunId) return;
    const poll = setInterval(async () => {
      const res = await fetch(`/api/dev-portal/workflows/execute?runId=${activeRunId}`);
      if (!res.ok) return;
      const data = await res.json();
      setLiveOutput(data.output);
      if (data.status !== "running") {
        setActiveRunId(null);
        setTriggering(null);
        fetchWorkflows();
        clearInterval(poll);
      }
    }, 2000);
    return () => clearInterval(poll);
  }, [activeRunId]);

  const fetchWorkflows = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filterEngine !== "all") params.set("engine", filterEngine);
    const res = await fetch(`/api/dev-portal/workflows?${params}`);
    if (res.ok) setWorkflows((await res.json()).workflows || []);
    setLoading(false);
  }, [filterEngine]);

  useEffect(() => { fetchWorkflows(); }, [fetchWorkflows]);

  const openCreate = () => {
    setEditWorkflow(null);
    setFormName(""); setFormDesc(""); setFormEngine("vercel-cron"); setFormCron(""); setFormActive(false);
    setFormCommand(""); setFormPrompt("");
    setModalOpen(true);
  };

  const openEdit = (w: Workflow) => {
    setEditWorkflow(w);
    setFormName(w.name); setFormDesc(w.description || ""); setFormEngine(w.engine);
    setFormCron(w.cronExpression || ""); setFormActive(w.isActive);
    setFormCommand((w.config?.command as string) || "");
    setFormPrompt((w.config?.prompt as string) || "");
    setModalOpen(true);
  };

  const handleSave = async () => {
    setSaving(true);
    const config: Record<string, unknown> = {};
    if (formCommand.trim()) config.command = formCommand.trim();
    if (formPrompt.trim()) config.prompt = formPrompt.trim();

    const payload = {
      name: formName, description: formDesc || null, engine: formEngine,
      cronExpression: formCron || null, isActive: formActive, config,
    };

    if (editWorkflow) {
      await fetch(`/api/dev-portal/workflows/${editWorkflow.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } else {
      await fetch("/api/dev-portal/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    }
    setSaving(false);
    setModalOpen(false);
    fetchWorkflows();
  };

  const handleToggle = async (id: string) => {
    await fetch(`/api/dev-portal/workflows/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "toggle" }),
    });
    fetchWorkflows();
  };

  const handleTrigger = async (id: string) => {
    setTriggering(id);
    setLiveOutput(null);

    if (isLocal) {
      // Use local execution engine — actually runs the command
      const res = await fetch("/api/dev-portal/workflows/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflowId: id }),
      });
      if (res.ok) {
        const data = await res.json();
        setActiveRunId(data.run.id); // start polling
      } else {
        setTriggering(null);
        fetchWorkflows();
      }
    } else {
      // Online mode — just log the trigger
      await fetch(`/api/dev-portal/workflows/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "trigger" }),
      });
      setTriggering(null);
      fetchWorkflows();
    }
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/dev-portal/workflows/${id}`, { method: "DELETE" });
    if (selectedId === id) setSelectedId(null);
    fetchWorkflows();
  };

  const selected = workflows.find((w) => w.id === selectedId);
  const activeCount = workflows.filter((w) => w.isActive).length;
  const engineCounts = ENGINES.reduce((acc, e) => {
    acc[e] = workflows.filter((w) => w.engine === e).length;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight">Workflow Builder</h1>
            {isLocal && (
              <span className="px-2 py-0.5 text-xs font-bold rounded-full bg-green-500/20 text-green-400 border border-green-600/30">
                LOCAL ENGINE
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500 mt-1">
            {isLocal
              ? "Local execution active — workflows run on this machine"
              : "Scheduled automation across three execution engines"}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowSetup(!showSetup)}
            className="px-3 py-2 text-sm rounded-lg border border-gray-700 text-gray-400 hover:border-green-600 hover:text-green-400 transition-colors">
            Pi 5 Setup
          </button>
          <button onClick={openCreate}
            className="px-4 py-2 text-sm font-semibold rounded-lg bg-cyan-600 hover:bg-cyan-500 transition-colors">
            + New Workflow
          </button>
        </div>
      </div>

      {/* Pi 5 Setup Guide */}
      {showSetup && (
        <div className="rounded-xl border border-green-800/50 bg-green-900/10 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-green-400">Dev Pi 5 — Self-Hosted Automation Server</h2>
            <button onClick={() => setShowSetup(false)} className="text-xs text-gray-600 hover:text-gray-400">Close</button>
          </div>
          <p className="text-sm text-gray-400">
            Your personal Pi 5 serves as the third execution engine — an always-on automation
            server that runs Claude Code sessions, scheduled scripts, and acts as a self-hosted
            GitHub Actions runner.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
              <h3 className="text-sm font-bold text-green-400 mb-2">1. Self-Hosted Runner</h3>
              <p className="text-xs text-gray-500 mb-3">Register your Pi 5 as a GitHub Actions runner for always-on CI/CD.</p>
              <pre className="text-xs text-gray-400 bg-gray-950 rounded p-2 overflow-x-auto font-mono leading-relaxed">{`# On your Pi 5:
cd ~/actions-runner
./config.sh --url \\
  https://github.com/OWNER/REPO \\
  --token YOUR_TOKEN \\
  --labels dev-pi,ironsight
sudo ./svc.sh install
sudo ./svc.sh start`}</pre>
            </div>

            <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
              <h3 className="text-sm font-bold text-green-400 mb-2">2. Cron Automation</h3>
              <p className="text-xs text-gray-500 mb-3">Schedule scripts directly on the Pi for tasks that don&apos;t need CI.</p>
              <pre className="text-xs text-gray-400 bg-gray-950 rounded p-2 overflow-x-auto font-mono leading-relaxed">{`# Example cron entries:
# Daily report generation
0 3 * * * claude -p "Generate \\
  shift report" >> /var/log/reports.log

# Hourly fleet health check
0 * * * * ~/scripts/fleet-health.sh

# Weekly code quality scan
0 6 * * 1 cd ~/repo && npm run lint`}</pre>
            </div>

            <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
              <h3 className="text-sm font-bold text-green-400 mb-2">3. Always-On Claude</h3>
              <p className="text-xs text-gray-500 mb-3">Run long Claude Code sessions that would time out on serverless.</p>
              <pre className="text-xs text-gray-400 bg-gray-950 rounded p-2 overflow-x-auto font-mono leading-relaxed">{`# Automated diagnostic analysis
claude -p "Analyze last 24h of \\
  fleet sensor data and write \\
  a summary to /tmp/daily.md"

# Scheduled test runs
claude -p "Run full test suite, \\
  fix any failures, commit to \\
  autofix/ branch"

# SSH in from anywhere via Tailscale
ssh andrew@100.112.68.52`}</pre>
            </div>
          </div>

          <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-3">
            <h3 className="text-sm font-bold text-gray-300 mb-2">Engine Comparison</h3>
            <div className="grid grid-cols-3 gap-3 text-xs">
              <div>
                <span className="text-gray-500 block mb-1">Vercel Cron</span>
                <ul className="text-gray-400 space-y-0.5">
                  <li>+ Serverless, zero maintenance</li>
                  <li>+ Integrated with dashboard</li>
                  <li>- 10s execution limit (hobby)</li>
                  <li>- No persistent state</li>
                </ul>
              </div>
              <div>
                <span className="text-gray-500 block mb-1">GitHub Actions</span>
                <ul className="text-gray-400 space-y-0.5">
                  <li>+ 2000 free min/month</li>
                  <li>+ Full CI/CD pipeline</li>
                  <li>- Cold start ~30s</li>
                  <li>- No device access</li>
                </ul>
              </div>
              <div>
                <span className="text-gray-500 block mb-1">Dev Pi 5</span>
                <ul className="text-gray-400 space-y-0.5">
                  <li>+ Always on, no limits</li>
                  <li>+ Device access (CAN, GPIO)</li>
                  <li>+ Long-running Claude sessions</li>
                  <li>- Needs power + network</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Engine Filter + Stats */}
      <div className="flex flex-col sm:flex-row gap-4 sm:items-center sm:justify-between">
        <div className="flex gap-2">
          <button onClick={() => setFilterEngine("all")}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
              filterEngine === "all" ? "border-cyan-600 bg-cyan-600/20 text-cyan-400" : "border-gray-700 bg-gray-800/50 text-gray-400 hover:border-gray-600"
            }`}>
            All ({workflows.length})
          </button>
          {ENGINES.map((e) => {
            const meta = ENGINE_META[e];
            return (
              <button key={e} onClick={() => setFilterEngine(e)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                  filterEngine === e ? "border-cyan-600 bg-cyan-600/20 text-cyan-400" : "border-gray-700 bg-gray-800/50 text-gray-400 hover:border-gray-600"
                }`}>
                {meta.icon} {meta.label} ({engineCounts[e] || 0})
              </button>
            );
          })}
        </div>
        <div className="flex gap-3 text-xs text-gray-500">
          <span><span className="text-green-400 font-bold">{activeCount}</span> active</span>
          <span><span className="text-gray-300 font-bold">{workflows.length - activeCount}</span> inactive</span>
        </div>
      </div>

      {/* Workflow List + Detail */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3 space-y-2">
          {loading ? (
            <div className="text-center py-12 text-gray-600 text-sm">Loading...</div>
          ) : workflows.length === 0 ? (
            <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-8 text-center">
              <p className="text-sm text-gray-500">No workflows yet</p>
              <p className="text-xs text-gray-700 mt-1">Create your first scheduled automation</p>
            </div>
          ) : workflows.map((w) => {
            const em = ENGINE_META[w.engine] || ENGINE_META["vercel-cron"];
            const lastStatus = w.lastRun ? (STATUS_COLORS[w.lastRun.status] || STATUS_COLORS.cancelled) : null;
            return (
              <button key={w.id} onClick={() => setSelectedId(w.id)}
                className={`w-full text-left rounded-lg border p-3 transition-all ${
                  selectedId === w.id ? "border-cyan-600/50 bg-cyan-900/10" : "border-gray-800 bg-gray-900/40 hover:border-gray-700"
                }`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="relative flex h-2.5 w-2.5 shrink-0">
                    {w.isActive && (
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-30" />
                    )}
                    <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${w.isActive ? "bg-green-400" : "bg-gray-600"}`} />
                  </span>
                  <span className="text-sm font-semibold text-gray-200 truncate flex-1">{w.name}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded ${em.bg} ${em.text}`}>{em.label}</span>
                </div>
                {w.description && (
                  <p className="text-xs text-gray-500 ml-5 mb-1 line-clamp-1">{w.description}</p>
                )}
                <div className="flex items-center gap-2 ml-5">
                  {w.cronExpression && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 font-mono">
                      {describeCron(w.cronExpression)}
                    </span>
                  )}
                  {lastStatus && (
                    <span className="flex items-center gap-1">
                      <span className={`h-1.5 w-1.5 rounded-full ${lastStatus.dot}`} />
                      <span className={`text-xs capitalize ${lastStatus.text}`}>
                        {w.lastRun!.status}
                      </span>
                    </span>
                  )}
                  <span className="text-xs text-gray-700 ml-auto">{timeAgo(w.updatedAt)}</span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Detail Panel */}
        <div className="lg:col-span-2">
          {!selected ? (
            <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-12 text-center">
              <p className="text-sm text-gray-600">Select a workflow to view details</p>
            </div>
          ) : (
            <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4 space-y-4">
              {/* Header */}
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-gray-100">{selected.name}</h2>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`text-xs px-1.5 py-0.5 rounded ${ENGINE_META[selected.engine]?.bg || ""} ${ENGINE_META[selected.engine]?.text || ""}`}>
                      {ENGINE_META[selected.engine]?.label || selected.engine}
                    </span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${selected.isActive ? "bg-green-500/20 text-green-400" : "bg-gray-700/50 text-gray-500"}`}>
                      {selected.isActive ? "Active" : "Inactive"}
                    </span>
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => handleTrigger(selected.id)} disabled={triggering === selected.id}
                    className="px-2 py-1 text-xs rounded border border-cyan-700/50 hover:border-cyan-600 text-cyan-400 disabled:opacity-50">
                    {triggering === selected.id ? "..." : "Run"}
                  </button>
                  <button onClick={() => handleToggle(selected.id)}
                    className={`px-2 py-1 text-xs rounded border ${selected.isActive ? "border-amber-700/50 hover:border-amber-600 text-amber-400" : "border-green-700/50 hover:border-green-600 text-green-400"}`}>
                    {selected.isActive ? "Pause" : "Enable"}
                  </button>
                  <button onClick={() => openEdit(selected)}
                    className="px-2 py-1 text-xs rounded border border-gray-700 hover:border-gray-600 text-gray-400">
                    Edit
                  </button>
                  <button onClick={() => handleDelete(selected.id)}
                    className="px-2 py-1 text-xs rounded border border-red-800/50 hover:border-red-600/50 text-red-400">
                    Del
                  </button>
                </div>
              </div>

              {selected.description && (
                <p className="text-sm text-gray-400">{selected.description}</p>
              )}

              {/* Config */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="text-xs text-gray-600 uppercase block">Schedule</span>
                  <span className="text-sm text-gray-300 font-mono">
                    {selected.cronExpression ? describeCron(selected.cronExpression) : "Manual only"}
                  </span>
                </div>
                <div>
                  <span className="text-xs text-gray-600 uppercase block">Cron</span>
                  <span className="text-sm text-gray-300 font-mono">{selected.cronExpression || "--"}</span>
                </div>
                <div>
                  <span className="text-xs text-gray-600 uppercase block">Engine</span>
                  <span className="text-sm text-gray-300">{ENGINE_META[selected.engine]?.desc || selected.engine}</span>
                </div>
                <div>
                  <span className="text-xs text-gray-600 uppercase block">Created</span>
                  <span className="text-sm text-gray-300">{new Date(selected.createdAt).toLocaleDateString()}</span>
                </div>
              </div>

              {/* Execution config */}
              {(selected.config?.command || selected.config?.prompt) ? (
                <div className="space-y-2">
                  {selected.config.command ? (
                    <div>
                      <span className="text-xs text-gray-600 uppercase block">Command</span>
                      <code className="text-xs text-cyan-400 bg-gray-950 rounded px-2 py-1 block mt-0.5 font-mono">
                        {String(selected.config.command)}
                      </code>
                    </div>
                  ) : null}
                  {selected.config.prompt ? (
                    <div>
                      <span className="text-xs text-gray-600 uppercase block">Claude Prompt</span>
                      <p className="text-xs text-gray-400 bg-gray-950 rounded px-2 py-1 mt-0.5 whitespace-pre-wrap">
                        {String(selected.config.prompt)}
                      </p>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {/* Recent Runs */}
              <div>
                <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-2">Recent Runs</h3>
                {selected.recentRuns.length === 0 ? (
                  <p className="text-xs text-gray-600">No runs recorded yet</p>
                ) : (
                  <div className="space-y-1">
                    {selected.recentRuns.map((r) => {
                      const sc = STATUS_COLORS[r.status] || STATUS_COLORS.cancelled;
                      return (
                        <div key={r.id} className="flex items-center gap-2 p-2 rounded-lg border border-gray-800/50 bg-gray-900/30">
                          <span className={`h-2 w-2 rounded-full ${sc.dot} shrink-0`} />
                          <span className={`text-xs capitalize ${sc.text} w-16`}>{r.status}</span>
                          <span className="text-xs px-1 py-0.5 rounded bg-gray-800 text-gray-500">{r.trigger}</span>
                          <span className="text-xs text-gray-600 ml-auto">
                            {duration(r.startedAt, r.endedAt)}
                          </span>
                          <span className="text-xs text-gray-700">{timeAgo(r.startedAt)}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Live execution output */}
              {activeRunId && triggering === selected.id && (
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-widest text-blue-400 mb-2 flex items-center gap-2">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-400" />
                    </span>
                    Executing...
                  </h3>
                  {liveOutput ? (
                    <pre className="text-[11px] text-green-400 bg-gray-950 border border-blue-800/30 rounded-lg p-3 max-h-64 overflow-y-auto whitespace-pre-wrap font-mono">
                      {(liveOutput as { stdout?: string }).stdout || "Waiting for output..."}
                    </pre>
                  ) : (
                    <div className="text-xs text-gray-500 bg-gray-950 border border-blue-800/30 rounded-lg p-3 animate-pulse">
                      Running command on {selected.engine}...
                    </div>
                  )}
                </div>
              )}

              {/* Run output preview */}
              {selected.recentRuns.length > 0 && selected.recentRuns[0].output && !(activeRunId && triggering === selected.id) && (
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-2">Latest Output</h3>
                  {(() => {
                    const out = selected.recentRuns[0].output as { stdout?: string; stderr?: string; exitCode?: number; durationMs?: number };
                    if (out.stdout !== undefined) {
                      // Structured output from local engine
                      return (
                        <div className="space-y-2">
                          <div className="flex gap-2 text-xs">
                            <span className={`px-1.5 py-0.5 rounded ${out.exitCode === 0 ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>
                              exit {out.exitCode}
                            </span>
                            {out.durationMs && (
                              <span className="px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">
                                {out.durationMs < 1000 ? `${out.durationMs}ms` : `${(out.durationMs / 1000).toFixed(1)}s`}
                              </span>
                            )}
                          </div>
                          {out.stdout && (
                            <pre className="text-[11px] text-green-400/90 bg-gray-950 border border-gray-800 rounded-lg p-3 max-h-80 overflow-y-auto whitespace-pre-wrap font-mono">
                              {out.stdout}
                            </pre>
                          )}
                          {out.stderr && (
                            <pre className="text-[11px] text-red-400/80 bg-gray-950 border border-red-900/30 rounded-lg p-3 max-h-40 overflow-y-auto whitespace-pre-wrap font-mono">
                              {out.stderr}
                            </pre>
                          )}
                        </div>
                      );
                    }
                    // Fallback: raw JSON
                    return (
                      <pre className="text-[11px] text-gray-400 bg-gray-950 border border-gray-800 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap font-mono">
                        {JSON.stringify(selected.recentRuns[0].output, null, 2)}
                      </pre>
                    );
                  })()}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Engine Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {ENGINES.map((e) => {
          const meta = ENGINE_META[e];
          const count = engineCounts[e] || 0;
          const activeInEngine = workflows.filter((w) => w.engine === e && w.isActive).length;
          return (
            <div key={e} className={`rounded-xl border border-gray-800 bg-gray-900/40 p-4 ${filterEngine === e ? "ring-1 ring-cyan-600/30" : ""}`}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">{meta.icon}</span>
                <span className={`text-sm font-bold ${meta.text}`}>{meta.label}</span>
              </div>
              <p className="text-xs text-gray-500 mb-3">{meta.desc}</p>
              <div className="flex gap-4 text-xs">
                <span className="text-gray-400"><span className="font-bold text-gray-200">{count}</span> workflows</span>
                <span className="text-gray-400"><span className="font-bold text-green-400">{activeInEngine}</span> active</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Create/Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-lg p-6 space-y-4">
            <h2 className="text-lg font-bold">{editWorkflow ? "Edit Workflow" : "New Workflow"}</h2>

            <div>
              <label className="text-xs text-gray-500 block mb-1">Name</label>
              <input value={formName} onChange={(e) => setFormName(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-700 bg-gray-800/50 text-gray-200"
                placeholder="e.g. Daily shift report" />
            </div>

            <div>
              <label className="text-xs text-gray-500 block mb-1">Description</label>
              <textarea value={formDesc} onChange={(e) => setFormDesc(e.target.value)} rows={2}
                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-700 bg-gray-800/50 text-gray-200"
                placeholder="What this workflow does..." />
            </div>

            <div>
              <label className="text-xs text-gray-500 block mb-1">Execution Engine</label>
              <div className="grid grid-cols-3 gap-2">
                {ENGINES.map((e) => {
                  const meta = ENGINE_META[e];
                  return (
                    <button key={e} onClick={() => setFormEngine(e)}
                      className={`p-3 rounded-lg border text-left transition-all ${
                        formEngine === e
                          ? "border-cyan-600 bg-cyan-600/10"
                          : "border-gray-700 bg-gray-800/30 hover:border-gray-600"
                      }`}>
                      <div className="text-lg mb-1">{meta.icon}</div>
                      <div className={`text-xs font-bold ${formEngine === e ? "text-cyan-400" : "text-gray-300"}`}>{meta.label}</div>
                      <div className="text-xs text-gray-500 mt-0.5 line-clamp-2">{meta.desc}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="text-xs text-gray-500 block mb-1">Schedule (cron expression)</label>
              <input value={formCron} onChange={(e) => setFormCron(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-700 bg-gray-800/50 text-gray-200 font-mono"
                placeholder="0 3 * * *" />
              <div className="flex gap-1.5 mt-2 flex-wrap">
                {CRON_PRESETS.map((p) => (
                  <button key={p.value} onClick={() => setFormCron(p.value)}
                    className={`px-2 py-0.5 text-xs rounded border transition-colors ${
                      formCron === p.value
                        ? "border-cyan-600 bg-cyan-600/20 text-cyan-400"
                        : "border-gray-700 bg-gray-800/30 text-gray-500 hover:border-gray-600"
                    }`}>
                    {p.label}
                  </button>
                ))}
              </div>
              {formCron && (
                <p className="text-xs text-gray-500 mt-1">
                  Schedule: <span className="text-gray-300">{describeCron(formCron)}</span>
                </p>
              )}
            </div>

            {/* Execution Config */}
            <div className="space-y-3 border-t border-gray-800 pt-3">
              <label className="text-xs text-gray-500 block">Execution Config</label>

              {(formEngine === "dev-pi" || formEngine === "vercel-cron") && (
                <div>
                  <label className="text-xs text-gray-600 block mb-1">
                    {formEngine === "dev-pi" ? "SSH Command (runs on Pi 5)" : "Shell Command (runs locally)"}
                  </label>
                  <input value={formCommand} onChange={(e) => setFormCommand(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-gray-700 bg-gray-800/50 text-gray-200 font-mono"
                    placeholder={formEngine === "dev-pi" ? "/usr/local/bin/fleet-health.sh" : "cd dashboard && npx vitest run"} />
                </div>
              )}

              {formEngine === "github-actions" && (
                <div>
                  <label className="text-xs text-gray-600 block mb-1">Workflow File</label>
                  <input value={formCommand} onChange={(e) => setFormCommand(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-gray-700 bg-gray-800/50 text-gray-200 font-mono"
                    placeholder="dev-pi.yml" />
                </div>
              )}

              <div>
                <label className="text-xs text-gray-600 block mb-1">Claude Prompt (optional — runs Claude CLI)</label>
                <textarea value={formPrompt} onChange={(e) => setFormPrompt(e.target.value)} rows={3}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-gray-700 bg-gray-800/50 text-gray-200 font-mono"
                  placeholder="Analyze the last 24h of fleet data and generate a summary report..." />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button onClick={() => setFormActive(!formActive)}
                className={`relative w-10 h-5 rounded-full transition-colors ${formActive ? "bg-green-600" : "bg-gray-700"}`}>
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${formActive ? "translate-x-5" : ""}`} />
              </button>
              <span className="text-sm text-gray-400">{formActive ? "Active — will run on schedule" : "Inactive — manual trigger only"}</span>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setModalOpen(false)}
                className="px-4 py-2 text-sm rounded-lg border border-gray-700 text-gray-400 hover:border-gray-600">
                Cancel
              </button>
              <button onClick={handleSave} disabled={saving || !formName.trim()}
                className="px-4 py-2 text-sm font-semibold rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 transition-colors">
                {saving ? "Saving..." : editWorkflow ? "Update" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
