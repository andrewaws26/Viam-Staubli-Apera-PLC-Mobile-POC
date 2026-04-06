"use client";

import dynamic from "next/dynamic";
import { useSearchParams, useRouter } from "next/navigation";
import { Suspense, useEffect } from "react";
import { useUser } from "@clerk/nextjs";

const Dashboard = dynamic(() => import("../components/Dashboard"), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center gap-3">
      <div className="w-10 h-10 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
      <p className="text-gray-600 text-sm uppercase tracking-widest">
        Initialising
      </p>
    </div>
  ),
});

function PageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user, isLoaded } = useUser();
  const truckId = searchParams.get("truck_id") ?? undefined;
  const role = (user?.publicMetadata as Record<string, unknown>)?.role as string || "operator";
  const isFleetUser = role === "developer" || role === "manager" || role === "mechanic";

  // Redirect fleet users (non-operators) to /fleet when they hit / without a truck_id
  useEffect(() => {
    if (isLoaded && isFleetUser && !truckId) {
      router.replace("/fleet");
    }
  }, [isLoaded, isFleetUser, truckId, router]);

  // Show spinner while redirecting
  if (!isLoaded || (isFleetUser && !truckId)) {
    return (
      <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center gap-3">
        <div className="w-10 h-10 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
        <p className="text-gray-600 text-sm uppercase tracking-widest">
          Initialising
        </p>
      </div>
    );
  }

  return <Dashboard truckId={truckId} />;
}

export default function Page() {
  return (
    <Suspense>
      <PageInner />
    </Suspense>
  );
}
