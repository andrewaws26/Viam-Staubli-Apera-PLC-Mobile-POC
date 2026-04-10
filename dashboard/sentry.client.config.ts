import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Only enable in production
  enabled: process.env.NODE_ENV === "production",

  // Sample 10% of transactions for performance monitoring
  tracesSampleRate: 0.1,

  // Capture 100% of errors
  sampleRate: 1.0,

  // Filter out noisy errors
  ignoreErrors: [
    // Browser extensions
    /chrome-extension/,
    /moz-extension/,
    // Network errors (expected when Pi is offline)
    "Failed to fetch",
    "NetworkError",
    "Load failed",
    // Clerk auth redirects
    "CLERK_",
  ],

  beforeSend(event) {
    // Strip any Viam API keys that might leak into error context
    if (event.request?.headers) {
      delete event.request.headers["authorization"];
      delete event.request.headers["x-api-key"];
    }
    return event;
  },
});
