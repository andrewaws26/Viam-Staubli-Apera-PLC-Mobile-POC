"use client";

import { useEffect, useCallback } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  title?: string;
  titleColor?: string;
  children: React.ReactNode;
}

/**
 * Full-screen modal optimized for 3.5" Sunfounder touchscreen (480×320).
 * Takes over the entire viewport with large, readable text.
 * No partial overlays or bottom sheets — there's no room on this screen.
 */
export default function FullScreenModal({
  open,
  onClose,
  title,
  titleColor = "text-white",
  children,
}: Props) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    if (open) {
      document.addEventListener("keydown", handleKeyDown);
      // Prevent background scrolling
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [open, handleKeyDown]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-gray-950 flex flex-col"
      style={{ animation: "modalIn 0.15s ease-out" }}
      role="dialog"
      aria-modal="true"
      aria-label={title || "Detail view"}
    >
      {/* Header with close button */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800 shrink-0">
        {title && (
          <h2 className={`text-base font-bold truncate ${titleColor}`}>
            {title}
          </h2>
        )}
        <button
          onClick={onClose}
          className="ml-auto min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg bg-gray-800 text-gray-300 text-lg font-bold active:bg-gray-700"
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      {/* Scrollable content */}
      <div
        className="flex-1 overflow-y-auto px-3 py-3"
        style={{ WebkitOverflowScrolling: "touch" }}
      >
        {children}
      </div>
    </div>
  );
}
