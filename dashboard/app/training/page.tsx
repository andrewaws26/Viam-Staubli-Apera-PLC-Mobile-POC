"use client";

/**
 * /training — My Training page.
 *
 * Shows the current user's training compliance status and requirements.
 * Dynamically imports TrainingStatus component.
 */

import dynamic from "next/dynamic";
import { useUser } from "@clerk/nextjs";
import AppNav from "@/components/AppNav";

const TrainingStatus = dynamic(() => import("../../components/TrainingStatus"), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center gap-3">
      <div className="w-10 h-10 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
      <p className="text-gray-600 text-sm uppercase tracking-widest">
        Loading Training
      </p>
    </div>
  ),
});

export default function TrainingPage() {
  const { user, isLoaded } = useUser();

  if (!isLoaded || !user) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="w-10 h-10 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <AppNav pageTitle="Training" />
      <main className="px-4 sm:px-6 py-6">
        <TrainingStatus currentUserId={user.id} />
      </main>
    </div>
  );
}
