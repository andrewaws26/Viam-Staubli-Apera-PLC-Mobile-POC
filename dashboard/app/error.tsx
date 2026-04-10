"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950 px-4">
      <div className="text-center max-w-md">
        <h1 className="text-5xl font-black text-red-500 mb-4">Error</h1>
        <h2 className="text-xl font-bold text-gray-200 mb-2">Something went wrong</h2>
        <p className="text-gray-500 mb-2">
          {error.message || "An unexpected error occurred."}
        </p>
        {error.digest && (
          <p className="text-xs text-gray-500 mb-6 font-mono">ID: {error.digest}</p>
        )}
        <div className="flex gap-3 justify-center">
          <button
            onClick={reset}
            className="px-6 py-3 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-semibold transition-colors"
          >
            Try Again
          </button>
          <a
            href="/"
            className="px-6 py-3 rounded-lg border border-gray-700 hover:border-gray-500 text-gray-300 hover:text-white font-semibold transition-colors"
          >
            Back to Home
          </a>
        </div>
      </div>
    </div>
  );
}
