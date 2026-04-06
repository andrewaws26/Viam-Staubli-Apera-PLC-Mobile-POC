/**
 * AI Prompt Completeness & Guardrail Tests
 *
 * These tests verify that the AI prompt templates in the API routes
 * contain all required sections, data references, and safety guardrails.
 * They work by reading the route source files and checking for required
 * string patterns — NO Claude API calls, fully deterministic.
 *
 * WHY THIS MATTERS:
 * The AI prompts are the most important part of the diagnostic system.
 * If someone edits a prompt and accidentally removes the aftertreatment
 * knowledge section, Claude won't know how SCR/DPF/DEF systems work.
 * If a guardrail phrase is removed, Claude might make unsafe statements.
 * These tests catch those regressions automatically.
 *
 * HOW IT WORKS:
 * 1. Reads the source code of each route file
 * 2. Checks that required string patterns exist in the prompt templates
 * 3. No mocking, no API calls, no network — just string pattern matching
 *
 * WHEN TO UPDATE:
 * - Added a new data field the AI should reference? Add a pattern check.
 * - Added new domain knowledge to the prompt? Add a content check.
 * - Added a new guardrail rule? Add it to the guardrails section.
 *
 * HOW TO RUN: cd dashboard && npx vitest run tests/unit/ai-prompt-completeness.test.ts
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// ── Read route source files ───────────────────────────────────────
// We read the actual TypeScript source to verify prompt content.
// This is intentionally source-level testing — we want to catch
// prompt changes in code review, not at runtime.

const DASHBOARD_ROOT = resolve(__dirname, "../..");

const chatRouteSource = readFileSync(
  resolve(DASHBOARD_ROOT, "app/api/ai-chat/route.ts"),
  "utf-8"
);

const diagnoseRouteSource = readFileSync(
  resolve(DASHBOARD_ROOT, "app/api/ai-diagnose/route.ts"),
  "utf-8"
);

// ── Aftertreatment Domain Knowledge ───────────────────────────────
// Both prompts MUST contain these concepts for accurate J1939 truck diagnosis.

const AFTERTREATMENT_CONCEPTS = [
  { pattern: "SCR", label: "Selective Catalytic Reduction system" },
  { pattern: "DEF", label: "Diesel Exhaust Fluid" },
  { pattern: "DPF", label: "Diesel Particulate Filter" },
  { pattern: "inducement", label: "EPA inducement stages" },
  { pattern: "sensor", label: "Sensor signal references" },
  { pattern: "NOx", label: "NOx sensor system" },
  { pattern: "Protect Lamp", label: "Protect Lamp behavior" },
  { pattern: "dosing", label: "DEF dosing system" },
  { pattern: "regen", label: "DPF regeneration" },
  { pattern: "soot", label: "DPF soot load" },
] as const;

describe("ai-chat prompt: aftertreatment knowledge", () => {
  for (const { pattern, label } of AFTERTREATMENT_CONCEPTS) {
    it(`includes ${label} (${pattern})`, () => {
      expect(chatRouteSource).toContain(pattern);
    });
  }
});

describe("ai-diagnose prompt: aftertreatment knowledge", () => {
  for (const { pattern, label } of AFTERTREATMENT_CONCEPTS) {
    it(`includes ${label} (${pattern})`, () => {
      expect(diagnoseRouteSource).toContain(pattern);
    });
  }
});

// ── J1939 Per-ECU DTC Field References ────────────────────────────
// The AI prompts MUST explain how per-ECU DTCs are structured in the
// readings dict. Without this, Claude can't find DTCs from specific ECUs.

describe("ai-diagnose prompt: per-ECU DTC field naming", () => {
  it("explains dtc_{ecu}_{i}_spn/fmi naming convention", () => {
    // The diagnose prompt must teach Claude how to find per-ECU DTCs
    expect(diagnoseRouteSource).toMatch(/dtc_\{?ecu\}?.*spn/i);
    expect(diagnoseRouteSource).toContain("fmi");
  });

  it("references specific ECU types", () => {
    for (const ecu of ["engine", "trans", "abs", "acm"]) {
      expect(diagnoseRouteSource).toContain(ecu);
    }
  });

  it("mentions dtc count fields", () => {
    expect(diagnoseRouteSource).toMatch(/dtc_.*count/);
  });
});

// ── Data Injection Points ─────────────────────────────────────────
// Both routes inject live readings and history into the prompt.
// If these injection points are removed, Claude gets no data.

describe("ai-chat route: data injection", () => {
  it("injects live readings as JSON", () => {
    expect(chatRouteSource).toContain("readingsText");
    expect(chatRouteSource).toContain("JSON.stringify");
  });

  it("injects historical data summary", () => {
    expect(chatRouteSource).toContain("history.text");
    expect(chatRouteSource).toContain("getAiHistorySummary");
  });

  it("injects diagnostic notes from pre-processing", () => {
    expect(chatRouteSource).toContain("diagnosticText");
    expect(chatRouteSource).toContain("runDiagnostics");
    expect(chatRouteSource).toContain("formatDiagnosticNotes");
  });

  it("injects DTC history from client-side localStorage", () => {
    expect(chatRouteSource).toContain("_dtc_history_text");
  });
});

describe("ai-diagnose route: data injection", () => {
  it("injects live readings as JSON", () => {
    expect(diagnoseRouteSource).toContain("readingsText");
    expect(diagnoseRouteSource).toContain("JSON.stringify");
  });

  it("injects historical data summary", () => {
    expect(diagnoseRouteSource).toContain("history.text");
    expect(diagnoseRouteSource).toContain("getAiHistorySummary");
  });

  it("injects diagnostic notes from pre-processing", () => {
    expect(diagnoseRouteSource).toContain("diagnosticText");
    expect(diagnoseRouteSource).toContain("runDiagnostics");
  });

  it("injects DTC history from client-side localStorage", () => {
    expect(diagnoseRouteSource).toContain("_dtc_history_text");
  });
});

// ── Safety Guardrails ─────────────────────────────────────────────
// These phrases MUST be in both prompts. They prevent Claude from
// making safety/liability judgments that belong to the mechanic.
// Removing any of these is a regression.

const GUARDRAIL_PHRASES = [
  { pattern: "NEVER make safety judgments", label: "no safety judgments" },
  { pattern: "mechanic's", label: "defers to mechanic" },
  { pattern: "COULD indicate", label: "uses possibility language" },
  { pattern: "not a decision-maker", label: "AI is not a decision-maker" },
  { pattern: "NEVER suggest that previous work was wrong", label: "no blaming previous mechanic" },
] as const;

describe("ai-chat prompt: safety guardrails", () => {
  for (const { pattern, label } of GUARDRAIL_PHRASES) {
    it(`contains guardrail: ${label}`, () => {
      expect(chatRouteSource).toContain(pattern);
    });
  }
});

describe("ai-diagnose prompt: safety guardrails", () => {
  it("contains no-safety-judgment guardrail", () => {
    // Diagnose prompt uses slightly different wording
    expect(diagnoseRouteSource).toMatch(/NOT make safety judgments|NEVER.*safe.*drive/i);
  });

  it("uses possibility language", () => {
    expect(diagnoseRouteSource).toMatch(/possibilit|could|ranked by likelihood/i);
  });

  it("defers to mechanic expertise", () => {
    expect(diagnoseRouteSource).toMatch(/mechanic.*decision|mechanic.*call/i);
  });
});

// ── Vehicle History Notes ─────────────────────────────────────────
// Both prompts should reference the known Mack Granite issues.
// This is fleet-specific context that improves diagnosis accuracy.

describe("fleet-specific context", () => {
  it("ai-chat includes Mack Granite VIN", () => {
    expect(chatRouteSource).toContain("1M2GR4GC7RM039830");
  });

  it("ai-diagnose includes Mack Granite VIN", () => {
    expect(diagnoseRouteSource).toContain("1M2GR4GC7RM039830");
  });

  it("ai-chat mentions B&B Metals fleet", () => {
    expect(chatRouteSource).toContain("B&B Metals");
  });

  it("ai-chat mentions in-house repairs", () => {
    expect(chatRouteSource).toContain("in-house");
  });
});

// ── Claude API Configuration ──────────────────────────────────────
// Verify the routes use appropriate model and token limits.

describe("Claude API configuration", () => {
  it("ai-chat uses claude-sonnet model", () => {
    expect(chatRouteSource).toMatch(/claude-sonnet/);
  });

  it("ai-diagnose uses claude-sonnet model", () => {
    expect(diagnoseRouteSource).toMatch(/claude-sonnet/);
  });

  it("ai-chat has max_tokens set", () => {
    expect(chatRouteSource).toContain("max_tokens");
  });

  it("ai-diagnose has max_tokens set", () => {
    expect(diagnoseRouteSource).toContain("max_tokens");
  });

  it("both routes check for ANTHROPIC_API_KEY", () => {
    expect(chatRouteSource).toContain("ANTHROPIC_API_KEY");
    expect(diagnoseRouteSource).toContain("ANTHROPIC_API_KEY");
  });
});

// ── Debug Mode ────────────────────────────────────────────────────
// Both routes support ?debug=1 for prompt inspection without API calls.
// This is critical for testing and prompt development.

describe("debug mode", () => {
  it("ai-chat supports debug=1 query param", () => {
    expect(chatRouteSource).toContain('debug');
    expect(chatRouteSource).toContain("diagnosticNotes");
  });

  it("ai-diagnose supports debug=1 query param", () => {
    expect(diagnoseRouteSource).toContain('debug');
    expect(diagnoseRouteSource).toContain("diagnosticNotes");
  });
});

// ── Logging ───────────────────────────────────────────────────────
// Conversations are logged for prompt refinement. These logs are how
// we improve the system over time.

describe("conversation logging", () => {
  it("ai-chat logs conversations", () => {
    expect(chatRouteSource).toContain("[AI-CHAT-LOG]");
  });

  it("ai-diagnose logs diagnoses", () => {
    expect(diagnoseRouteSource).toContain("[AI-DIAGNOSIS-LOG]");
  });

  it("ai-chat captures J1939 per-ECU DTCs in logs", () => {
    // The log should capture DTCs from all ECU sources, not just OBD-II
    // Chat route uses a regex pattern to match per-ECU DTC fields
    expect(chatRouteSource).toMatch(/dtc_/);
  });
});

// ── Response Structure ────────────────────────────────────────────
// Verify the routes return consistent response shapes.

describe("response structure", () => {
  it("ai-chat returns { success, reply } on success", () => {
    expect(chatRouteSource).toContain("success: true");
    expect(chatRouteSource).toContain("reply");
  });

  it("ai-diagnose returns { success, diagnosis } on success", () => {
    expect(diagnoseRouteSource).toContain("success: true");
    expect(diagnoseRouteSource).toContain("diagnosis");
  });

  it("both routes return 502 on Claude API failure", () => {
    expect(chatRouteSource).toContain("502");
    expect(diagnoseRouteSource).toContain("502");
  });

  it("both routes return 400 on invalid input", () => {
    expect(chatRouteSource).toContain("400");
    expect(diagnoseRouteSource).toContain("400");
  });
});
