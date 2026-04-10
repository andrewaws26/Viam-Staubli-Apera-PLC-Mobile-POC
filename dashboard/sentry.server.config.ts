import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,

  // Only enable in production
  enabled: process.env.NODE_ENV === "production",

  // Sample 10% of transactions for performance
  tracesSampleRate: 0.1,

  // Capture 100% of errors
  sampleRate: 1.0,

  // Filter known non-actionable errors
  ignoreErrors: [
    // Expected when Pi is offline
    "ECONNREFUSED",
    "ETIMEDOUT",
    // Viam SDK connection issues (Pi offline is normal)
    "failed to connect",
  ],

  beforeSend(event) {
    // Never send Viam credentials or Supabase keys
    if (event.extra) {
      for (const key of Object.keys(event.extra)) {
        if (/api.key|secret|token|password/i.test(key)) {
          event.extra[key] = "[REDACTED]";
        }
      }
    }
    return event;
  },
});
