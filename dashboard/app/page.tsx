"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useUser } from "@clerk/nextjs";

const HomeScreen = dynamic(() => import("../components/HomeScreen"), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center gap-3">
      <div className="w-10 h-10 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
    </div>
  ),
});

const Dashboard = dynamic(() => import("../components/Dashboard"), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center gap-3">
      <div className="w-10 h-10 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
      <p className="text-gray-500 text-sm uppercase tracking-widest">
        Loading Truck Dashboard
      </p>
    </div>
  ),
});

function PageInner() {
  const searchParams = useSearchParams();
  const { isLoaded } = useUser();
  const truckId = searchParams.get("truck_id") ?? undefined;

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center gap-3">
        <div className="w-10 h-10 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
      </div>
    );
  }

  // If a truck_id is in the URL, show the truck dashboard directly
  if (truckId) {
    return <Dashboard truckId={truckId} />;
  }

  // Otherwise show the OS home screen
  return <HomeScreen />;
}

export default function Page() {
  return (
    <Suspense>
      <PageInner />
    </Suspense>
  );
}
