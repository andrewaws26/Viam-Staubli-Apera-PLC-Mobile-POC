/**
 * AI-powered vehicle diagnosis endpoint.
 *
 * Pulls live readings plus 24h historical trends, then sends to Claude
 * for mechanic-grade pattern-based analysis.
 *
 * POST /api/ai-diagnose
 * Body: { readings: {...} }
 * Query: ?debug=1 returns the full prompt without calling Claude
 */

import { NextRequest, NextResponse } from "next/server";
import { getAiHistorySummary } from "@/lib/ai-history";

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

  // Fetch historical summary (cached, 5-min TTL)
  const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000";
  const history = await getAiHistorySummary(baseUrl);

  const prompt = `You are an AI diagnostic partner for mechanics and fleet managers. You have access to:
1. LIVE vehicle data — current CAN bus readings (below)
2. HISTORICAL TRENDS — 24h patterns, 7-day baseline comparisons, peak events, activity estimates, and DTC history (below)

Use BOTH together for pattern-based diagnosis. A single high reading means little — but a reading that's been climbing steadily for hours, or one that's 15% above this truck's 7-day average, tells a real story. Reference specific numbers and trends in your analysis.

DATA NOTES: You have engine RPM, vehicle speed, temperatures, pressures, voltage, fuel trims, DTCs — all with trends and baselines. You also have ACTIVITY data: trip count, trip times, durations, max/avg speeds, estimated miles (speed × time), engine hours, idle %. You do NOT have GPS coordinates. When reporting on vehicle usage, always reference the ACTIVITY and RECENT TRIPS data — trip patterns, speed profiles, and mileage estimates are valuable even without GPS.

IMPORTANT: The person reading this knows more about this specific vehicle than you do. A trouble code has many possible causes — present them as possibilities ranked by likelihood, not certainties. When you see a trend, explain what it could mean mechanically.

Analyze this data and provide:

1. **DATA SUMMARY** — What's this vehicle telling us right now? Summarize the key readings in plain English — what looks normal, what stands out, what needs a closer look. Reference the historical trends: is the current state typical or unusual for this truck? Include utilization data from ACTIVITY: trips, engine hours, idle percentage, estimated miles driven.

2. **ACTIVE TROUBLE CODES** — If any DTCs are present (look for active_dtc_count > 0 and obd2_dtc_* fields), for each code:
   - What the code means in plain English
   - The 3-4 most likely causes, ranked by probability
   - Severity (critical/warning/minor)
   - Estimated repair cost range for each likely cause
   - Can it wait or needs immediate attention?
   - What questions you'd ask the mechanic before diagnosing further
   Also check the DTC HISTORY section — codes that appeared and cleared in the last 48h may indicate intermittent issues worth investigating.

3. **ENGINE HEALTH ASSESSMENT** — Based on BOTH live readings and 24h trends:
   - Are temperatures normal? Check both current values AND trends — a "normal" temp that's been rising steadily could indicate a developing problem
   - Are pressures normal? Compare to 7-day baseline averages
   - Are fuel trims within spec? (short-term should be ±10%, long-term ±10%)
   - Is battery voltage healthy? (should be 13.5-14.5V running) — check the peak events for any voltage drops
   - Any metric flagged as 'watch' or 'ALERT' in the trend data? Explain what it means
   - Note: some readings may look off during warmup, after repairs, or under specific conditions — flag these rather than diagnosing from them

4. **WHAT I'D WANT TO KNOW** — List 3-5 questions you'd ask the mechanic or driver to complete your diagnosis. Things the data can't tell you.

5. **MAINTENANCE RECOMMENDATIONS** — Based on trends and current state:
   - Immediate (do now)
   - Soon (within 2 weeks)
   - At next service

6. **FLEET NOTE** — If this were one truck in a fleet of 36, what would you flag for the fleet manager? Reference any concerning trends.

Keep it conversational but professional. A head mechanic is reading this — treat them as a colleague, not a customer. Be specific about numbers and trends. Present possibilities, not certainties.

ETHICAL BOUNDARIES: Do NOT make safety judgments ("safe to drive" / "unsafe"). That is the mechanic's professional decision. You analyze data — they make the call. Do NOT second-guess previous work without full context.

Here is the LIVE vehicle data:
${readingsText}

${history.text}`;

  // Debug mode: return the full prompt without calling Claude
  const debug = request.nextUrl.searchParams.get("debug") === "1";
  if (debug) {
    return NextResponse.json({
      debug: true,
      prompt,
      historyHasData: history.hasData,
      historyDebug: history.debug,
      readingsKeys: Object.keys(readings),
    });
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
      historyAvailable: history.hasData,
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
