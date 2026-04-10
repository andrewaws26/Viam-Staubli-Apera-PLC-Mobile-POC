/**
 * IronSight MCP Server
 *
 * Exposes fleet diagnostics, Pi management, sensor data, and Supabase queries
 * as MCP tools for Claude Code CLI sessions.
 *
 * Transport: stdio (local process)
 * Run: node mcp-server/index.js
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { execFile, exec as execCb } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const execAsync = promisify(execCb);
const execFileAsync = promisify(execFile);

const PI_HOST = process.env.PI_HOST || "100.112.68.52";
const REPO_ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

// ── Supabase client (optional — works without if no keys) ──────────
let supabase = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

// ── Helpers ─────────────────────────────────────────────────────────
async function sshCommand(cmd, timeoutMs = 15000) {
  try {
    const { stdout, stderr } = await execAsync(
      `ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no andrew@${PI_HOST} "${cmd.replace(/"/g, '\\"')}"`,
      { timeout: timeoutMs }
    );
    return { ok: true, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (err) {
    return { ok: false, error: err.message?.slice(0, 500) || "SSH failed" };
  }
}

async function localExec(cmd, timeoutMs = 30000) {
  try {
    const { stdout, stderr } = await execAsync(cmd, {
      timeout: timeoutMs,
      cwd: REPO_ROOT,
    });
    return { ok: true, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (err) {
    return {
      ok: false,
      stdout: err.stdout?.trim() || "",
      stderr: err.stderr?.trim() || "",
      error: err.message?.slice(0, 500) || "command failed",
    };
  }
}

function text(content) {
  return { content: [{ type: "text", text: typeof content === "string" ? content : JSON.stringify(content, null, 2) }] };
}

// ── Tool Definitions ────────────────────────────────────────────────
const TOOLS = [
  // ── Pi Fleet ──────────────────────────────────
  {
    name: "pi_status",
    description: "Get Pi 5 system status: CPU, memory, disk, temperature, uptime, network interfaces. Uses SSH via Tailscale.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "pi_service_status",
    description: "Check status of a systemd service on the Pi 5 (viam-server, can0, ironsight-self-heal, etc.)",
    inputSchema: {
      type: "object",
      properties: {
        service: { type: "string", description: "Service name (e.g., viam-server, can0)" },
      },
      required: ["service"],
    },
  },
  {
    name: "pi_restart_service",
    description: "Restart a systemd service on the Pi 5. Use with caution.",
    inputSchema: {
      type: "object",
      properties: {
        service: { type: "string", description: "Service name to restart" },
      },
      required: ["service"],
    },
  },
  {
    name: "pi_journal",
    description: "Read recent journal logs from a Pi 5 service",
    inputSchema: {
      type: "object",
      properties: {
        service: { type: "string", description: "Service name" },
        lines: { type: "number", description: "Number of lines (default 30)" },
      },
      required: ["service"],
    },
  },
  {
    name: "pi_can_bus_status",
    description: "Get CAN bus (can0) status: link state, bitrate, listen-only mode, frame counts, errors",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "pi_run_command",
    description: "Run an arbitrary command on the Pi 5 via SSH. Use for diagnostics only.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to run" },
      },
      required: ["command"],
    },
  },

  // ── Sensor Data ───────────────────────────────
  {
    name: "get_latest_readings",
    description: "Get the most recent sensor readings from Supabase for a component (plc-monitor, truck-engine, cell-monitor)",
    inputSchema: {
      type: "object",
      properties: {
        component: {
          type: "string",
          description: "Component name: plc-monitor, truck-engine, or cell-monitor",
          enum: ["plc-monitor", "truck-engine", "cell-monitor"],
        },
        limit: { type: "number", description: "Number of readings (default 5)" },
      },
      required: ["component"],
    },
  },
  {
    name: "query_supabase",
    description: "Run a read-only SQL query against the IronSight Supabase database. Returns up to 100 rows.",
    inputSchema: {
      type: "object",
      properties: {
        sql: { type: "string", description: "SQL query (SELECT only)" },
      },
      required: ["sql"],
    },
  },

  // ── Local Dev ─────────────────────────────────
  {
    name: "run_tests",
    description: "Run the dashboard test suite (vitest). Returns pass/fail summary.",
    inputSchema: {
      type: "object",
      properties: {
        filter: { type: "string", description: "Test file filter pattern (optional)" },
      },
      required: [],
    },
  },
  {
    name: "run_typecheck",
    description: "Run TypeScript type checking on the dashboard",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_git_status",
    description: "Get current git status: branch, dirty files, unpushed commits, recent log",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "fleet_health",
    description: "Run the fleet health check script and return JSON status of all systems",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "check_vercel_deploy",
    description: "Check if the Vercel production deployment is healthy",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "npm_audit",
    description: "Run npm audit on the dashboard and return vulnerability summary",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
];

// ── Tool Handlers ───────────────────────────────────────────────────
async function handleTool(name, args) {
  switch (name) {
    // ── Pi Fleet ─────────────────────
    case "pi_status": {
      const result = await sshCommand(
        "echo '=== UPTIME ===' && uptime && " +
        "echo '=== CPU ===' && cat /proc/loadavg && " +
        "echo '=== MEMORY ===' && free -h | head -3 && " +
        "echo '=== DISK ===' && df -h / | tail -1 && " +
        "echo '=== TEMP ===' && vcgencmd measure_temp 2>/dev/null || cat /sys/class/thermal/thermal_zone0/temp && " +
        "echo '=== NETWORK ===' && ip -brief addr show | grep -v lo"
      );
      return text(result);
    }

    case "pi_service_status": {
      const svc = args.service.replace(/[^a-zA-Z0-9._-]/g, "");
      const result = await sshCommand(`systemctl status ${svc} --no-pager -l 2>&1 | head -20`);
      return text(result);
    }

    case "pi_restart_service": {
      const svc = args.service.replace(/[^a-zA-Z0-9._-]/g, "");
      const result = await sshCommand(`sudo systemctl restart ${svc} && sleep 2 && systemctl is-active ${svc}`);
      return text(result);
    }

    case "pi_journal": {
      const svc = args.service.replace(/[^a-zA-Z0-9._-]/g, "");
      const lines = Math.min(args.lines || 30, 100);
      const result = await sshCommand(`journalctl -u ${svc} --no-pager -n ${lines} 2>&1`);
      return text(result);
    }

    case "pi_can_bus_status": {
      const result = await sshCommand(
        "echo '=== LINK ===' && ip -d link show can0 2>/dev/null && " +
        "echo '=== STATS ===' && ip -s link show can0 2>/dev/null && " +
        "echo '=== SERVICE ===' && systemctl is-active can0 2>/dev/null"
      );
      return text(result);
    }

    case "pi_run_command": {
      const result = await sshCommand(args.command);
      return text(result);
    }

    // ── Sensor Data ──────────────────
    case "get_latest_readings": {
      if (!supabase) return text({ error: "Supabase not configured — set SUPABASE_URL and SUPABASE_SERVICE_KEY" });
      const limit = Math.min(args.limit || 5, 50);
      // Query Viam data table for the component
      const { data, error } = await supabase
        .from("sensor_readings")
        .select("*")
        .eq("component_name", args.component)
        .order("time_received", { ascending: false })
        .limit(limit);
      if (error) return text({ error: error.message });
      return text(data);
    }

    case "query_supabase": {
      if (!supabase) return text({ error: "Supabase not configured — set SUPABASE_URL and SUPABASE_SERVICE_KEY" });
      const sql = args.sql.trim();
      if (!/^\s*select\b/i.test(sql)) return text({ error: "Only SELECT queries allowed" });
      const { data, error } = await supabase.rpc("exec_sql", { query: sql });
      if (error) {
        // Fallback: try direct query if RPC not available
        return text({ error: `Query failed: ${error.message}. Use get_latest_readings for sensor data or the Supabase MCP server for full DB access.` });
      }
      return text(data);
    }

    // ── Local Dev ────────────────────
    case "run_tests": {
      const filter = args.filter ? ` ${args.filter}` : "";
      const result = await localExec(`cd dashboard && npx vitest run --reporter=verbose${filter} 2>&1 | tail -30`, 120000);
      return text(result);
    }

    case "run_typecheck": {
      const result = await localExec("cd dashboard && npx tsc --noEmit 2>&1 | tail -30", 60000);
      return text(result);
    }

    case "get_git_status": {
      const [status, log, diff] = await Promise.all([
        localExec("git status --porcelain -b"),
        localExec("git log --oneline -10"),
        localExec("git diff --stat"),
      ]);
      return text({ branch: status.stdout?.split("\n")[0], status: status.stdout, log: log.stdout, diff: diff.stdout });
    }

    case "fleet_health": {
      const result = await sshCommand("/usr/local/bin/fleet-health.sh 2>/dev/null || echo '{\"error\": \"fleet-health.sh not found\"}'");
      try {
        return text(JSON.parse(result.stdout));
      } catch {
        return text(result);
      }
    }

    case "check_vercel_deploy": {
      const result = await localExec(
        'curl -s -o /dev/null -w \'{"http_code": "%{http_code}", "time_total": "%{time_total}"}\' https://viam-staubli-apera-plc-mobile-poc.vercel.app/api/cell-readings?sim=true',
        10000
      );
      try {
        return text(JSON.parse(result.stdout));
      } catch {
        return text(result);
      }
    }

    case "npm_audit": {
      const result = await localExec("cd dashboard && npm audit --json 2>/dev/null | head -100", 30000);
      try {
        const audit = JSON.parse(result.stdout);
        return text({
          vulnerabilities: audit.metadata?.vulnerabilities || {},
          total: audit.metadata?.vulnerabilities
            ? Object.values(audit.metadata.vulnerabilities).reduce((a, b) => a + b, 0)
            : "unknown",
        });
      } catch {
        return text(result);
      }
    }

    default:
      return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  }
}

// ── Resource Definitions ────────────────────────────────────────────
const RESOURCES = [
  {
    uri: "ironsight://plc-register-map",
    name: "PLC Register Map",
    description: "Complete decoded register map for the Click PLC (478 registers)",
    mimeType: "text/markdown",
  },
  {
    uri: "ironsight://fleet-config",
    name: "Fleet Configuration",
    description: "Viam server config and fleet fragment template",
    mimeType: "application/json",
  },
  {
    uri: "ironsight://session-handoff",
    name: "Session Handoff",
    description: "Current dev status and next priorities",
    mimeType: "text/markdown",
  },
];

async function handleResource(uri) {
  switch (uri) {
    case "ironsight://plc-register-map":
      return { contents: [{ uri, mimeType: "text/markdown", text: await readFile(`${REPO_ROOT}/docs/plc-register-map.md`, "utf-8") }] };
    case "ironsight://fleet-config":
      return { contents: [{ uri, mimeType: "application/json", text: await readFile(`${REPO_ROOT}/config/viam-server.json`, "utf-8").catch(() => "{}") }] };
    case "ironsight://session-handoff":
      return { contents: [{ uri, mimeType: "text/markdown", text: await readFile(`${REPO_ROOT}/docs/session-handoff.md`, "utf-8").catch(() => "No handoff doc found") }] };
    default:
      throw new Error(`Unknown resource: ${uri}`);
  }
}

// ── Server Setup ────────────────────────────────────────────────────
const server = new Server(
  { name: "ironsight", version: "1.0.0" },
  { capabilities: { tools: {}, resources: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
server.setRequestHandler(CallToolRequestSchema, async (req) => handleTool(req.params.name, req.params.arguments || {}));
server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: RESOURCES }));
server.setRequestHandler(ReadResourceRequestSchema, async (req) => handleResource(req.params.uri));

const transport = new StdioServerTransport();
await server.connect(transport);
