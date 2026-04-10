"use client";

import { useState } from "react";
import { useUser } from "@clerk/nextjs";
import { usePathname } from "next/navigation";
import TopNav from "./TopNav";
import SectionSidebar from "./SectionSidebar";
import MobileDrawer from "./MobileDrawer";
import Breadcrumb from "./Breadcrumb";
import { resolveSection } from "@/lib/nav-config";

interface Props {
  children: React.ReactNode;
  /** Override section detection (for route group layouts that know their section) */
  sectionId?: string;
}

export default function SectionLayout({ children, sectionId }: Props) {
  const { user } = useUser();
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const role =
    ((user?.publicMetadata as Record<string, unknown>)?.role as string) ||
    "operator";

  const section = sectionId
    ? (resolveSection(pathname) ??
      { id: sectionId, label: sectionId, href: "/", sidebar: [] })
    : resolveSection(pathname);

  const hasSidebar = section && section.sidebar.length > 0;

  return (
    <div className="min-h-screen bg-gray-950">
      <TopNav />
      <Breadcrumb />
      <div className="flex">
        {hasSidebar && (
          <>
            <SectionSidebar groups={section.sidebar} role={role} />
            <MobileDrawer
              groups={section.sidebar}
              role={role}
              open={drawerOpen}
              onClose={() => setDrawerOpen(false)}
            />
          </>
        )}
        <main className={`flex-1 min-w-0 px-4 sm:px-6 lg:px-8 py-6 ${hasSidebar ? "max-w-6xl" : "max-w-7xl mx-auto"}`}>
          {hasSidebar && (
            <button
              onClick={() => setDrawerOpen(true)}
              className="lg:hidden mb-4 p-2 rounded-md text-gray-400 hover:text-gray-200 hover:bg-gray-800/50 transition-colors"
              aria-label="Open navigation menu"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
