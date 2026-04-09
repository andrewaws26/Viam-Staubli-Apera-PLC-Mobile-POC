"use client";

import SectionLayout from "@/components/nav/SectionLayout";

export default function ExecutiveLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <SectionLayout sectionId="finance">{children}</SectionLayout>;
}
