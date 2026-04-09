import { NextRequest, NextResponse } from "next/server";
import { requireRole, getAuthUserId } from "@/lib/auth-guard";
import { getSupabase } from "@/lib/supabase";

export async function GET() {
  const denied = await requireRole("/api/dev-portal");
  if (denied) return denied;

  const sb = getSupabase();
  const [nodesRes, edgesRes] = await Promise.all([
    sb.from("architecture_nodes").select("*").order("name"),
    sb.from("architecture_edges").select("*"),
  ]);

  return NextResponse.json({
    nodes: nodesRes.data || [],
    edges: edgesRes.data || [],
  });
}

export async function POST(req: NextRequest) {
  const denied = await requireRole("/api/dev-portal");
  if (denied) return denied;

  const userId = await getAuthUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { action } = body;

  const sb = getSupabase();

  if (action === "add_node") {
    const { node_type, name, description, metadata } = body;
    if (!name || !node_type) return NextResponse.json({ error: "name and node_type required" }, { status: 400 });
    const { data, error } = await sb.from("architecture_nodes").insert({
      node_type, name, description: description || null, metadata: metadata || {},
    }).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ node: data }, { status: 201 });
  }

  if (action === "add_edge") {
    const { source_id, target_id, edge_type, label, metadata } = body;
    if (!source_id || !target_id) return NextResponse.json({ error: "source_id and target_id required" }, { status: 400 });
    const { data, error } = await sb.from("architecture_edges").insert({
      source_id, target_id, edge_type: edge_type || "data", label: label || null, metadata: metadata || {},
    }).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ edge: data }, { status: 201 });
  }

  if (action === "update_node") {
    const { id, ...updates } = body;
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (updates.name !== undefined) payload.name = updates.name;
    if (updates.description !== undefined) payload.description = updates.description;
    if (updates.node_type !== undefined) payload.node_type = updates.node_type;
    if (updates.metadata !== undefined) payload.metadata = updates.metadata;
    if (updates.status !== undefined) payload.status = updates.status;
    const { data, error } = await sb.from("architecture_nodes").update(payload).eq("id", id).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ node: data });
  }

  if (action === "delete_node") {
    const { id } = body;
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const { error } = await sb.from("architecture_nodes").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  if (action === "delete_edge") {
    const { id } = body;
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const { error } = await sb.from("architecture_edges").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
