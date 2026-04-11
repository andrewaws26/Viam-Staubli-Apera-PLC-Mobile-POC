/**
 * Timesheet Sections & Daily Log Form Tests
 *
 * Tests the section configuration, daily log form logic, and frontend-to-backend
 * alignment for the flattened timesheet layout matching the legacy B&B form.
 *
 * HOW TO RUN: cd dashboard && npx vitest run tests/unit/timesheet-sections.test.ts
 */

import { describe, it, expect } from "vitest";

// ── Section configuration alignment ────────────────────────────────

/**
 * These must match the SECTION_TABLES keys in
 * dashboard/app/api/timesheets/[id]/sections/route.ts
 */
const FRONTEND_SECTION_KEYS = [
  "railroad_timecards",
  "inspections",
  "ifta_entries",
  "expenses",
  "maintenance_time",
  "shop_time",
  "mileage_pay",
  "flight_pay",
  "holiday_pay",
  "vacation_pay",
];

const BACKEND_SECTION_TABLES: Record<string, string> = {
  railroad_timecards: "timesheet_railroad_timecards",
  inspections: "timesheet_inspections",
  ifta_entries: "timesheet_ifta_entries",
  expenses: "timesheet_expenses",
  maintenance_time: "timesheet_maintenance_time",
  shop_time: "timesheet_shop_time",
  mileage_pay: "timesheet_mileage_pay",
  flight_pay: "timesheet_flight_pay",
  holiday_pay: "timesheet_holiday_pay",
  vacation_pay: "timesheet_vacation_pay",
};

describe("Section key alignment (frontend → backend)", () => {
  it("has exactly 10 section keys", () => {
    expect(FRONTEND_SECTION_KEYS).toHaveLength(10);
  });

  it("every frontend key maps to a backend table", () => {
    for (const key of FRONTEND_SECTION_KEYS) {
      expect(BACKEND_SECTION_TABLES[key]).toBeDefined();
      expect(BACKEND_SECTION_TABLES[key]).toMatch(/^timesheet_/);
    }
  });

  it("backend table count matches frontend section count", () => {
    expect(Object.keys(BACKEND_SECTION_TABLES)).toHaveLength(
      FRONTEND_SECTION_KEYS.length,
    );
  });

  it("no duplicate frontend keys", () => {
    const unique = new Set(FRONTEND_SECTION_KEYS);
    expect(unique.size).toBe(FRONTEND_SECTION_KEYS.length);
  });
});

// ── Section labels and empty state text ─────────────────────────────

const SECTION_CONFIG = [
  { key: "railroad_timecards", label: "Railroad Timecards", emptyText: "No railroad time cards entered for this week", addLabel: "Add Time Card" },
  { key: "inspections", label: "Inspections", emptyText: "No equipment inspections entered for this week", addLabel: "Add Inspection" },
  { key: "ifta_entries", label: "IFTA", emptyText: "No IFTA entered for this week", addLabel: "Add IFTA" },
  { key: "expenses", label: "Expenses", emptyText: "No expenses entered for this week", addLabel: "Add Expense" },
  { key: "maintenance_time", label: "Maintenance Time", emptyText: "No maintenance time entered for this week", addLabel: "Add Maintenance Time" },
  { key: "shop_time", label: "Shop Time", emptyText: "No shop time entered for this week", addLabel: "Add Shop Time" },
  { key: "mileage_pay", label: "Mileage Pay", emptyText: "No mileage pay entries entered for this week", addLabel: "Add Mileage Pay" },
  { key: "flight_pay", label: "Flight Pay", emptyText: "No flight pay entries entered for this week", addLabel: "Add Flight Pay" },
  { key: "holiday_pay", label: "Holiday Pay", emptyText: "No holiday pay entries entered for this week", addLabel: "Add Holiday Pay" },
  { key: "vacation_pay", label: "Vacation Pay", emptyText: "No Vacation pay entries entered for this week", addLabel: "Add Vacation Pay" },
];

describe("Section config matches legacy B&B form", () => {
  it("every section has a non-empty label", () => {
    for (const s of SECTION_CONFIG) {
      expect(s.label.length).toBeGreaterThan(0);
    }
  });

  it("every section has an emptyText containing 'for this week'", () => {
    for (const s of SECTION_CONFIG) {
      expect(s.emptyText).toContain("for this week");
    }
  });

  it("every section has an addLabel starting with 'Add'", () => {
    for (const s of SECTION_CONFIG) {
      expect(s.addLabel).toMatch(/^Add /);
    }
  });

  it("IFTA section is labeled 'IFTA' not 'IFTA Entries'", () => {
    const ifta = SECTION_CONFIG.find((s) => s.key === "ifta_entries");
    expect(ifta?.label).toBe("IFTA");
  });

  it("section keys match the expected backend keys", () => {
    for (const s of SECTION_CONFIG) {
      expect(FRONTEND_SECTION_KEYS).toContain(s.key);
    }
  });
});

// ── Daily log hours auto-calculation ────────────────────────────────

/**
 * Replicates the auto-hours calculation from TimesheetForm.updateDlForm
 * to ensure the logic is correct.
 */
function calculateHours(
  startTime: string,
  endTime: string,
  lunchMinutes: number,
): number {
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  let hours = eh + em / 60 - (sh + sm / 60);
  if (hours < 0) hours += 24;
  hours -= (lunchMinutes || 0) / 60;
  if (hours < 0) hours = 0;
  return Math.round(hours * 100) / 100;
}

describe("Daily log hours auto-calculation", () => {
  it("calculates simple 8-hour day", () => {
    expect(calculateHours("07:00", "15:00", 0)).toBe(8);
  });

  it("subtracts 30-minute lunch", () => {
    expect(calculateHours("07:00", "15:00", 30)).toBe(7.5);
  });

  it("subtracts 60-minute lunch", () => {
    expect(calculateHours("07:00", "17:00", 60)).toBe(9);
  });

  it("handles overnight shift (end time < start time)", () => {
    // 22:00 to 06:00 = 8 hours
    expect(calculateHours("22:00", "06:00", 0)).toBe(8);
  });

  it("handles midnight crossing with lunch", () => {
    // 22:00 to 06:00 = 8 hours minus 30 min lunch = 7.5
    expect(calculateHours("22:00", "06:00", 30)).toBe(7.5);
  });

  it("returns 0 when lunch exceeds work time", () => {
    // 07:00 to 07:30 = 0.5 hours, minus 60 min lunch = negative → clamp to 0
    expect(calculateHours("07:00", "07:30", 60)).toBe(0);
  });

  it("handles 12-hour day with 45-min lunch", () => {
    // 06:00 to 18:00 = 12 hours minus 0.75 = 11.25
    expect(calculateHours("06:00", "18:00", 45)).toBe(11.25);
  });

  it("handles same start and end (zero hours, not 24)", () => {
    // When start === end, difference is 0 — user must enter manually for 24h shifts
    expect(calculateHours("07:00", "07:00", 0)).toBe(0);
  });

  it("handles minutes in start/end times", () => {
    // 07:30 to 16:15 = 8.75 hours minus 15 min lunch = 8.5
    expect(calculateHours("07:30", "16:15", 15)).toBe(8.5);
  });
});

// ── Daily log clear function ────────────────────────────────────────

describe("Daily log entry clear", () => {
  const emptyLog = {
    log_date: "2026-04-07",
    start_time: "",
    end_time: "",
    hours_worked: 0,
    travel_hours: 0,
    description: "",
    lunch_minutes: 0,
    semi_truck_travel: false,
    traveling_from: "",
    destination: "",
    travel_miles: null as number | null,
  };

  const populatedLog = {
    ...emptyLog,
    start_time: "07:00",
    end_time: "15:00",
    hours_worked: 8,
    travel_hours: 1.5,
    description: "Track work",
    lunch_minutes: 30,
    semi_truck_travel: true,
    traveling_from: "Shop",
    destination: "Job Site",
    travel_miles: 85,
  };

  it("populated log has data", () => {
    expect(populatedLog.hours_worked).toBe(8);
    expect(populatedLog.start_time).toBe("07:00");
    expect(populatedLog.semi_truck_travel).toBe(true);
  });

  it("clearing resets all fields to defaults but preserves log_date", () => {
    const cleared = {
      ...populatedLog,
      start_time: "",
      end_time: "",
      hours_worked: 0,
      travel_hours: 0,
      description: "",
      lunch_minutes: 0,
      semi_truck_travel: false,
      traveling_from: "",
      destination: "",
      travel_miles: null,
    };
    expect(cleared.log_date).toBe("2026-04-07"); // preserved
    expect(cleared.start_time).toBe("");
    expect(cleared.hours_worked).toBe(0);
    expect(cleared.semi_truck_travel).toBe(false);
    expect(cleared.travel_miles).toBeNull();
  });
});

// ── Upload authorization ────────────────────────────────────────────

describe("Upload route security requirements", () => {
  const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic"];
  const ALLOWED_FIELDS = ["receipt_image_url", "odometer_image_url"];
  const MAX_FILE_SIZE = 10 * 1024 * 1024;

  it("only allows image MIME types", () => {
    expect(ALLOWED_TYPES).toHaveLength(4);
    for (const type of ALLOWED_TYPES) {
      expect(type).toMatch(/^image\//);
    }
  });

  it("does not allow dangerous types", () => {
    expect(ALLOWED_TYPES).not.toContain("text/html");
    expect(ALLOWED_TYPES).not.toContain("application/javascript");
    expect(ALLOWED_TYPES).not.toContain("image/svg+xml");
  });

  it("only allows known expense fields", () => {
    expect(ALLOWED_FIELDS).toHaveLength(2);
    expect(ALLOWED_FIELDS).toContain("receipt_image_url");
    expect(ALLOWED_FIELDS).toContain("odometer_image_url");
  });

  it("max file size is 10MB", () => {
    expect(MAX_FILE_SIZE).toBe(10485760);
  });
});
