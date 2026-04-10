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

  // Session Replay: 10% of all sessions, 100% of sessions with errors
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,

  enableLogs: true,

  integrations: [Sentry.replayIntegration()],

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

// Hook into App Router navigation transitions
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
