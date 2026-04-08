"use client";

import { useState } from "react";

interface SectionDef {
  id: string;
  label: string;
}

export function DocsLayout({
  title,
  subtitle,
  sections,
  children,
}: {
  title: string;
  subtitle: string;
  sections: readonly SectionDef[];
  children: React.ReactNode;
}) {
  const [activeSection, setActiveSection] = useState<string>(sections[0]?.id ?? "");
  const [searchQuery, setSearchQuery] = useState("");

  const filteredSections = searchQuery
    ? sections.filter(
        (s) =>
          s.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
          s.id.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : sections;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-black tracking-tight">{title}</h1>
          <p className="text-gray-400 mt-2">{subtitle}</p>
        </div>

        <div className="flex gap-8">
          {/* Sidebar Navigation */}
          <nav className="hidden lg:block w-64 shrink-0">
            <div className="sticky top-20">
              <input
                type="text"
                placeholder="Search docs..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full px-3 py-2 mb-4 rounded-lg bg-gray-900 border border-gray-800 text-sm text-gray-100 placeholder-gray-600 focus:border-violet-500 focus:outline-none"
              />
              <div className="space-y-0.5 max-h-[calc(100vh-12rem)] overflow-y-auto pr-2">
                {filteredSections.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => {
                      setActiveSection(s.id);
                      document.getElementById(s.id)?.scrollIntoView({ behavior: "smooth" });
                    }}
                    className={`w-full text-left px-3 py-1.5 rounded-md text-sm transition-colors ${
                      activeSection === s.id
                        ? "bg-violet-600/20 text-violet-300 font-semibold"
                        : "text-gray-500 hover:text-gray-300 hover:bg-gray-900"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          </nav>

          {/* Mobile section picker */}
          <div className="lg:hidden w-full mb-6">
            <select
              value={activeSection}
              onChange={(e) => {
                setActiveSection(e.target.value);
                document.getElementById(e.target.value)?.scrollIntoView({ behavior: "smooth" });
              }}
              className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-gray-100"
            >
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          {/* Main Content */}
          <div className="flex-1 min-w-0 space-y-16">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
