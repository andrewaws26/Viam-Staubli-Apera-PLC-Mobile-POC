"use client";

import { useUser } from "@clerk/nextjs";
import TeamRoster from "@/components/TeamRoster";

export default function TeamPage() {
  const { user, isLoaded } = useUser();
  const role =
    ((user?.publicMetadata as Record<string, unknown>)?.role as string) ||
    "operator";
  const allowed = role === "developer" || role === "manager";

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="w-10 h-10 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="text-center">
          <h1 className="text-xl font-bold text-gray-300">Access Denied</h1>
          <p className="text-sm text-gray-600 mt-2">Team roster is restricted to managers and developers.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-6 py-6 max-w-6xl mx-auto">
      <TeamRoster />
    </div>
  );
}
