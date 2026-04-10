"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import dynamic from "next/dynamic";
import { useUser } from "@clerk/nextjs";
import type { Timesheet } from "@ironsight/shared";

const TimesheetForm = dynamic(() => import("../../../../components/TimesheetForm"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center py-20">
      <div className="w-10 h-10 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
    </div>
  ),
});

export default function EditTimesheetPage() {
  const { id } = useParams<{ id: string }>();
  const { user, isLoaded } = useUser();
  const [timesheet, setTimesheet] = useState<Timesheet | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!id) return;
    fetch(`/api/timesheets/${id}`)
      .then((r) => {
        if (!r.ok) throw new Error("Not found");
        return r.json();
      })
      .then((data) => setTimesheet(data))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (!isLoaded || loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center gap-3">
        <div className="w-10 h-10 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
        <p className="text-gray-500 text-sm uppercase tracking-widest">Loading Timesheet</p>
      </div>
    );
  }

  if (error || !timesheet) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-xl font-bold text-gray-300">Timesheet Not Found</h1>
          <a
            href="/timesheets"
            className="inline-block mt-4 text-sm text-purple-400 hover:text-purple-300 underline"
          >
            Back to Timesheets
          </a>
        </div>
      </div>
    );
  }

  const role =
    ((user?.publicMetadata as Record<string, unknown>)?.role as string) ||
    "operator";

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 px-4 sm:px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-black tracking-widest uppercase text-gray-100">
            Timesheet
          </h1>
          <p className="text-xs text-gray-500 mt-0.5 tracking-wide">
            {timesheet.user_name} — Week ending {new Date(timesheet.week_ending + "T12:00:00").toLocaleDateString()}
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
          existingTimesheet={timesheet}
          currentUserId={user?.id || ""}
          currentUserRole={role}
        />
      </main>
    </div>
  );
}
