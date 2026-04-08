"use client";

import SectionLayout from "@/components/nav/SectionLayout";

export default function FleetLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <SectionLayout sectionId="fleet">{children}</SectionLayout>;
}
