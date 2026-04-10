"use client";

import { useUser } from "@clerk/nextjs";
import FleetManager from "@/components/FleetManager";
import TruckAssignments from "@/components/TruckAssignments";
import AuditLogViewer from "@/components/AuditLogViewer";
import TeamRoster from "@/components/TeamRoster";

export default function AdminPage() {
  const { user, isLoaded } = useUser();
  const role = (user?.publicMetadata as Record<string, unknown>)?.role as string || "operator";
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
          <p className="text-sm text-gray-500 mt-2">This page is restricted to developers and managers.</p>
          <a href="/" className="inline-block mt-4 text-sm text-purple-400 hover:text-purple-300 underline">Back to Dashboard</a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <main className="px-4 sm:px-6 py-6 max-w-6xl mx-auto space-y-8">
        <TeamRoster />
        <FleetManager />
        <TruckAssignments />
        <AuditLogViewer />
      </main>
    </div>
  );
}
