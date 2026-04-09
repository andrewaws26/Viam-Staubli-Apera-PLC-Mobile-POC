"use client";

import SectionLayout from "@/components/nav/SectionLayout";

export default function DevPortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <SectionLayout sectionId="devportal">{children}</SectionLayout>;
}
