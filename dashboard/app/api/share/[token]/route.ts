/**
 * GET /api/share/:token — Resolve a shared link (public, no auth required).
 * Returns the shared content with metadata.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const sb = getSupabase();

  // Look up the shared link
  const { data: link, error } = await sb
    .from("shared_links")
    .select("*")
    .eq("token", token)
    .single();

  if (error || !link) {
    return NextResponse.json({ error: "Link not found" }, { status: 404 });
  }

  // Check expiry
  if (link.expires_at && new Date(link.expires_at) < new Date()) {
    return NextResponse.json({ error: "This link has expired" }, { status: 410 });
  }

  // Track view count (fire-and-forget)
  const updates: Record<string, unknown> = {
    view_count: (link.view_count || 0) + 1,
  };
  if (!link.viewed_at) {
    updates.viewed_at = new Date().toISOString();
  }
  sb.from("shared_links").update(updates).eq("id", link.id).then(() => {});

  // If the link references a DB entity (snapshot, saved_report), fetch it
  let entityData = link.entity_payload;
  if (!entityData && link.entity_id) {
    const table =
      link.entity_type === "snapshot" ? "truck_snapshots" :
      link.entity_type === "saved_report" ? "saved_reports" :
      null;

    if (table) {
      const { data: row } = await sb.from(table).select("*").eq("id", link.entity_id).single();
      entityData = row;
    }
  }

  return NextResponse.json({
    entity_type: link.entity_type,
    title: link.title,
    shared_by: link.created_by_name,
    shared_at: link.created_at,
    message: link.message,
    data: entityData,
  });
}
