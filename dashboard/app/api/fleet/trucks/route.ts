/**
 * Fleet truck list API.
 *
 * GET /api/fleet/trucks — returns all configured trucks for the fleet selector UI.
 */

import { NextResponse } from "next/server";
import { listTrucks } from "@/lib/machines";

export async function GET() {
  return NextResponse.json(await listTrucks());
}
