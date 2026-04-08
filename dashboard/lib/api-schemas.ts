/**
 * Zod schemas for API route input validation.
 *
 * Centralizes validation for all POST body and query parameter shapes.
 * Each schema is co-located with a TypeScript type inferred from it,
 * so the schema IS the type definition — no drift possible.
 *
 * USAGE IN API ROUTES:
 *   import { AiChatBody, parseBody } from "@/lib/api-schemas";
 *   const body = parseBody(AiChatBody, await request.json());
 *   if (body.error) return NextResponse.json(body.error, { status: 400 });
 *   const { messages, readings } = body.data;
 *
 * WHY ZOD:
 * Without runtime validation, malformed requests silently produce garbage
 * data that flows into Claude prompts or sensor displays. Zod catches
 * these at the API boundary — the only place validation matters.
 *
 * WHEN TO UPDATE:
 * When you add a new API route or change an existing body shape, add or
 * update the corresponding schema here. The TypeScript compiler will
 * catch any mismatches between the schema and the route code.
 */

import { z } from "zod/v4";

// ── Shared Primitives ─────────────────────────────────────────────

/** A chat message with role and content. */
const ChatMessage = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1),
});

/** Sensor readings — flexible key-value map from CAN bus / Modbus. */
const SensorReadings = z.record(z.string(), z.unknown());

// ── AI Chat Endpoint ──────────────────────────────────────────────

export const AiChatBody = z.object({
  messages: z.array(ChatMessage).min(1),
  readings: SensorReadings.optional().default({}),
});
export type AiChatBodyType = z.infer<typeof AiChatBody>;

// ── AI Diagnose Endpoint ──────────────────────────────────────────

export const AiDiagnoseBody = z.object({
  readings: SensorReadings,
});
export type AiDiagnoseBodyType = z.infer<typeof AiDiagnoseBody>;

// ── Truck Command Endpoint ────────────────────────────────────────

export const TruckCommandBody = z.object({
  command: z.enum([
    "clear_dtcs",
    "request_pgn",
    "get_bus_stats",
    "get_supported_pgns",
    "send_raw",
    "get_freeze_frame",
    "get_readiness",
    "get_vin",
    "get_pending_dtcs",
    "get_permanent_dtcs",
  ]),
  // Optional params vary by command
  pgn: z.number().int().min(0).max(131071).optional(),
  source_address: z.number().int().min(0).max(255).optional(),
  can_id: z.number().int().optional(),
  data_hex: z.string().optional(),
});
export type TruckCommandBodyType = z.infer<typeof TruckCommandBody>;

// ── PLC Command Endpoint ──────────────────────────────────────────

export const PlcCommandBody = z.object({
  action: z.enum([
    "test_eject",
    "software_eject",
    "reset_counters",
    "set_mode",
    "set_spacing",
    "toggle_drop_enable",
    "toggle_laser",
    "toggle_encoder_reset",
    "set_detector_offset",
    "clear_data_counts",
    "list_profiles",
    "provision",
    "read_config",
  ]),
  // Optional params vary by action
  output: z.string().optional(),
  mode: z.string().optional(),
  inches: z.number().optional(),
  raw: z.number().int().optional(),
  offset_inches: z.number().optional(),
  truck_id: z.string().optional(),
  machine_address: z.string().optional(),
});
export type PlcCommandBodyType = z.infer<typeof PlcCommandBody>;

// ── Cell Command Endpoint ────────────────────────────────────────

export const CellCommandBody = z.object({
  command: z.enum([
    "status",
    "discover",
    "poll_all",
    "raw_staubli",
    "raw_apera",
    "apera_health",
    "apera_reconnect",
    "apera_restart",
  ]),
});
export type CellCommandBodyType = z.infer<typeof CellCommandBody>;

// ── Shift Report Query Params ─────────────────────────────────────

export const ShiftReportQuery = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD").optional(),
  shift: z.enum(["day", "night", "full"]).optional(),
  startHour: z.coerce.number().int().min(0).max(23).optional(),
  startMin: z.coerce.number().int().min(0).max(59).optional(),
  endHour: z.coerce.number().int().min(0).max(23).optional(),
  endMin: z.coerce.number().int().min(0).max(59).optional(),
  debug: z.enum(["1"]).optional(),
  truck_id: z.string().optional(),
});

// ── History Query Params ──────────────────────────────────────────

export const HistoryQuery = z.object({
  hours: z.coerce.number().min(0.1).max(168).optional().default(8),
  type: z.enum(["recent", "summary"]).optional().default("summary"),
  truck_id: z.string().optional(),
});

export const TruckHistoryQuery = z.object({
  hours: z.coerce.number().min(0.1).max(168).optional().default(4),
  vin: z.string().optional(),
  truck_id: z.string().optional(),
});

// ── Report Generator ────────────────────────────────────────────

export const ReportGenerateBody = z.object({
  prompt: z.string().min(5).max(2000),
});
export type ReportGenerateBodyType = z.infer<typeof ReportGenerateBody>;

export const ReportSaveBody = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  prompt: z.string().min(1),
  generated_sql: z.string().min(1),
  category: z.string().optional(),
  is_shared: z.boolean().optional(),
});
export type ReportSaveBodyType = z.infer<typeof ReportSaveBody>;

export const ReportUpdateBody = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  category: z.string().optional(),
  is_shared: z.boolean().optional(),
});
export type ReportUpdateBodyType = z.infer<typeof ReportUpdateBody>;

// ── Parse Helper ──────────────────────────────────────────────────

/**
 * Parse and validate a request body against a Zod schema.
 * Returns { data } on success, { error } on failure with formatted message.
 *
 * Usage:
 *   const result = parseBody(AiChatBody, rawBody);
 *   if (result.error) return NextResponse.json(result.error, { status: 400 });
 *   const { messages } = result.data;
 */
export function parseBody<T>(
  schema: z.ZodType<T>,
  data: unknown,
): { data: T; error?: never } | { data?: never; error: { error: string; details: string[] } } {
  const result = schema.safeParse(data);
  if (result.success) {
    return { data: result.data };
  }
  const details = result.error.issues.map(
    (issue) => `${issue.path.join(".")}: ${issue.message}`
  );
  return {
    error: {
      error: "Validation failed",
      details,
    },
  };
}

/**
 * Parse query parameters from a NextRequest URL.
 * Extracts all searchParams into an object, then validates.
 */
export function parseQuery<T>(
  schema: z.ZodType<T>,
  searchParams: URLSearchParams,
): { data: T; error?: never } | { data?: never; error: { error: string; details: string[] } } {
  const raw: Record<string, string> = {};
  searchParams.forEach((value, key) => {
    raw[key] = value;
  });
  return parseBody(schema, raw);
}
