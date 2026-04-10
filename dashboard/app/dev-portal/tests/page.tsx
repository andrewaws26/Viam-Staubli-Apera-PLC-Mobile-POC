"use client";

import { useState, useEffect, useCallback } from "react";

interface TestRun {
  id: string;
  suite: string;
  status: string;
  totalTests: number | null;
  passed: number | null;
  failed: number | null;
  skipped: number | null;
  durationMs: number | null;
  trigger: string;
  commitSha: string | null;
  branch: string | null;
  outputUrl: string | null;
  startedAt: string;
  endedAt: string | null;
}

const STATUS_COLORS: Record<string, { dot: string; text: string; bg: string }> = {
  running: { dot: "bg-blue-400", text: "text-blue-400", bg: "bg-blue-500/10" },
  passed:  { dot: "bg-green-400", text: "text-green-400", bg: "bg-green-500/10" },
  failed:  { dot: "bg-red-400", text: "text-red-400", bg: "bg-red-500/10" },
  skipped: { dot: "bg-gray-500", text: "text-gray-500", bg: "bg-gray-500/10" },
};

const SUITE_COLORS: Record<string, { bg: string; text: string }> = {
  unit:       { bg: "bg-green-700/30", text: "text-green-400" },
  e2e:        { bg: "bg-purple-700/30", text: "text-purple-400" },
  "api-health": { bg: "bg-blue-700/30", text: "text-blue-400" },
  visual:     { bg: "bg-pink-700/30", text: "text-pink-400" },
  safety:     { bg: "bg-amber-700/30", text: "text-amber-400" },
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

export default function TestRunsPage() {
  const [runs, setRuns] = useState<TestRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterSuite, setFilterSuite] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Log modal
  const [modalOpen, setModalOpen] = useState(false);
  const [formSuite, setFormSuite] = useState("unit");
  const [formStatus, setFormStatus] = useState("passed");
  const [formTotal, setFormTotal] = useState("");
  const [formPassed, setFormPassed] = useState("");
  const [formFailed, setFormFailed] = useState("");
  const [formDuration, setFormDuration] = useState("");
  const [formBranch, setFormBranch] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchRuns = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ limit: "50" });
    if (filterSuite !== "all") params.set("suite", filterSuite);
    const res = await fetch(`/api/dev-portal/tests?${params}`);
    if (res.ok) {
      let data = (await res.json()).testRuns || [];
      if (filterStatus !== "all") data = data.filter((r: TestRun) => r.status === filterStatus);
      setRuns(data);
    }
    setLoading(false);
  }, [filterSuite, filterStatus]);

  useEffect(() => { fetchRuns(); }, [fetchRuns]);

  const handleLog = async () => {
    setSaving(true);
    await fetch("/api/dev-portal/tests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        suite: formSuite,
        status: formStatus,
        totalTests: formTotal ? parseInt(formTotal) : null,
        passed: formPassed ? parseInt(formPassed) : null,
        failed: formFailed ? parseInt(formFailed) : null,
        durationMs: formDuration ? parseInt(formDuration) : null,
        branch: formBranch || null,
        trigger: "manual",
      }),
    });
    setSaving(false);
    setModalOpen(false);
    fetchRuns();
  };

  const selected = runs.find((r) => r.id === selectedId);

  // Summary
  const totalRuns = runs.length;
  const passRate = totalRuns > 0
    ? Math.round((runs.filter((r) => r.status === "passed").length / totalRuns) * 100)
    : 0;
  const totalFailed = runs.reduce((s, r) => s + (r.failed || 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight">Test Runs</h1>
          <p className="text-sm text-gray-500 mt-1">Test execution history across all suites</p>
        </div>
        <button onClick={() => setModalOpen(true)} className="px-4 py-2 text-sm font-semibold rounded-lg bg-cyan-600 hover:bg-cyan-500 transition-colors">
          + Log Run
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
          <div className="text-2xl font-black text-gray-200">{totalRuns}</div>
          <div className="text-xs text-gray-500 mt-1">Total Runs</div>
        </div>
        <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
          <div className={`text-2xl font-black ${passRate >= 90 ? "text-green-400" : passRate >= 70 ? "text-amber-400" : "text-red-400"}`}>
            {passRate}%
          </div>
          <div className="text-xs text-gray-500 mt-1">Pass Rate</div>
        </div>
        <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
          <div className={`text-2xl font-black ${totalFailed === 0 ? "text-green-400" : "text-red-400"}`}>
            {totalFailed}
          </div>
          <div className="text-xs text-gray-500 mt-1">Total Failures</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-4 flex-wrap">
        <div className="flex gap-2">
          {["all", "unit", "e2e", "api-health", "visual", "safety"].map((s) => (
            <button key={s} onClick={() => setFilterSuite(s)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${filterSuite === s ? "border-cyan-600 bg-cyan-600/20 text-cyan-400" : "border-gray-700 bg-gray-800/50 text-gray-400 hover:border-gray-600"}`}>
              {s === "all" ? "All Suites" : s}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          {["all", "passed", "failed", "running"].map((s) => (
            <button key={s} onClick={() => setFilterStatus(s)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${filterStatus === s ? "border-cyan-600 bg-cyan-600/20 text-cyan-400" : "border-gray-700 bg-gray-800/50 text-gray-400 hover:border-gray-600"}`}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* List + Detail */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3 space-y-2">
          {loading ? (
            <div className="text-center py-12 text-gray-600 text-sm">Loading...</div>
          ) : runs.length === 0 ? (
            <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-8 text-center">
              <p className="text-sm text-gray-500">No test runs recorded</p>
            </div>
          ) : runs.map((r) => {
            const sc = STATUS_COLORS[r.status] || STATUS_COLORS.skipped;
            const suc = SUITE_COLORS[r.suite] || SUITE_COLORS.unit;
            return (
              <button key={r.id} onClick={() => setSelectedId(r.id)}
                className={`w-full text-left rounded-lg border p-3 transition-all ${selectedId === r.id ? "border-cyan-600/50 bg-cyan-900/10" : "border-gray-800 bg-gray-900/40 hover:border-gray-700"}`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="relative flex h-2 w-2 shrink-0">
                    {r.status === "running" && <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${sc.dot} opacity-75`} />}
                    <span className={`relative inline-flex rounded-full h-2 w-2 ${sc.dot}`} />
                  </span>
                  <span className={`text-xs px-1.5 py-0.5 rounded ${suc.bg} ${suc.text}`}>{r.suite}</span>
                  <span className={`text-xs capitalize ${sc.text} flex-1`}>{r.status}</span>
                  {r.totalTests !== null && (
                    <span className="text-xs text-gray-400">
                      <span className="text-green-400">{r.passed}</span>
                      {r.failed ? <> / <span className="text-red-400">{r.failed}</span></> : null}
                      <span className="text-gray-600"> / {r.totalTests}</span>
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 ml-4">
                  {r.branch && <span className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 font-mono">{r.branch}</span>}
                  {r.durationMs !== null && <span className="text-xs text-gray-600">{(r.durationMs / 1000).toFixed(1)}s</span>}
                  <span className="text-xs text-gray-700">{r.trigger}</span>
                  <span className="text-xs text-gray-700 ml-auto">{timeAgo(r.startedAt)}</span>
                </div>
              </button>
            );
          })}
        </div>

        <div className="lg:col-span-2">
          {!selected ? (
            <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-12 text-center">
              <p className="text-sm text-gray-600">Select a run to view details</p>
            </div>
          ) : (
            <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4 space-y-4">
              <div className="flex items-center gap-2">
                <span className={`text-xs px-1.5 py-0.5 rounded ${(SUITE_COLORS[selected.suite] || SUITE_COLORS.unit).bg} ${(SUITE_COLORS[selected.suite] || SUITE_COLORS.unit).text}`}>{selected.suite}</span>
                <h2 className="text-lg font-bold text-gray-100 capitalize">{selected.status}</h2>
              </div>

              {/* Pass/Fail bar */}
              {selected.totalTests && selected.totalTests > 0 && (
                <div>
                  <div className="flex h-3 rounded-full overflow-hidden bg-gray-800">
                    {selected.passed && selected.passed > 0 && (
                      <div className="bg-green-500" style={{ width: `${(selected.passed / selected.totalTests) * 100}%` }} />
                    )}
                    {selected.failed && selected.failed > 0 && (
                      <div className="bg-red-500" style={{ width: `${(selected.failed / selected.totalTests) * 100}%` }} />
                    )}
                    {selected.skipped && selected.skipped > 0 && (
                      <div className="bg-gray-600" style={{ width: `${(selected.skipped / selected.totalTests) * 100}%` }} />
                    )}
                  </div>
                  <div className="flex gap-4 mt-2 text-xs">
                    <span className="text-green-400">{selected.passed} passed</span>
                    {selected.failed ? <span className="text-red-400">{selected.failed} failed</span> : null}
                    {selected.skipped ? <span className="text-gray-500">{selected.skipped} skipped</span> : null}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div><span className="text-xs text-gray-600 uppercase block">Duration</span><span className="text-sm text-gray-300">{selected.durationMs ? `${(selected.durationMs / 1000).toFixed(1)}s` : "--"}</span></div>
                <div><span className="text-xs text-gray-600 uppercase block">Trigger</span><span className="text-sm text-gray-300">{selected.trigger}</span></div>
                <div><span className="text-xs text-gray-600 uppercase block">Branch</span><span className="text-sm text-gray-300 font-mono">{selected.branch || "--"}</span></div>
                <div><span className="text-xs text-gray-600 uppercase block">Commit</span><span className="text-sm text-gray-300 font-mono">{selected.commitSha?.slice(0, 7) || "--"}</span></div>
                <div><span className="text-xs text-gray-600 uppercase block">Started</span><span className="text-sm text-gray-300">{new Date(selected.startedAt).toLocaleString()}</span></div>
                <div><span className="text-xs text-gray-600 uppercase block">Ended</span><span className="text-sm text-gray-300">{selected.endedAt ? new Date(selected.endedAt).toLocaleString() : "ongoing"}</span></div>
              </div>

              {selected.outputUrl && (
                <a href={selected.outputUrl} target="_blank" rel="noopener noreferrer"
                  className="block text-xs text-cyan-400 hover:text-cyan-300 underline">View full output</a>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Log Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-md p-6 space-y-4">
            <h2 className="text-lg font-bold">Log Test Run</h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Suite</label>
                <select value={formSuite} onChange={(e) => setFormSuite(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-gray-700 bg-gray-800/50 text-gray-200">
                  {["unit", "e2e", "api-health", "visual", "safety"].map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Status</label>
                <select value={formStatus} onChange={(e) => setFormStatus(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-gray-700 bg-gray-800/50 text-gray-200">
                  {["passed", "failed", "running", "skipped"].map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><label className="text-xs text-gray-500 block mb-1">Total</label><input type="number" value={formTotal} onChange={(e) => setFormTotal(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-gray-700 bg-gray-800/50 text-gray-200" /></div>
              <div><label className="text-xs text-gray-500 block mb-1">Passed</label><input type="number" value={formPassed} onChange={(e) => setFormPassed(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-gray-700 bg-gray-800/50 text-gray-200" /></div>
              <div><label className="text-xs text-gray-500 block mb-1">Failed</label><input type="number" value={formFailed} onChange={(e) => setFormFailed(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-gray-700 bg-gray-800/50 text-gray-200" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs text-gray-500 block mb-1">Duration (ms)</label><input type="number" value={formDuration} onChange={(e) => setFormDuration(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-gray-700 bg-gray-800/50 text-gray-200" /></div>
              <div><label className="text-xs text-gray-500 block mb-1">Branch</label><input type="text" value={formBranch} onChange={(e) => setFormBranch(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-gray-700 bg-gray-800/50 text-gray-200" placeholder="develop" /></div>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setModalOpen(false)} className="px-4 py-2 text-sm rounded-lg border border-gray-700 text-gray-400 hover:border-gray-600">Cancel</button>
              <button onClick={handleLog} disabled={saving} className="px-4 py-2 text-sm font-semibold rounded-lg bg-cyan-600 hover:bg-cyan-500 transition-colors disabled:opacity-50">{saving ? "Saving..." : "Log Run"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
