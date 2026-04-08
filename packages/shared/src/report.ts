/**
 * report.ts — Shared types for the AI Report Generator.
 */

export interface SavedReport {
  id: string;
  created_by: string;
  created_by_name: string;
  name: string;
  description: string | null;
  prompt: string;
  generated_sql: string;
  is_shared: boolean;
  category: string | null;
  last_run_at: string | null;
  run_count: number;
  created_at: string;
  updated_at: string;
}

export interface ReportGenerateRequest {
  prompt: string;
}

export interface ReportGenerateResponse {
  sql: string;
  results: Record<string, unknown>[];
  row_count: number;
  execution_time_ms: number;
}

export type ReportCategory =
  | "fleet"
  | "finance"
  | "hr"
  | "compliance"
  | "operations"
  | "custom";

export const REPORT_CATEGORY_LABELS: Record<ReportCategory, string> = {
  fleet: "Fleet",
  finance: "Finance",
  hr: "HR & People",
  compliance: "Compliance",
  operations: "Operations",
  custom: "Custom",
};
