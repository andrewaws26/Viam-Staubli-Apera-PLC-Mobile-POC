import { NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { getAuthUserId } from "@/lib/auth-guard";

export async function GET() {
  const userId = await getAuthUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const client = await clerkClient();
    const { data: users } = await client.users.getUserList({ limit: 100 });

    const members = users.map((u) => ({
      id: u.id,
      name: [u.firstName, u.lastName].filter(Boolean).join(" ") || u.emailAddresses[0]?.emailAddress || "Unknown",
      email: u.emailAddresses[0]?.emailAddress || "",
      role: (u.publicMetadata as Record<string, unknown>)?.role as string || "operator",
      imageUrl: u.imageUrl,
    }));

    return NextResponse.json(members);
  } catch (err) {
    console.error("[TEAM-MEMBERS]", err);
    return NextResponse.json({ error: "Failed to fetch team members" }, { status: 500 });
  }
}
