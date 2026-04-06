"use client";

import { useUser } from "@clerk/nextjs";
import TruckAssignments from "@/components/TruckAssignments";

export default function AdminPage() {
  const { user, isLoaded } = useUser();
  const role = (user?.publicMetadata as Record<string, unknown>)?.role as string || "operator";
  const allowed = role === "developer" || role === "manager";

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="w-10 h-10 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-xl font-bold text-gray-300">Access Denied</h1>
          <p className="text-sm text-gray-600 mt-2">This page is restricted to developers and managers.</p>
          <a href="/" className="inline-block mt-4 text-sm text-purple-400 hover:text-purple-300 underline">Back to Dashboard</a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 px-4 sm:px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg sm:text-2xl font-black tracking-widest uppercase text-gray-100">Fleet Admin</h1>
          <p className="text-[10px] sm:text-xs text-gray-600 mt-0.5 tracking-wide">
            IronSight — Truck Assignments
          </p>
        </div>
        <a
          href="/"
          className="min-h-[44px] px-4 py-2 rounded-lg border border-gray-700 hover:border-gray-500 text-gray-300 hover:text-white text-xs font-bold uppercase tracking-wider transition-colors flex items-center"
        >
          Dashboard
        </a>
      </header>
      <main className="px-4 sm:px-6 py-6 max-w-6xl mx-auto">
        <TruckAssignments />
      </main>
    </div>
  );
}
