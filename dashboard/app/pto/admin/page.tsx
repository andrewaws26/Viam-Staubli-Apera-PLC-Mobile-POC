"use client";

/**
 * /pto/admin — PTO Management page (manager/developer only).
 *
 * Gates access by role. Dynamically imports PTOAdmin component.
 */

import dynamic from "next/dynamic";
import { useUser } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import AppNav from "@/components/AppNav";

const PTOAdmin = dynamic(() => import("../../../components/PTOAdmin"), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center gap-3">
      <div className="w-10 h-10 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
      <p className="text-gray-600 text-sm uppercase tracking-widest">
        Loading PTO Management
      </p>
    </div>
  ),
});

export default function PTOAdminPage() {
  const { user, isLoaded } = useUser();
  const router = useRouter();

  const role =
    ((user?.publicMetadata as Record<string, unknown>)?.role as string) ||
    "operator";
  const isAuthorized = role === "developer" || role === "manager";

  // Redirect unauthorized users back to /pto
  useEffect(() => {
    if (isLoaded && !isAuthorized) {
      router.replace("/pto");
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
      <AppNav pageTitle="PTO Admin" />
      <main className="px-4 sm:px-6 py-6">
        <PTOAdmin />
      </main>
    </div>
  );
}
