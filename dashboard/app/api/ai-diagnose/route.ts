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

  const prompt = `You are a master ASE-certified diesel and automotive mechanic with 30 years of experience. You are looking at live diagnostic data from a vehicle's CAN bus, pulled remotely via a cloud-connected IoT sensor.

Analyze this data and provide:

1. **VEHICLE STATUS** — Is this vehicle safe to drive right now? One clear sentence.

2. **ACTIVE TROUBLE CODES** — If any DTCs are present (look for active_dtc_count > 0 and obd2_dtc_* fields), explain each code in plain English:
   - What the code means
   - What's likely causing it
   - Severity (critical/warning/minor)
   - Estimated repair cost range
   - Can it wait or needs immediate attention?

3. **ENGINE HEALTH ASSESSMENT** — Based on the live readings:
   - Are temperatures normal? (coolant, oil, intake, catalyst)
   - Are pressures normal? (oil, fuel, manifold, barometric)
   - Are fuel trims within spec? (short-term should be ±10%, long-term ±10%)
   - Is battery voltage healthy? (should be 13.5-14.5V running)
   - Any readings that suggest a developing problem?

4. **MAINTENANCE RECOMMENDATIONS** — Based on what you see, what should be done?
   - Immediate (do now)
   - Soon (within 2 weeks)
   - At next service

5. **FLEET NOTE** — If this were one truck in a fleet of 36, what would you flag for the fleet manager?

Keep it conversational but professional. A head mechanic is reading this. Don't dumb it down but don't use unnecessary jargon either. Be specific about numbers — reference the actual values you see in the data.

Here is the live vehicle data:
${readingsText}`;

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

    return NextResponse.json({ success: true, diagnosis });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to reach Claude API", message: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
