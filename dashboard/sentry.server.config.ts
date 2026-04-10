import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "https://7faf82d97f102e9a713f0b71279693b6@o4511196794454016.ingest.us.sentry.io/4511196813983744",

  // Only enable in production
  enabled: process.env.NODE_ENV === "production",

  sendDefaultPii: true,

  // 100% in dev, 10% in production
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,

  // Capture 100% of errors
  sampleRate: 1.0,

  // Attach local variable values to stack frames
  includeLocalVariables: true,

  enableLogs: true,

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
