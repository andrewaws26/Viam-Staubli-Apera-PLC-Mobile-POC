"use client";

import dynamic from "next/dynamic";
import { useUser } from "@clerk/nextjs";

const TimesheetAdmin = dynamic(() => import("../../../../components/TimesheetAdmin"), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center gap-3">
      <div className="w-10 h-10 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
      <p className="text-gray-500 text-sm uppercase tracking-widest">
        Loading Admin View
      </p>
    </div>
  ),
});

export default function TimesheetAdminPage() {
  const { user, isLoaded } = useUser();
  const role =
    ((user?.publicMetadata as Record<string, unknown>)?.role as string) ||
    "operator";
  const isManager = role === "developer" || role === "manager";

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="w-10 h-10 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
      </div>
    );
  }

  if (!isManager) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-xl font-bold text-gray-300">Access Denied</h1>
          <p className="text-gray-500 mt-2">Manager or developer role required.</p>
          <a
            href="/timesheets"
            className="inline-block mt-4 text-sm text-purple-400 hover:text-purple-300 underline"
          >
            Back to My Timesheets
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <main className="px-4 sm:px-6 py-6">
        <TimesheetAdmin />
      </main>
    </div>
  );
}
