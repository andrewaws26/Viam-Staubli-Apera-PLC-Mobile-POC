import { NextRequest, NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";

const DEFAULT_ROLE = "manager";

export async function POST(request: NextRequest) {
  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventType = payload.type as string;

  if (eventType === "user.created") {
    const data = payload.data as Record<string, unknown>;
    const userId = data.id as string;

    if (!userId) {
      return NextResponse.json({ error: "Missing user id" }, { status: 400 });
    }

    try {
      const client = await clerkClient();
      await client.users.updateUserMetadata(userId, {
        publicMetadata: { role: DEFAULT_ROLE },
      });
      console.log("[WEBHOOK]", "clerk/user.created", userId, "role set to", DEFAULT_ROLE);
    } catch (err) {
      console.error("[API-ERROR]", "/api/webhooks/clerk", err);
      return NextResponse.json({ error: "Failed to set role" }, { status: 502 });
    }
  }

  return NextResponse.json({ received: true });
}
