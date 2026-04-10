"use client";

import React, { useState } from "react";
import type { DTCHistoryEvent } from "../lib/dtc-history";
import { lookupFMI } from "../lib/spn-lookup";

interface DTCTimelineProps {
  events: DTCHistoryEvent[];
  onClear: () => void;
}

function fmtTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 16).replace("T", " ");
  }
}

export default function DTCTimeline({ events, onClear }: DTCTimelineProps) {
  const [open, setOpen] = useState(false);

  if (events.length === 0) return null;

  // Count intermittent patterns
  const counts: Record<string, { appeared: number; cleared: number; spnName: string; ecuLabel: string }> = {};
  for (const e of events) {
    const key = `${e.spn}:${e.fmi}:${e.ecuSuffix}`;
    if (!counts[key]) counts[key] = { appeared: 0, cleared: 0, spnName: e.spnName, ecuLabel: e.ecuLabel };
    counts[key][e.event]++;
  }
  const intermittent = Object.entries(counts).filter(([, c]) => c.appeared > 1 && c.cleared > 0);

  const sorted = [...events].reverse(); // newest first

  return (
    <div className="bg-gray-900/50 rounded-2xl border border-gray-800/30 p-4 sm:p-5 mb-3">
      <div className="flex items-center justify-between">
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-2 text-sm sm:text-base font-black text-gray-300 uppercase tracking-wider"
        >
          <span className={`transition-transform ${open ? "rotate-90" : ""}`}>{"\u25B6"}</span>
          DTC History ({events.length})
        </button>
        <button
          onClick={onClear}
          className="text-xs text-gray-600 hover:text-gray-400 px-2 py-1"
        >
          Clear History
        </button>
      </div>

      {open && (
        <div className="mt-3">
          {/* Intermittent pattern alerts */}
          {intermittent.length > 0 && (
            <div className="bg-yellow-950/30 border border-yellow-800/30 rounded-lg px-3 py-2 mb-3">
              <span className="text-xs font-bold text-yellow-400 uppercase tracking-wider">
                Intermittent Codes Detected
              </span>
              <div className="mt-1 space-y-1">
                {intermittent.map(([key, c]) => (
                  <div key={key} className="text-xs text-yellow-300">
                    {c.spnName} ({c.ecuLabel}) — appeared {c.appeared}x, cleared {c.cleared}x
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Timeline */}
          <div className="max-h-64 overflow-y-auto space-y-1.5 pr-1">
            {sorted.map((e) => (
              <div
                key={e.id}
                className="flex items-start gap-2 text-xs"
              >
                <span className="text-gray-600 whitespace-nowrap shrink-0 w-28 text-right">
                  {fmtTime(e.timestamp)}
                </span>
                <span
                  className={`mt-1 w-2 h-2 rounded-full shrink-0 ${
                    e.event === "appeared" ? "bg-red-500" : "bg-green-500"
                  }`}
                />
                <div className="min-w-0">
                  <span className={`font-bold ${e.event === "appeared" ? "text-red-300" : "text-green-300"}`}>
                    {e.event === "appeared" ? "APPEARED" : "CLEARED"}
                  </span>
                  <span className="text-gray-400 ml-1.5">
                    {e.spnName}
                  </span>
                  <span className="text-gray-600 ml-1">
                    SPN {e.spn} / FMI {e.fmi}
                  </span>
                  <span className="text-gray-700 ml-1">
                    ({lookupFMI(e.fmi)})
                  </span>
                  <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">
                    {e.ecuLabel}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
