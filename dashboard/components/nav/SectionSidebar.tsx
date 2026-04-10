"use client";

import { usePathname } from "next/navigation";
import type { NavGroup } from "@/lib/nav-config";
import { canAccessItem } from "@/lib/nav-config";

interface Props {
  groups: NavGroup[];
  role: string;
}

export default function SectionSidebar({ groups, role }: Props) {
  const pathname = usePathname();

  const visibleGroups = groups
    .map((g) => ({
      ...g,
      items: g.items.filter((item) => canAccessItem(role, item)),
    }))
    .filter((g) => g.items.length > 0);

  if (visibleGroups.length === 0) return null;

  return (
    <aside className="hidden lg:block w-64 shrink-0 sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto border-r border-gray-800/60 bg-gray-950">
      <nav className="py-4 px-3 space-y-5">
        {visibleGroups.map((group, gi) => (
          <div key={gi}>
            {group.title && (
              <h3 className="px-3 mb-1.5 text-xs font-bold uppercase tracking-[0.2em] text-gray-600">
                {group.title}
              </h3>
            )}
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const isActive =
                  pathname === item.href ||
                  (item.href !== "/" &&
                    pathname.startsWith(item.href + "/"));
                return (
                  <li key={item.href}>
                    <a
                      href={item.href}
                      className={`block px-3 py-1.5 rounded-md text-sm transition-colors ${
                        isActive
                          ? "text-white bg-violet-500/10 border-l-2 border-violet-500 pl-2.5"
                          : "text-gray-400 hover:text-gray-200 hover:bg-gray-800/50"
                      }`}
                    >
                      {item.label}
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}
