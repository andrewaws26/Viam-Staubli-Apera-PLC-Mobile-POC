/**
 * Returns the current user ID for chat components.
 *
 * TODO: Once Clerk is fully activated (ClerkProvider wrapping the app),
 * replace this with Clerk's useUser hook.
 */

const DEV_USER_ID = "user_andrew";

export function useCurrentUser(): { userId: string; isLoaded: boolean } {
  return { userId: DEV_USER_ID, isLoaded: true };
}
