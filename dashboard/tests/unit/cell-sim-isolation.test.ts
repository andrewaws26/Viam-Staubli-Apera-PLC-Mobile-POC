/**
 * Cell sim data isolation tests.
 *
 * Ensures that simulated robot cell data NEVER leaks to real trucks.
 * - Truck "00" (demo): allowed to see sim data
 * - Truck "01" and others: must only see real Viam data or nothing
 * - The API must route to the correct truck's Part ID
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock dependencies before importing the route handler
// ---------------------------------------------------------------------------

// Mock viam-data module
const mockGetLatestReading = vi.fn();
const mockResetDataClient = vi.fn();
vi.mock("@/lib/viam-data", () => ({
  getLatestReading: (...args: unknown[]) => mockGetLatestReading(...args),
  resetDataClient: () => mockResetDataClient(),
}));

// Mock machines module — truck "00" has no Part ID, "01" has one
vi.mock("@/lib/machines", () => ({
  getDefaultTruck: () => ({
    id: "00",
    name: "Demo Truck",
    tpsPartId: "",
    truckPartId: "",
  }),
  getTruckById: (id: string) => {
    if (id === "00") return { id: "00", name: "Demo Truck", tpsPartId: "", truckPartId: "" };
    if (id === "01") return { id: "01", name: "Truck 01", tpsPartId: "part-id-01", truckPartId: "part-id-01" };
    return null;
  },
}));

// Mock Clerk auth
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({ userId: "test-user" }),
}));

// Import the route handler AFTER mocks are set up
import { GET } from "../../app/api/cell-readings/route";
import { NextRequest } from "next/server";

function makeRequest(params: Record<string, string>): NextRequest {
  const url = new URL("http://localhost:3000/api/cell-readings");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url);
}

async function getJsonBody(req: NextRequest) {
  const res = await GET(req);
  return res.json();
}

describe("Cell readings — sim data isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Truck "00" (demo) ─────────────────────────────────────────────

  it("returns sim data for truck 00 when sim=true", async () => {
    const body = await getJsonBody(makeRequest({ sim: "true", truck: "00" }));
    expect(body._is_sim).toBe(true);
    expect(body.staubli).toBeDefined();
    expect(body.apera).toBeDefined();
  });

  it("returns sim data when sim=true with no truck param (backward compat)", async () => {
    const body = await getJsonBody(makeRequest({ sim: "true" }));
    expect(body._is_sim).toBe(true);
    expect(body.staubli).toBeDefined();
  });

  it("returns _no_cell for truck 00 with sim=false (no Part ID)", async () => {
    const body = await getJsonBody(makeRequest({ sim: "false", truck: "00" }));
    expect(body._no_cell).toBe(true);
    expect(body.staubli).toBeUndefined();
    expect(body._is_sim).toBeUndefined();
  });

  // ── Truck "01" (real truck with cell) ─────────────────────────────

  it("NEVER returns sim data for truck 01 — even when sim=true", async () => {
    const body = await getJsonBody(makeRequest({ sim: "true", truck: "01" }));
    // sim=true + non-"00" truck should NOT return sim data
    expect(body._is_sim).not.toBe(true);
  });

  it("queries Viam with truck 01's Part ID", async () => {
    mockGetLatestReading.mockResolvedValueOnce({
      timeCaptured: new Date(),
      payload: { staubli_connected: true, apera_connected: true },
    });

    const body = await getJsonBody(makeRequest({ sim: "false", truck: "01" }));

    // Should have called getLatestReading with truck 01's Part ID
    expect(mockGetLatestReading).toHaveBeenCalledWith("part-id-01", "cell-monitor");
    // Should return real data, not sim
    expect(body._is_sim).toBe(false);
    expect(body._source).toBe("viam");
  });

  it("returns _no_cell when truck 01 has no recent Viam data", async () => {
    mockGetLatestReading.mockResolvedValueOnce(null);

    const body = await getJsonBody(makeRequest({ sim: "false", truck: "01" }));

    expect(body._no_cell).toBe(true);
    expect(body._offline).toBe(true);
    // Must NOT fall back to sim data
    expect(body._is_sim).toBeUndefined();
    expect(body.staubli).toBeUndefined();
  });

  it("returns _no_cell on Viam error for truck 01 — no sim fallback", async () => {
    mockGetLatestReading.mockRejectedValueOnce(new Error("Viam down"));

    const body = await getJsonBody(makeRequest({ sim: "false", truck: "01" }));

    expect(body._no_cell).toBe(true);
    expect(body._reason).toBe("viam_error");
    // Must NOT contain sim data
    expect(body._is_sim).toBeUndefined();
    expect(body.staubli).toBeUndefined();
  });

  // ── Unknown trucks ────────────────────────────────────────────────

  it("returns _no_cell for trucks not in the fleet", async () => {
    const body = await getJsonBody(makeRequest({ sim: "false", truck: "99" }));
    expect(body._no_cell).toBe(true);
    expect(body.staubli).toBeUndefined();
    expect(body._is_sim).toBeUndefined();
  });

  // ── Regression guard ──────────────────────────────────────────────

  it("real Viam data always has _is_sim: false", async () => {
    mockGetLatestReading.mockResolvedValueOnce({
      timeCaptured: new Date(),
      payload: { staubli_connected: true },
    });

    const body = await getJsonBody(makeRequest({ sim: "false", truck: "01" }));
    expect(body._is_sim).toBe(false);
  });
});
