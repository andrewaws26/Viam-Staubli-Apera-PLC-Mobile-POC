"use client";

import { useState } from "react";

type DisclaimerVariant = "payroll" | "tax" | "financial" | "general";

const DISCLAIMERS: Record<DisclaimerVariant, { title: string; text: string }> = {
  payroll: {
    title: "Payroll Tax Notice",
    text: "Tax calculations use IRS and state rates as of system deployment. Verify all withholding amounts with a qualified tax professional before processing payroll. IronSight is not a licensed payroll provider and assumes no liability for tax computation errors.",
  },
  tax: {
    title: "Tax Reporting Notice",
    text: "These reports are for internal management review only. File official returns (941, 940, W-2, 1099) with the IRS and state agencies directly. Do not use these reports as filed tax documents without CPA review.",
  },
  financial: {
    title: "Financial Reporting Notice",
    text: "Financial reports are generated from system data and have not been independently audited. Consult a CPA for official financial statements and audit-ready reports.",
  },
  general: {
    title: "Notice",
    text: "This accounting system is a management tool, not a substitute for professional accounting or legal advice.",
  },
};

interface ComplianceDisclaimerProps {
  variant: DisclaimerVariant;
  className?: string;
  dismissible?: boolean;
}

export default function ComplianceDisclaimer({
  variant,
  className = "",
  dismissible = true,
}: ComplianceDisclaimerProps) {
  const [dismissed, setDismissed] = useState(false);
  const disclaimer = DISCLAIMERS[variant];

  if (dismissed) return null;

  return (
    <div
      className={`rounded-lg border border-amber-700/50 bg-amber-900/20 px-4 py-3 ${className}`}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex-shrink-0 text-amber-400">⚠</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-amber-300">
            {disclaimer.title}
          </p>
          <p className="mt-1 text-xs text-amber-200/70">{disclaimer.text}</p>
        </div>
        {dismissible && (
          <button
            onClick={() => setDismissed(true)}
            className="flex-shrink-0 text-amber-400/60 hover:text-amber-300 text-sm"
            aria-label="Dismiss notice"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}
