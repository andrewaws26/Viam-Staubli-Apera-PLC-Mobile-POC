import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";
import { spawn } from "child_process";

/**
 * LOCAL-ONLY workflow execution engine.
 * Runs commands on the local machine — Claude CLI, scripts, SSH to Pi 5.
 * Writes results back to Supabase so the online dashboard stays current.
 *
 * Only works on localhost (npm run dev). Vercel will never hit this because
 * child_process.spawn doesn't work in serverless.
 */

const PI5_HOST = "andrew@100.112.68.52";
const REPO_ROOT = process.env.REPO_ROOT || process.cwd().replace(/\/dashboard$/, "");

interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

/** Spawn a process and capture output with timeout */
function execCommand(
  command: string,
  args: string[],
  opts?: { timeoutMs?: number; env?: Record<string, string>; cwd?: string }
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const start = Date.now();
    const timeout = opts?.timeoutMs || 300_000; // 5 min default
    let stdout = "";
    let stderr = "";
    let killed = false;

    const proc = spawn(command, args, {
      cwd: opts?.cwd || REPO_ROOT,
      env: { ...process.env, ...opts?.env },
      shell: true,
      timeout,
    });

    proc.stdout?.on("data", (d) => { stdout += d.toString(); });
    proc.stderr?.on("data", (d) => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      killed = true;
      proc.kill("SIGTERM");
    }, timeout);

    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: killed ? 124 : (code ?? 1),
        stdout: stdout.slice(-50_000), // cap at 50KB
        stderr: stderr.slice(-10_000),
        durationMs: Date.now() - start,
      });
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        exitCode: 1,
        stdout: "",
        stderr: err.message,
        durationMs: Date.now() - start,
      });
    });
  });
}

/** Execute a workflow based on its engine type */
async function executeWorkflow(
  workflow: Record<string, unknown>,
  input?: Record<string, unknown>
): Promise<ExecResult> {
  const engine = workflow.engine as string;
  const config = (workflow.config || {}) as Record<string, unknown>;
  const name = workflow.name as string;

  switch (engine) {
    case "dev-pi": {
      // SSH to Pi 5 and execute command
      const cmd = (config.command as string) ||
        (input?.command as string) ||
        "/usr/local/bin/fleet-health.sh";

      return execCommand("ssh", [
        "-o", "ConnectTimeout=10",
        "-o", "StrictHostKeyChecking=no",
        PI5_HOST,
        cmd,
      ], { timeoutMs: (config.timeoutMs as number) || 120_000 });
    }

    case "github-actions": {
      // Dispatch a GitHub Actions workflow
      const workflowFile = (config.workflowFile as string) || "dev-pi.yml";
      const ref = (config.ref as string) || "main";
      const ghInputs = (input?.inputs as Record<string, string>) || (config.inputs as Record<string, string>) || {};

      // Build the gh cli command
      const inputArgs = Object.entries(ghInputs)
        .map(([k, v]) => `-f ${k}=${v}`)
        .join(" ");

      return execCommand("gh", [
        "workflow", "run", workflowFile,
        "--ref", ref,
        ...(inputArgs ? inputArgs.split(" ") : []),
      ], { timeoutMs: 30_000 });
    }

    case "vercel-cron": {
      // Execute locally — these are typically Claude API calls or report generation
      const script = (config.script as string) || (config.command as string);
      const prompt = (config.prompt as string) || (input?.prompt as string);

      if (prompt) {
        // Claude CLI session
        return execCommand("claude", [
          "-p", prompt,
          "--output-format", "text",
        ], {
          timeoutMs: (config.timeoutMs as number) || 600_000, // 10 min for Claude
          cwd: REPO_ROOT,
        });
      }

      if (script) {
        return execCommand("bash", ["-c", script], {
          timeoutMs: (config.timeoutMs as number) || 120_000,
          cwd: REPO_ROOT,
        });
      }

      return {
        exitCode: 1,
        stdout: "",
        stderr: `Workflow "${name}": no script or prompt configured in config`,
        durationMs: 0,
      };
    }

    default:
      return {
        exitCode: 1,
        stdout: "",
        stderr: `Unknown engine: ${engine}`,
        durationMs: 0,
      };
  }
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Local-only guard: only allow from localhost
  const host = req.headers.get("host") || "";
  const isLocal = host.startsWith("localhost") || host.startsWith("127.0.0.1");
  if (!isLocal) {
    return NextResponse.json(
      { error: "Execution engine only available locally (npm run dev)" },
      { status: 403 }
    );
  }

  const body = await req.json();
  const { workflowId, input } = body;

  if (!workflowId) {
    return NextResponse.json({ error: "workflowId required" }, { status: 400 });
  }

  const sb = getSupabase();

  // Fetch workflow
  const { data: workflow, error: wErr } = await sb
    .from("dev_workflows")
    .select("*")
    .eq("id", workflowId)
    .single();

  if (wErr || !workflow) {
    return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
  }

  // Create run record
  const { data: run, error: rErr } = await sb
    .from("workflow_runs")
    .insert({
      workflow_id: workflowId,
      status: "running",
      trigger: "manual",
      input: input || null,
    })
    .select()
    .single();

  if (rErr || !run) {
    return NextResponse.json({ error: "Failed to create run" }, { status: 500 });
  }

  // Start streaming response — return immediately with run ID
  // Execute in background and update Supabase when done
  const runId = run.id;

  // Fire and forget — execute async, write result to DB
  executeWorkflow(workflow, input).then(async (result) => {
    const status = result.exitCode === 0 ? "completed" : "failed";
    await sb
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
      .eq("id", runId);

    console.log(
      `[WORKFLOW] ${workflow.name} [${workflow.engine}] → ${status} (${result.durationMs}ms)`
    );
  }).catch(async (err) => {
    await sb
      .from("workflow_runs")
      .update({
        status: "failed",
        ended_at: new Date().toISOString(),
        output: { error: err.message },
      })
      .eq("id", runId);
  });

  return NextResponse.json({
    run: { id: runId, status: "running", workflowId },
    message: `Executing "${workflow.name}" on ${workflow.engine}...`,
  });
}

/** GET: Poll run status (for the UI to check progress) */
export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const host = req.headers.get("host") || "";
  const isLocal = host.startsWith("localhost") || host.startsWith("127.0.0.1");
  if (!isLocal) {
    return NextResponse.json({ error: "Local only" }, { status: 403 });
  }

  const runId = req.nextUrl.searchParams.get("runId");
  if (!runId) {
    // Return execution engine status
    return NextResponse.json({
      engine: "local",
      available: true,
      repoRoot: REPO_ROOT,
      pi5Host: PI5_HOST,
    });
  }

  const sb = getSupabase();
  const { data: run } = await sb
    .from("workflow_runs")
    .select("*")
    .eq("id", runId)
    .single();

  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: run.id,
    status: run.status,
    trigger: run.trigger,
    output: run.output,
    startedAt: run.started_at,
    endedAt: run.ended_at,
  });
}
