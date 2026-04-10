/**
 * IronSight Dev — Command Center (v2)
 * Native macOS app: health monitoring, single AI agent, auto-diagnose pipeline.
 */

const {
  app, BrowserWindow, Tray, Menu, nativeImage,
  Notification, ipcMain, shell, globalShortcut,
} = require("electron");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const cron = require("node-cron");
const os = require("os");
const Store = require("electron-store");

const { exec, fire, cancelRun: cancelActiveRun, getActiveRuns } = require("./lib/executor");
const { createHealthEngine } = require("./lib/health");
const { getGitContext, buildSmartContext } = require("./lib/context");
const { getChangeFeed } = require("./lib/feed");
const { getActiveTemplates, getTemplate } = require("./lib/templates");
const { createAgent, onStream, onActivity } = require("./lib/agent");
const { createAutoFix } = require("./lib/autofix");

const REPO_ROOT = path.resolve(__dirname, "..");
const DASHBOARD_DIR = path.join(REPO_ROOT, "dashboard");
const PI5_HOST = "andrew@100.112.68.52";
const DEVICE_ID = "mac";
const DEVICE_NAME = "Mac (dev workstation)";
const PROD_URL = "https://viam-staubli-apera-plc-mobile-poc.vercel.app";

function loadEnv() {
  try {
    const fs = require("fs");
    const content = fs.readFileSync(path.join(DASHBOARD_DIR, ".env.local"), "utf-8");
    for (const line of content.split("\n")) {
      const match = line.match(/^([A-Z_]+)=(.+)$/);
      if (match) process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
    }
  } catch {}
}
loadEnv();

const supabase = createClient(process.env.SUPABASE_URL || "", process.env.SUPABASE_SERVICE_ROLE_KEY || "");
const store = new Store({ name: "ironsight-dev" });
if (!store.get("credentials")) store.set("credentials", { supabaseAccessToken: "", vercelToken: "", resendApiKey: "" });

let mainWindow = null;
let tray = null;
const cronJobs = new Map();
const scheduledJobs = new Map();

// ── Engines ───────────────────────────────────────────────────────────
const health = createHealthEngine({ repoRoot: REPO_ROOT, dashboardDir: DASHBOARD_DIR, supabase, prodUrl: PROD_URL });
const agent = createAgent({ repoRoot: REPO_ROOT, store });
const autofix = createAutoFix({
  repoRoot: REPO_ROOT, store,
  onProgress: (event, checkId, data) => { mainWindow?.webContents.send(`autofix-${event}`, { checkId, ...data }); },
});

// ── Wiring ────────────────────────────────────────────────────────────
onStream((type, chunk) => { mainWindow?.webContents.send("agent-stream", { type, chunk }); });

const activityLog = [];
onActivity((entry) => {
  activityLog.push(entry);
  if (activityLog.length > 500) activityLog.splice(0, activityLog.length - 500);
  mainWindow?.webContents.send("agent-activity", entry);
});

// Health → Auto-Diagnose (safe, read-only). Never auto-fix.
health.onChange((id, result, prev) => {
  mainWindow?.webContents.send("health-updated", { id, ...result });
  updateTrayStatus();

  if (prev && result.status === "fail" && prev.status !== "fail") {
    new Notification({ title: `${result.label}: ${result.summary}`, body: "Click to open IronSight Dev" }).show();
    if (autofix.canRun(id).ok) {
      console.log(`[AutoDiagnose] ${id}`);
      autofix.diagnose(id).then((diag) => {
        if (diag && !diag.passing) mainWindow?.webContents.send("autofix-diagnosed", { checkId: id, ...diag });
      });
    }
  }
  if (prev && prev.status === "fail" && result.status === "ok") {
    new Notification({ title: `${result.label}: passing again`, body: result.summary, silent: true }).show();
    autofix.resetAttempts(id);
  }
});

// ── Heartbeat ─────────────────────────────────────────────────────────
async function sendHeartbeat() {
  try {
    await supabase.from("device_heartbeats").upsert({
      id: DEVICE_ID, device_name: DEVICE_NAME, hostname: os.hostname(),
      last_seen: new Date().toISOString(),
      metadata: { uptime: Math.round(os.uptime()), activeRuns: getActiveRuns().size, cronJobs: cronJobs.size, platform: process.platform, arch: process.arch },
    });
  } catch {}
}

// ── Tray ──────────────────────────────────────────────────────────────
function createTrayIcon(color = "default") {
  const size = 22;
  const c = color === "running" ? "#3b82f6" : color === "error" ? "#ef4444" : color === "warn" ? "#f59e0b" : "#22c55e";
  const icon = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(`<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg"><circle cx="11" cy="11" r="8" fill="none" stroke="${c}" stroke-width="2"/><circle cx="11" cy="11" r="4" fill="${c}"/></svg>`).toString("base64")}`);
  icon.setTemplateImage(false);
  return icon;
}

function updateTrayStatus() {
  const worst = health.getWorstStatus();
  const color = worst === "fail" ? "error" : worst === "warn" ? "warn" : getActiveRuns().size > 0 ? "running" : "default";
  tray?.setImage(createTrayIcon(color));
  tray?.setContextMenu(buildTrayMenu());
}

function buildTrayMenu() {
  const all = health.getAll();
  const failures = Object.values(all).filter((h) => h.status === "fail");
  const templates = getActiveTemplates(all);
  const items = [
    { label: "IronSight Dev", enabled: false },
    { label: failures.length > 0 ? `${failures.length} issue${failures.length > 1 ? "s" : ""}` : "All healthy", enabled: false },
    { type: "separator" },
    { label: "Open Dashboard", click: createWindow },
    { type: "separator" },
  ];
  const active = templates.filter((t) => t.active && t.id !== "deploy");
  for (const t of active) items.push({ label: `Fix: ${t.label}`, click: () => { createWindow(); runSmartClaude({ template: t.id }); } });
  if (active.length > 0) items.push({ type: "separator" });
  items.push(
    { label: "Chat with Agent...", click: () => { createWindow(); mainWindow?.webContents.send("navigate", "chat"); } },
    { label: "Run Audit...", click: () => { createWindow(); mainWindow?.webContents.send("navigate", "audit"); } },
    { type: "separator" },
    { label: "Open in Terminal", click: () => fire("open", ["-a", "Terminal", REPO_ROOT]) },
    { label: "Open in Browser", click: () => shell.openExternal(PROD_URL) },
    { type: "separator" },
    { label: "Quit", click: () => { app.isQuitting = true; app.quit(); } },
  );
  return Menu.buildFromTemplate(items);
}

// ── Window ────────────────────────────────────────────────────────────
function createWindow() {
  if (mainWindow) { mainWindow.show(); mainWindow.focus(); return; }
  const bounds = store.get("windowBounds", { width: 1000, height: 760 });
  mainWindow = new BrowserWindow({
    ...bounds, minWidth: 700, minHeight: 500,
    titleBarStyle: "hiddenInset", trafficLightPosition: { x: 12, y: 12 },
    vibrancy: "under-window", visualEffectState: "active", backgroundColor: "#00000000",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false },
  });
  mainWindow.loadFile(path.join(__dirname, "index.html"));
  const saveBounds = () => { if (mainWindow && !mainWindow.isMinimized()) store.set("windowBounds", mainWindow.getBounds()); };
  mainWindow.on("resize", saveBounds);
  mainWindow.on("move", saveBounds);
  mainWindow.on("close", (e) => { if (!app.isQuitting) { e.preventDefault(); mainWindow.hide(); } });
  mainWindow.on("closed", () => { mainWindow = null; });
}

function buildAppMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: app.name, submenu: [
      { role: "about" }, { type: "separator" },
      { label: "Settings...", accelerator: "CmdOrCtrl+,", click: () => mainWindow?.webContents.send("navigate", "settings") },
      { type: "separator" }, { role: "hide" }, { role: "hideOthers" }, { role: "unhide" },
      { type: "separator" }, { label: "Quit", accelerator: "CmdOrCtrl+Q", click: () => { app.isQuitting = true; app.quit(); } },
    ]},
    { label: "Edit", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
    { label: "View", submenu: [
      { label: "Refresh", accelerator: "CmdOrCtrl+R", click: () => { health.runAll(); mainWindow?.webContents.send("refresh-all"); } },
      { type: "separator" },
      { label: "Watch", accelerator: "CmdOrCtrl+1", click: () => mainWindow?.webContents.send("navigate", "watch") },
      { label: "Chat", accelerator: "CmdOrCtrl+2", click: () => mainWindow?.webContents.send("navigate", "chat") },
      { label: "Audit", accelerator: "CmdOrCtrl+3", click: () => mainWindow?.webContents.send("navigate", "audit") },
      { label: "Settings", accelerator: "CmdOrCtrl+4", click: () => mainWindow?.webContents.send("navigate", "settings") },
      { type: "separator" }, { role: "toggleDevTools" },
    ]},
    { label: "Window", submenu: [{ role: "minimize" }, { role: "zoom" }, { type: "separator" }, { role: "front" }] },
  ]));
}

// ── Workflows ─────────────────────────────────────────────────────────
let cachedWorkflows = [];

async function loadWorkflows() {
  try {
    const { data } = await supabase.from("dev_workflows").select("*").order("updated_at", { ascending: false }).limit(20);
    cachedWorkflows = data || [];
    setupCronJobs(cachedWorkflows.filter((w) => w.is_active && w.cron_expression));
  } catch {}
}

function setupCronJobs(workflows) {
  for (const [id, job] of cronJobs) { if (!workflows.find((w) => w.id === id)) { job.stop(); cronJobs.delete(id); } }
  for (const w of workflows) {
    if (cronJobs.has(w.id)) continue;
    try { const job = cron.schedule(w.cron_expression, () => executeWorkflow(w)); cronJobs.set(w.id, job); } catch {}
  }
}

async function executeWorkflow(workflow, input) {
  const { data: run } = await supabase.from("workflow_runs").insert({ workflow_id: workflow.id, status: "running", trigger: "manual", executor: DEVICE_ID, input: input || null }).select().single();
  if (!run) return;
  updateTrayStatus();
  mainWindow?.webContents.send("run-started", { runId: run.id, workflow });
  const execOpts = { runId: run.id, onStdout: (chunk) => mainWindow?.webContents.send("run-output", { runId: run.id, stdout: chunk, streaming: true }) };
  let result; const config = workflow.config || {};
  switch (workflow.engine) {
    case "dev-pi": result = await exec("ssh", ["-o", "ConnectTimeout=10", "-o", "StrictHostKeyChecking=no", PI5_HOST, config.command || "/usr/local/bin/fleet-health.sh"], { ...execOpts, timeout: config.timeoutMs || 120_000 }); break;
    case "github-actions": result = await exec("gh", ["workflow", "run", config.workflowFile || "dev-pi.yml", "--ref", config.ref || "main"], { ...execOpts, timeout: 30_000 }); break;
    default: {
      const prompt = config.prompt || input?.prompt;
      if (prompt) result = await exec("claude", ["-p", prompt, "--output-format", "text"], { ...execOpts, shell: false, timeout: config.timeoutMs || 600_000 });
      else if (config.command) result = await exec("bash", ["-c", config.command], { ...execOpts, timeout: config.timeoutMs || 120_000 });
      else result = { exitCode: 1, stdout: "", stderr: "No command configured", durationMs: 0 };
    }
  }
  const status = result.exitCode === 0 ? "completed" : "failed";
  await supabase.from("workflow_runs").update({ status, ended_at: new Date().toISOString(), output: { exitCode: result.exitCode, stdout: result.stdout.slice(-50_000), stderr: result.stderr.slice(-10_000), durationMs: result.durationMs } }).eq("id", run.id);
  new Notification({ title: `${status === "completed" ? "Done" : "Failed"}: ${workflow.name}`, body: status === "completed" ? `${(result.durationMs / 1000).toFixed(1)}s` : `Exit ${result.exitCode}` }).show();
  updateTrayStatus();
  mainWindow?.webContents.send("run-completed", { runId: run.id, status, result });
  loadWorkflows();
}

async function getSystemContext() {
  const [gitCtx, healthResults] = await Promise.all([getGitContext(REPO_ROOT), Promise.resolve(health.getAll())]);
  return buildSmartContext(gitCtx, healthResults);
}

async function runSmartClaude({ template: templateId, prompt: customPrompt }) {
  const context = await getSystemContext();
  const tpl = templateId ? getTemplate(templateId) : null;
  const fullPrompt = tpl ? tpl.getPrompt(context) : `${context}\n\n## Task\n${customPrompt || "Help me."}`;
  const { data: wf } = await supabase.from("dev_workflows").insert({ name: templateId ? `Claude: ${templateId}` : `Claude: ${(customPrompt || "").slice(0, 50)}...`, engine: "vercel-cron", config: { prompt: fullPrompt }, is_active: false, created_by: "dev-app" }).select().single();
  if (wf) executeWorkflow(wf, { prompt: fullPrompt });
}

// ── IPC: Health ───────────────────────────────────────────────────────
ipcMain.handle("get-system-health", () => health.getAll());
ipcMain.handle("run-single-check", (_, id) => health.runCheck(id));

// ── IPC: Context ──────────────────────────────────────────────────────
ipcMain.handle("get-change-feed", () => getChangeFeed(REPO_ROOT, supabase));
ipcMain.handle("get-smart-context", async () => { const g = await getGitContext(REPO_ROOT); return buildSmartContext(g, health.getAll()); });
ipcMain.handle("get-prompt-templates", () => getActiveTemplates(health.getAll()));
ipcMain.handle("run-smart-claude", (_, opts) => { runSmartClaude(opts); return { ok: true }; });

// ── IPC: Agent ────────────────────────────────────────────────────────
ipcMain.handle("agent-chat", async (_, message, focus) => { const ctx = await getSystemContext(); return await agent.chat(message, ctx, focus); });
ipcMain.handle("agent-audit", async (_, scope) => { const ctx = await getSystemContext(); return await agent.audit(scope, ctx); });
ipcMain.handle("agent-research", async (_, question) => { const ctx = await getSystemContext(); return await agent.research(question, ctx); });
ipcMain.handle("agent-get-history", () => agent.getHistory());
ipcMain.handle("agent-clear-history", () => { agent.clearHistory(); return { ok: true }; });
ipcMain.handle("agent-get-status", () => agent.getStatus());
ipcMain.handle("agent-get-memory", () => agent.getMemories());
ipcMain.handle("agent-add-memory", (_, type, content) => agent.addMemory(type, content));
ipcMain.handle("agent-remove-memory", (_, index) => agent.removeMemory(index));
ipcMain.handle("agent-clear-memory", () => { agent.clearMemories(); return { ok: true }; });

// ── IPC: AutoFix ──────────────────────────────────────────────────────
ipcMain.handle("autofix-status", () => autofix.getStatus());
ipcMain.handle("autofix-history", () => autofix.getHistory());
ipcMain.handle("autofix-diagnose", (_, checkId) => autofix.diagnose(checkId));
ipcMain.handle("autofix-fix", (_, checkId) => autofix.fix(checkId));
ipcMain.handle("autofix-merge", (_, branch) => autofix.mergeFix(branch));
ipcMain.handle("autofix-discard", (_, branch) => autofix.discardFix(branch));
ipcMain.handle("autofix-reset", (_, checkId) => { autofix.resetAttempts(checkId); return { ok: true }; });

// ── IPC: Activity ─────────────────────────────────────────────────────
ipcMain.handle("get-agent-activity", (_, limit) => activityLog.slice(-(limit || 50)));

// ── IPC: Settings ─────────────────────────────────────────────────────
ipcMain.handle("get-settings", () => store.get("settings", { autoDiagnose: true, disabledChecks: [], theme: "system", scheduledRuns: true }));
ipcMain.handle("save-settings", (_, s) => { store.set("settings", s); return { ok: true }; });
ipcMain.handle("get-credentials", () => store.get("credentials", {}));
ipcMain.handle("save-credentials", (_, c) => { store.set("credentials", c); return { ok: true }; });

// ── IPC: Workflows ────────────────────────────────────────────────────
ipcMain.handle("get-workflows", async () => { await loadWorkflows(); return cachedWorkflows.map((w) => ({ id: w.id, name: w.name, description: w.description, engine: w.engine, cronExpression: w.cron_expression, isActive: w.is_active, config: w.config })); });
ipcMain.handle("get-runs", async (_, wid) => { const { data } = await supabase.from("workflow_runs").select("*").eq("workflow_id", wid).order("started_at", { ascending: false }).limit(20); return data || []; });
ipcMain.handle("trigger-workflow", async (_, wid, input) => { const w = cachedWorkflows.find((x) => x.id === wid); if (!w) return { error: "Not found" }; executeWorkflow(w, input); return { ok: true }; });
ipcMain.handle("run-claude", (_, prompt) => { runSmartClaude({ prompt }); return { ok: true }; });
ipcMain.handle("cancel-run", (_, runId) => { cancelActiveRun(runId); return { ok: true }; });
ipcMain.handle("get-status", () => ({ running: getActiveRuns().size, cronJobs: cronJobs.size, repoRoot: REPO_ROOT, device: DEVICE_ID, health: health.getAll(), autofixStatus: autofix.getStatus() }));

// ── Scheduled Audits ──────────────────────────────────────────────────
function setupScheduledRuns() {
  const settings = store.get("settings", { scheduledRuns: true });
  if (settings.scheduledRuns === false) return;
  scheduledJobs.set("security-daily", cron.schedule("0 9 * * *", async () => {
    const ctx = await getSystemContext(); const r = await agent.audit("security", ctx);
    if (r.findings?.length > 0) new Notification({ title: `Security: ${r.findings.length} findings`, body: r.summary || "Review in IronSight Dev" }).show();
  }));
  scheduledJobs.set("full-weekly", cron.schedule("0 10 * * 1", async () => { const ctx = await getSystemContext(); await agent.audit("full", ctx); }));
}

// ── Lifecycle ─────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  buildAppMenu();
  tray = new Tray(createTrayIcon()); tray.setToolTip("IronSight Dev");
  tray.on("click", () => createWindow()); tray.on("right-click", () => tray.popUpContextMenu());
  await sendHeartbeat(); setInterval(sendHeartbeat, 30_000);
  health.start(); await loadWorkflows(); setInterval(loadWorkflows, 60_000);
  setupScheduledRuns();
  globalShortcut.register("CommandOrControl+Shift+I", () => { if (mainWindow?.isVisible()) mainWindow.hide(); else createWindow(); });
  try {
    supabase.channel("pi-heartbeat").on("postgres_changes", { event: "UPDATE", schema: "public", table: "device_heartbeats", filter: "id=eq.pi5" }, (payload) => {
      const data = payload.new; if (!data?.last_seen) return;
      const elapsed = Date.now() - new Date(data.last_seen).getTime(); const mins = Math.round(elapsed / 60_000);
      mainWindow?.webContents.send("health-updated", { id: "pi", label: "Pi 5", category: "services", status: elapsed < 120_000 ? "ok" : elapsed < 300_000 ? "warn" : "fail", summary: elapsed < 120_000 ? "online" : `${mins}m ago`, detail: { lastSeen: data.last_seen, metadata: data.metadata, elapsed }, checkedAt: new Date().toISOString() });
    }).subscribe();
  } catch {}
  createWindow();
  console.log("[IronSight Dev] v2 ready | Health + auto-diagnose active | Cmd+Shift+I to toggle");
});

app.on("before-quit", () => { app.isQuitting = true; health.stop(); for (const j of cronJobs.values()) j.stop(); for (const j of scheduledJobs.values()) j.stop(); globalShortcut.unregisterAll(); });
app.on("window-all-closed", (e) => e.preventDefault());
app.on("activate", createWindow);
