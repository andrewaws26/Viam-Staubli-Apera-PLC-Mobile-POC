// ---------------------------------------------------------------------------
// Loading skeleton shown while report data is being fetched
// ---------------------------------------------------------------------------

export function LoadingSkeleton({ rangeLabel }: { rangeLabel: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-4">
      <div className="w-10 h-10 rounded-full border-2 border-gray-700 border-t-green-500 animate-spin" />
      <div className="text-center">
        <p className="text-gray-300 font-semibold">Generating Shift Report</p>
        <p className="text-gray-500 text-sm mt-1">Querying Viam Cloud for TPS + truck data...</p>
        <p className="text-gray-500 text-xs mt-1">{rangeLabel}</p>
      </div>
      <div className="w-full max-w-3xl grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4 mt-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-gray-900 rounded-xl border border-gray-800 p-4 animate-pulse">
            <div className="h-3 w-20 bg-gray-800 rounded mb-3" />
            <div className="h-8 w-16 bg-gray-800 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
