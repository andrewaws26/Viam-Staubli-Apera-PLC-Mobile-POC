"use client";

import { useState } from "react";
import { useAuth } from "@clerk/nextjs";
import HelpPanel from "./HelpPanel";

/**
 * Floating help button — bottom-right corner of every page.
 * Opens a slide-out chat panel powered by the /api/help endpoint.
 * Only renders for authenticated users.
 */
export default function HelpButton() {
  const { isSignedIn } = useAuth();
  const [isOpen, setIsOpen] = useState(false);

  // Don't render for unauthenticated users
  if (!isSignedIn) return null;

  return (
    <>
      {/* Floating button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-5 right-5 z-50 w-12 h-12 rounded-full bg-violet-600 hover:bg-violet-500 text-white shadow-lg shadow-violet-600/25 flex items-center justify-center transition-all hover:scale-105 active:scale-95"
          aria-label="Open help"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </button>
      )}

      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-[55] sm:bg-transparent"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Panel */}
      {isOpen && <HelpPanel onClose={() => setIsOpen(false)} />}
    </>
  );
}
