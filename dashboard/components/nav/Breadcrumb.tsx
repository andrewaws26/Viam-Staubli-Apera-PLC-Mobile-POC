"use client";

import { usePathname } from "next/navigation";
import { resolveSection, buildBreadcrumbs } from "@/lib/nav-config";

export default function Breadcrumb() {
  const pathname = usePathname();
  const section = resolveSection(pathname);
  const crumbs = buildBreadcrumbs(pathname, section);

  if (crumbs.length === 0) return null;

  return (
    <nav
      aria-label="Breadcrumb"
      className="overflow-x-auto border-b border-gray-800/40 bg-gray-950/50"
    >
      <ol className="flex items-center gap-1.5 px-4 sm:px-6 py-2 text-xs text-gray-500 whitespace-nowrap">
        <li>
          <a href="/" className="hover:text-gray-300 transition-colors">
            Home
          </a>
        </li>
        {crumbs.map((crumb, i) => {
          const isLast = i === crumbs.length - 1;
          return (
            <li key={crumb.href + i} className="flex items-center gap-1.5">
              <span className="text-gray-700" aria-hidden="true">/</span>
              {isLast ? (
                <span className="text-gray-300" aria-current="page">
                  {crumb.label}
                </span>
              ) : (
                <a
                  href={crumb.href}
                  className="hover:text-gray-300 transition-colors"
                >
                  {crumb.label}
                </a>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
