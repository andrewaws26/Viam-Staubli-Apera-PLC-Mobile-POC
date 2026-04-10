"use client";

import { useEffect, useCallback } from "react";
import { usePathname } from "next/navigation";
import type { NavGroup } from "@/lib/nav-config";
import { canAccessItem } from "@/lib/nav-config";

interface Props {
  groups: NavGroup[];
  role: string;
  open: boolean;
  onClose: () => void;
}

export default function MobileDrawer({ groups, role, open, onClose }: Props) {
  const pathname = usePathname();

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    if (open) {
      document.addEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [open, handleKeyDown]);

  const visibleGroups = groups
    .map((g) => ({
      ...g,
      items: g.items.filter((item) => canAccessItem(role, item)),
    }))
    .filter((g) => g.items.length > 0);

  if (visibleGroups.length === 0) return null;

  return (
    <div
      className={`fixed inset-0 z-50 lg:hidden transition-opacity duration-300 ${
        open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
      }`}
      role="dialog"
      aria-modal="true"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <aside
        className={`absolute top-0 left-0 h-full w-72 bg-gray-950 border-r border-gray-800/60 shadow-xl transition-transform duration-300 ease-in-out ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Header with close button */}
        <div className="flex items-center justify-between px-4 h-14 border-b border-gray-800/60">
          <span className="text-sm font-semibold text-gray-200">Navigation</span>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-gray-400 hover:text-gray-200 hover:bg-gray-800/50 transition-colors"
            aria-label="Close navigation"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Nav items — same structure as SectionSidebar */}
        <nav className="py-4 px-3 space-y-5 overflow-y-auto h-[calc(100%-3.5rem)]">
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
                        onClick={onClose}
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
    </div>
  );
}
