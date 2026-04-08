"use client";

import { useUser } from "@clerk/nextjs";
import { usePathname } from "next/navigation";
import TopNav from "./TopNav";
import SectionSidebar from "./SectionSidebar";
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
          <SectionSidebar groups={section.sidebar} role={role} />
        )}
        <main className={`flex-1 min-w-0 ${hasSidebar ? "" : ""}`}>
          {children}
        </main>
      </div>
    </div>
  );
}
