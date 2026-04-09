"use client";

/**
 * /pto — Time Off page.
 *
 * Shows PTO balance cards at top, then the filterable list of requests.
 * Dynamically imports PTOList and fetches balance data server-side-ish.
 */

import dynamic from "next/dynamic";
import { useUser } from "@clerk/nextjs";
import { useState, useEffect } from "react";
import type { PTOBalance } from "@ironsight/shared";
import { useToast } from "@/components/Toast";

const PTOList = dynamic(() => import("../../../components/PTOList"), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center gap-3">
      <div className="w-10 h-10 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
      <p className="text-gray-600 text-sm uppercase tracking-widest">
        Loading Time Off
      </p>
    </div>
  ),
});

export default function PTOPage() {
  const { user, isLoaded } = useUser();
  const [balance, setBalance] = useState<PTOBalance | null>(null);

  const role =
    ((user?.publicMetadata as Record<string, unknown>)?.role as string) ||
    "operator";

  const { toast } = useToast();

  // Fetch PTO balance for the header cards
  useEffect(() => {
    fetch("/api/pto/balance")
      .then((r) => r.json())
      .then((data: PTOBalance) => setBalance(data))
      .catch(() => toast("Failed to load PTO balance"));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="w-10 h-10 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <main className="px-4 sm:px-6 py-6">
        {/* Balance overview cards */}
        {balance && (
          <div className="max-w-4xl mx-auto grid grid-cols-3 gap-4 mb-6">
            <div className="p-4 rounded-xl bg-blue-900/20 border border-blue-800">
              <div className="text-2xl font-black text-blue-400">{balance.vacation_remaining}h</div>
              <div className="text-xs text-blue-300/70 uppercase tracking-wider mt-1">Vacation Left</div>
            </div>
            <div className="p-4 rounded-xl bg-amber-900/20 border border-amber-800">
              <div className="text-2xl font-black text-amber-400">{balance.sick_remaining}h</div>
              <div className="text-xs text-amber-300/70 uppercase tracking-wider mt-1">Sick Left</div>
            </div>
            <div className="p-4 rounded-xl bg-purple-900/20 border border-purple-800">
              <div className="text-2xl font-black text-purple-400">{balance.personal_remaining}h</div>
              <div className="text-xs text-purple-300/70 uppercase tracking-wider mt-1">Personal Left</div>
            </div>
          </div>
        )}

        <PTOList currentUserRole={role} />
      </main>
    </div>
  );
}
