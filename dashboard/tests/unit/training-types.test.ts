/**
 * Training Compliance Type Validation Tests
 *
 * Tests the training types in packages/shared/src/training.ts.
 * These types drive the safety certification tracking system:
 * compliance statuses, label maps, color maps, and the UserTrainingStatus
 * aggregation shape.
 *
 * WHAT TO ADD:
 * If you add a new compliance status (unlikely — the 4-state model is
 * well-defined), update the expected values here. More commonly, you'll
 * add fields to TrainingRequirement or TrainingRecord.
 *
 * HOW TO RUN: cd dashboard && npx vitest run tests/unit/training-types.test.ts
 */

import { describe, it, expect } from "vitest";
import {
  COMPLIANCE_STATUS_LABELS,
  COMPLIANCE_STATUS_COLORS,
} from "@ironsight/shared/training";
import type {
  TrainingComplianceStatus,
  UserTrainingStatus,
  TrainingRequirement,
  TrainingRecord,
} from "@ironsight/shared/training";

// ── TrainingComplianceStatus ────────────────────────────────────────

describe("TrainingComplianceStatus values", () => {
  const ALL_STATUSES: TrainingComplianceStatus[] = [
    "current",
    "expiring_soon",
    "expired",
    "missing",
  ];

  it("has exactly 4 compliance statuses in COMPLIANCE_STATUS_LABELS", () => {
    expect(Object.keys(COMPLIANCE_STATUS_LABELS)).toHaveLength(4);
  });

  it("COMPLIANCE_STATUS_LABELS maps every status to a human-readable string", () => {
    for (const status of ALL_STATUSES) {
      expect(COMPLIANCE_STATUS_LABELS[status]).toBeDefined();
      expect(typeof COMPLIANCE_STATUS_LABELS[status]).toBe("string");
      expect(COMPLIANCE_STATUS_LABELS[status].length).toBeGreaterThan(0);
    }
  });

  it("COMPLIANCE_STATUS_LABELS has expected display values", () => {
    expect(COMPLIANCE_STATUS_LABELS.current).toBe("Current");
    expect(COMPLIANCE_STATUS_LABELS.expiring_soon).toBe("Expiring Soon");
    expect(COMPLIANCE_STATUS_LABELS.expired).toBe("Expired");
    expect(COMPLIANCE_STATUS_LABELS.missing).toBe("Not Completed");
  });
});

// ── COMPLIANCE_STATUS_COLORS ────────────────────────────────────────

describe("COMPLIANCE_STATUS_COLORS", () => {
  const ALL_STATUSES: TrainingComplianceStatus[] = [
    "current",
    "expiring_soon",
    "expired",
    "missing",
  ];

  it("maps all 4 statuses to hex color strings", () => {
    expect(Object.keys(COMPLIANCE_STATUS_COLORS)).toHaveLength(4);
    for (const status of ALL_STATUSES) {
      expect(COMPLIANCE_STATUS_COLORS[status]).toBeDefined();
      // Verify it's a valid hex color
      expect(COMPLIANCE_STATUS_COLORS[status]).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it("uses distinct colors for each status", () => {
    const colors = Object.values(COMPLIANCE_STATUS_COLORS);
    const unique = new Set(colors);
    expect(unique.size).toBe(colors.length);
  });

  it("uses green for current (safe)", () => {
    expect(COMPLIANCE_STATUS_COLORS.current).toBe("#22c55e");
  });

  it("uses amber for expiring_soon (warning)", () => {
    expect(COMPLIANCE_STATUS_COLORS.expiring_soon).toBe("#f59e0b");
  });

  it("uses red for expired (danger)", () => {
    expect(COMPLIANCE_STATUS_COLORS.expired).toBe("#ef4444");
  });

  it("uses gray for missing (neutral/muted)", () => {
    expect(COMPLIANCE_STATUS_COLORS.missing).toBe("#6b7280");
  });
});

// ── UserTrainingStatus interface ────────────────────────────────────

describe("UserTrainingStatus interface", () => {
  it("has is_compliant boolean field", () => {
    // Build a compliant user status to verify the shape
    const compliantUser: UserTrainingStatus = {
      user_id: "user_001",
      user_name: "Andrew Sieg",
      total_required: 5,
      completed: 5,
      current: 5,
      expiring_soon: 0,
      expired: 0,
      missing: 0,
      is_compliant: true,
      details: [],
    };
    expect(compliantUser.is_compliant).toBe(true);
    expect(typeof compliantUser.is_compliant).toBe("boolean");
  });

  it("has is_compliant false when any training is not current", () => {
    const nonCompliantUser: UserTrainingStatus = {
      user_id: "user_002",
      user_name: "John Doe",
      total_required: 5,
      completed: 3,
      current: 2,
      expiring_soon: 1,
      expired: 1,
      missing: 1,
      is_compliant: false,
      details: [],
    };
    expect(nonCompliantUser.is_compliant).toBe(false);
  });

  it("has numeric count fields that sum correctly", () => {
    const user: UserTrainingStatus = {
      user_id: "user_003",
      user_name: "Jane Smith",
      total_required: 8,
      completed: 6,
      current: 4,
      expiring_soon: 1,
      expired: 1,
      missing: 2,
      is_compliant: false,
      details: [],
    };
    // current + expiring_soon + expired + missing should equal total_required
    const sum = user.current + user.expiring_soon + user.expired + user.missing;
    expect(sum).toBe(user.total_required);
  });

  it("has details array for per-requirement breakdown", () => {
    const user: UserTrainingStatus = {
      user_id: "user_004",
      user_name: "Test User",
      total_required: 1,
      completed: 1,
      current: 1,
      expiring_soon: 0,
      expired: 0,
      missing: 0,
      is_compliant: true,
      details: [
        {
          requirement: {
            id: "req-001",
            name: "Fall Protection",
            description: "OSHA fall protection certification",
            frequency_months: 12,
            is_required: true,
            is_active: true,
            created_at: "2025-01-01T00:00:00Z",
          },
          latest_record: {
            id: "rec-001",
            user_id: "user_004",
            user_name: "Test User",
            requirement_id: "req-001",
            requirement_name: "Fall Protection",
            completed_date: "2026-03-01",
            expiry_date: "2027-03-01",
            certificate_url: null,
            notes: null,
            recorded_by: "admin_001",
            recorded_by_name: "Admin",
            created_at: "2026-03-01T00:00:00Z",
          },
          status: "current",
          days_until_expiry: 327,
        },
      ],
    };
    expect(user.details).toHaveLength(1);
    expect(user.details[0].status).toBe("current");
    expect(user.details[0].days_until_expiry).toBeGreaterThan(0);
  });
});

// ── TrainingRequirement interface ───────────────────────────────────

describe("TrainingRequirement interface", () => {
  it("supports recurring certifications (frequency_months set)", () => {
    const recurring: TrainingRequirement = {
      id: "req-001",
      name: "CPR/First Aid",
      description: "American Red Cross CPR certification",
      frequency_months: 24,
      is_required: true,
      is_active: true,
      created_at: "2025-01-01T00:00:00Z",
    };
    expect(recurring.frequency_months).toBe(24);
  });

  it("supports one-time trainings (frequency_months null)", () => {
    const oneTime: TrainingRequirement = {
      id: "req-002",
      name: "New Hire Orientation",
      description: "Company onboarding training",
      frequency_months: null,
      is_required: true,
      is_active: true,
      created_at: "2025-01-01T00:00:00Z",
    };
    expect(oneTime.frequency_months).toBeNull();
  });
});
