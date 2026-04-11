"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";

function getNextSaturday(): string {
  const now = new Date();
  const day = now.getDay();
  const diff = (6 - day + 7) % 7 || 7;
  const sat = new Date(now);
  sat.setDate(now.getDate() + diff);
  return sat.toISOString().split("T")[0];
}

export default function NewTimesheetPage() {
  const { user, isLoaded } = useUser();
  const router = useRouter();
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isLoaded || !user) return;

    fetch("/api/timesheets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ week_ending: getNextSaturday() }),
    })
      .then(async (r) => {
        const data = await r.json();
        if (r.status === 409 && data.existing_id) {
          // Timesheet for this week already exists — go to it
          router.replace(`/timesheets/${data.existing_id}`);
        } else if (r.ok && data.id) {
          router.replace(`/timesheets/${data.id}`);
        } else {
          setError(data.error || "Failed to create timesheet");
        }
      })
      .catch(() => setError("Failed to create timesheet"));
  }, [isLoaded, user, router]);

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center gap-3">
      {error ? (
        <div className="text-center">
          <p className="text-red-400 mb-4">{error}</p>
          <a href="/timesheets" className="text-purple-400 hover:text-purple-300 underline">Back to Timesheets</a>
        </div>
      ) : (
        <>
          <div className="w-10 h-10 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
          <p className="text-gray-500 text-sm uppercase tracking-widest">Creating Timesheet...</p>
        </>
      )}
    </div>
  );
}
