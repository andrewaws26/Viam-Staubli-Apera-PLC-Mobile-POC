const STATUS_STYLES: Record<string, string> = {
  // Timesheets / Work Orders
  draft: "bg-gray-700/50 text-gray-300 border-gray-600",
  submitted: "bg-blue-900/40 text-blue-300 border-blue-800/50",
  approved: "bg-emerald-900/40 text-emerald-300 border-emerald-800/50",
  rejected: "bg-red-900/40 text-red-300 border-red-800/50",
  // Work Orders
  open: "bg-gray-700/50 text-gray-300 border-gray-600",
  in_progress: "bg-amber-900/40 text-amber-300 border-amber-800/50",
  blocked: "bg-red-900/40 text-red-300 border-red-800/50",
  done: "bg-emerald-900/40 text-emerald-300 border-emerald-800/50",
  // Invoices / Bills
  sent: "bg-blue-900/40 text-blue-300 border-blue-800/50",
  partial: "bg-amber-900/40 text-amber-300 border-amber-800/50",
  paid: "bg-emerald-900/40 text-emerald-300 border-emerald-800/50",
  overdue: "bg-red-900/40 text-red-300 border-red-800/50",
  voided: "bg-gray-800/50 text-gray-500 border-gray-700",
  // Journal Entries
  posted: "bg-emerald-900/40 text-emerald-300 border-emerald-800/50",
  // Jobs
  bidding: "bg-blue-900/40 text-blue-300 border-blue-800/50",
  active: "bg-emerald-900/40 text-emerald-300 border-emerald-800/50",
  completed: "bg-gray-700/50 text-gray-300 border-gray-600",
  closed: "bg-gray-800/50 text-gray-500 border-gray-700",
  // PTO
  pending: "bg-amber-900/40 text-amber-300 border-amber-800/50",
  cancelled: "bg-gray-800/50 text-gray-500 border-gray-700",
  // Training
  current: "bg-emerald-900/40 text-emerald-300 border-emerald-800/50",
  expiring_soon: "bg-amber-900/40 text-amber-300 border-amber-800/50",
  expired: "bg-red-900/40 text-red-300 border-red-800/50",
  missing: "bg-gray-800/50 text-gray-500 border-gray-700",
};

const FALLBACK = "bg-gray-700/50 text-gray-300 border-gray-600";

interface Props {
  status: string;
  label?: string;
  className?: string;
}

export default function StatusBadge({ status, label, className = "" }: Props) {
  const style = STATUS_STYLES[status] ?? FALLBACK;
  const display = label ?? status.replace(/_/g, " ");

  return (
    <span
      className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border capitalize ${style} ${className}`}
    >
      {display}
    </span>
  );
}
