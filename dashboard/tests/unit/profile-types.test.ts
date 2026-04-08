/**
 * Employee Profile Type Validation Tests
 *
 * Tests the profile types in packages/shared/src/profile.ts.
 * These types define employee HR data (phone, hire date, department, etc.)
 * that extend the base Clerk auth user.
 *
 * WHAT TO ADD:
 * When you add a new department or job title, add it to the expected
 * values in these tests so the dropdown options stay in sync.
 *
 * HOW TO RUN: cd dashboard && npx vitest run tests/unit/profile-types.test.ts
 */

import { describe, it, expect } from "vitest";
import {
  DEPARTMENT_OPTIONS,
  JOB_TITLE_OPTIONS,
} from "@ironsight/shared/profile";
import type {
  EmployeeProfile,
  UpdateProfilePayload,
} from "@ironsight/shared/profile";

// ── DEPARTMENT_OPTIONS ──────────────────────────────────────────────

describe("DEPARTMENT_OPTIONS", () => {
  it("is non-empty", () => {
    expect(DEPARTMENT_OPTIONS.length).toBeGreaterThan(0);
  });

  it("contains the core B&B Metals departments", () => {
    expect(DEPARTMENT_OPTIONS).toContain("Field Operations");
    expect(DEPARTMENT_OPTIONS).toContain("Maintenance");
    expect(DEPARTMENT_OPTIONS).toContain("Management");
    expect(DEPARTMENT_OPTIONS).toContain("Administration");
    expect(DEPARTMENT_OPTIONS).toContain("Safety");
    expect(DEPARTMENT_OPTIONS).toContain("Logistics");
  });

  it("has exactly 6 departments", () => {
    expect(DEPARTMENT_OPTIONS).toHaveLength(6);
  });

  it("contains only non-empty strings", () => {
    for (const dept of DEPARTMENT_OPTIONS) {
      expect(typeof dept).toBe("string");
      expect(dept.length).toBeGreaterThan(0);
    }
  });
});

// ── JOB_TITLE_OPTIONS ───────────────────────────────────────────────

describe("JOB_TITLE_OPTIONS", () => {
  it("is non-empty", () => {
    expect(JOB_TITLE_OPTIONS.length).toBeGreaterThan(0);
  });

  it("contains expected field operations titles", () => {
    expect(JOB_TITLE_OPTIONS).toContain("Field Technician");
    expect(JOB_TITLE_OPTIONS).toContain("Lead Technician");
    expect(JOB_TITLE_OPTIONS).toContain("Mechanic");
    expect(JOB_TITLE_OPTIONS).toContain("Heavy Equipment Operator");
    expect(JOB_TITLE_OPTIONS).toContain("CDL Driver");
  });

  it("contains management and safety titles", () => {
    expect(JOB_TITLE_OPTIONS).toContain("Foreman");
    expect(JOB_TITLE_OPTIONS).toContain("Project Manager");
    expect(JOB_TITLE_OPTIONS).toContain("Safety Officer");
  });

  it("contains administrative titles", () => {
    expect(JOB_TITLE_OPTIONS).toContain("Dispatcher");
    expect(JOB_TITLE_OPTIONS).toContain("Administrator");
  });

  it("has exactly 10 job titles", () => {
    expect(JOB_TITLE_OPTIONS).toHaveLength(10);
  });

  it("contains only non-empty strings", () => {
    for (const title of JOB_TITLE_OPTIONS) {
      expect(typeof title).toBe("string");
      expect(title.length).toBeGreaterThan(0);
    }
  });
});

// ── EmployeeProfile interface ───────────────────────────────────────

describe("EmployeeProfile interface", () => {
  // Build a complete profile object to verify the interface shape at runtime.
  // This catches if fields are accidentally removed from the type.
  const sampleProfile: EmployeeProfile = {
    id: "prof-001",
    user_id: "user_abc123",
    user_name: "Andrew Sieg",
    user_email: "andrew@bbmetals.com",
    phone: "555-123-4567",
    emergency_contact_name: "Jane Sieg",
    emergency_contact_phone: "555-987-6543",
    hire_date: "2023-06-15",
    job_title: "Field Technician",
    department: "Field Operations",
    profile_picture_url: "https://storage.example.com/photos/andrew.jpg",
    created_at: "2023-06-15T00:00:00Z",
    updated_at: "2026-04-08T12:00:00Z",
  };

  it("has required user_id field", () => {
    expect(sampleProfile.user_id).toBe("user_abc123");
  });

  it("has required user_name field", () => {
    expect(sampleProfile.user_name).toBe("Andrew Sieg");
  });

  it("has required user_email field", () => {
    expect(sampleProfile.user_email).toBe("andrew@bbmetals.com");
  });

  it("has nullable HR fields (phone, hire_date, etc.)", () => {
    // Verify each nullable field accepts null
    const minimalProfile: EmployeeProfile = {
      id: "prof-002",
      user_id: "user_xyz",
      user_name: "New Hire",
      user_email: "new@bbmetals.com",
      phone: null,
      emergency_contact_name: null,
      emergency_contact_phone: null,
      hire_date: null,
      job_title: null,
      department: null,
      profile_picture_url: null,
      created_at: "2026-04-08T00:00:00Z",
      updated_at: "2026-04-08T00:00:00Z",
    };
    expect(minimalProfile.phone).toBeNull();
    expect(minimalProfile.hire_date).toBeNull();
    expect(minimalProfile.department).toBeNull();
  });

  it("has timestamp fields (created_at, updated_at)", () => {
    expect(sampleProfile.created_at).toBeDefined();
    expect(sampleProfile.updated_at).toBeDefined();
  });
});

// ── UpdateProfilePayload interface ──────────────────────────────────

describe("UpdateProfilePayload interface", () => {
  it("accepts an empty object (all fields optional)", () => {
    // UpdateProfilePayload should work with zero fields for a no-op update
    const emptyPayload: UpdateProfilePayload = {};
    expect(emptyPayload).toEqual({});
  });

  it("accepts any single field", () => {
    // Each field should be independently settable
    const phoneOnly: UpdateProfilePayload = { phone: "555-111-2222" };
    const deptOnly: UpdateProfilePayload = { department: "Safety" };
    const titleOnly: UpdateProfilePayload = { job_title: "Foreman" };

    expect(phoneOnly.phone).toBe("555-111-2222");
    expect(deptOnly.department).toBe("Safety");
    expect(titleOnly.job_title).toBe("Foreman");
  });

  it("accepts all fields together", () => {
    const fullPayload: UpdateProfilePayload = {
      phone: "555-000-1111",
      emergency_contact_name: "Emergency Contact",
      emergency_contact_phone: "555-000-2222",
      hire_date: "2024-01-01",
      job_title: "Lead Technician",
      department: "Maintenance",
      profile_picture_url: "https://storage.example.com/new-photo.jpg",
    };
    expect(Object.keys(fullPayload)).toHaveLength(7);
  });
});
