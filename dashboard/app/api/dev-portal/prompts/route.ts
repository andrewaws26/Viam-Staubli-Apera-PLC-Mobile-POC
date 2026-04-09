import { NextRequest, NextResponse } from "next/server";
import { requireRole, getAuthUserId } from "@/lib/auth-guard";
import { getSupabase } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const denied = await requireRole("/api/dev-portal");
  if (denied) return denied;

  const category = req.nextUrl.searchParams.get("category");
  const activeOnly = req.nextUrl.searchParams.get("active") !== "false";

  const sb = getSupabase();
  let query = sb
    .from("prompt_templates")
    .select("*")
    .order("updated_at", { ascending: false });

  if (activeOnly) query = query.eq("is_active", true);
  if (category) query = query.eq("category", category);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ templates: data || [] });
}

export async function POST(req: NextRequest) {
  const denied = await requireRole("/api/dev-portal");
  if (denied) return denied;

  const userId = await getAuthUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { name, description, category, body: templateBody, variables } = body;

  if (!name || !templateBody) {
    return NextResponse.json({ error: "name and body are required" }, { status: 400 });
  }

  const sb = getSupabase();

  // Create the template
  const { data: template, error } = await sb
    .from("prompt_templates")
    .insert({
      name,
      description: description || null,
      category: category || "general",
      body: templateBody,
      variables: variables || [],
      created_by: userId,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Create initial version (v1)
  await sb.from("prompt_versions").insert({
    template_id: template.id,
    version: 1,
    body: templateBody,
    variables: variables || [],
    changelog: "Initial version",
    created_by: userId,
  });

  return NextResponse.json({ template }, { status: 201 });
}
