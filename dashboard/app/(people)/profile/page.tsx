"use client";

/**
 * /profile — My Profile page.
 *
 * Dynamically imports ProfileForm to keep bundle size down.
 * Reads the current user's Clerk metadata for role gating.
 */

import dynamic from "next/dynamic";
import { useUser } from "@clerk/nextjs";

const ProfileForm = dynamic(() => import("../../../components/ProfileForm"), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center gap-3">
      <div className="w-10 h-10 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
      <p className="text-gray-500 text-sm uppercase tracking-widest">
        Loading Profile
      </p>
    </div>
  ),
});

export default function ProfilePage() {
  const { user, isLoaded } = useUser();

  if (!isLoaded || !user) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="w-10 h-10 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
      </div>
    );
  }

  const role =
    ((user.publicMetadata as Record<string, unknown>)?.role as string) ||
    "operator";

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <main className="px-4 sm:px-6 py-6">
        <ProfileForm
          currentUserId={user.id}
          currentUserRole={role}
        />
      </main>
    </div>
  );
}
