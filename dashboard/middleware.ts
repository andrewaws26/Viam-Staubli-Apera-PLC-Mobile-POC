import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/tour(.*)",
  "/api/webhooks(.*)",
  "/api/share/:token",
  "/shared(.*)",
]);

export default clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    await auth.protect();
  }
});

export const config = {
  // Exclude Sentry monitoring tunnel, Next.js internals, and static files
  matcher: [
    "/((?!monitoring|.*\\..*|_next).*)",
    "/",
    "/(api|trpc)(.*)",
  ],
};
