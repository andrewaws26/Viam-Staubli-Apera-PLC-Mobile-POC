"use client";

import SectionLayout from "@/components/nav/SectionLayout";

export default function ReportsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <SectionLayout sectionId="reports">{children}</SectionLayout>;
}
