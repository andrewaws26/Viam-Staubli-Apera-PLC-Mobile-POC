/**
 * PTO (Paid Time Off) Type Validation Tests
 *
 * Tests the PTO types in packages/shared/src/pto.ts.
 * These types drive the time-off request/approval workflow:
 * request types, statuses, label maps, and color maps for UI badges.
 *
 * WHAT TO ADD:
 * If you add a new PTO type (e.g., 'jury_duty') or status, add it to
 * the expected values here and verify the label/color maps are updated.
 *
 * HOW TO RUN: cd dashboard && npx vitest run tests/unit/pto-types.test.ts
 */

import { describe, it, expect } from "vitest";
import {
  PTO_TYPE_LABELS,
  PTO_STATUS_LABELS,
  PTO_STATUS_COLORS,
} from "@ironsight/shared/pto";
import type {
  PTORequestType,
  PTOStatus,
  CreatePTORequestPayload,
} from "@ironsight/shared/pto";

// ── PTORequestType ──────────────────────────────────────────────────

describe("PTORequestType values", () => {
  const ALL_TYPES: PTORequestType[] = ["vacation", "sick", "personal", "bereavement", "other"];

  it("has exactly 5 request types in PTO_TYPE_LABELS", () => {
    expect(Object.keys(PTO_TYPE_LABELS)).toHaveLength(5);
  });

  it("PTO_TYPE_LABELS maps every request type to a string", () => {
    for (const type of ALL_TYPES) {
      expect(PTO_TYPE_LABELS[type]).toBeDefined();
      expect(typeof PTO_TYPE_LABELS[type]).toBe("string");
      expect(PTO_TYPE_LABELS[type].length).toBeGreaterThan(0);
    }
  });

  it("PTO_TYPE_LABELS has expected human-readable values", () => {
    expect(PTO_TYPE_LABELS.vacation).toBe("Vacation");
    expect(PTO_TYPE_LABELS.sick).toBe("Sick");
    expect(PTO_TYPE_LABELS.personal).toBe("Personal");
    expect(PTO_TYPE_LABELS.bereavement).toBe("Bereavement");
    expect(PTO_TYPE_LABELS.other).toBe("Other");
  });
});

// ── PTOStatus ───────────────────────────────────────────────────────

describe("PTOStatus values", () => {
  const ALL_STATUSES: PTOStatus[] = ["pending", "approved", "rejected", "cancelled"];

  it("has exactly 4 statuses in PTO_STATUS_LABELS", () => {
    expect(Object.keys(PTO_STATUS_LABELS)).toHaveLength(4);
  });

  it("PTO_STATUS_LABELS maps every status to a string", () => {
    for (const status of ALL_STATUSES) {
      expect(PTO_STATUS_LABELS[status]).toBeDefined();
      expect(typeof PTO_STATUS_LABELS[status]).toBe("string");
      expect(PTO_STATUS_LABELS[status].length).toBeGreaterThan(0);
    }
  });

  it("PTO_STATUS_LABELS has expected human-readable values", () => {
    expect(PTO_STATUS_LABELS.pending).toBe("Pending");
    expect(PTO_STATUS_LABELS.approved).toBe("Approved");
    expect(PTO_STATUS_LABELS.rejected).toBe("Rejected");
    expect(PTO_STATUS_LABELS.cancelled).toBe("Cancelled");
  });
});

// ── PTO_STATUS_COLORS ───────────────────────────────────────────────

describe("PTO_STATUS_COLORS", () => {
  const ALL_STATUSES: PTOStatus[] = ["pending", "approved", "rejected", "cancelled"];

  it("maps all 4 statuses to hex color strings", () => {
    expect(Object.keys(PTO_STATUS_COLORS)).toHaveLength(4);
    for (const status of ALL_STATUSES) {
      expect(PTO_STATUS_COLORS[status]).toBeDefined();
      // Verify it's a valid hex color (e.g., #f59e0b)
      expect(PTO_STATUS_COLORS[status]).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it("uses distinct colors for each status", () => {
    // No two statuses should share the same color
    const colors = Object.values(PTO_STATUS_COLORS);
    const unique = new Set(colors);
    expect(unique.size).toBe(colors.length);
  });

  it("uses warning-like color for pending", () => {
    // Amber/yellow family (#f59e0b)
    expect(PTO_STATUS_COLORS.pending).toBe("#f59e0b");
  });

  it("uses success-like color for approved", () => {
    // Green family (#22c55e)
    expect(PTO_STATUS_COLORS.approved).toBe("#22c55e");
  });

  it("uses danger-like color for rejected", () => {
    // Red family (#ef4444)
    expect(PTO_STATUS_COLORS.rejected).toBe("#ef4444");
  });

  it("uses muted color for cancelled", () => {
    // Gray family (#6b7280)
    expect(PTO_STATUS_COLORS.cancelled).toBe("#6b7280");
  });
});

// ── CreatePTORequestPayload ─────────────────────────────────────────

describe("CreatePTORequestPayload", () => {
  it("requires request_type, start_date, end_date, and hours_requested", () => {
    const payload: CreatePTORequestPayload = {
      request_type: "vacation",
      start_date: "2026-07-04",
      end_date: "2026-07-05",
      hours_requested: 16,
    };
    expect(payload.request_type).toBe("vacation");
    expect(payload.start_date).toBe("2026-07-04");
    expect(payload.end_date).toBe("2026-07-05");
    expect(payload.hours_requested).toBe(16);
  });

  it("accepts optional reason field", () => {
    const payloadWithReason: CreatePTORequestPayload = {
      request_type: "sick",
      start_date: "2026-04-08",
      end_date: "2026-04-08",
      hours_requested: 8,
      reason: "Doctor appointment",
    };
    expect(payloadWithReason.reason).toBe("Doctor appointment");
  });

  it("works without optional reason field", () => {
    const payloadNoReason: CreatePTORequestPayload = {
      request_type: "personal",
      start_date: "2026-05-01",
      end_date: "2026-05-01",
      hours_requested: 4,
    };
    expect(payloadNoReason.reason).toBeUndefined();
  });

  it("accepts all PTO request types", () => {
    // Verify each type is assignable to the payload
    const types: PTORequestType[] = ["vacation", "sick", "personal", "bereavement", "other"];
    for (const type of types) {
      const payload: CreatePTORequestPayload = {
        request_type: type,
        start_date: "2026-01-01",
        end_date: "2026-01-01",
        hours_requested: 8,
      };
      expect(payload.request_type).toBe(type);
    }
  });
});
