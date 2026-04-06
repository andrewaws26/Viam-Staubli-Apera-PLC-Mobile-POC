/**
 * Shared utilities for AI endpoints — readings filtering and truncation handling.
 */

/**
 * Compact readings JSON for AI prompts.
 * Removes internal metadata keys (prefixed with _) and null values.
 * Uses compact JSON formatting instead of pretty-print to save tokens.
 *
 * Keeps "N/A", "NO SIGNAL", and zero values — those are diagnostically meaningful
 * (e.g., SCR temp reading N/A triggers DEF dosing disabled detection).
 */
export function compactReadings(readings: Record<string, unknown>): string {
  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(readings)) {
    if (key.startsWith("_")) continue;
    if (value === null || value === undefined) continue;
    filtered[key] = value;
  }
  return JSON.stringify(filtered);
}

/** Truncation notice appended when Claude hits max_tokens */
export const TRUNCATION_NOTICE =
  "\n\n*[Response was cut short due to length. Ask me to continue or narrow your question.]*";

/**
 * Append a truncation notice if Claude's response was cut off (stop_reason === "max_tokens").
 */
export function appendTruncationNotice(
  stopReason: string | undefined,
  reply: string
): string {
  if (stopReason === "max_tokens") {
    return reply + TRUNCATION_NOTICE;
  }
  return reply;
}
