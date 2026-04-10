import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "https://7faf82d97f102e9a713f0b71279693b6@o4511196794454016.ingest.us.sentry.io/4511196813983744",

  enabled: process.env.NODE_ENV === "production",

  sendDefaultPii: true,

  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,

  enableLogs: true,
});
