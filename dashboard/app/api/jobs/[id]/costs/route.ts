import { auth, clerkClient } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";
import { NextRequest, NextResponse } from "next/server";

async function checkFinanceRole(userId: string) {
  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  const role = (user.publicMetadata as { role?: string }).role;
  return role && ["developer", "manager"].includes(role);
}

type Params = { params: Promise<{ id: string }> };

/** GET — list cost entries for a job */
export async function GET(_req: NextRequest, { params }: Params) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await checkFinanceRole(userId)))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const sb = getSupabase();
  const { data, error } = await sb
    .from("job_cost_entries")
    .select("*")
    .eq("job_id", id)
    .order("date", { ascending: false });

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

/** POST — add a manual cost entry */
export async function POST(req: NextRequest, { params }: Params) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await checkFinanceRole(userId)))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const body = await req.json();
  if (!body.cost_type || body.amount == null)
    return NextResponse.json(
      { error: "cost_type and amount are required" },
      { status: 400 },
    );

  const sb = getSupabase();
  const { data, error } = await sb
    .from("job_cost_entries")
    .insert({
      job_id: id,
      cost_type: body.cost_type,
      description: body.description || "",
      quantity: body.quantity || 1,
      rate: body.rate || 0,
      amount: body.amount,
      date: body.date || new Date().toISOString().split("T")[0],
      source_type: "manual",
      created_by: userId,
    })
    .select()
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
