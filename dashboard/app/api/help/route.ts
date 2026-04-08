/**
 * AI help assistant endpoint — answers questions about IronSight features.
 *
 * POST /api/help
 * Body: { messages: [{role, content}...], userRole: string, currentPage: string }
 *
 * Uses the curated HELP_KNOWLEDGE_BASE as cached context so Claude can answer
 * any platform question. Role-aware: tells users what they can/cannot access.
 * Streams SSE responses for real-time typing feel.
 *
 * No role gate — all authenticated users can ask for help.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { HelpBody, parseBody } from "@/lib/api-schemas";
import { logAudit } from "@/lib/audit";
import { HELP_KNOWLEDGE_BASE } from "@/lib/help-knowledge-base";

/**
 * Role-specific context injected into the dynamic portion of the prompt.
 * Tells the AI what the user can and cannot access.
 */
const ROLE_CONTEXT: Record<string, string> = {
  operator:
    "This user is an Operator. They can view truck dashboards, their own timesheets/PTO/training/profile, view work orders (not create), and use team chat. They CANNOT access the Fleet page, AI diagnostics, Finance/Accounting, or admin features.",
  mechanic:
    "This user is a Mechanic. They have Operator access plus: Fleet page, AI diagnostics, truck commands, create/manage work orders, and view team members.",
  manager:
    "This user is a Manager. They have full access to all features including Finance/Accounting, timesheet/PTO approvals, training admin, fleet admin, audit trail, push notifications, and AI reports.",
  developer:
    "This user is a Developer. They have full access to everything including dev tools (/dev), vision page (/vision), and DEV mode on truck dashboards.",
};

/**
 * Static system prompt — cached via Anthropic prompt caching for ~90% token savings.
 */
const SYSTEM_PROMPT = `You are the IronSight Help Assistant — a friendly, knowledgeable guide to the IronSight platform. Your job is to help users find features, understand how things work, and troubleshoot common issues.

You have complete knowledge of the IronSight platform from the documentation below. Use it to answer questions accurately and helpfully.

RESPONSE RULES:
- Be concise — most answers should be 2-4 short paragraphs
- Use **bold** for key terms, page names, and navigation paths
- Use bullet points for lists of steps or features
- Always mention the specific page path (e.g., **/fleet**, **/work**) when referencing a feature
- If a feature requires a higher role than the user has, say so clearly and explain what role is needed
- If you don't know the answer from the documentation, say so honestly — don't guess
- Do NOT use ## or ### markdown headers — the chat panel doesn't render them well
- End responses with a brief "Anything else?" or related suggestion, NOT a list of follow-up questions

NAVIGATION HELP:
- When users ask "where do I find X" or "how do I do X", give them the exact page path and brief steps
- If the feature is on a specific tab or section within a page, describe how to get there

ROLE AWARENESS:
- The user's role and accessible features are provided below
- If they ask about a feature they can't access, explain what role is required
- Don't volunteer information about features they can't use unless they specifically ask

PLATFORM DOCUMENTATION:
${HELP_KNOWLEDGE_BASE}`;

export async function POST(request: NextRequest) {
  // Auth check — all roles can use help, but must be signed in
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

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

  const parsed = parseBody(HelpBody, rawBody);
  if (parsed.error) {
    return NextResponse.json(parsed.error, { status: 400 });
  }

  const { messages, userRole, currentPage } = parsed.data;

  // Build dynamic context
  const roleContext = ROLE_CONTEXT[userRole] || ROLE_CONTEXT.operator;
  const pageContext = currentPage
    ? `The user is currently on the **${currentPage}** page.`
    : "";
  const dynamicContext = [roleContext, pageContext].filter(Boolean).join("\n\n");

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
        "anthropic-beta": "prompt-caching-2024-07-31",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        stream: true,
        system: [
          {
            type: "text",
            text: SYSTEM_PROMPT,
            cache_control: { type: "ephemeral" },
          },
          { type: "text", text: dynamicContext },
        ],
        messages: apiMessages,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("[API-ERROR]", "/api/help", `Claude API ${response.status}:`, errText);
      return NextResponse.json(
        { error: "Claude API error", details: errText },
        { status: 502 }
      );
    }

    if (!response.body) {
      return NextResponse.json({ error: "No response body" }, { status: 502 });
    }

    // Stream SSE to client
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullReply = "";

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split("\n");

            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              const data = line.slice(6).trim();
              if (data === "[DONE]") continue;

              try {
                const event = JSON.parse(data);
                if (event.type === "content_block_delta" && event.delta?.text) {
                  fullReply += event.delta.text;
                  controller.enqueue(
                    encoder.encode(
                      `data: ${JSON.stringify({ text: event.delta.text })}\n\n`
                    )
                  );
                }
              } catch {
                // Skip unparseable lines
              }
            }
          }

          controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
          controller.close();
        } catch (err) {
          controller.error(err);
        }

        // Audit log after stream completes
        logAudit({
          action: "help_query",
          details: {
            message_count: messages.length,
            user_role: userRole,
            current_page: currentPage || null,
            last_question: messages
              .filter((m) => m.role === "user")
              .pop()
              ?.content?.substring(0, 200),
          },
        });

        // Get user name for logging
        let userName = "Unknown";
        try {
          const client = await clerkClient();
          const user = await client.users.getUser(userId);
          userName = user.firstName
            ? `${user.firstName} ${user.lastName ?? ""}`.trim()
            : user.emailAddresses?.[0]?.emailAddress ?? "Unknown";
        } catch { /* ignore */ }

        console.log(
          "[HELP-LOG]",
          JSON.stringify({
            user: userName,
            role: userRole,
            page: currentPage,
            question: messages
              .filter((m) => m.role === "user")
              .pop()?.content,
            response_length: fullReply.length,
          })
        );
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    console.error("[API-ERROR]", "/api/help", err);
    return NextResponse.json(
      {
        error: "Failed to reach Claude API",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 502 }
    );
  }
}
