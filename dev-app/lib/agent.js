/**
 * Agent — single Claude-powered dev partner with switchable focus areas.
 * Replaces the 9-team model with one agent that acts, not reports.
 *
 * Focus Areas (context overlays, not personas):
 *   general, security, database, quality, infrastructure, finance
 *
 * Modes:
 *   chat     — interactive conversation, full codebase access, 15 turns
 *   audit    — runs REAL tools first, then Claude analyzes actual output
 *   research — extended investigation, 25 turns, 10-min timeout
 */

const { exec } = require("./executor");

let _onStream = null;
function onStream(fn) { _onStream = fn; }
function emitStream(type, chunk) { if (_onStream) _onStream(type, chunk); }

let _onActivity = null;
function onActivity(fn) { _onActivity = fn; }
function logActivity(action, detail) {
  const entry = { action, detail, timestamp: new Date().toISOString() };
  if (_onActivity) _onActivity(entry);
  return entry;
}

function claudeArgs(prompt, opts = {}) {
  const args = ["-p", prompt, "--output-format", "text", "--dangerously-skip-permissions"];
  if (opts.maxTurns) args.push("--max-turns", String(opts.maxTurns));
  return args;
}

// ── Focus Areas ──────────────────────────────────────────────────────

const FOCUS_AREAS = {
  general: {
    label: "General",
    context: "",
  },
  security: {
    label: "Security",
    context: `\n\n## Focus: Security\nPrioritize: auth bypass risks, dependency vulns, secrets in client code/logs, SQL injection, XSS, IDOR. Check Clerk middleware coverage and role enforcement.`,
  },
  database: {
    label: "Database",
    context: `\n\n## Focus: Database\nPrioritize: migration safety, missing indexes, N+1 queries in API routes, schema normalization, RLS gaps. 60+ Supabase tables across accounting/timesheets/chat/fleet/jobs.`,
  },
  quality: {
    label: "Quality",
    context: `\n\n## Focus: Quality & Testing\nPrioritize: test coverage gaps, flaky tests, missing edge cases, API endpoint tests, E2E coverage. Dashboard has 1395+ vitest tests and Playwright E2E.`,
  },
  infrastructure: {
    label: "Infrastructure",
    context: `\n\n## Focus: Infrastructure\nPrioritize: Vercel deployment health, Supabase uptime, Pi 5 connectivity (Tailscale 100.112.68.52), GitHub Actions CI, cron jobs, module service status.`,
  },
  finance: {
    label: "Finance",
    context: `\n\n## Focus: Financial Integrity\nPrioritize: double-entry balance enforcement, tax calculation accuracy (federal/state/FICA/FUTA), invoice lifecycle, period locks, audit trail completeness. Full QuickBooks replacement.`,
  },
};

const BASE_PROMPT = `You are the IronSight dev agent — a pragmatic senior-level AI engineer embedded in a company OS monorepo (Next.js dashboard, Python sensor modules, React Native mobile, Electron dev app). You work for Andrew, a solo developer at B&B Metals.

You have full codebase access. Read files, search code, edit files, run commands, run tests. When asked to fix something, FIX it — don't just suggest. When investigating, be thorough — read the actual code.

Key constraints:
- Andrew is one person. Prioritize by impact.
- Be concise. Lead with the answer.
- Make clear decisions (yes/no), not "consider" or "evaluate".
- No gold-plating. Fix what's asked, nothing more.
- If you make changes, verify they work.`;

// ── Engine ────────────────────────────────────────────────────────────

function createAgent({ repoRoot, store }) {
  const history = [];
  const STORE_HISTORY = "agent-history";
  const STORE_MEMORY = "agent-memory";
  let isRunning = false;

  // Load persisted state
  const savedHistory = store?.get(STORE_HISTORY) || [];
  history.push(...savedHistory.slice(-50));
  let memories = store?.get(STORE_MEMORY) || [];

  function saveHistory() {
    store?.set(STORE_HISTORY, history.slice(-50));
  }

  function saveMemory() {
    memories = memories.slice(-30);
    store?.set(STORE_MEMORY, memories);
  }

  function buildMemoryContext() {
    if (!memories.length) return "";
    const lines = memories.map((m) => {
      const tag = m.type === "correction" ? "CORRECTION" : m.type === "preference" ? "PREFERENCE" : "LEARNED";
      return `- [${tag}] ${m.content}`;
    });
    return `\n\n## Memory (learned from past interactions)\n${lines.join("\n")}`;
  }

  // ── Chat ───────────────────────────────────────────────────────────

  async function chat(message, systemContext, focus = "general") {
    if (isRunning) return "Agent is already running. Wait for it to finish.";
    isRunning = true;
    logActivity("chat_started", message.slice(0, 100));

    try {
      history.push({ role: "user", content: message, timestamp: new Date().toISOString() });

      const recentMessages = history.slice(-10);
      const conversationBlock = recentMessages
        .map((m) => `${m.role === "user" ? "Andrew" : "Agent"}: ${m.content}`)
        .join("\n\n");

      const focusContext = FOCUS_AREAS[focus]?.context || "";
      const memoryBlock = buildMemoryContext();

      const prompt = `${BASE_PROMPT}${memoryBlock}${focusContext}\n\n${systemContext}\n\n## Conversation\n${conversationBlock}\n\n## Instructions\nRespond to Andrew's latest message. Be concise and actionable. If asked to fix something, DO it. If corrected, adapt.`;

      const result = await exec("claude", claudeArgs(prompt, { maxTurns: 15 }), {
        cwd: repoRoot, shell: false, timeout: 300_000,
        onStdout: (chunk) => emitStream("chat", chunk),
      });

      const response = result.exitCode === 0 ? result.stdout.trim() : `Error: ${result.stderr || "Failed"}`;
      history.push({ role: "assistant", content: response, timestamp: new Date().toISOString() });
      saveHistory();
      logActivity("chat_complete", response.slice(0, 80));
      return response;
    } finally {
      isRunning = false;
    }
  }

  // ── Audit ──────────────────────────────────────────────────────────

  async function audit(scope, systemContext) {
    if (isRunning) return { error: "Agent is already running." };
    isRunning = true;
    logActivity("audit_started", `Scope: ${scope}`);

    const path = require("path");
    const dashboardDir = path.join(repoRoot, "dashboard");

    const AUDIT_TOOLS = {
      security: [
        { name: "npm audit", cmd: "npm", args: ["audit", "--json"], cwd: dashboardDir, timeout: 30_000 },
        { name: "auth routes scan", cmd: "grep", args: ["-rn", "getAuth\\|currentUser\\|clerkClient", "app/api/", "--include=*.ts", "-l"], cwd: dashboardDir, timeout: 10_000 },
      ],
      tests: [
        { name: "vitest", cmd: "npx", args: ["vitest", "run", "--reporter=verbose"], cwd: dashboardDir, timeout: 180_000 },
      ],
      types: [
        { name: "tsc", cmd: "npx", args: ["tsc", "--noEmit"], cwd: dashboardDir, timeout: 60_000 },
      ],
      lint: [
        { name: "eslint", cmd: "npx", args: ["eslint", ".", "--format", "compact", "--max-warnings", "200"], cwd: dashboardDir, timeout: 60_000 },
      ],
      deps: [
        { name: "npm audit", cmd: "npm", args: ["audit", "--json"], cwd: dashboardDir, timeout: 30_000 },
        { name: "npm outdated", cmd: "npm", args: ["outdated", "--json"], cwd: dashboardDir, timeout: 15_000 },
      ],
      full: [
        { name: "npm audit", cmd: "npm", args: ["audit", "--json"], cwd: dashboardDir, timeout: 30_000 },
        { name: "tsc", cmd: "npx", args: ["tsc", "--noEmit"], cwd: dashboardDir, timeout: 60_000 },
        { name: "eslint", cmd: "npx", args: ["eslint", ".", "--format", "compact", "--max-warnings", "200"], cwd: dashboardDir, timeout: 60_000 },
      ],
    };

    try {
      const tools = AUDIT_TOOLS[scope];
      if (!tools) return { error: `Unknown audit scope: ${scope}` };

      // Phase 1: Run real tools
      emitStream("audit", `Running ${scope} audit...\n`);
      const toolResults = [];
      for (const tool of tools) {
        emitStream("audit", `  ${tool.name}...\n`);
        const result = await exec(tool.cmd, tool.args, { cwd: tool.cwd || repoRoot, timeout: tool.timeout });
        toolResults.push({
          name: tool.name,
          exitCode: result.exitCode,
          output: (result.stdout + "\n" + result.stderr).slice(-10_000),
        });
        emitStream("audit", `  ${tool.name}: exit ${result.exitCode}\n`);
      }

      // Phase 2: Claude analyzes real results
      emitStream("audit", `\nAnalyzing with Claude...\n`);
      const toolBlock = toolResults.map((r) =>
        `### ${r.name} (exit ${r.exitCode})\n\`\`\`\n${r.output.slice(-5000)}\n\`\`\``
      ).join("\n\n");

      const prompt = `${BASE_PROMPT}\n\n${systemContext}\n\n## Audit: ${scope}\nThese are REAL tool outputs. Analyze them:\n\n${toolBlock}\n\n## Instructions\nProvide a structured assessment:\n1. **Critical** — fix now\n2. **Warnings** — fix soon\n3. **Recommendations** — consider\n\nBe specific: file, problem, fix. Don't flag things that work.\n\nOutput a JSON block:\n\`\`\`json\n{"status":"green|yellow|red","findings":[{"title":"...","severity":"critical|high|medium|low","detail":"...","file":"..."}],"summary":"one-line assessment"}\n\`\`\``;

      const result = await exec("claude", claudeArgs(prompt, { maxTurns: 10 }), {
        cwd: repoRoot, shell: false, timeout: 300_000,
        onStdout: (chunk) => emitStream("audit", chunk),
      });

      const response = result.exitCode === 0 ? result.stdout.trim() : `Error: ${result.stderr}`;
      const parsed = parseStructuredOutput(response);
      logActivity("audit_complete", `${scope}: ${parsed.findings.length} findings`);

      return { raw: response, ...parsed, scope };
    } finally {
      isRunning = false;
    }
  }

  // ── Research ───────────────────────────────────────────────────────

  async function research(question, systemContext) {
    if (isRunning) return "Agent is already running.";
    isRunning = true;
    logActivity("research_started", question.slice(0, 100));

    try {
      history.push({ role: "user", content: `[Research] ${question}`, timestamp: new Date().toISOString() });
      const memoryBlock = buildMemoryContext();

      const prompt = `${BASE_PROMPT}${memoryBlock}\n\n${systemContext}\n\n## Deep Research\n${question}\n\n## Instructions\nBe thorough: READ files, SEARCH patterns, RUN commands. Provide specific file paths and line numbers. Do not hallucinate.`;

      const result = await exec("claude", claudeArgs(prompt, { maxTurns: 25 }), {
        cwd: repoRoot, shell: false, timeout: 600_000,
        onStdout: (chunk) => emitStream("research", chunk),
      });

      const response = result.exitCode === 0 ? result.stdout.trim() : `Error: ${result.stderr}`;
      history.push({ role: "assistant", content: response, timestamp: new Date().toISOString() });
      saveHistory();
      logActivity("research_complete", response.slice(0, 80));
      return response;
    } finally {
      isRunning = false;
    }
  }

  // ── Structured Output Parser ───────────────────────────────────────

  function parseStructuredOutput(rawText) {
    const result = { status: "yellow", findings: [], summary: "", narrative: rawText };
    if (!rawText) return result;

    const jsonMatch = rawText.match(/```json\s*\n?([\s\S]*?)```/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1].trim());
        if (parsed.status) result.status = parsed.status;
        if (Array.isArray(parsed.findings)) result.findings = parsed.findings;
        if (parsed.summary) result.summary = parsed.summary;
        result.narrative = rawText.replace(/```json[\s\S]*?```/, "").trim();
      } catch {}
    }

    if (!result.findings.length && !jsonMatch) {
      if (/critical|breach|data loss|production down/i.test(rawText)) result.status = "red";
      else if (/warning|risk|gap|vuln|fail/i.test(rawText)) result.status = "yellow";
      else result.status = "green";
    }

    return result;
  }

  // ── Memory ─────────────────────────────────────────────────────────

  function addMemory(type, content) {
    memories.push({ type, content, createdAt: new Date().toISOString() });
    saveMemory();
    return memories;
  }

  function getMemories() { return [...memories]; }

  function removeMemory(index) {
    if (index >= 0 && index < memories.length) {
      memories.splice(index, 1);
      saveMemory();
    }
    return memories;
  }

  function clearMemories() {
    memories = [];
    store?.delete(STORE_MEMORY);
  }

  // ── Getters ────────────────────────────────────────────────────────

  function getHistory() { return [...history]; }

  function clearHistory() {
    history.length = 0;
    store?.delete(STORE_HISTORY);
  }

  function getStatus() {
    return { isRunning, historyLength: history.length, memoryCount: memories.length };
  }

  return {
    chat, audit, research,
    addMemory, getMemories, removeMemory, clearMemories,
    getHistory, clearHistory, getStatus,
  };
}

module.exports = { createAgent, onStream, onActivity, FOCUS_AREAS };
