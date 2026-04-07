import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth-guard";

const SYSTEM_PROMPT = `You are an expert heavy-duty truck mechanic with deep knowledge of Mack/Volvo diesel engines, J1939 diagnostics, aftertreatment systems (DPF/SCR/DEF), and general fleet maintenance procedures.

Given a work order title and optional description/DTCs, generate a practical step-by-step checklist a shop mechanic would follow. Each step should be:
- Concise (under 60 characters ideally, 80 max)
- Actionable (starts with a verb: Check, Inspect, Replace, Measure, etc.)
- Ordered logically (diagnosis before repair, easy checks before teardown)
- Between 4 and 12 steps total

Return ONLY a JSON array of strings. No explanation, no markdown, no wrapping.

Example input: "DPF regen keeps aborting"
Example output: ["Read all active DTCs from engine ECM","Check DPF inlet temp sensor reading","Check DPF outlet temp sensor reading","Inspect 7th injector for coking","Verify exhaust back pressure is in range","Check DEF dosing valve operation","Attempt forced regen with scan tool","Monitor soot load during regen","Clear codes and road test"]`;

export async function POST(request: NextRequest) {
  const denied = await requireRole("/api/ai-suggest-steps");
  if (denied) return denied;

  let body: { title: string; description?: string; dtcs?: { spn: number; fmi: number }[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.title?.trim()) {
    return NextResponse.json({ error: "Missing title" }, { status: 400 });
  }

  let userMessage = `Work order: "${body.title.trim()}"`;
  if (body.description?.trim()) {
    userMessage += `\nDescription: ${body.description.trim()}`;
  }
  if (body.dtcs && body.dtcs.length > 0) {
    const dtcList = body.dtcs.map((d) => `SPN ${d.spn} / FMI ${d.fmi}`).join(", ");
    userMessage += `\nActive DTCs: ${dtcList}`;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "AI not configured" }, { status: 503 });
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 500,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("[AI-SUGGEST-STEPS] API error:", response.status, err);
      throw new Error(`API ${response.status}`);
    }

    const data = await response.json();
    const text = data.content?.[0]?.text ?? "";

    const steps: string[] = JSON.parse(text);
    if (!Array.isArray(steps) || steps.some((s: unknown) => typeof s !== "string")) {
      throw new Error("Invalid response format");
    }

    console.log("[AI-SUGGEST-STEPS]", { title: body.title, stepCount: steps.length });
    return NextResponse.json({ steps });
  } catch (err) {
    console.error("[AI-SUGGEST-STEPS]", err);
    return NextResponse.json(
      { error: "Failed to generate steps" },
      { status: 502 },
    );
  }
}
