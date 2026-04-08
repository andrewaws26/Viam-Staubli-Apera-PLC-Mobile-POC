"use client";

/**
 * /training/admin — Training Compliance management page (manager/developer only).
 *
 * Gates access by role. Dynamically imports TrainingAdmin component.
 */

import dynamic from "next/dynamic";
import { useUser } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

const TrainingAdmin = dynamic(() => import("../../../components/TrainingAdmin"), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center gap-3">
      <div className="w-10 h-10 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
      <p className="text-gray-600 text-sm uppercase tracking-widest">
        Loading Training Compliance
      </p>
    </div>
  ),
});

export default function TrainingAdminPage() {
  const { user, isLoaded } = useUser();
  const router = useRouter();

  const role =
    ((user?.publicMetadata as Record<string, unknown>)?.role as string) ||
    "operator";
  const isAuthorized = role === "developer" || role === "manager";

  // Redirect unauthorized users back to /training
  useEffect(() => {
    if (isLoaded && !isAuthorized) {
      router.replace("/training");
    }
  }, [isLoaded, isAuthorized, router]);

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="w-10 h-10 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
      </div>
    );
  }

  if (!isAuthorized) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <p className="text-gray-500">Redirecting...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 px-4 sm:px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-black tracking-widest uppercase text-gray-100">
            Training Compliance
          </h1>
          <p className="text-xs text-gray-600 mt-0.5 tracking-wide">
            IronSight — Employee Training Management
          </p>
        </div>
        <div className="flex gap-2">
          <a
            href="/training"
            className="px-4 py-2 rounded-lg border border-gray-700 hover:border-gray-500 text-gray-400 hover:text-white text-sm font-bold uppercase tracking-wider transition-colors"
          >
            My Training
          </a>
          <a
            href="/"
            className="px-4 py-2 rounded-lg border border-gray-700 hover:border-gray-500 text-gray-400 hover:text-white text-sm font-bold uppercase tracking-wider transition-colors"
          >
            Dashboard
          </a>
        </div>
      </header>
      <main className="px-4 sm:px-6 py-6">
        <TrainingAdmin />
      </main>
    </div>
  );
}
