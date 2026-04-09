/**
 * GET    /api/snapshots/:id — Get full snapshot with reading_data
 * DELETE /api/snapshots/:id — Delete a snapshot
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { requireRole } from "@/lib/auth-guard";
import { logAudit } from "@/lib/audit";
import { getSupabase } from "@/lib/supabase";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireRole("/api/snapshots");
  if (denied) return denied;

  const { id } = await params;
  const sb = getSupabase();
  const { data, error } = await sb.from("truck_snapshots")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Snapshot not found" }, { status: 404 });
  }

  return NextResponse.json(data);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireRole("/api/snapshots");
  if (denied) return denied;

  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const sb = getSupabase();
  const { error } = await sb.from("truck_snapshots").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  }

  logAudit({ action: "snapshot_deleted", details: { snapshot_id: id } });
  return NextResponse.json({ ok: true });
}
