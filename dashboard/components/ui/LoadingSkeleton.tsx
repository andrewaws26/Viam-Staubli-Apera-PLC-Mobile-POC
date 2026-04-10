interface Props {
  variant?: "page" | "cards" | "table" | "inline";
  rows?: number;
  columns?: number;
}

function Pulse({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse bg-gray-800 rounded ${className}`} />;
}

function PageSkeleton() {
  return (
    <div className="space-y-6 p-4 sm:p-6">
      <Pulse className="h-8 w-48" />
      <Pulse className="h-4 w-32" />
      <div className="space-y-3 mt-8">
        <Pulse className="h-20 w-full rounded-xl" />
        <Pulse className="h-20 w-full rounded-xl" />
        <Pulse className="h-20 w-full rounded-xl" />
      </div>
    </div>
  );
}

function CardsSkeleton({ columns = 4 }: { columns?: number }) {
  return (
    <div className={`grid grid-cols-2 sm:grid-cols-${columns} gap-3 p-4 sm:p-6`}>
      {Array.from({ length: columns }).map((_, i) => (
        <div key={i} className="rounded-xl border border-gray-800 p-4 space-y-3">
          <Pulse className="h-4 w-20" />
          <Pulse className="h-8 w-16" />
          <Pulse className="h-3 w-24" />
        </div>
      ))}
    </div>
  );
}

function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-4 sm:p-6">
      <Pulse className="h-10 w-full rounded-lg" />
      {Array.from({ length: rows }).map((_, i) => (
        <Pulse key={i} className="h-12 w-full rounded-lg" />
      ))}
    </div>
  );
}

function InlineSkeleton() {
  return (
    <div className="flex items-center justify-center py-8">
      <div className="w-6 h-6 rounded-full border-2 border-gray-700 border-t-gray-400 animate-spin" />
    </div>
  );
}

export default function LoadingSkeleton({ variant = "page", rows, columns }: Props) {
  switch (variant) {
    case "cards":
      return <CardsSkeleton columns={columns} />;
    case "table":
      return <TableSkeleton rows={rows} />;
    case "inline":
      return <InlineSkeleton />;
    default:
      return <PageSkeleton />;
  }
}
