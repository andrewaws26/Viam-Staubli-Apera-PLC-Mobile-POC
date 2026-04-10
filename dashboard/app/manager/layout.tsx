"use client";

import SectionLayout from "@/components/nav/SectionLayout";

export default function ManagerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <SectionLayout sectionId="manager">{children}</SectionLayout>;
}
