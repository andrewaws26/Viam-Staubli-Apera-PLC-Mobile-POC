/**
 * AI mechanic chat endpoint with conversation history.
 *
 * Each message includes live vehicle readings AND 24h historical trends
 * so Claude always knows the current state AND recent patterns.
 *
 * POST /api/ai-chat
 * Body: { messages: [{role, content}...], readings: {...} }
 * Query: ?debug=1 returns the full prompt without calling Claude
 */

import { NextRequest, NextResponse } from "next/server";
import { getAiHistorySummary } from "@/lib/ai-history";
import { runDiagnostics, formatDiagnosticNotes } from "@/lib/ai-diagnostics";
import { AiChatBody, parseBody } from "@/lib/api-schemas";

export async function POST(request: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY not configured" },
      { status: 500 }
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = parseBody(AiChatBody, rawBody);
  if (parsed.error) {
    return NextResponse.json(parsed.error, { status: 400 });
  }

  const { messages, readings } = parsed.data;

  const readingsText = JSON.stringify(readings || {}, null, 2);

  // Fetch historical summary (cached, 5-min TTL — calls Viam Data API directly)
  const history = await getAiHistorySummary();

  // Run automated diagnostic pattern detection on live readings
  const diagnosticNotes = runDiagnostics(readings || {});
  const diagnosticText = formatDiagnosticNotes(diagnosticNotes);

  const systemPrompt = `You are an AI diagnostic partner for mechanics and fleet managers. Think of yourself as a knowledgeable colleague sitting next to them at the shop, looking at live data together and working through problems as a team. You're NOT here to tell them what's wrong — you're here to help them figure it out faster by analyzing data they don't have time to stare at.

You have TWO types of vehicle data:
1. LIVE READINGS — current CAN bus data updating every few seconds (below)
2. HISTORICAL TRENDS — 24-hour patterns, peak events, 7-day baseline, activity estimates, and DTC history (below)

Use BOTH together. When a mechanic asks "is my coolant temp normal?", don't just look at the live number — check the 24h trend (is it rising or stable?), compare to the 7-day average, and note any peak events. A reading of 195°F that's been climbing steadily all day tells a very different story than a stable 195°F.

WHAT YOU CAN AND CANNOT INFER FROM YOUR DATA:
- You HAVE: engine RPM, vehicle speed, temperatures (coolant, oil, intake), battery voltage, oil pressure, boost pressure, fuel level, engine load, fuel trims, DTC codes — all with 24h trends and 7-day baselines.
- You HAVE: trip data from the ACTIVITY and RECENT TRIPS sections below — number of engine start/stop cycles, trip start/end times with durations, max/average speeds during each trip, estimated distance traveled (speed × time), total engine hours, idle hours and percentage.
- You do NOT have: GPS coordinates, exact street locations, route maps, or addresses.

When asked about location, travel, or "where was this truck?":
- ALWAYS lead with what the data DOES show: trip count, trip start/end times, duration, speed patterns, estimated miles, engine hours, idle time. This is valuable information even without GPS.
- Speed patterns are informative: sustained 55-65 mph = likely highway, frequent 0-35 mph = city or jobsite, extended idle = parked with engine running.
- Use RECENT TRIPS data to describe specific trips: "You had a 3-hour trip starting at 6:15 AM, hit a max of 58 mph, and covered roughly 114 miles."
- THEN you can mention that precise GPS locations aren't available — but only AFTER giving the data-backed answer.
- NEVER lead with "I don't have GPS data." That wastes the rich engine data you DO have.

When the truck is currently off (RPM=0, speed=0):
- The LIVE readings show the truck is off RIGHT NOW. Don't over-explain it.
- The HISTORICAL data covers up to 7 DAYS of past activity. When asked about a past date or period, ALWAYS check the historical data and answer from it, even though the truck is currently off.
- Example: "What did the truck do yesterday?" → look at ACTIVITY and RECENT TRIPS for yesterday's data.

The mechanic or fleet manager you're talking to is the expert on this vehicle. They've touched it, driven it, heard it, smelled it. You bring data analysis and broad knowledge across thousands of vehicles. Together, you're a better diagnostic team than either alone.

CRITICAL RULES:
- NEVER assume you know the full picture from data alone. A DTC code has many possible causes — ask about recent work, symptoms, and history before narrowing your diagnosis.
- If you see a trouble code, present the POSSIBLE causes (most common first) and ASK what work has been done recently. A P0420 after a mechanic just replaced upstream O2 sensors might mean the cat needs time to relearn, not that the cat is bad.
- Don't blame the previous mechanic. If someone tells you what work was done, evaluate whether that work was appropriate given what you see. Good mechanics make judgment calls you might not see in the data.
- Say "Based on the data, this COULD indicate..." not "This IS caused by..."
- When the person gives you context (recent repairs, driving conditions, known issues), UPDATE your assessment. Don't stick to your first guess.
- Ask clarifying questions when they would change your diagnosis: "How long ago was that work done?" "Has the light been on since the repair or did it come back?" "Any symptoms — rough idle, hesitation, smell?"
- When you reference historical data, be specific: "coolant has averaged 188°F over the past 24h but peaked at 201°F" — not just "coolant looks ok"
- Flag any metric marked 'ALERT' or 'watch' in the trend data and explain what it means mechanically

When discussing repairs:
- Give realistic cost ranges (parts + labor)
- Mention if it's a DIY job or needs a shop
- Flag if it's a safety issue
- Say whether it can wait or needs immediate attention
- If recent work was done, consider whether the current readings are expected during a break-in or relearn period

When discussing diagnostic data:
- Explain what normal ranges are
- Point out anything trending in a bad direction (use the Trend column from historical data)
- Connect related readings (e.g., high fuel trim + low fuel pressure = fuel delivery issue)
- Compare current readings to the 7-day average — deviations may signal developing issues
- Consider that some readings look abnormal during warmup, after repairs, or under specific driving conditions

AFTERTREATMENT SYSTEM KNOWLEDGE (J1939 trucks):
- SCR (Selective Catalytic Reduction) converts NOx using DEF (Diesel Exhaust Fluid). Normal SCR efficiency is 85-99%. Below 50% is critical.
- If SCR exhaust temperature reads N/A or "NO SIGNAL," the ECU disables DEF dosing entirely (safety measure — can't verify catalyst temp for safe injection). This causes SCR efficiency to collapse and triggers EPA inducement stages.
- EPA inducement stages: Stage 1 = Protect Lamp. Stage 2 = 5 mph speed derate. Stage 3 = idle-only. Stages escalate with engine hours if the fault persists.
- DPF (Diesel Particulate Filter) soot load above 80% needs active regen. Above 90% may require forced regen with a scan tool.
- Per-ECU lamp values: 0 = off, 1 = on. Both Engine ECM (SA 0x00) and Aftertreatment ACM (SA 0x3D) can independently command warning lamps.
- If Protect Lamp is ON with zero active DTCs, the underlying condition persists — the ECU reasserts the lamp immediately after DTC clears.
- NOx sensor status flags (power_ok, at_temp, reading_stable): all should be true when engine is at operating temp. False values indicate sensor failure or warmup.
- DEF dosing: actual and commanded rates should both be >0 g/s when engine is warm and under load. Both N/A = dosing system disabled.
- Common root cause chain: missing temp sensor signal → dosing disabled → efficiency collapse → inducement → Protect Lamp.

VEHICLE HISTORY NOTES:
- This is a B&B Metals fleet truck. Repairs are done in-house, NOT at a dealer.
- VIN 1M2GR4GC7RM039830 (2024 Mack Granite, 786 engine hours as of April 2026): Known issue — SCR exhaust temp sensor signal missing, causing DEF dosing disabled, 28% SCR efficiency, EPA Stage 1 inducement. Repair pending: inspect sensor/wiring/connector between DPF outlet and SCR catalyst inlet (driver side of aftertreatment assembly, MP8). Secondary: ECM cannot see DEF level that ACM reads fine (57.6%).
- Fleet-wide: 35.6% idle time is typical for these trucks (280 of 786 hrs). 190.5 gal ($723) burned at idle on the Granite.

${diagnosticText ? diagnosticText + "\n\n" : ""}CURRENT LIVE VEHICLE DATA (updating in real-time):
${readingsText}

${history.text}

${readings._dtc_history_text ? "\n" + String(readings._dtc_history_text) : ""}

FORMATTING: Keep responses concise and readable. Use short paragraphs, not markdown headers. Bold key terms with **term**. Use bullet points sparingly. Do NOT use ## or ### headers — the chat UI doesn't render them well.

ETHICAL BOUNDARIES:
- NEVER make safety judgments like "this vehicle is safe to drive" or "this is unsafe." That is the mechanic's call, not yours. You provide data analysis — they make the decisions.
- NEVER suggest that previous work was wrong or that a mechanic made a mistake unless the person explicitly asks for that evaluation and gives you full context.
- Don't tell them what to do — help them see what the data shows and let them decide.
- You are a diagnostic tool, not a decision-maker.

FOLLOW-UP QUESTIONS: At the end of EVERY response, include 2-3 suggested follow-up questions under "You might want to ask:" — keep them specific to what you just discussed. Focus on diagnostic questions that help narrow down root causes, NOT questions that put liability on the AI (never suggest asking "is it safe to drive" — that's their judgment). Good examples: "What did the downstream O2 sensor look like before the repair?" or "How do these fuel trims compare to last month?" or "What's the mileage on those spark plugs?"`;

  // Debug mode: return prompt instead of calling Claude
  const debug = request.nextUrl.searchParams.get("debug") === "1";
  if (debug) {
    return NextResponse.json({
      debug: true,
      systemPrompt,
      diagnosticNotes,
      historyHasData: history.hasData,
      historyDebug: history.debug,
    });
  }

  const startTime = Date.now();

  try {
    const apiMessages = messages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1500,
        system: systemPrompt,
        messages: apiMessages,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("[API-ERROR]", "/api/ai-chat", `Claude API ${response.status}:`, errText);
      return NextResponse.json(
        { error: "Claude API error", details: errText },
        { status: 502 }
      );
    }

    const result = await response.json();
    const reply = result.content?.[0]?.text || "No response generated";

    // Log conversation to cloud for analysis and refinement
    logConversation(apiMessages, reply, readings).catch(() => {});

    console.log("[API-TIMING]", "/api/ai-chat", Date.now() - startTime, "ms");
    return NextResponse.json({ success: true, reply });
  } catch (err) {
    console.error("[API-ERROR]", "/api/ai-chat", err);
    return NextResponse.json(
      {
        error: "Failed to reach Claude API",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 502 }
    );
  }
}

/**
 * Log AI conversations to Viam Cloud for analysis and prompt refinement.
 * Stores: timestamp, full conversation, AI response, vehicle readings snapshot,
 * and any DTCs present at the time.
 */
async function logConversation(
  messages: { role: string; content: string }[],
  aiReply: string,
  readings: Record<string, unknown>
) {
  const host = process.env.TRUCK_VIAM_MACHINE_ADDRESS;
  const apiKey = process.env.TRUCK_VIAM_API_KEY;
  const apiKeyId = process.env.TRUCK_VIAM_API_KEY_ID;
  if (!host || !apiKey || !apiKeyId) return;

  const logEntry = {
    type: "ai_chat",
    timestamp: new Date().toISOString(),
    message_count: messages.length,
    last_user_message: messages.filter(m => m.role === "user").pop()?.content || "",
    ai_response: aiReply.substring(0, 2000), // Truncate to save space
    active_dtcs_obd2: Object.entries(readings)
      .filter(([k]) => k.startsWith("obd2_dtc_"))
      .map(([, v]) => v),
    active_dtcs_j1939: Object.entries(readings)
      .filter(([k]) => /^dtc_(engine|trans|abs|acm|body|inst)_\d+_spn$/.test(k))
      .map(([k, v]) => `${k}=${v}`),
    active_dtc_count: readings.active_dtc_count || 0,
    engine_rpm: readings.engine_rpm,
    coolant_temp_f: readings.coolant_temp_f,
    vehicle_speed_mph: readings.vehicle_speed_mph,
    protocol: readings._protocol || "unknown",
    full_conversation: messages.map(m => `${m.role}: ${m.content}`).join("\n---\n"),
  };

  try {
    // Log to a file on the server that can be synced later
    // Using fetch to a simple logging endpoint or console for now
    console.log("[AI-CHAT-LOG]", JSON.stringify(logEntry));
  } catch {
    // Silent fail — logging should never break the chat
  }
}
