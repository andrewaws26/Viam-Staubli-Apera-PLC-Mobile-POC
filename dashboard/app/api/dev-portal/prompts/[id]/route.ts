import { NextRequest, NextResponse } from "next/server";
import { requireRole, getAuthUserId } from "@/lib/auth-guard";
import { getSupabase } from "@/lib/supabase";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireRole("/api/dev-portal");
  if (denied) return denied;

  const { id } = await params;
  const sb = getSupabase();

  const [templateRes, versionsRes] = await Promise.all([
    sb.from("prompt_templates").select("*").eq("id", id).single(),
    sb
      .from("prompt_versions")
      .select("*")
      .eq("template_id", id)
      .order("version", { ascending: false }),
  ]);

  if (templateRes.error) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  return NextResponse.json({
    template: templateRes.data,
    versions: versionsRes.data || [],
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireRole("/api/dev-portal");
  if (denied) return denied;

  const userId = await getAuthUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const { name, description, category, body: templateBody, variables, is_active, changelog } = body;

  const sb = getSupabase();

  // Get current template to check if body changed
  const { data: current } = await sb
    .from("prompt_templates")
    .select("body, variables")
    .eq("id", id)
    .single();

  if (!current) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  // Build update payload
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (name !== undefined) update.name = name;
  if (description !== undefined) update.description = description;
  if (category !== undefined) update.category = category;
  if (templateBody !== undefined) update.body = templateBody;
  if (variables !== undefined) update.variables = variables;
  if (is_active !== undefined) update.is_active = is_active;

  const { data: updated, error } = await sb
    .from("prompt_templates")
    .update(update)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Auto-create a new version if body or variables changed
  const bodyChanged = templateBody !== undefined && templateBody !== current.body;
  const varsChanged =
    variables !== undefined &&
    JSON.stringify(variables) !== JSON.stringify(current.variables);

  if (bodyChanged || varsChanged) {
    // Get latest version number
    const { data: latestVersion } = await sb
      .from("prompt_versions")
      .select("version")
      .eq("template_id", id)
      .order("version", { ascending: false })
      .limit(1)
      .single();

    const nextVersion = (latestVersion?.version || 0) + 1;

    await sb.from("prompt_versions").insert({
      template_id: id,
      version: nextVersion,
      body: updated.body,
      variables: updated.variables,
      changelog: changelog || `Updated ${bodyChanged ? "body" : ""}${bodyChanged && varsChanged ? " and " : ""}${varsChanged ? "variables" : ""}`,
      created_by: userId,
    });
  }

  return NextResponse.json({ template: updated });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireRole("/api/dev-portal");
  if (denied) return denied;

  const { id } = await params;
  const sb = getSupabase();

  // Soft delete — mark inactive
  const { error } = await sb
    .from("prompt_templates")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
