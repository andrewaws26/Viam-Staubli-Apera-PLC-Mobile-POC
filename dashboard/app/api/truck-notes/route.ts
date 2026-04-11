import { NextRequest, NextResponse } from "next/server";
import { auth, currentUser, clerkClient } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";
import { canSeeAllTrucks, canManageFleet } from "@/lib/auth";
import { logAudit, logAuditDirect } from "@/lib/audit";

async function getUserRole(userId: string): Promise<string> {
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    return (user.publicMetadata as Record<string, unknown>)?.role as string || "operator";
  } catch {
    return "operator";
  }
}

export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const truckId = request.nextUrl.searchParams.get("truck_id");
  if (!truckId) {
    return NextResponse.json({ error: "Missing truck_id" }, { status: 400 });
  }

  const role = await getUserRole(userId);

  // Operators can only fetch notes for trucks they are assigned to
  if (!canSeeAllTrucks(role)) {
    try {
      const sb = getSupabase();
      const { data } = await sb
        .from("truck_assignments")
        .select("id")
        .eq("user_id", userId)
        .eq("truck_id", truckId)
        .limit(1);

      if (!data || data.length === 0) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    } catch (err) {
      console.error("[API-ERROR]", "/api/truck-notes", err);
      return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
    }
  }

  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("truck_notes")
      .select("*")
      .eq("truck_id", truckId)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) throw error;
    return NextResponse.json(data ?? []);
  } catch (err) {
    console.error("[API-ERROR]", "/api/truck-notes", err);
    return NextResponse.json(
      { error: "Failed to fetch notes", message: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}

export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await currentUser();
  const authorName = user?.firstName
    ? `${user.firstName} ${user.lastName ?? ""}`.trim()
    : user?.emailAddresses?.[0]?.emailAddress ?? "Unknown";
  const role = await getUserRole(userId);

  let body: { truck_id?: string; body?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { truck_id, body: noteBody } = body;
  if (!truck_id || !noteBody?.trim()) {
    return NextResponse.json({ error: "Missing truck_id or body" }, { status: 400 });
  }

  // Operators can only post to their assigned trucks
  if (!canSeeAllTrucks(role)) {
    try {
      const sb = getSupabase();
      const { data } = await sb
        .from("truck_assignments")
        .select("id")
        .eq("user_id", userId)
        .eq("truck_id", truck_id)
        .limit(1);

      if (!data || data.length === 0) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    } catch (err) {
      console.error("[API-ERROR]", "/api/truck-notes", err);
      return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
    }
  }

  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("truck_notes")
      .insert({
        truck_id,
        author_id: userId,
        author_name: authorName,
        author_role: role,
        body: noteBody.trim(),
      })
      .select()
      .single();

    if (error) throw error;

    await logAuditDirect(userId, authorName, role, {
      action: "note_created",
      truckId: truck_id,
      details: { note_id: data.id, body_preview: noteBody.trim().substring(0, 100) },
    });

    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    console.error("[API-ERROR]", "/api/truck-notes", err);
    return NextResponse.json(
      { error: "Failed to create note", message: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const noteId = request.nextUrl.searchParams.get("id");
  if (!noteId) {
    return NextResponse.json({ error: "Missing note id" }, { status: 400 });
  }

  const role = await getUserRole(userId);

  try {
    const sb = getSupabase();
    const { data: note, error: fetchErr } = await sb
      .from("truck_notes")
      .select("author_id")
      .eq("id", noteId)
      .single();

    if (fetchErr || !note) {
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
    }

    // Only the author or developer/manager can delete
    if (note.author_id !== userId && !canManageFleet(role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { error: delErr } = await sb.from("truck_notes").delete().eq("id", noteId);
    if (delErr) throw delErr;

    await logAudit({ action: "note_deleted", details: { note_id: noteId } });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[API-ERROR]", "/api/truck-notes", err);
    return NextResponse.json(
      { error: "Failed to delete note", message: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
