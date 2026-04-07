/**
 * Shared AI utility for IronSight.
 * Used by both /api/ai-chat (existing) and team chat @ai mentions.
 */

const AI_SYSTEM_PROMPT = `You are an AI diagnostic partner for mechanics and fleet managers in a team chat. You're a knowledgeable colleague helping analyze live truck data and work through problems collaboratively.

CRITICAL RULES:
- Say "this COULD indicate" not "this IS caused by"
- NEVER make safety judgments — that's the mechanic's call
- Ask about vehicle history before diagnosing
- Present possibilities, not certainties
- Keep responses concise — this is a group chat, not a report

FORMATTING: Keep responses short and conversational. Use bold for key terms. No markdown headers. End with 1-2 follow-up questions.`;

export interface AiThreadContext {
  recentMessages: { role: string; name: string; content: string }[];
  sensorSnapshot?: Record<string, unknown>;
  entityType: string;
  entityId?: string;
  activeDtcs?: string[];
}

/**
 * Generate an AI response for a team chat thread.
 * Returns the AI's reply text.
 */
export async function generateThreadAiResponse(
  userMessage: string,
  context: AiThreadContext,
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return "AI is not configured. Please set ANTHROPIC_API_KEY.";
  }

  // Build context block
  const contextParts: string[] = [];

  if (context.entityType === "truck" && context.entityId) {
    contextParts.push(`Thread context: Truck ${context.entityId}`);
  } else if (context.entityType === "work_order" && context.entityId) {
    contextParts.push(`Thread context: Work Order ${context.entityId}`);
  } else if (context.entityType === "dtc") {
    contextParts.push(`Thread context: DTC Discussion ${context.entityId || ""}`);
  }

  if (context.sensorSnapshot && Object.keys(context.sensorSnapshot).length > 0) {
    const readings = Object.entries(context.sensorSnapshot)
      .filter(([, v]) => v != null)
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ");
    contextParts.push(`Current sensor readings: ${readings}`);
  }

  if (context.activeDtcs && context.activeDtcs.length > 0) {
    contextParts.push(`Active DTCs: ${context.activeDtcs.join(", ")}`);
  }

  // Build conversation for API
  const conversationMessages: { role: "user" | "assistant"; content: string }[] = [];

  // Add recent thread messages as context
  for (const msg of context.recentMessages.slice(-10)) {
    if (msg.role === "ai") {
      conversationMessages.push({ role: "assistant", content: msg.content });
    } else if (msg.role !== "system") {
      conversationMessages.push({
        role: "user",
        content: `[${msg.name}]: ${msg.content}`,
      });
    }
  }

  // Add the current message
  conversationMessages.push({ role: "user", content: userMessage });

  const dynamicContext = contextParts.join("\n");

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
        max_tokens: 1000,
        system: [
          { type: "text", text: AI_SYSTEM_PROMPT },
          { type: "text", text: dynamicContext },
        ],
        messages: conversationMessages,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("[TEAM-CHAT-LOG] AI API error:", response.status, errText);
      return "Sorry, I couldn't process that right now. Try again in a moment.";
    }

    const result = await response.json();
    return result.content?.[0]?.text || "No response generated.";
  } catch (err) {
    console.error("[TEAM-CHAT-LOG] AI error:", err);
    return "Sorry, I couldn't process that right now. Try again in a moment.";
  }
}
