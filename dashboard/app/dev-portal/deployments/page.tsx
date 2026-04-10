"use client";

import { useState, useEffect, useCallback } from "react";

interface Deployment {
  id: string;
  target: string;
  status: string;
  commitSha: string | null;
  branch: string | null;
  deployUrl: string | null;
  trigger: string;
  details: Record<string, unknown> | null;
  startedAt: string;
  endedAt: string | null;
  createdBy: string;
}

const STATUS_COLORS: Record<string, { dot: string; text: string }> = {
  deploying:    { dot: "bg-blue-400", text: "text-blue-400" },
  success:      { dot: "bg-green-400", text: "text-green-400" },
  failed:       { dot: "bg-red-400", text: "text-red-400" },
  "rolled-back": { dot: "bg-amber-400", text: "text-amber-400" },
};

const TARGET_COLORS: Record<string, { bg: string; text: string }> = {
  vercel:   { bg: "bg-gray-700/30", text: "text-gray-300" },
  pi5:      { bg: "bg-green-700/30", text: "text-green-400" },
  supabase: { bg: "bg-emerald-700/30", text: "text-emerald-400" },
  "github-pages": { bg: "bg-purple-700/30", text: "text-purple-400" },
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

export default function DeploymentsPage() {
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Log modal
  const [modalOpen, setModalOpen] = useState(false);
  const [formTarget, setFormTarget] = useState("vercel");
  const [formStatus, setFormStatus] = useState("success");
  const [formBranch, setFormBranch] = useState("");
  const [formCommit, setFormCommit] = useState("");
  const [formUrl, setFormUrl] = useState("");
  const [formTrigger, setFormTrigger] = useState("manual");
  const [saving, setSaving] = useState(false);

  const fetchDeployments = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/dev-portal/deployments?limit=50");
    if (res.ok) setDeployments((await res.json()).deployments || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchDeployments(); }, [fetchDeployments]);

  const handleLog = async () => {
    setSaving(true);
    await fetch("/api/dev-portal/deployments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        target: formTarget,
        status: formStatus,
        branch: formBranch || null,
        commitSha: formCommit || null,
        deployUrl: formUrl || null,
        trigger: formTrigger,
      }),
    });
    setSaving(false);
    setModalOpen(false);
    fetchDeployments();
  };

  const selected = deployments.find((d) => d.id === selectedId);

  const successRate = deployments.length > 0
    ? Math.round((deployments.filter((d) => d.status === "success").length / deployments.length) * 100)
    : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight">Deployments</h1>
          <p className="text-sm text-gray-500 mt-1">Deployment history across all targets</p>
        </div>
        <button onClick={() => setModalOpen(true)} className="px-4 py-2 text-sm font-semibold rounded-lg bg-cyan-600 hover:bg-cyan-500 transition-colors">
          + Log Deploy
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
          <div className="text-2xl font-black text-gray-200">{deployments.length}</div>
          <div className="text-xs text-gray-500 mt-1">Total Deploys</div>
        </div>
        <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
          <div className={`text-2xl font-black ${successRate >= 90 ? "text-green-400" : "text-amber-400"}`}>{successRate}%</div>
          <div className="text-xs text-gray-500 mt-1">Success Rate</div>
        </div>
        <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
          <div className="text-2xl font-black text-blue-400">{deployments.filter((d) => d.status === "deploying").length}</div>
          <div className="text-xs text-gray-500 mt-1">In Progress</div>
        </div>
      </div>

      {/* Timeline + Detail */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3 space-y-2">
          {loading ? (
            <div className="text-center py-12 text-gray-500 text-sm">Loading...</div>
          ) : deployments.length === 0 ? (
            <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-8 text-center">
              <p className="text-sm text-gray-500">No deployments recorded</p>
            </div>
          ) : deployments.map((d) => {
            const sc = STATUS_COLORS[d.status] || STATUS_COLORS.failed;
            const tc = TARGET_COLORS[d.target] || TARGET_COLORS.vercel;
            return (
              <button key={d.id} onClick={() => setSelectedId(d.id)}
                className={`w-full text-left rounded-lg border p-3 transition-all ${selectedId === d.id ? "border-cyan-600/50 bg-cyan-900/10" : "border-gray-800 bg-gray-900/40 hover:border-gray-700"}`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="relative flex h-2 w-2 shrink-0">
                    {d.status === "deploying" && <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${sc.dot} opacity-75`} />}
                    <span className={`relative inline-flex rounded-full h-2 w-2 ${sc.dot}`} />
                  </span>
                  <span className={`text-xs px-1.5 py-0.5 rounded ${tc.bg} ${tc.text}`}>{d.target}</span>
                  <span className={`text-xs capitalize ${sc.text}`}>{d.status}</span>
                  <span className="text-xs text-gray-700 ml-auto">{timeAgo(d.startedAt)}</span>
                </div>
                <div className="flex items-center gap-2 ml-4">
                  {d.branch && <span className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 font-mono">{d.branch}</span>}
                  {d.commitSha && <span className="text-xs text-gray-500 font-mono">{d.commitSha.slice(0, 7)}</span>}
                  <span className="text-xs text-gray-700">{d.trigger}</span>
                </div>
              </button>
            );
          })}
        </div>

        <div className="lg:col-span-2">
          {!selected ? (
            <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-12 text-center">
              <p className="text-sm text-gray-500">Select a deployment to view details</p>
            </div>
          ) : (
            <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4 space-y-4">
              <div className="flex items-center gap-2">
                <span className={`text-xs px-1.5 py-0.5 rounded ${(TARGET_COLORS[selected.target] || TARGET_COLORS.vercel).bg} ${(TARGET_COLORS[selected.target] || TARGET_COLORS.vercel).text}`}>{selected.target}</span>
                <h2 className={`text-lg font-bold capitalize ${(STATUS_COLORS[selected.status] || STATUS_COLORS.failed).text}`}>{selected.status}</h2>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><span className="text-xs text-gray-500 uppercase block">Branch</span><span className="text-sm text-gray-300 font-mono">{selected.branch || "--"}</span></div>
                <div><span className="text-xs text-gray-500 uppercase block">Commit</span><span className="text-sm text-gray-300 font-mono">{selected.commitSha?.slice(0, 7) || "--"}</span></div>
                <div><span className="text-xs text-gray-500 uppercase block">Trigger</span><span className="text-sm text-gray-300">{selected.trigger}</span></div>
                <div><span className="text-xs text-gray-500 uppercase block">Started</span><span className="text-sm text-gray-300">{new Date(selected.startedAt).toLocaleString()}</span></div>
              </div>
              {selected.deployUrl && (
                <a href={selected.deployUrl} target="_blank" rel="noopener noreferrer" className="block text-xs text-cyan-400 hover:text-cyan-300 underline">View deployment</a>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Log Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-md p-6 space-y-4">
            <h2 className="text-lg font-bold">Log Deployment</h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Target</label>
                <select value={formTarget} onChange={(e) => setFormTarget(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-gray-700 bg-gray-800/50 text-gray-200">
                  {["vercel", "pi5", "supabase", "github-pages"].map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Status</label>
                <select value={formStatus} onChange={(e) => setFormStatus(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-gray-700 bg-gray-800/50 text-gray-200">
                  {["deploying", "success", "failed", "rolled-back"].map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs text-gray-500 block mb-1">Branch</label><input value={formBranch} onChange={(e) => setFormBranch(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-gray-700 bg-gray-800/50 text-gray-200" placeholder="develop" /></div>
              <div><label className="text-xs text-gray-500 block mb-1">Trigger</label>
                <select value={formTrigger} onChange={(e) => setFormTrigger(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-gray-700 bg-gray-800/50 text-gray-200">
                  {["git-push", "manual", "cron", "rollback"].map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
            <div><label className="text-xs text-gray-500 block mb-1">Commit SHA</label><input value={formCommit} onChange={(e) => setFormCommit(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-gray-700 bg-gray-800/50 text-gray-200 font-mono" placeholder="abc1234" /></div>
            <div><label className="text-xs text-gray-500 block mb-1">Deploy URL</label><input value={formUrl} onChange={(e) => setFormUrl(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-gray-700 bg-gray-800/50 text-gray-200" placeholder="https://..." /></div>
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setModalOpen(false)} className="px-4 py-2 text-sm rounded-lg border border-gray-700 text-gray-400 hover:border-gray-600">Cancel</button>
              <button onClick={handleLog} disabled={saving} className="px-4 py-2 text-sm font-semibold rounded-lg bg-cyan-600 hover:bg-cyan-500 transition-colors disabled:opacity-50">{saving ? "Saving..." : "Log Deploy"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
