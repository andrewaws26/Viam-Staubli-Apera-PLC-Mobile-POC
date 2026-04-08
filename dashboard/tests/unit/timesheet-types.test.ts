/**
 * Timesheet Type Validation Tests
 *
 * Tests the expanded timesheet types in packages/shared/src/timesheet.ts.
 * These types define the data shapes for B&B Metals weekly field timesheets,
 * including daily logs, expenses, IFTA entries, and railroad timecards.
 *
 * WHAT TO ADD:
 * When you add a new timesheet sub-section or constant array, add coverage
 * here to make sure the array/type hasn't been accidentally truncated.
 *
 * HOW TO RUN: cd dashboard && npx vitest run tests/unit/timesheet-types.test.ts
 */

import { describe, it, expect } from "vitest";
import {
  TIMESHEET_STATUS_LABELS,
  TIMESHEET_STATUS_COLORS,
  EXPENSE_CATEGORIES,
  US_STATE_CODES,
  LUNCH_OPTIONS,
  WEEKDAY_LABELS,
  RAILROAD_OPTIONS,
} from "@ironsight/shared/timesheet";
import type {
  TimesheetStatus,
  TimesheetDailyLog,
  TimesheetExpense,
  ExpenseCategory,
  CreateTimesheetPayload,
  Timesheet,
} from "@ironsight/shared/timesheet";

// ── TimesheetStatus ─────────────────────────────────────────────────

describe("TimesheetStatus values", () => {
  const ALL_STATUSES: TimesheetStatus[] = ["draft", "submitted", "approved", "rejected"];

  it("has exactly 4 status values in TIMESHEET_STATUS_LABELS", () => {
    // Ensures nobody added a status without updating labels
    expect(Object.keys(TIMESHEET_STATUS_LABELS)).toHaveLength(4);
  });

  it("TIMESHEET_STATUS_LABELS covers all expected statuses", () => {
    for (const status of ALL_STATUSES) {
      expect(TIMESHEET_STATUS_LABELS[status]).toBeDefined();
      expect(typeof TIMESHEET_STATUS_LABELS[status]).toBe("string");
    }
  });

  it("TIMESHEET_STATUS_COLORS covers all expected statuses", () => {
    for (const status of ALL_STATUSES) {
      expect(TIMESHEET_STATUS_COLORS[status]).toBeDefined();
      expect(typeof TIMESHEET_STATUS_COLORS[status]).toBe("string");
    }
  });

  it("label values are human-readable (capitalized)", () => {
    expect(TIMESHEET_STATUS_LABELS.draft).toBe("Draft");
    expect(TIMESHEET_STATUS_LABELS.submitted).toBe("Submitted");
    expect(TIMESHEET_STATUS_LABELS.approved).toBe("Approved");
    expect(TIMESHEET_STATUS_LABELS.rejected).toBe("Rejected");
  });
});

// ── RAILROAD_OPTIONS ────────────────────────────────────────────────

describe("RAILROAD_OPTIONS", () => {
  it("includes all expected Class I railroads", () => {
    // The major Class I railroads B&B Metals contracts with
    expect(RAILROAD_OPTIONS).toContain("CSX");
    expect(RAILROAD_OPTIONS).toContain("Norfolk Southern");
    expect(RAILROAD_OPTIONS).toContain("BNSF");
    expect(RAILROAD_OPTIONS).toContain("Union Pacific");
    expect(RAILROAD_OPTIONS).toContain("Canadian National");
    expect(RAILROAD_OPTIONS).toContain("Canadian Pacific");
    expect(RAILROAD_OPTIONS).toContain("Kansas City Southern");
    expect(RAILROAD_OPTIONS).toContain("Amtrak");
  });

  it("includes Short Line and Other as catch-all options", () => {
    expect(RAILROAD_OPTIONS).toContain("Short Line");
    expect(RAILROAD_OPTIONS).toContain("Other");
  });

  it("has exactly 10 railroad options", () => {
    expect(RAILROAD_OPTIONS).toHaveLength(10);
  });

  it("is a readonly tuple (cannot be mutated)", () => {
    // TypeScript enforces 'as const' at compile time; at runtime we verify
    // the array is defined and non-empty
    expect(Array.isArray(RAILROAD_OPTIONS)).toBe(true);
    expect(RAILROAD_OPTIONS.length).toBeGreaterThan(0);
  });
});

// ── EXPENSE_CATEGORIES ──────────────────────────────────────────────

describe("EXPENSE_CATEGORIES", () => {
  it("includes all 10 B&B Metals chart-of-accounts categories", () => {
    const expected: string[] = [
      "Fuel",
      "Safety",
      "Repairs & Maintenance",
      "Parts",
      "Parking",
      "Lodging/Hotels",
      "Travel",
      "Supplies",
      "MGT Approved Expense",
      "Other",
    ];
    expect(EXPENSE_CATEGORIES).toEqual(expected);
  });

  it("has exactly 10 categories", () => {
    expect(EXPENSE_CATEGORIES).toHaveLength(10);
  });

  it("always includes a catch-all 'Other' category", () => {
    expect(EXPENSE_CATEGORIES).toContain("Other");
  });
});

// ── US_STATE_CODES ──────────────────────────────────────────────────

describe("US_STATE_CODES", () => {
  it("has exactly 50 state codes (all US states)", () => {
    expect(US_STATE_CODES).toHaveLength(50);
  });

  it("contains only 2-letter uppercase codes", () => {
    for (const code of US_STATE_CODES) {
      expect(code).toMatch(/^[A-Z]{2}$/);
    }
  });

  it("includes common IFTA-relevant states for B&B operations", () => {
    // B&B Metals operates primarily in the eastern US
    expect(US_STATE_CODES).toContain("OH");
    expect(US_STATE_CODES).toContain("PA");
    expect(US_STATE_CODES).toContain("WV");
    expect(US_STATE_CODES).toContain("VA");
    expect(US_STATE_CODES).toContain("TX");
    expect(US_STATE_CODES).toContain("NY");
  });

  it("has no duplicate state codes", () => {
    const unique = new Set(US_STATE_CODES);
    expect(unique.size).toBe(US_STATE_CODES.length);
  });
});

// ── LUNCH_OPTIONS ───────────────────────────────────────────────────

describe("LUNCH_OPTIONS", () => {
  it("has correct minute values in 15-minute increments", () => {
    expect([...LUNCH_OPTIONS]).toEqual([0, 15, 30, 45, 60]);
  });

  it("starts with 0 (no lunch break)", () => {
    expect(LUNCH_OPTIONS[0]).toBe(0);
  });

  it("ends with 60 (maximum 1-hour lunch)", () => {
    expect(LUNCH_OPTIONS[LUNCH_OPTIONS.length - 1]).toBe(60);
  });

  it("contains only non-negative numbers", () => {
    for (const option of LUNCH_OPTIONS) {
      expect(option).toBeGreaterThanOrEqual(0);
    }
  });
});

// ── WEEKDAY_LABELS ──────────────────────────────────────────────────

describe("WEEKDAY_LABELS", () => {
  it("has exactly 7 entries (one per day of the week)", () => {
    expect(WEEKDAY_LABELS).toHaveLength(7);
  });

  it("starts with Monday (B&B work week starts Monday)", () => {
    expect(WEEKDAY_LABELS[0]).toBe("Monday");
  });

  it("ends with Sunday", () => {
    expect(WEEKDAY_LABELS[6]).toBe("Sunday");
  });

  it("contains all 7 day names in order", () => {
    expect([...WEEKDAY_LABELS]).toEqual([
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
    ]);
  });
});

// ── TimesheetDailyLog shape ─────────────────────────────────────────

describe("TimesheetDailyLog interface", () => {
  // Build a complete daily log object to verify the interface shape.
  // This catches drift between the type definition and what the API returns.
  const sampleLog: TimesheetDailyLog = {
    id: "log-001",
    timesheet_id: "ts-001",
    log_date: "2026-04-07",
    start_time: "07:00",
    end_time: "17:00",
    hours_worked: 10,
    travel_hours: 1.5,
    lunch_minutes: 30,
    description: "Track tie replacement",
    semi_truck_travel: false,
    traveling_from: null,
    destination: null,
    travel_miles: null,
    sort_order: 0,
    created_at: "2026-04-07T07:00:00Z",
  };

  it("has all required fields including new lunch_minutes", () => {
    expect(sampleLog.lunch_minutes).toBe(30);
  });

  it("has semi_truck_travel boolean field", () => {
    expect(typeof sampleLog.semi_truck_travel).toBe("boolean");
  });

  it("has nullable traveling_from, destination, and travel_miles", () => {
    // These are only populated when semi_truck_travel is true
    expect(sampleLog.traveling_from).toBeNull();
    expect(sampleLog.destination).toBeNull();
    expect(sampleLog.travel_miles).toBeNull();
  });

  it("has sort_order for day ordering", () => {
    expect(typeof sampleLog.sort_order).toBe("number");
  });
});

// ── TimesheetExpense category type ──────────────────────────────────

describe("TimesheetExpense category matches EXPENSE_CATEGORIES", () => {
  it("every EXPENSE_CATEGORIES value is a valid ExpenseCategory", () => {
    // Build a sample expense for each category to ensure type compatibility
    for (const category of EXPENSE_CATEGORIES) {
      const expense: Pick<TimesheetExpense, "category"> = { category };
      expect(expense.category).toBe(category);
    }
  });

  it("TimesheetExpense has receipt and fuel-related fields", () => {
    const expense: TimesheetExpense = {
      id: "exp-001",
      timesheet_id: "ts-001",
      expense_date: "2026-04-07",
      amount: 85.5,
      category: "Fuel",
      description: "Diesel for chase truck",
      needs_reimbursement: true,
      payment_type: "credit",
      receipt_image_url: "https://storage.example.com/receipt.jpg",
      is_fuel: true,
      fuel_vehicle_type: "chase",
      fuel_vehicle_number: "CV-102",
      odometer_image_url: null,
      created_at: "2026-04-07T12:00:00Z",
    };
    expect(expense.is_fuel).toBe(true);
    expect(expense.fuel_vehicle_type).toBe("chase");
    expect(expense.needs_reimbursement).toBe(true);
  });
});

// ── CreateTimesheetPayload ──────────────────────────────────────────

describe("CreateTimesheetPayload", () => {
  it("accepts minimal payload (only week_ending required)", () => {
    const payload: CreateTimesheetPayload = {
      week_ending: "2026-04-13",
    };
    expect(payload.week_ending).toBe("2026-04-13");
  });

  it("accepts all new fields (norfolk_southern_job_code, ifta_odometer, etc.)", () => {
    const payload: CreateTimesheetPayload = {
      week_ending: "2026-04-13",
      railroad_working_on: "Norfolk Southern",
      norfolk_southern_job_code: "NS-12345",
      chase_vehicles: ["CV-101", "CV-102"],
      semi_trucks: ["ST-001"],
      work_location: "Charleston, WV",
      nights_out: 4,
      layovers: 1,
      coworkers: [{ id: "user-002", name: "John Smith" }],
      ifta_odometer_start: 102340,
      ifta_odometer_end: 102890,
      notes: "Replaced 200 ties on CSX main line",
    };
    expect(payload.norfolk_southern_job_code).toBe("NS-12345");
    expect(payload.ifta_odometer_start).toBe(102340);
    expect(payload.ifta_odometer_end).toBe(102890);
  });

  it("accepts daily_logs with new semi_truck_travel fields", () => {
    const payload: CreateTimesheetPayload = {
      week_ending: "2026-04-13",
      daily_logs: [
        {
          log_date: "2026-04-07",
          start_time: "06:00",
          end_time: "18:00",
          hours_worked: 12,
          travel_hours: 2,
          lunch_minutes: 30,
          description: "Track work",
          semi_truck_travel: true,
          traveling_from: "Shop",
          destination: "Job Site A",
          travel_miles: 85,
        },
      ],
    };
    expect(payload.daily_logs).toHaveLength(1);
    expect(payload.daily_logs![0].semi_truck_travel).toBe(true);
    expect(payload.daily_logs![0].lunch_minutes).toBe(30);
    expect(payload.daily_logs![0].travel_miles).toBe(85);
  });
});

// ── Timesheet main interface ────────────────────────────────────────

describe("Timesheet interface", () => {
  it("includes all sub-section arrays", () => {
    // Verify the full Timesheet type includes all embedded sub-sections.
    // A partial object with required sub-section arrays confirms the shape.
    const ts: Pick<
      Timesheet,
      | "daily_logs"
      | "railroad_timecards"
      | "inspections"
      | "ifta_entries"
      | "expenses"
      | "maintenance_time"
      | "shop_time"
      | "mileage_pay"
      | "flight_pay"
      | "holiday_pay"
      | "vacation_pay"
    > = {
      daily_logs: [],
      railroad_timecards: [],
      inspections: [],
      ifta_entries: [],
      expenses: [],
      maintenance_time: [],
      shop_time: [],
      mileage_pay: [],
      flight_pay: [],
      holiday_pay: [],
      vacation_pay: [],
    };
    // All 11 sub-section arrays should exist
    expect(Object.keys(ts)).toHaveLength(11);
  });
});
