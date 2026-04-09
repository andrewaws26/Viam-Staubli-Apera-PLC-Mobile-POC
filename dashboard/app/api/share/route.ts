/**
 * POST /api/share — Create a shareable link for a snapshot or report.
 * Optionally sends an email notification via Resend.
 */

import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";
import { sendShareEmail } from "@/lib/share-email";
import type { CreateSharePayload, ShareResponse } from "@ironsight/shared";

export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get user name
  let userName = "Unknown";
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    userName = user.firstName
      ? `${user.firstName} ${user.lastName ?? ""}`.trim()
      : user.emailAddresses?.[0]?.emailAddress ?? "Unknown";
  } catch { /* fallback to Unknown */ }

  let body: CreateSharePayload;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.entity_type || !body.title) {
    return NextResponse.json({ error: "entity_type and title are required" }, { status: 400 });
  }

  // Generate unique token (URL-safe, 22 chars)
  const token = randomBytes(16).toString("base64url");

  // Calculate expiry
  const expiresAt = body.expires_in_days
    ? new Date(Date.now() + body.expires_in_days * 86400000).toISOString()
    : null;

  const sb = getSupabase();
  const { error: dbError } = await sb.from("shared_links").insert({
    token,
    entity_type: body.entity_type,
    entity_id: body.entity_id || null,
    entity_payload: body.entity_payload || null,
    title: body.title,
    created_by: userId,
    created_by_name: userName,
    recipient_email: body.recipient_email || null,
    recipient_name: body.recipient_name || null,
    message: body.message || null,
    expires_at: expiresAt,
  });

  if (dbError) {
    console.error("[SHARE-ERROR]", dbError.message);
    return NextResponse.json({ error: "Failed to create share link" }, { status: 500 });
  }

  // Build the public URL
  const origin = request.headers.get("x-forwarded-host")
    ? `https://${request.headers.get("x-forwarded-host")}`
    : request.nextUrl.origin;
  const shareUrl = `${origin}/shared/${token}`;

  // Send email if recipient provided
  let emailSent = false;
  if (body.recipient_email) {
    emailSent = await sendShareEmail({
      to: body.recipient_email,
      recipientName: body.recipient_name,
      senderName: userName,
      title: body.title,
      message: body.message,
      shareUrl,
      entityType: body.entity_type,
    });
  }

  console.log("[SHARE-LOG]", {
    action: "link_created",
    entity_type: body.entity_type,
    entity_id: body.entity_id,
    user: userName,
    recipient: body.recipient_email || "none",
    email_sent: emailSent,
  });

  const response: ShareResponse = { token, url: shareUrl, email_sent: emailSent };
  return NextResponse.json(response, { status: 201 });
}
