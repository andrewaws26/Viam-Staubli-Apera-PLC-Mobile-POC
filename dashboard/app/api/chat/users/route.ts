import { NextRequest, NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { getAuthUserId } from "@/lib/auth-guard";

let cachedUsers: { data: unknown[]; fetchedAt: number } | null = null;
const CACHE_TTL = 60_000; // 60 seconds

export async function GET(request: NextRequest) {
  const userId = await getAuthUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Return cached if fresh
  if (cachedUsers && Date.now() - cachedUsers.fetchedAt < CACHE_TTL) {
    return NextResponse.json(cachedUsers.data);
  }

  try {
    const client = await clerkClient();
    const { data: users } = await client.users.getUserList({ limit: 100 });

    const mapped = users.map((u) => ({
      id: u.id,
      name: u.firstName
        ? `${u.firstName} ${u.lastName ?? ""}`.trim()
        : u.emailAddresses?.[0]?.emailAddress ?? "Unknown",
      email: u.emailAddresses?.[0]?.emailAddress ?? "",
      role: (u.publicMetadata as Record<string, unknown>)?.role || "operator",
    }));

    cachedUsers = { data: mapped, fetchedAt: Date.now() };

    console.log("[TEAM-CHAT-LOG]", "GET /api/chat/users", { count: mapped.length });
    return NextResponse.json(mapped);
  } catch (err) {
    console.error("[TEAM-CHAT-LOG]", "GET /api/chat/users error:", err);
    return NextResponse.json(
      { error: "Failed to fetch users", message: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
