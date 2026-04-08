"use client";

import dynamic from "next/dynamic";
import { useUser } from "@clerk/nextjs";

const TimesheetForm = dynamic(() => import("../../../components/TimesheetForm"), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center gap-3">
      <div className="w-10 h-10 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
      <p className="text-gray-600 text-sm uppercase tracking-widest">
        Loading Form
      </p>
    </div>
  ),
});

export default function NewTimesheetPage() {
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
      <header className="border-b border-gray-800 px-4 sm:px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-black tracking-widest uppercase text-gray-100">
            New Timesheet
          </h1>
          <p className="text-xs text-gray-600 mt-0.5 tracking-wide">
            IronSight — Weekly Time Tracking
          </p>
        </div>
        <a
          href="/timesheets"
          className="px-4 py-2 rounded-lg border border-gray-700 hover:border-gray-500 text-gray-400 hover:text-white text-sm font-bold uppercase tracking-wider transition-colors"
        >
          Back
        </a>
      </header>
      <main className="px-4 sm:px-6 py-6">
        <TimesheetForm
          currentUserId={user.id}
          currentUserRole={role}
        />
      </main>
    </div>
  );
}
