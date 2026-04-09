import { NextRequest, NextResponse } from "next/server";
import { requireRole, getAuthUserId } from "@/lib/auth-guard";
import { getSupabase } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const denied = await requireRole("/api/dev-portal");
  if (denied) return denied;

  const category = req.nextUrl.searchParams.get("category");
  const search = req.nextUrl.searchParams.get("q");
  const tag = req.nextUrl.searchParams.get("tag");

  const sb = getSupabase();
  let query = sb
    .from("knowledge_entries")
    .select("*")
    .order("updated_at", { ascending: false });

  if (category) query = query.eq("category", category);
  if (tag) query = query.contains("tags", [tag]);
  if (search) query = query.or(`title.ilike.%${search}%,body.ilike.%${search}%`);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ entries: data || [] });
}

export async function POST(req: NextRequest) {
  const denied = await requireRole("/api/dev-portal");
  if (denied) return denied;

  const userId = await getAuthUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { action } = body;

  const sb = getSupabase();

  if (action === "create" || !action) {
    const { category, title, body: content, tags, source } = body;
    if (!title || !content) return NextResponse.json({ error: "title and body required" }, { status: 400 });
    const { data, error } = await sb.from("knowledge_entries").insert({
      category: category || "convention",
      title, body: content,
      tags: tags || [],
      source: source || null,
      created_by: userId,
    }).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ entry: data }, { status: 201 });
  }

  if (action === "update") {
    const { id, category, title, body: content, tags, source } = body;
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (category !== undefined) update.category = category;
    if (title !== undefined) update.title = title;
    if (content !== undefined) update.body = content;
    if (tags !== undefined) update.tags = tags;
    if (source !== undefined) update.source = source;
    const { data, error } = await sb.from("knowledge_entries").update(update).eq("id", id).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ entry: data });
  }

  if (action === "delete") {
    const { id } = body;
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const { error } = await sb.from("knowledge_entries").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
