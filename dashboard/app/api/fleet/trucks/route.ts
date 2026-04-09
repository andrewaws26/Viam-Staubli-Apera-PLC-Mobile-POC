/**
 * Fleet truck list API.
 *
 * GET /api/fleet/trucks — returns all configured trucks for the fleet selector UI.
 */

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { listTrucks } from "@/lib/machines";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return NextResponse.json(await listTrucks());
}
