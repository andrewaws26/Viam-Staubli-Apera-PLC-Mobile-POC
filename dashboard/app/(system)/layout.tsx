"use client";

import SectionLayout from "@/components/nav/SectionLayout";

export default function SystemLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <SectionLayout>{children}</SectionLayout>;
}
