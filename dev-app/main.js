const { app, BrowserWindow, Tray, Menu, nativeImage, Notification, ipcMain, shell, globalShortcut } = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const { createClient } = require("@supabase/supabase-js");
const cron = require("node-cron");

// ── Config ────────────────────────────────────────────────────────────
const REPO_ROOT = path.resolve(__dirname, "..");
const PI5_HOST = "andrew@100.112.68.52";

// Load from .env.local in the dashboard directory
function loadEnv() {
  try {
    const envPath = path.join(REPO_ROOT, "dashboard", ".env.local");
    const fs = require("fs");
    const content = fs.readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const match = line.match(/^([A-Z_]+)=(.+)$/);
      if (match) process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
    }
  } catch {}
}
loadEnv();

const supabase = createClient(
  process.env.SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

// ── State ─────────────────────────────────────────────────────────────
let mainWindow = null;
let tray = null;
const activeRuns = new Map(); // runId → { process, workflow }
const cronJobs = new Map();   // workflowId → cron task

// ── Tray Icon ─────────────────────────────────────────────────────────
function createTrayIcon(color = "default") {
  // Draw a simple circle icon programmatically
  const size = 22;
  const canvas = nativeImage.createEmpty();
  // Use template image for macOS dark/light menu bar
  const icon = nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(`
      <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
        <circle cx="11" cy="11" r="8" fill="none" stroke="${color === "running" ? "#3b82f6" : color === "error" ? "#ef4444" : "#22c55e"}" stroke-width="2"/>
        <circle cx="11" cy="11" r="4" fill="${color === "running" ? "#3b82f6" : color === "error" ? "#ef4444" : "#22c55e"}"/>
      </svg>
    `).toString("base64")}`
  );
  icon.setTemplateImage(false);
  return icon;
}

// ── Window ────────────────────────────────────────────────────────────
function createWindow() {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 12, y: 12 },
    vibrancy: "under-window",
    visualEffectState: "active",
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "index.html"));

  mainWindow.on("close", (e) => {
    e.preventDefault();
    mainWindow.hide();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ── Tray Menu ─────────────────────────────────────────────────────────
function buildTrayMenu(workflows = []) {
  const running = activeRuns.size;
  const items = [
    { label: `IronSight Dev Portal`, enabled: false },
    { label: running > 0 ? `${running} running...` : "No active runs", enabled: false },
    { type: "separator" },
    { label: "Open Dashboard", click: createWindow },
    { type: "separator" },
  ];

  // Quick-run workflows
  if (workflows.length > 0) {
    items.push({ label: "Quick Run", enabled: false });
    for (const w of workflows.slice(0, 8)) {
      const engineIcon = w.engine === "dev-pi" ? "🖥" : w.engine === "github-actions" ? "⚙" : "⏱";
      items.push({
        label: `  ${engineIcon} ${w.name}`,
        click: () => executeWorkflow(w),
      });
    }
    items.push({ type: "separator" });
  }

  items.push(
    {
      label: "Run Claude Session...",
      click: () => {
        createWindow();
        mainWindow?.webContents.send("open-claude-prompt");
      },
    },
    { label: "Fleet Health Check", click: () => runFleetHealth() },
    { label: "Run Tests", click: () => runTests() },
    { type: "separator" },
    { label: "Open in Terminal", click: () => openTerminal() },
    { label: "Open in Browser", click: () => shell.openExternal("http://localhost:3000/dev-portal/workflows") },
    { type: "separator" },
    { label: "Quit", click: () => { app.isQuitting = true; app.quit(); } },
  );

  return Menu.buildFromTemplate(items);
}

// ── Execution Engine ──────────────────────────────────────────────────
function execCommand(command, args, opts = {}) {
  return new Promise((resolve) => {
    const start = Date.now();
    let stdout = "";
    let stderr = "";

    const proc = spawn(command, args, {
      cwd: opts.cwd || REPO_ROOT,
      env: { ...process.env, ...opts.env },
      shell: true,
      timeout: opts.timeoutMs || 300_000,
    });

    proc.stdout?.on("data", (d) => {
      stdout += d.toString();
      // Stream to window
      mainWindow?.webContents.send("run-output", {
        runId: opts.runId,
        stdout: d.toString(),
        streaming: true,
      });
    });

    proc.stderr?.on("data", (d) => {
      stderr += d.toString();
    });

    proc.on("close", (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout: stdout.slice(-50_000),
        stderr: stderr.slice(-10_000),
        durationMs: Date.now() - start,
      });
    });

    proc.on("error", (err) => {
      resolve({ exitCode: 1, stdout: "", stderr: err.message, durationMs: Date.now() - start });
    });

    // Store for cancellation
    if (opts.runId) activeRuns.set(opts.runId, { process: proc, workflow: opts.workflow });
  });
}

async function executeWorkflow(workflow, input) {
  // Create run in Supabase
  const { data: run } = await supabase
    .from("workflow_runs")
    .insert({
      workflow_id: workflow.id,
      status: "running",
      trigger: "manual",
      input: input || null,
    })
    .select()
    .single();

  if (!run) return;

  tray?.setImage(createTrayIcon("running"));
  mainWindow?.webContents.send("run-started", { runId: run.id, workflow });

  // Notify
  new Notification({
    title: `Running: ${workflow.name}`,
    body: `Engine: ${workflow.engine}`,
    silent: true,
  }).show();

  let result;
  const config = workflow.config || {};
  const execOpts = { runId: run.id, workflow };

  switch (workflow.engine) {
    case "dev-pi": {
      const cmd = config.command || input?.command || "/usr/local/bin/fleet-health.sh";
      result = await execCommand("ssh", [
        "-o", "ConnectTimeout=10", "-o", "StrictHostKeyChecking=no",
        PI5_HOST, cmd,
      ], { ...execOpts, timeoutMs: config.timeoutMs || 120_000 });
      break;
    }
    case "github-actions": {
      const file = config.workflowFile || config.command || "dev-pi.yml";
      result = await execCommand("gh", [
        "workflow", "run", file, "--ref", config.ref || "main",
      ], { ...execOpts, timeoutMs: 30_000 });
      break;
    }
    case "vercel-cron":
    default: {
      const prompt = config.prompt || input?.prompt;
      if (prompt) {
        result = await execCommand("claude", [
          "-p", prompt, "--output-format", "text",
        ], { ...execOpts, timeoutMs: config.timeoutMs || 600_000 });
      } else if (config.command) {
        result = await execCommand("bash", ["-c", config.command], {
          ...execOpts, timeoutMs: config.timeoutMs || 120_000,
        });
      } else {
        result = { exitCode: 1, stdout: "", stderr: "No command or prompt configured", durationMs: 0 };
      }
      break;
    }
  }

  activeRuns.delete(run.id);
  const status = result.exitCode === 0 ? "completed" : "failed";

  // Update Supabase
  await supabase
    .from("workflow_runs")
    .update({
      status,
      ended_at: new Date().toISOString(),
      output: {
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        durationMs: result.durationMs,
      },
    })
    .eq("id", run.id);

  // Notify completion
  new Notification({
    title: `${status === "completed" ? "Done" : "Failed"}: ${workflow.name}`,
    body: status === "completed"
      ? `Completed in ${result.durationMs < 1000 ? result.durationMs + "ms" : (result.durationMs / 1000).toFixed(1) + "s"}`
      : `Exit code ${result.exitCode}`,
  }).show();

  tray?.setImage(createTrayIcon(activeRuns.size > 0 ? "running" : status === "completed" ? "default" : "error"));
  mainWindow?.webContents.send("run-completed", { runId: run.id, status, result });

  // Refresh menu
  loadWorkflows();
}

// ── Quick Actions ─────────────────────────────────────────────────────
async function runFleetHealth() {
  const fakeWorkflow = { id: null, name: "Fleet Health Check", engine: "dev-pi", config: { command: "/usr/local/bin/fleet-health.sh" } };
  // Just run directly without DB tracking
  const result = await execCommand("ssh", [
    "-o", "ConnectTimeout=10", "-o", "StrictHostKeyChecking=no",
    PI5_HOST, "/usr/local/bin/fleet-health.sh",
  ], { timeoutMs: 30_000 });

  new Notification({
    title: result.exitCode === 0 ? "Fleet Health: OK" : "Fleet Health: Error",
    body: result.stdout.slice(0, 200) || result.stderr.slice(0, 200),
  }).show();

  mainWindow?.webContents.send("quick-result", { action: "fleet-health", result });
}

async function runTests() {
  const result = await execCommand("npx", ["vitest", "run"], {
    cwd: path.join(REPO_ROOT, "dashboard"),
    timeoutMs: 120_000,
  });

  const passMatch = result.stdout.match(/(\d+) passed/);
  const failMatch = result.stdout.match(/(\d+) failed/);

  new Notification({
    title: result.exitCode === 0 ? "Tests Passed" : "Tests Failed",
    body: `${passMatch?.[1] || "?"} passed, ${failMatch?.[1] || "0"} failed`,
  }).show();

  mainWindow?.webContents.send("quick-result", { action: "tests", result });
}

function openTerminal() {
  spawn("open", ["-a", "Terminal", REPO_ROOT]);
}

// ── Load Workflows from Supabase ──────────────────────────────────────
let cachedWorkflows = [];

async function loadWorkflows() {
  try {
    const { data } = await supabase
      .from("dev_workflows")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(20);

    cachedWorkflows = data || [];
    tray?.setContextMenu(buildTrayMenu(cachedWorkflows));

    // Setup cron jobs for active workflows
    setupCronJobs(cachedWorkflows.filter((w) => w.is_active && w.cron_expression));
  } catch {}
}

function setupCronJobs(workflows) {
  // Clear old jobs
  for (const [id, job] of cronJobs) {
    if (!workflows.find((w) => w.id === id)) {
      job.stop();
      cronJobs.delete(id);
    }
  }

  // Setup new jobs
  for (const w of workflows) {
    if (cronJobs.has(w.id)) continue;
    try {
      const job = cron.schedule(w.cron_expression, () => {
        console.log(`[CRON] Triggering: ${w.name}`);
        executeWorkflow(w);
      });
      cronJobs.set(w.id, job);
      console.log(`[CRON] Scheduled: ${w.name} (${w.cron_expression})`);
    } catch (err) {
      console.error(`[CRON] Invalid expression for ${w.name}:`, err.message);
    }
  }
}

// ── IPC Handlers ──────────────────────────────────────────────────────
ipcMain.handle("get-workflows", async () => {
  await loadWorkflows();
  return cachedWorkflows.map((w) => ({
    id: w.id, name: w.name, description: w.description, engine: w.engine,
    cronExpression: w.cron_expression, isActive: w.is_active, config: w.config,
    createdAt: w.created_at, updatedAt: w.updated_at,
  }));
});

ipcMain.handle("get-runs", async (_, workflowId) => {
  const { data } = await supabase
    .from("workflow_runs")
    .select("*")
    .eq("workflow_id", workflowId)
    .order("started_at", { ascending: false })
    .limit(20);
  return data || [];
});

ipcMain.handle("trigger-workflow", async (_, workflowId, input) => {
  const workflow = cachedWorkflows.find((w) => w.id === workflowId);
  if (!workflow) return { error: "Not found" };
  executeWorkflow(workflow, input);
  return { ok: true };
});

ipcMain.handle("run-claude", async (_, prompt) => {
  const fakeWorkflow = {
    id: null, name: "Ad-hoc Claude Session", engine: "vercel-cron",
    config: { prompt }, is_active: false,
  };

  // Create a temporary workflow entry
  const { data: wf } = await supabase.from("dev_workflows").insert({
    name: `Claude: ${prompt.slice(0, 50)}...`,
    engine: "vercel-cron",
    config: { prompt },
    is_active: false,
    created_by: "dev-app",
  }).select().single();

  if (wf) executeWorkflow(wf, { prompt });
  return { ok: true };
});

ipcMain.handle("cancel-run", (_, runId) => {
  const active = activeRuns.get(runId);
  if (active?.process) {
    active.process.kill("SIGTERM");
    activeRuns.delete(runId);
  }
  return { ok: true };
});

ipcMain.handle("get-status", () => ({
  running: activeRuns.size,
  cronJobs: cronJobs.size,
  repoRoot: REPO_ROOT,
  pi5Host: PI5_HOST,
}));

// ── App Lifecycle ─────────────────────────────────────────────────────
app.dock?.hide(); // Hide dock icon — menu bar app only

app.whenReady().then(async () => {
  tray = new Tray(createTrayIcon());
  tray.setToolTip("IronSight Dev Portal");

  await loadWorkflows();

  tray.on("click", () => createWindow());
  tray.on("right-click", () => tray.popUpContextMenu());

  // Global shortcut to toggle window
  globalShortcut.register("CommandOrControl+Shift+I", () => {
    if (mainWindow?.isVisible()) {
      mainWindow.hide();
    } else {
      createWindow();
    }
  });

  // Refresh workflows every 60 seconds
  setInterval(loadWorkflows, 60_000);

  console.log("[IronSight Dev] Menu bar app ready");
  console.log(`[IronSight Dev] Repo: ${REPO_ROOT}`);
  console.log(`[IronSight Dev] ${cachedWorkflows.length} workflows loaded`);
  console.log(`[IronSight Dev] ${cronJobs.size} cron jobs active`);
  console.log("[IronSight Dev] Cmd+Shift+I to toggle window");
});

app.on("before-quit", () => {
  app.isQuitting = true;
  for (const job of cronJobs.values()) job.stop();
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", (e) => e.preventDefault());
app.on("activate", createWindow);
