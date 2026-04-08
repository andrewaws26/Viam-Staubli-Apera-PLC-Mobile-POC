import { NextRequest, NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";

async function getUserInfo(userId: string) {
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const role =
      ((user.publicMetadata as Record<string, unknown>)?.role as string) ||
      "operator";
    return { role };
  } catch {
    return { role: "operator" };
  }
}

/**
 * GET /api/inventory/alerts
 * Returns parts needing attention. Manager/developer only.
 * Response: { low_stock, out_of_stock, reorder_suggestions }
 */
export async function GET(_request: NextRequest) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userInfo = await getUserInfo(userId);
  const isManager =
    userInfo.role === "developer" || userInfo.role === "manager";
  if (!isManager)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const sb = getSupabase();

    // Fetch all active parts that are low_stock or out_of_stock
    const { data: lowStock, error: lowErr } = await sb
      .from("parts")
      .select("*")
      .eq("is_active", true)
      .eq("status", "low_stock")
      .order("category", { ascending: true })
      .order("part_number", { ascending: true });

    if (lowErr) throw lowErr;

    const { data: outOfStock, error: outErr } = await sb
      .from("parts")
      .select("*")
      .eq("is_active", true)
      .eq("status", "out_of_stock")
      .order("category", { ascending: true })
      .order("part_number", { ascending: true });

    if (outErr) throw outErr;

    // Build reorder suggestions: parts at or below reorder_point with a reorder_quantity set
    const allAlertParts = [...(outOfStock ?? []), ...(lowStock ?? [])];
    const reorderSuggestions = allAlertParts
      .filter((p) => p.reorder_quantity > 0)
      .map((p) => ({
        part: p,
        suggested_quantity: p.reorder_quantity,
      }));

    return NextResponse.json({
      low_stock: lowStock ?? [],
      out_of_stock: outOfStock ?? [],
      reorder_suggestions: reorderSuggestions,
    });
  } catch (err) {
    console.error("[API-ERROR]", "/api/inventory/alerts GET", err);
    return NextResponse.json(
      { error: "Failed to fetch inventory alerts" },
      { status: 502 },
    );
  }
}
