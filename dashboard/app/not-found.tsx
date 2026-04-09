import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950 px-4">
      <div className="text-center max-w-md">
        <h1 className="text-6xl font-black text-purple-500 mb-4">404</h1>
        <h2 className="text-xl font-bold text-gray-200 mb-2">Page Not Found</h2>
        <p className="text-gray-500 mb-8">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <Link
          href="/"
          className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-semibold transition-colors"
        >
          Back to IronSight
        </Link>
      </div>
    </div>
  );
}
