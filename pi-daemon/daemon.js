#!/usr/bin/env node
// IronSight Pi 5 Daemon
// Automation companion that syncs with the Mac app via Supabase.
// When Mac is online → Mac runs workflows, Pi stays idle.
// When Mac is offline → Pi picks up scheduled + pending workflows.

const { createClient } = require("@supabase/supabase-js");
const { spawn } = require("child_process");
const cron = require("node-cron");
const os = require("os");
const fs = require("fs");
const path = require("path");

// ── Config ────────────────────────────────────────────────────────────
const REPO_ROOT = path.resolve(__dirname, "..");
const DEVICE_ID = "pi5";
const DEVICE_NAME = "Pi 5 (viam-pi)";
const HEARTBEAT_INTERVAL = 30_000;     // 30s
const MAC_OFFLINE_THRESHOLD = 120_000; // 2 min without heartbeat = offline
const WORKFLOW_POLL_INTERVAL = 60_000; // 1 min
const PENDING_POLL_INTERVAL = 15_000;  // 15s — quick pickup

// ── Load env from dashboard/.env.local ─────────────────────────────────
function loadEnv() {
  const candidates = [
    path.join(REPO_ROOT, "dashboard", ".env.local"),
    path.join(os.homedir(), ".ironsight", ".env"),
  ];
  for (const envPath of candidates) {
    try {
      const content = fs.readFileSync(envPath, "utf-8");
      for (const line of content.split("\n")) {
        const match = line.match(/^([A-Z_]+)=(.+)$/);
        if (match) process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
      }
      console.log(`[ENV] Loaded from ${envPath}`);
      return;
    } catch (err) {
      if (err.code !== "ENOENT") {
        console.warn(`[ENV] Failed to read ${envPath}: ${err.message}`);
      }
    }
  }
  console.warn("[ENV] No env file found — using process.env");
}
loadEnv();

// Use anon key (RLS-scoped) instead of service role key.
// The daemon only needs access to device_heartbeats, workflow_runs, and dev_workflows.
// Ensure RLS policies grant access to the anon role for these tables.
const supabase = createClient(
  process.env.SUPABASE_URL || "",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ""
);

// ── State ─────────────────────────────────────────────────────────────
const activeRuns = new Map(); // runId → child process
const cronJobs = new Map();   // workflowId → cron task
let cachedWorkflows = [];
let macOnlineCache = false;

// ── Heartbeat ─────────────────────────────────────────────────────────
async function sendHeartbeat() {
  try {
    const nets = os.networkInterfaces();
    const tailscaleIp = Object.values(nets).flat()
      .find((n) => n?.address?.startsWith("100."))?.address;

    await supabase.from("device_heartbeats").upsert({
      id: DEVICE_ID,
      device_name: DEVICE_NAME,
      hostname: os.hostname(),
      ip_address: tailscaleIp || null,
      last_seen: new Date().toISOString(),
      metadata: {
        uptime: Math.round(os.uptime()),
        loadAvg: os.loadavg(),
        freeMem: Math.round(os.freemem() / 1024 / 1024),
        totalMem: Math.round(os.totalmem() / 1024 / 1024),
        activeRuns: activeRuns.size,
        cronJobs: cronJobs.size,
        nodeVersion: process.version,
      },
    });
  } catch (err) {
    console.error("[HEARTBEAT]", err.message);
  }
}

// ── Mac online check ──────────────────────────────────────────────────
async function checkMacOnline() {
  try {
    const { data } = await supabase
      .from("device_heartbeats")
      .select("last_seen")
      .eq("id", "mac")
      .single();

    if (!data) {
      macOnlineCache = false;
      return false;
    }
    const elapsed = Date.now() - new Date(data.last_seen).getTime();
    macOnlineCache = elapsed < MAC_OFFLINE_THRESHOLD;
    return macOnlineCache;
  } catch {
    macOnlineCache = false;
    return false;
  }
}

// ── Execute command (local — we ARE the Pi) ───────────────────────────
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

    proc.stdout?.on("data", (d) => { stdout += d.toString(); });
    proc.stderr?.on("data", (d) => { stderr += d.toString(); });

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

    if (opts.runId) activeRuns.set(opts.runId, proc);
  });
}

// ── Execute a workflow ────────────────────────────────────────────────
async function executeWorkflow(workflow, opts = {}) {
  // Skip if Mac is online (unless force or pending pickup)
  if (!opts.force) {
    const macUp = await checkMacOnline();
    if (macUp) {
      console.log(`[SKIP] Mac is online — deferring: ${workflow.name}`);
      return;
    }
  }

  // Create run record
  const { data: run } = await supabase
    .from("workflow_runs")
    .insert({
      workflow_id: workflow.id,
      status: "running",
      trigger: opts.trigger || "scheduled",
      executor: DEVICE_ID,
      input: opts.input || null,
    })
    .select()
    .single();

  if (!run) {
    console.error(`[ERROR] Failed to create run for: ${workflow.name}`);
    return;
  }

  console.log(`[RUN] ${workflow.name} (${run.id.slice(0, 8)}...)`);
  const config = workflow.config || {};
  let result;

  switch (workflow.engine) {
    case "dev-pi": {
      // We ARE the Pi — run locally, no SSH
      const cmd = config.command || "/usr/local/bin/fleet-health.sh";
      result = await execCommand("bash", ["-c", cmd], {
        runId: run.id,
        timeoutMs: config.timeoutMs || 120_000,
      });
      break;
    }

    case "vercel-cron": {
      if (config.prompt) {
        // Use Claude CLI
        result = await execCommand("claude", [
          "-p", config.prompt, "--output-format", "text",
        ], { runId: run.id, timeoutMs: config.timeoutMs || 600_000 });
      } else if (config.command) {
        result = await execCommand("bash", ["-c", config.command], {
          runId: run.id, timeoutMs: config.timeoutMs || 120_000,
        });
      } else {
        result = { exitCode: 1, stdout: "", stderr: "No command or prompt configured", durationMs: 0 };
      }
      break;
    }

    case "github-actions": {
      const file = config.workflowFile || "dev-pi.yml";
      result = await execCommand("gh", [
        "workflow", "run", file, "--ref", config.ref || "main",
      ], { runId: run.id, timeoutMs: 30_000 });
      break;
    }

    default:
      result = { exitCode: 1, stdout: "", stderr: `Unknown engine: ${workflow.engine}`, durationMs: 0 };
  }

  activeRuns.delete(run.id);
  const status = result.exitCode === 0 ? "completed" : "failed";

  // Write result back to Supabase
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
        executor: DEVICE_ID,
      },
    })
    .eq("id", run.id);

  const icon = status === "completed" ? "OK" : "FAIL";
  const dur = result.durationMs < 1000
    ? `${result.durationMs}ms`
    : `${(result.durationMs / 1000).toFixed(1)}s`;
  console.log(`[${icon}] ${workflow.name} — ${dur}`);
}

// ── Pick up pending runs (triggered from web dashboard while Mac is offline)
async function checkPendingRuns() {
  try {
    const { data: pending } = await supabase
      .from("workflow_runs")
      .select("*, dev_workflows(*)")
      .eq("status", "pending")
      .is("executor", null)
      .order("started_at", { ascending: true })
      .limit(3);

    if (!pending?.length) return;

    // Only pick up if Mac is offline
    const macUp = await checkMacOnline();
    if (macUp) return;

    for (const run of pending) {
      const workflow = run.dev_workflows;
      if (!workflow) continue;

      console.log(`[PICKUP] Claiming: ${workflow.name} (${run.id.slice(0, 8)}...)`);

      // Claim with optimistic lock
      const { error } = await supabase
        .from("workflow_runs")
        .update({ executor: DEVICE_ID, status: "running" })
        .eq("id", run.id)
        .eq("status", "pending");

      if (error) {
        console.error(`[PICKUP] Claim failed:`, error.message);
        continue;
      }

      // Execute
      const config = workflow.config || {};
      let result;

      if (workflow.engine === "dev-pi") {
        const cmd = config.command || "/usr/local/bin/fleet-health.sh";
        result = await execCommand("bash", ["-c", cmd], {
          runId: run.id, timeoutMs: config.timeoutMs || 120_000,
        });
      } else if (config.prompt) {
        result = await execCommand("claude", [
          "-p", config.prompt, "--output-format", "text",
        ], { runId: run.id, timeoutMs: 600_000 });
      } else if (config.command) {
        result = await execCommand("bash", ["-c", config.command], {
          runId: run.id, timeoutMs: 120_000,
        });
      } else {
        result = { exitCode: 1, stdout: "", stderr: "No command configured", durationMs: 0 };
      }

      activeRuns.delete(run.id);
      const status = result.exitCode === 0 ? "completed" : "failed";

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
            executor: DEVICE_ID,
          },
        })
        .eq("id", run.id);

      console.log(`[${status === "completed" ? "OK" : "FAIL"}] ${workflow.name}`);
    }
  } catch (err) {
    console.error("[PICKUP]", err.message);
  }
}

// ── Load workflows from Supabase ──────────────────────────────────────
async function loadWorkflows() {
  try {
    const { data } = await supabase
      .from("dev_workflows")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(50);

    cachedWorkflows = data || [];
    const activeScheduled = cachedWorkflows.filter((w) => w.is_active && w.cron_expression);
    setupCronJobs(activeScheduled);
  } catch (err) {
    console.error("[SYNC]", err.message);
  }
}

function setupCronJobs(workflows) {
  // Remove stale jobs
  for (const [id, job] of cronJobs) {
    if (!workflows.find((w) => w.id === id)) {
      job.stop();
      cronJobs.delete(id);
    }
  }

  // Add new jobs
  for (const w of workflows) {
    if (cronJobs.has(w.id)) continue;
    try {
      const job = cron.schedule(w.cron_expression, () => {
        console.log(`[CRON] Triggered: ${w.name}`);
        executeWorkflow(w);
      });
      cronJobs.set(w.id, job);
    } catch (err) {
      console.error(`[CRON] Bad expression for ${w.name}:`, err.message);
    }
  }
}

// ── Status display ────────────────────────────────────────────────────
function printStatus() {
  const macStatus = macOnlineCache ? "ONLINE" : "OFFLINE (Pi is primary)";
  console.log(`\n[STATUS] Mac: ${macStatus} | Workflows: ${cachedWorkflows.length} | Cron: ${cronJobs.size} | Active: ${activeRuns.size}`);
}

// ── Main ──────────────────────────────────────────────────────────────
async function main() {
  console.log("=========================================");
  console.log("  IronSight Pi Daemon v1.0");
  console.log(`  Device: ${DEVICE_NAME}`);
  console.log(`  Host:   ${os.hostname()}`);
  console.log(`  Repo:   ${REPO_ROOT}`);
  console.log(`  Node:   ${process.version}`);
  console.log("=========================================");

  if (!process.env.SUPABASE_URL) {
    console.error("[FATAL] SUPABASE_URL not set. Check dashboard/.env.local or ~/.ironsight/.env");
    process.exit(1);
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY && !process.env.SUPABASE_ANON_KEY) {
    console.error("[FATAL] No Supabase anon key found. Set SUPABASE_ANON_KEY in your .env file.");
    console.error("  Note: SUPABASE_SERVICE_ROLE_KEY is no longer used — use a scoped anon key instead.");
    process.exit(1);
  }

  // Initial setup
  await sendHeartbeat();
  await checkMacOnline();
  await loadWorkflows();

  // Heartbeat — every 30s
  setInterval(sendHeartbeat, HEARTBEAT_INTERVAL);

  // Mac online check — every 30s
  setInterval(checkMacOnline, 30_000);

  // Refresh workflows — every 60s
  setInterval(loadWorkflows, WORKFLOW_POLL_INTERVAL);

  // Check for pending runs — every 15s
  setInterval(checkPendingRuns, PENDING_POLL_INTERVAL);

  // Status log — every 5 min
  setInterval(printStatus, 300_000);

  printStatus();
  console.log("\n[READY] Pi daemon running — Ctrl+C to stop");
}

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n[SHUTDOWN] Stopping cron jobs...");
  for (const job of cronJobs.values()) job.stop();
  console.log("[SHUTDOWN] Killing active runs...");
  for (const proc of activeRuns.values()) proc.kill?.("SIGTERM");
  process.exit(0);
});

process.on("SIGTERM", () => {
  for (const job of cronJobs.values()) job.stop();
  for (const proc of activeRuns.values()) proc.kill?.("SIGTERM");
  process.exit(0);
});

main().catch((err) => {
  console.error("[FATAL]", err);
  process.exit(1);
});
