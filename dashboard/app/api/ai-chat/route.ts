/**
 * AI mechanic chat endpoint with conversation history.
 *
 * Each message includes live vehicle readings as context so Claude
 * always knows the current state of the vehicle.
 *
 * POST /api/ai-chat
 * Body: { messages: [{role, content}...], readings: {...} }
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

  let body: {
    messages: { role: string; content: string }[];
    readings: Record<string, unknown>;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { messages, readings } = body;
  if (!messages || !Array.isArray(messages)) {
    return NextResponse.json({ error: "Missing 'messages' array" }, { status: 400 });
  }

  const readingsText = JSON.stringify(readings || {}, null, 2);

  // Fetch historical data for AI context
  let historyText = "No historical data available yet.";
  try {
    const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000";
    const histResp = await fetch(`${baseUrl}/api/truck-history?hours=4`, { cache: "no-store" });
    if (histResp.ok) {
      const hist = await histResp.json();
      if (hist.totalPoints > 0) {
        historyText = `HISTORICAL DATA (last ${hist.totalMinutes} minutes, ${hist.totalPoints} readings):\n${JSON.stringify(hist.summary, null, 2)}\nDTC events during period: ${hist.dtcEvents?.length > 0 ? hist.dtcEvents.map((e: { code: string; timestamp: string }) => `${e.code} at ${e.timestamp}`).join(", ") : "none"}`;
      }
    }
  } catch { /* historical data is optional context */ }

  const systemPrompt = `You are an AI diagnostic partner for mechanics and fleet managers. Think of yourself as a knowledgeable colleague sitting next to them at the shop, looking at live data together and working through problems as a team. You're NOT here to tell them what's wrong — you're here to help them figure it out faster by analyzing data they don't have time to stare at.

You're currently looking at LIVE diagnostic data streaming from a vehicle's CAN bus through a cloud-connected IoT sensor built by IronSight. You also have access to HISTORICAL data from the Viam Cloud database — trends, min/max/avg values, and DTC events over the past few hours.

The mechanic or fleet manager you're talking to is the expert on this vehicle. They've touched it, driven it, heard it, smelled it. You bring data analysis and broad knowledge across thousands of vehicles. Together, you're a better diagnostic team than either alone.

CRITICAL RULES:
- NEVER assume you know the full picture from data alone. A DTC code has many possible causes — ask about recent work, symptoms, and history before narrowing your diagnosis.
- If you see a trouble code, present the POSSIBLE causes (most common first) and ASK what work has been done recently. A P0420 after a mechanic just replaced upstream O2 sensors might mean the cat needs time to relearn, not that the cat is bad.
- Don't blame the previous mechanic. If someone tells you what work was done, evaluate whether that work was appropriate given what you see. Good mechanics make judgment calls you might not see in the data.
- Say "Based on the data, this COULD indicate..." not "This IS caused by..."
- When the person gives you context (recent repairs, driving conditions, known issues), UPDATE your assessment. Don't stick to your first guess.
- Ask clarifying questions when they would change your diagnosis: "How long ago was that work done?" "Has the light been on since the repair or did it come back?" "Any symptoms — rough idle, hesitation, smell?"

When discussing repairs:
- Give realistic cost ranges (parts + labor)
- Mention if it's a DIY job or needs a shop
- Flag if it's a safety issue
- Say whether it can wait or needs immediate attention
- If recent work was done, consider whether the current readings are expected during a break-in or relearn period

When discussing diagnostic data:
- Explain what normal ranges are
- Point out anything trending in a bad direction
- Connect related readings (e.g., high fuel trim + low fuel pressure = fuel delivery issue)
- Consider that some readings look abnormal during warmup, after repairs, or under specific driving conditions

CURRENT LIVE VEHICLE DATA (updating in real-time):
${readingsText}

${historyText}

This data refreshes every few seconds. If the mechanic asks about current values, reference these numbers directly. You also have historical trend data above — use it to identify patterns (is coolant temp rising over time? are fuel trims getting worse?). Compare current values to historical min/avg/max when relevant.

FORMATTING: Keep responses concise and readable. Use short paragraphs, not markdown headers. Bold key terms with **term**. Use bullet points sparingly. Do NOT use ## or ### headers — the chat UI doesn't render them well.

ETHICAL BOUNDARIES:
- NEVER make safety judgments like "this vehicle is safe to drive" or "this is unsafe." That is the mechanic's call, not yours. You provide data analysis — they make the decisions.
- NEVER suggest that previous work was wrong or that a mechanic made a mistake unless the person explicitly asks for that evaluation and gives you full context.
- Don't tell them what to do — help them see what the data shows and let them decide.
- You are a diagnostic tool, not a decision-maker.

FOLLOW-UP QUESTIONS: At the end of EVERY response, include 2-3 suggested follow-up questions under "You might want to ask:" — keep them specific to what you just discussed. Focus on diagnostic questions that help narrow down root causes, NOT questions that put liability on the AI (never suggest asking "is it safe to drive" — that's their judgment). Good examples: "What did the downstream O2 sensor look like before the repair?" or "How do these fuel trims compare to last month?" or "What's the mileage on those spark plugs?"`;

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
      return NextResponse.json(
        { error: "Claude API error", details: errText },
        { status: 502 }
      );
    }

    const result = await response.json();
    const reply = result.content?.[0]?.text || "No response generated";

    // Log conversation to cloud for analysis and refinement
    logConversation(apiMessages, reply, readings).catch(() => {});

    return NextResponse.json({ success: true, reply });
  } catch (err) {
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
    active_dtcs: Object.entries(readings)
      .filter(([k]) => k.startsWith("obd2_dtc_"))
      .map(([, v]) => v),
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
