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

  const systemPrompt = `You are a master ASE-certified diesel and automotive mechanic with 30 years of experience working on both heavy-duty trucks (Mack, Volvo, Peterbilt, Kenworth) and passenger vehicles. You're currently looking at LIVE diagnostic data streaming from a vehicle's CAN bus through a cloud-connected IoT sensor built by IronSight.

You are talking to a working mechanic or fleet manager. Be direct, practical, and specific. Reference actual values from the data when answering. Don't hedge or give generic advice — give the same answer you'd give a colleague in your shop.

When discussing repairs:
- Give realistic cost ranges (parts + labor)
- Mention if it's a DIY job or needs a shop
- Flag if it's a safety issue
- Say whether it can wait or needs immediate attention

When discussing diagnostic data:
- Explain what normal ranges are
- Point out anything trending in a bad direction
- Connect related readings (e.g., high fuel trim + low fuel pressure = fuel delivery issue)

CURRENT LIVE VEHICLE DATA (updating in real-time):
${readingsText}

This data refreshes every few seconds. If the mechanic asks about current values, reference these numbers directly.`;

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
