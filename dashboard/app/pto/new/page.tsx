"use client";

/**
 * /pto/new — Request Time Off page.
 *
 * Dynamically imports PTORequestForm.
 */

import dynamic from "next/dynamic";
import { useUser } from "@clerk/nextjs";
import AppNav from "@/components/AppNav";

const PTORequestForm = dynamic(() => import("../../../components/PTORequestForm"), {
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

export default function NewPTOPage() {
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
      <AppNav pageTitle="New PTO Request" />
      <main className="px-4 sm:px-6 py-6">
        <PTORequestForm currentUserId={user.id} />
      </main>
    </div>
  );
}
