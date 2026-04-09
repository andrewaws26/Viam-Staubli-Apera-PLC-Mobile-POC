const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ironsight", {
  getWorkflows: () => ipcRenderer.invoke("get-workflows"),
  getRuns: (workflowId) => ipcRenderer.invoke("get-runs", workflowId),
  triggerWorkflow: (id, input) => ipcRenderer.invoke("trigger-workflow", id, input),
  runClaude: (prompt) => ipcRenderer.invoke("run-claude", prompt),
  cancelRun: (runId) => ipcRenderer.invoke("cancel-run", runId),
  getStatus: () => ipcRenderer.invoke("get-status"),

  // Events from main process
  onRunOutput: (cb) => ipcRenderer.on("run-output", (_, data) => cb(data)),
  onRunStarted: (cb) => ipcRenderer.on("run-started", (_, data) => cb(data)),
  onRunCompleted: (cb) => ipcRenderer.on("run-completed", (_, data) => cb(data)),
  onQuickResult: (cb) => ipcRenderer.on("quick-result", (_, data) => cb(data)),
  onOpenClaudePrompt: (cb) => ipcRenderer.on("open-claude-prompt", () => cb()),
});
