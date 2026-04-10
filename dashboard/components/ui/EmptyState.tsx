import type { ReactNode } from "react";

interface Props {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}

export default function EmptyState({ icon, title, description, action }: Props) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      {icon && (
        <div className="w-14 h-14 rounded-2xl bg-gray-800/60 flex items-center justify-center text-gray-500 mb-4">
          {icon}
        </div>
      )}
      <h3 className="text-sm font-semibold text-gray-300">{title}</h3>
      {description && (
        <p className="text-xs text-gray-500 mt-1.5 max-w-xs">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
