import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth-guard";
import { getSupabase } from "@/lib/supabase";

interface HealthCheck {
  source: string;
  url: string;
  timeout: number;
}

const SERVICES: HealthCheck[] = [
  { source: "Vercel", url: `${process.env.NEXT_PUBLIC_BASE_URL || "https://viam-staubli-apera-plc-mobile-poc.vercel.app"}/api/health`, timeout: 5000 },
  { source: "Supabase", url: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/`, timeout: 5000 },
  { source: "Clerk", url: "https://api.clerk.com/v1/health", timeout: 5000 },
];

async function checkService(svc: HealthCheck) {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), svc.timeout);
    const headers: Record<string, string> = {};

    if (svc.source === "Supabase") {
      headers["apikey"] = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
    }

    const res = await fetch(svc.url, {
      signal: controller.signal,
      headers,
    });
    clearTimeout(timer);
    const responseMs = Date.now() - start;

    return {
      source: svc.source,
      status: res.ok ? "healthy" as const : "degraded" as const,
      responseMs,
      checkedAt: new Date().toISOString(),
    };
  } catch {
    return {
      source: svc.source,
      status: "down" as const,
      responseMs: Date.now() - start,
      checkedAt: new Date().toISOString(),
    };
  }
}

export async function GET() {
  const denied = await requireRole("/api/dev-portal");
  if (denied) return denied;

  const results = await Promise.all(SERVICES.map(checkService));

  // Log health checks to DB (fire-and-forget)
  try {
    const sb = getSupabase();
    await sb.from("system_health_logs").insert(
      results.map((r) => ({
        source: r.source,
        status: r.status,
        response_ms: r.responseMs,
        checked_at: r.checkedAt,
      }))
    );
  } catch {
    // Don't fail the response if logging fails
  }

  // Fetch active sessions
  let activeSessions: unknown[] = [];
  try {
    const sb = getSupabase();
    const { data } = await sb
      .from("dev_sessions")
      .select("id, session_type, status, title, started_at")
      .eq("status", "running")
      .order("started_at", { ascending: false })
      .limit(10);
    activeSessions = (data || []).map((s: Record<string, unknown>) => ({
      id: s.id,
      sessionType: s.session_type,
      status: s.status,
      title: s.title,
      startedAt: s.started_at,
    }));
  } catch {
    // Non-critical
  }

  return NextResponse.json({
    services: results,
    activeSessions,
    checkedAt: new Date().toISOString(),
  });
}
