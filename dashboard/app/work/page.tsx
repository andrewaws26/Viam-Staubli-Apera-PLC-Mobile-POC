"use client";

import dynamic from "next/dynamic";
import { useUser } from "@clerk/nextjs";

const WorkBoard = dynamic(() => import("../../components/WorkBoard"), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center gap-3">
      <div className="w-10 h-10 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
      <p className="text-gray-600 text-sm uppercase tracking-widest">
        Loading Work Board
      </p>
    </div>
  ),
});

export default function WorkPage() {
  const { user, isLoaded } = useUser();
  const role =
    ((user?.publicMetadata as Record<string, unknown>)?.role as string) ||
    "operator";
  const allowed =
    role === "developer" ||
    role === "manager" ||
    role === "mechanic" ||
    role === "operator";

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
          <a
            href="/"
            className="inline-block mt-4 text-sm text-purple-400 hover:text-purple-300 underline"
          >
            Back to Dashboard
          </a>
        </div>
      </div>
    );
  }

  return <WorkBoard />;
}
