/**
 * AI-powered vehicle diagnosis endpoint.
 *
 * Pulls live readings from the truck-engine sensor, then sends them to
 * Claude for mechanic-grade analysis. Returns the diagnosis as text.
 *
 * POST /api/ai-diagnose
 * Body: { readings: {...} }  — pass the current readings directly
 */

import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY not configured" },
      { status: 500 }
    );
  }

  let body: { readings: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const readings = body.readings;
  if (!readings) {
    return NextResponse.json({ error: "Missing 'readings' in body" }, { status: 400 });
  }

  const readingsText = JSON.stringify(readings, null, 2);

  // Fetch historical data for diagnosis context
  let historyText = "";
  try {
    const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000";
    const histResp = await fetch(`${baseUrl}/api/truck-history?hours=168`, { cache: "no-store" });
    if (histResp.ok) {
      const hist = await histResp.json();
      if (hist.totalPoints > 0) {
        historyText = `\n\nHISTORICAL DATA (last ${hist.totalMinutes} minutes, ${hist.totalPoints} readings from Viam Cloud):\n${JSON.stringify(hist.summary, null, 2)}\nDTC events during period: ${hist.dtcEvents?.length > 0 ? hist.dtcEvents.map((e: { code: string; timestamp: string }) => `${e.code} at ${e.timestamp}`).join(", ") : "none"}`;
      }
    }
  } catch { /* historical data is optional */ }

  const prompt = `You are an AI diagnostic partner for mechanics and fleet managers. You're looking at live vehicle data streamed from a CAN bus sensor, along with historical trend data from the past few hours stored in Viam Cloud. Think of yourself as a knowledgeable colleague helping work through a diagnosis — not an oracle declaring what's wrong.

IMPORTANT: You have both live readings AND historical min/avg/max data. Use the historical data to identify trends — is a temperature rising over time? Are fuel trims getting worse? Compare current values to the historical average. The person reading this knows more about this specific vehicle than you do. A trouble code has many possible causes — present them as possibilities ranked by likelihood, not certainties.

Analyze this data and provide:

1. **DATA SUMMARY** — What's this vehicle telling us right now? Summarize the key readings in plain English — what looks normal, what stands out, what needs a closer look.

2. **ACTIVE TROUBLE CODES** — If any DTCs are present (look for active_dtc_count > 0 and obd2_dtc_* fields), for each code:
   - What the code means in plain English
   - The 3-4 most likely causes, ranked by probability
   - Severity (critical/warning/minor)
   - Estimated repair cost range for each likely cause
   - Can it wait or needs immediate attention?
   - What questions you'd ask the mechanic before diagnosing further ("Has this code come back after a recent repair?" "How long has the light been on?" "Any recent work on the exhaust or O2 sensors?")

3. **ENGINE HEALTH ASSESSMENT** — Based on the live readings:
   - Are temperatures normal? (coolant, oil, intake, catalyst)
   - Are pressures normal? (oil, fuel, manifold, barometric)
   - Are fuel trims within spec? (short-term should be ±10%, long-term ±10%)
   - Is battery voltage healthy? (should be 13.5-14.5V running)
   - Any readings that suggest a developing problem?
   - Note: some readings may look off during warmup, after repairs, or under specific conditions — flag these rather than diagnosing from them.

4. **WHAT I'D WANT TO KNOW** — List 3-5 questions you'd ask the mechanic or driver to complete your diagnosis. Things the data can't tell you.

5. **MAINTENANCE RECOMMENDATIONS** — Based on what you see:
   - Immediate (do now)
   - Soon (within 2 weeks)
   - At next service

6. **FLEET NOTE** — If this were one truck in a fleet of 36, what would you flag for the fleet manager?

Keep it conversational but professional. A head mechanic is reading this — treat them as a colleague, not a customer. They may have already done good work on this vehicle that explains what you're seeing in the data. Be specific about numbers. Present possibilities, not certainties.

ETHICAL BOUNDARIES: Do NOT make safety judgments ("safe to drive" / "unsafe"). That is the mechanic's professional decision. You analyze data — they make the call. Do NOT second-guess previous work without full context.

Here is the live vehicle data:
${readingsText}
${historyText}`;

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
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return NextResponse.json(
        { error: "Claude API error", details: errText },
        { status: 502 }
      );
    }

    const result = await response.json();
    const diagnosis = result.content?.[0]?.text || "No diagnosis generated";

    // Log diagnosis to cloud for analysis
    const logEntry = {
      type: "ai_full_diagnosis",
      timestamp: new Date().toISOString(),
      diagnosis: diagnosis.substring(0, 3000),
      active_dtcs: Object.entries(readings)
        .filter(([k]) => k.startsWith("obd2_dtc_"))
        .map(([, v]) => v),
      active_dtc_count: readings.active_dtc_count || 0,
      engine_rpm: readings.engine_rpm,
      coolant_temp_f: readings.coolant_temp_f,
      protocol: readings._protocol || "unknown",
    };
    console.log("[AI-DIAGNOSIS-LOG]", JSON.stringify(logEntry));

    return NextResponse.json({ success: true, diagnosis });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to reach Claude API", message: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
