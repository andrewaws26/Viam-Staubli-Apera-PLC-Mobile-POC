/**
 * Structured logging utility for IronSight.
 *
 * Provides consistent log prefixes, context tags, and severity levels
 * across all API routes and background jobs.
 *
 * Usage:
 *   const log = createLogger("SHIFT-REPORT");
 *   log.info("Query complete", { rows: 42, ms: 120 });
 *   log.error("Query failed", { sql, error: err.message });
 */

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogContext {
  [key: string]: unknown;
}

interface Logger {
  debug(message: string, ctx?: LogContext): void;
  info(message: string, ctx?: LogContext): void;
  warn(message: string, ctx?: LogContext): void;
  error(message: string, ctx?: LogContext): void;
}

function formatCtx(ctx?: LogContext): string {
  if (!ctx || Object.keys(ctx).length === 0) return "";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(ctx)) {
    if (v instanceof Error) {
      parts.push(`${k}=${v.message}`);
    } else if (typeof v === "object" && v !== null) {
      parts.push(`${k}=${JSON.stringify(v)}`);
    } else {
      parts.push(`${k}=${String(v)}`);
    }
  }
  return " " + parts.join(" ");
}

const LEVEL_MAP: Record<LogLevel, (...args: string[]) => void> = {
  debug: console.debug,
  info: console.log,
  warn: console.warn,
  error: console.error,
};

export function createLogger(prefix: string): Logger {
  const log = (level: LogLevel, message: string, ctx?: LogContext) => {
    const fn = LEVEL_MAP[level];
    fn(`[${prefix}]`, message + formatCtx(ctx));
  };

  return {
    debug: (msg, ctx?) => log("debug", msg, ctx),
    info: (msg, ctx?) => log("info", msg, ctx),
    warn: (msg, ctx?) => log("warn", msg, ctx),
    error: (msg, ctx?) => log("error", msg, ctx),
  };
}
