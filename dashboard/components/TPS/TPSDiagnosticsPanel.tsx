// TPSDiagnosticsPanel.tsx — Displays active diagnostic rules with severity
// badges and operator action guidance.
"use client";

import type { SensorDiagnostic } from "./TPSFields";

interface TPSDiagnosticsPanelProps {
  diagnostics: SensorDiagnostic[];
}

export default function TPSDiagnosticsPanel({ diagnostics }: TPSDiagnosticsPanelProps) {
  return (
    <div>
      <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-2 border-b border-gray-800/50 pb-1">
        Active Diagnostics ({diagnostics.length})
      </h3>
      {diagnostics.length === 0 ? (
        <p className="text-xs text-gray-700">All clear &mdash; no diagnostics firing.</p>
      ) : (
        <div className="space-y-1">
          {diagnostics.map((d, i) => (
            <div
              key={`${d.rule}-${i}`}
              className={`py-1.5 px-2 rounded text-xs ${
                d.severity === "critical"
                  ? "bg-red-950/20 text-red-400"
                  : d.severity === "warning"
                    ? "bg-yellow-950/20 text-yellow-400"
                    : "bg-blue-950/20 text-blue-400"
              }`}
            >
              <span className="font-bold">[{d.severity.toUpperCase()}]</span>{" "}
              <span className="font-mono">{d.rule}</span> &mdash; {d.title}
              {d.action && (
                <span className="block mt-0.5 text-gray-500 text-xs">{d.action}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
