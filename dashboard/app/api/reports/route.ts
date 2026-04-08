/**
 * /api/reports — Saved reports CRUD.
 *
 * GET:    List saved reports (own + shared). Filters: ?category=, ?search=
 * POST:   Save a new report.
 * PATCH:  Update report metadata.
 * DELETE: Delete own report.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole, getAuthUserId } from "@/lib/auth-guard";
import { logAudit } from "@/lib/audit";
import { getSupabase } from "@/lib/supabase";
import { ReportSaveBody, ReportUpdateBody, parseBody } from "@/lib/api-schemas";
import { clerkClient } from "@clerk/nextjs/server";

async function getUserName(userId: string): Promise<string> {
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    return user.firstName
      ? `${user.firstName} ${user.lastName ?? ""}`.trim()
      : user.emailAddresses?.[0]?.emailAddress ?? "Unknown";
  } catch {
    return "Unknown";
  }
}

// ── GET: List saved reports ───────────────────────────────────────

export async function GET(request: NextRequest) {
  const denied = await requireRole("/api/reports");
  if (denied) return denied;

  const userId = await getAuthUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const category = searchParams.get("category");
  const search = searchParams.get("search");

  const sb = getSupabase();

  // Show own reports + shared reports from others
  let query = sb
    .from("saved_reports")
    .select("*")
    .or(`created_by.eq.${userId},is_shared.eq.true`)
    .order("updated_at", { ascending: false });

  if (category) {
    query = query.eq("category", category);
  }

  if (search) {
    query = query.or(`name.ilike.%${search}%,description.ilike.%${search}%,prompt.ilike.%${search}%`);
  }

  const { data, error } = await query;

  if (error) {
    console.error("[REPORT-ERROR]", "list", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data || []);
}

// ── POST: Save a report ───────────────────────────────────────────

export async function POST(request: NextRequest) {
  const denied = await requireRole("/api/reports");
  if (denied) return denied;

  const userId = await getAuthUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = parseBody(ReportSaveBody, rawBody);
  if (parsed.error) {
    return NextResponse.json(parsed.error, { status: 400 });
  }

  const userName = await getUserName(userId);
  const sb = getSupabase();

  const { data, error } = await sb
    .from("saved_reports")
    .insert({
      created_by: userId,
      created_by_name: userName,
      name: parsed.data.name,
      description: parsed.data.description || null,
      prompt: parsed.data.prompt,
      generated_sql: parsed.data.generated_sql,
      category: parsed.data.category || null,
      is_shared: parsed.data.is_shared || false,
    })
    .select()
    .single();

  if (error) {
    console.error("[REPORT-ERROR]", "save", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  logAudit({
    action: "report_saved",
    details: { report_id: data.id, name: parsed.data.name },
  });

  return NextResponse.json(data, { status: 201 });
}

// ── PATCH: Update report metadata ─────────────────────────────────

export async function PATCH(request: NextRequest) {
  const denied = await requireRole("/api/reports");
  if (denied) return denied;

  const userId = await getAuthUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = parseBody(ReportUpdateBody, rawBody);
  if (parsed.error) {
    return NextResponse.json(parsed.error, { status: 400 });
  }

  const sb = getSupabase();
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.description !== undefined) updates.description = parsed.data.description;
  if (parsed.data.category !== undefined) updates.category = parsed.data.category;
  if (parsed.data.is_shared !== undefined) updates.is_shared = parsed.data.is_shared;

  const { data, error } = await sb
    .from("saved_reports")
    .update(updates)
    .eq("id", parsed.data.id)
    .eq("created_by", userId)
    .select()
    .single();

  if (error) {
    console.error("[REPORT-ERROR]", "update", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  logAudit({
    action: "report_updated",
    details: { report_id: parsed.data.id },
  });

  return NextResponse.json(data);
}

// ── DELETE: Delete own report ─────────────────────────────────────

export async function DELETE(request: NextRequest) {
  const denied = await requireRole("/api/reports");
  if (denied) return denied;

  const userId = await getAuthUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing report id" }, { status: 400 });
  }

  const sb = getSupabase();
  const { error } = await sb
    .from("saved_reports")
    .delete()
    .eq("id", id)
    .eq("created_by", userId);

  if (error) {
    console.error("[REPORT-ERROR]", "delete", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  logAudit({
    action: "report_deleted",
    details: { report_id: id },
  });

  return NextResponse.json({ success: true });
}
