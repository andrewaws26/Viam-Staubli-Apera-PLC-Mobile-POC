"use client";

import SectionLayout from "@/components/nav/SectionLayout";

export default function PeopleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <SectionLayout sectionId="people">{children}</SectionLayout>;
}
