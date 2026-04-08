"use client";

import { usePathname } from "next/navigation";
import { resolveSection, buildBreadcrumbs } from "@/lib/nav-config";

export default function Breadcrumb() {
  const pathname = usePathname();
  const section = resolveSection(pathname);
  const crumbs = buildBreadcrumbs(pathname, section);

  if (crumbs.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5 px-4 sm:px-6 py-2 text-xs text-gray-500 border-b border-gray-800/40 bg-gray-950/50">
      <a href="/" className="hover:text-gray-300 transition-colors">
        Home
      </a>
      {crumbs.map((crumb, i) => {
        const isLast = i === crumbs.length - 1;
        return (
          <span key={crumb.href + i} className="flex items-center gap-1.5">
            <span className="text-gray-700">/</span>
            {isLast ? (
              <span className="text-gray-300">{crumb.label}</span>
            ) : (
              <a
                href={crumb.href}
                className="hover:text-gray-300 transition-colors"
              >
                {crumb.label}
              </a>
            )}
          </span>
        );
      })}
    </div>
  );
}
