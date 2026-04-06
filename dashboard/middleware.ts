// Clerk Auth Middleware — SCAFFOLDED, not yet active
// To activate: npm install @clerk/nextjs, then uncomment the import and export below.
// Set env vars: NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, CLERK_SECRET_KEY

// import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Public routes that don't require authentication
// const isPublicRoute = createRouteMatcher([
//   "/sign-in(.*)",
//   "/sign-up(.*)",
// ]);

// export default clerkMiddleware(async (auth, request) => {
//   if (!isPublicRoute(request)) {
//     await auth.protect();
//   }
// });

// Placeholder: no-op middleware until Clerk is installed
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(_request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};
