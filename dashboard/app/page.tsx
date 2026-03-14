import dynamic from "next/dynamic";

// Dashboard is loaded client-side only.
// The Viam SDK uses browser APIs (WebRTC, AudioContext) that cannot run
// during Next.js server-side rendering.
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

export default function Page() {
  return <Dashboard />;
}
