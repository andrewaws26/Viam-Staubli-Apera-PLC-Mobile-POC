"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

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
  const truckId = searchParams.get("truck_id") ?? undefined;
  return <Dashboard truckId={truckId} />;
}

export default function Page() {
  return (
    <Suspense>
      <PageInner />
    </Suspense>
  );
}
