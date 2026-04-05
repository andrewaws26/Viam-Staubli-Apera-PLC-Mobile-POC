// ---------------------------------------------------------------------------
// Print styles — professional paper-ready report
// ---------------------------------------------------------------------------

export const PRINT_STYLES = `
  @media print {
    @page { size: letter portrait; margin: 0.6in 0.75in; }

    /* White paper reset */
    *, *::before, *::after {
      color: #1f2937 !important;
      background: white !important;
      border-color: #d1d5db !important;
      box-shadow: none !important;
      text-shadow: none !important;
    }
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; margin: 0; padding: 0; }

    /* Hide ALL screen content — only .print-report shows */
    .no-print { display: none !important; }
    main > *:not(.print-report) { display: none !important; }
    .print-report { display: block !important; padding: 0 4px; }

    /* Container resets */
    main { gap: 0 !important; padding: 0 !important; }
    .min-h-screen { min-height: 0 !important; }

    /* ---- Header ---- */
    .pr-header { display: flex; justify-content: space-between; align-items: flex-end; margin: 0 0 6px 0; }
    .pr-header h1 { font-size: 15pt; font-weight: 900; letter-spacing: 0.1em; margin: 0; line-height: 1; color: #111827 !important; }
    .pr-header-right { font-size: 9pt; color: #4b5563 !important; text-align: right; line-height: 1.4; }
    .pr-rule { border: none; border-top: 2.5pt solid #111827 !important; margin: 0 0 14px 0; }

    /* ---- KPI row ---- */
    .pr-kpi-row { display: grid; grid-template-columns: repeat(4, 1fr); border: 2px solid #374151 !important; border-radius: 4px; margin-bottom: 14px; overflow: hidden; }
    .pr-kpi { border-right: 1px solid #d1d5db !important; padding: 10px 12px; text-align: center; }
    .pr-kpi:last-child { border-right: none !important; }
    .pr-kpi-val { font-size: 22pt; font-weight: 900; line-height: 1.1; color: #111827 !important; }
    .pr-kpi-val span { font-size: 9pt; font-weight: 400; margin-left: 2px; color: #6b7280 !important; }
    .pr-kpi-label { font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.06em; color: #6b7280 !important; margin-top: 3px; }

    /* ---- Location ---- */
    .pr-location { font-size: 9.5pt; margin: 0 0 12px 0; color: #374151 !important; }
    .pr-location strong { color: #111827 !important; }

    /* ---- Sections ---- */
    .pr-section { margin-bottom: 12px; }
    .pr-section-head { font-size: 9pt; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; border-bottom: 1.5px solid #9ca3af !important; padding-bottom: 2px; margin-bottom: 5px; color: #374151 !important; }

    /* ---- Alerts ---- */
    .pr-alert { font-size: 8.5pt; padding: 2px 0; line-height: 1.4; }
    .pr-critical { color: #dc2626 !important; }
    .pr-warning { color: #92400e !important; }
    .pr-more { font-size: 7.5pt; color: #6b7280 !important; font-style: italic; margin-top: 2px; }

    /* ---- Tables ---- */
    .pr-table { width: 100%; border-collapse: collapse; font-size: 8.5pt; margin-top: 4px; }
    .pr-table th { background: #f3f4f6 !important; font-weight: 700; text-align: left; padding: 3px 8px; border: 1px solid #d1d5db !important; font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.03em; }
    .pr-table td { padding: 3px 8px; border: 1px solid #e5e7eb !important; }
    .pr-table tr:nth-child(even) td { background: #f9fafb !important; }

    /* ---- Peaks + DTCs ---- */
    .pr-inline-data { font-size: 9.5pt; line-height: 1.6; color: #374151 !important; }

    /* ---- Footer ---- */
    .pr-footer { font-size: 7.5pt; color: #9ca3af !important; text-align: center; border-top: 1px solid #d1d5db !important; padding-top: 6px; margin-top: 20px; }
  }

  /* Hide print elements on screen */
  @media screen {
    .print-only { display: none !important; }
    .print-report { display: none !important; }
    .print-data-table { display: none !important; }
  }
`;
