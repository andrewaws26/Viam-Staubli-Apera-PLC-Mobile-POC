"use client";

import SectionLayout from "@/components/nav/SectionLayout";

export default function OperationsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <SectionLayout sectionId="operations">{children}</SectionLayout>;
}
