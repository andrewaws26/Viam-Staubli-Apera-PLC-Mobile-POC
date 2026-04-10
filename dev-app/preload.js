const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ironsight", {
  // ── Health ────────────────────────────────────────────
  getSystemHealth: () => ipcRenderer.invoke("get-system-health"),
  runSingleCheck: (id) => ipcRenderer.invoke("run-single-check", id),

  // ── Context & Feed ────────────────────────────────────
  getChangeFeed: () => ipcRenderer.invoke("get-change-feed"),
  getSmartContext: () => ipcRenderer.invoke("get-smart-context"),
  getPromptTemplates: () => ipcRenderer.invoke("get-prompt-templates"),

  // ── Smart Claude ──────────────────────────────────────
  runSmartClaude: (opts) => ipcRenderer.invoke("run-smart-claude", opts),

  // ── Agent ─────────────────────────────────────────────
  agentChat: (message, focus) => ipcRenderer.invoke("agent-chat", message, focus),
  agentAudit: (scope) => ipcRenderer.invoke("agent-audit", scope),
  agentResearch: (question) => ipcRenderer.invoke("agent-research", question),
  agentGetHistory: () => ipcRenderer.invoke("agent-get-history"),
  agentClearHistory: () => ipcRenderer.invoke("agent-clear-history"),
  agentGetStatus: () => ipcRenderer.invoke("agent-get-status"),

  // ── Agent Memory ──────────────────────────────────────
  agentGetMemory: () => ipcRenderer.invoke("agent-get-memory"),
  agentAddMemory: (type, content) => ipcRenderer.invoke("agent-add-memory", type, content),
  agentRemoveMemory: (index) => ipcRenderer.invoke("agent-remove-memory", index),
  agentClearMemory: () => ipcRenderer.invoke("agent-clear-memory"),

  // ── AutoFix ───────────────────────────────────────────
  autofixStatus: () => ipcRenderer.invoke("autofix-status"),
  autofixHistory: () => ipcRenderer.invoke("autofix-history"),
  autofixDiagnose: (checkId) => ipcRenderer.invoke("autofix-diagnose", checkId),
  autofixFix: (checkId) => ipcRenderer.invoke("autofix-fix", checkId),
  autofixMerge: (branch) => ipcRenderer.invoke("autofix-merge", branch),
  autofixDiscard: (branch) => ipcRenderer.invoke("autofix-discard", branch),
  autofixReset: (checkId) => ipcRenderer.invoke("autofix-reset", checkId),

  // ── Activity ───────────────────────────────────────────
  getAgentActivity: (limit) => ipcRenderer.invoke("get-agent-activity", limit),

  // ── Settings & Credentials ────────────────────────────
  getSettings: () => ipcRenderer.invoke("get-settings"),
  saveSettings: (settings) => ipcRenderer.invoke("save-settings", settings),
  getCredentials: () => ipcRenderer.invoke("get-credentials"),
  saveCredentials: (creds) => ipcRenderer.invoke("save-credentials", creds),

  // ── Workflows ─────────────────────────────────────────
  getWorkflows: () => ipcRenderer.invoke("get-workflows"),
  getRuns: (workflowId) => ipcRenderer.invoke("get-runs", workflowId),
  triggerWorkflow: (id, input) => ipcRenderer.invoke("trigger-workflow", id, input),
  runClaude: (prompt) => ipcRenderer.invoke("run-claude", prompt),
  cancelRun: (runId) => ipcRenderer.invoke("cancel-run", runId),
  getStatus: () => ipcRenderer.invoke("get-status"),

  // ── Events from main process ──────────────────────────
  onHealthUpdated: (cb) => ipcRenderer.on("health-updated", (_, data) => cb(data)),
  onRunOutput: (cb) => ipcRenderer.on("run-output", (_, data) => cb(data)),
  onRunStarted: (cb) => ipcRenderer.on("run-started", (_, data) => cb(data)),
  onRunCompleted: (cb) => ipcRenderer.on("run-completed", (_, data) => cb(data)),
  onNavigate: (cb) => ipcRenderer.on("navigate", (_, view) => cb(view)),
  onRefreshAll: (cb) => ipcRenderer.on("refresh-all", () => cb()),
  onAgentStream: (cb) => ipcRenderer.on("agent-stream", (_, data) => cb(data)),
  onAgentActivity: (cb) => ipcRenderer.on("agent-activity", (_, data) => cb(data)),
  onAutofixDiagnosed: (cb) => ipcRenderer.on("autofix-diagnosed", (_, data) => cb(data)),
  onAutofixStarted: (cb) => ipcRenderer.on("autofix-started", (_, data) => cb(data)),
  onAutofixProgress: (cb) => ipcRenderer.on("autofix-progress", (_, data) => cb(data)),
  onAutofixComplete: (cb) => ipcRenderer.on("autofix-complete", (_, data) => cb(data)),
});
