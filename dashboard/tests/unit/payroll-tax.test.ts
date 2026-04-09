/**
 * Payroll Tax Calculation Tests
 *
 * Tests the actual math for federal withholding, FICA, FUTA, SUTA, and state tax
 * using 2026 bracket data. A bug here means employees get wrong paychecks.
 *
 * Uses the IRS 2026 tax brackets from migration 020.
 */

import { describe, it, expect } from "vitest";
import {
  r2, periodsPerYear, getTaxValue,
  calcFederalWithholding, calcSocialSecurity, calcMedicare, calcFuta, calcSuta,
  type TaxRateRow, type TaxProfileRow,
} from "@/lib/payroll-tax";

// ── 2026 Tax Tables (from migration 020) ──────────────────────────

const FEDERAL_BRACKETS_SINGLE: TaxRateRow[] = [
  { tax_type: "federal_income", filing_status: "single", bracket_min: 0, bracket_max: 11925, rate: 0.10, flat_amount: 0 },
  { tax_type: "federal_income", filing_status: "single", bracket_min: 11925, bracket_max: 48475, rate: 0.12, flat_amount: 1192.50 },
  { tax_type: "federal_income", filing_status: "single", bracket_min: 48475, bracket_max: 103350, rate: 0.22, flat_amount: 5578.50 },
  { tax_type: "federal_income", filing_status: "single", bracket_min: 103350, bracket_max: 197300, rate: 0.24, flat_amount: 17651.50 },
  { tax_type: "federal_income", filing_status: "single", bracket_min: 197300, bracket_max: 250525, rate: 0.32, flat_amount: 40199.50 },
  { tax_type: "federal_income", filing_status: "single", bracket_min: 250525, bracket_max: 626350, rate: 0.35, flat_amount: 57231.50 },
  { tax_type: "federal_income", filing_status: "single", bracket_min: 626350, bracket_max: null, rate: 0.37, flat_amount: 188769.75 },
];

const FEDERAL_BRACKETS_MFJ: TaxRateRow[] = [
  { tax_type: "federal_income", filing_status: "married_jointly", bracket_min: 0, bracket_max: 23850, rate: 0.10, flat_amount: 0 },
  { tax_type: "federal_income", filing_status: "married_jointly", bracket_min: 23850, bracket_max: 96950, rate: 0.12, flat_amount: 2385.00 },
  { tax_type: "federal_income", filing_status: "married_jointly", bracket_min: 96950, bracket_max: 206700, rate: 0.22, flat_amount: 11157.00 },
  { tax_type: "federal_income", filing_status: "married_jointly", bracket_min: 206700, bracket_max: 394600, rate: 0.24, flat_amount: 35283.00 },
];

const STD_DEDUCTIONS: TaxRateRow[] = [
  { tax_type: "std_deduction", filing_status: "single", bracket_min: 0, bracket_max: null, rate: 0, flat_amount: 15700 },
  { tax_type: "std_deduction", filing_status: "married_jointly", bracket_min: 0, bracket_max: null, rate: 0, flat_amount: 31400 },
  { tax_type: "std_deduction", filing_status: "head_of_household", bracket_min: 0, bracket_max: null, rate: 0, flat_amount: 22250 },
];

function makeProfile(overrides?: Partial<TaxProfileRow>): TaxProfileRow {
  return {
    user_id: "user_test",
    filing_status: "single",
    dependents_credit: 0,
    other_income: 0,
    deductions: 0,
    extra_withholding: 0,
    state_withholding: 0.04,
    state_extra_wh: 0,
    pay_frequency: "biweekly",
    hourly_rate: 30,
    salary_annual: null,
    pay_type: "hourly",
    ytd_gross_pay: 0,
    ytd_federal_wh: 0,
    ytd_state_wh: 0,
    ytd_ss_employee: 0,
    ytd_medicare_employee: 0,
    ytd_ss_employer: 0,
    ytd_medicare_employer: 0,
    ytd_futa: 0,
    ytd_suta: 0,
    ...overrides,
  };
}

// ── Utility helpers ───────────────────────────────────────────────

describe("r2()", () => {
  it("rounds to 2 decimal places", () => {
    expect(r2(100.456)).toBe(100.46);
    expect(r2(100.454)).toBe(100.45);
    expect(r2(0.1 + 0.2)).toBe(0.3);
    expect(r2(1000)).toBe(1000);
  });
});

describe("periodsPerYear()", () => {
  it("returns correct periods for each frequency", () => {
    expect(periodsPerYear("weekly")).toBe(52);
    expect(periodsPerYear("biweekly")).toBe(26);
    expect(periodsPerYear("semimonthly")).toBe(24);
    expect(periodsPerYear("monthly")).toBe(12);
  });

  it("defaults to weekly for unknown frequencies", () => {
    expect(periodsPerYear("quarterly")).toBe(52);
    expect(periodsPerYear("")).toBe(52);
  });
});

describe("getTaxValue()", () => {
  const rates: TaxRateRow[] = [
    { tax_type: "ss_rate", filing_status: null, bracket_min: 0, bracket_max: null, rate: 0.062, flat_amount: 176100 },
    { tax_type: "medicare_rate", filing_status: null, bracket_min: 0, bracket_max: null, rate: 0.0145, flat_amount: 0 },
  ];

  it("finds rate by tax_type", () => {
    expect(getTaxValue(rates, "ss_rate")).toBe(0.062);
    expect(getTaxValue(rates, "medicare_rate")).toBe(0.0145);
  });

  it("finds flat_amount when requested", () => {
    expect(getTaxValue(rates, "ss_rate", "flat_amount")).toBe(176100);
  });

  it("returns 0 for unknown tax type", () => {
    expect(getTaxValue(rates, "unknown")).toBe(0);
  });
});

// ── Federal Withholding ───────────────────────────────────────────

describe("calcFederalWithholding()", () => {
  it("calculates correct tax for single filer, biweekly $2400 gross", () => {
    const profile = makeProfile({ filing_status: "single", pay_frequency: "biweekly" });
    const grossPay = 2400;

    // Annualized: $2400 * 26 = $62,400
    // Minus std deduction: $62,400 - $15,700 = $46,700
    // Falls in 12% bracket: $1,192.50 + ($46,700 - $11,925) * 0.12 = $1,192.50 + $4,173.00 = $5,365.50
    // De-annualized: $5,365.50 / 26 = $206.37 per period
    const federal = calcFederalWithholding(grossPay, profile, FEDERAL_BRACKETS_SINGLE, STD_DEDUCTIONS);
    expect(federal).toBeCloseTo(206.37, 0); // Within $1
    expect(federal).toBeGreaterThan(0);
  });

  it("married filing jointly pays less than single at same income", () => {
    const single = makeProfile({ filing_status: "single" });
    const married = makeProfile({ filing_status: "married_jointly" });
    const allBrackets = [...FEDERAL_BRACKETS_SINGLE, ...FEDERAL_BRACKETS_MFJ];
    const grossPay = 3000;

    const singleTax = calcFederalWithholding(grossPay, single, allBrackets, STD_DEDUCTIONS);
    const marriedTax = calcFederalWithholding(grossPay, married, allBrackets, STD_DEDUCTIONS);

    expect(marriedTax).toBeLessThan(singleTax);
  });

  it("returns 0 when income below standard deduction", () => {
    const profile = makeProfile({ pay_frequency: "biweekly" });
    const grossPay = 400; // Annualized: $400 * 26 = $10,400 < $15,700 std deduction

    const federal = calcFederalWithholding(grossPay, profile, FEDERAL_BRACKETS_SINGLE, STD_DEDUCTIONS);
    expect(federal).toBe(0);
  });

  it("adds extra withholding to the result", () => {
    const profile = makeProfile({ extra_withholding: 50 });
    const grossPay = 2400;

    const withExtra = calcFederalWithholding(grossPay, profile, FEDERAL_BRACKETS_SINGLE, STD_DEDUCTIONS);
    const profile2 = makeProfile({ extra_withholding: 0 });
    const without = calcFederalWithholding(grossPay, profile2, FEDERAL_BRACKETS_SINGLE, STD_DEDUCTIONS);

    expect(withExtra).toBeCloseTo(without + 50, 0);
  });

  it("subtracts dependents credit per period", () => {
    const profile = makeProfile({ dependents_credit: 2000 }); // $2000 annual credit
    const profileNoDep = makeProfile({ dependents_credit: 0 });
    const grossPay = 2400;

    const withDep = calcFederalWithholding(grossPay, profile, FEDERAL_BRACKETS_SINGLE, STD_DEDUCTIONS);
    const noDep = calcFederalWithholding(grossPay, profileNoDep, FEDERAL_BRACKETS_SINGLE, STD_DEDUCTIONS);

    // Credit reduces tax by $2000/26 = ~$76.92 per period
    expect(noDep - withDep).toBeCloseTo(76.92, 0);
  });
});

// ── Social Security ───────────────────────────────────────────────

describe("calcSocialSecurity()", () => {
  const SS_RATE = 0.062;
  const SS_WAGE_BASE = 176100;

  it("calculates 6.2% of gross pay", () => {
    expect(calcSocialSecurity(2400, 0, SS_RATE, SS_WAGE_BASE)).toBe(r2(2400 * 0.062));
  });

  it("caps at wage base", () => {
    // YTD already at $175,000, gross of $2,000
    // Only $1,100 is taxable ($176,100 - $175,000)
    const result = calcSocialSecurity(2000, 175000, SS_RATE, SS_WAGE_BASE);
    expect(result).toBe(r2(1100 * 0.062));
  });

  it("returns 0 when already over wage base", () => {
    expect(calcSocialSecurity(2400, 180000, SS_RATE, SS_WAGE_BASE)).toBe(0);
  });
});

// ── Medicare ──────────────────────────────────────────────────────

describe("calcMedicare()", () => {
  const RATE = 0.0145;
  const ADDITIONAL_RATE = 0.009;
  const THRESHOLD = 200000;

  it("calculates 1.45% of gross pay", () => {
    expect(calcMedicare(2400, 0, RATE, ADDITIONAL_RATE, THRESHOLD)).toBe(r2(2400 * 0.0145));
  });

  it("adds 0.9% additional tax above $200k threshold", () => {
    // YTD at $199,000, gross of $3,000 → total $202,000
    // All $3,000 of gross gets base Medicare (1.45%)
    // $2,000 excess above $200k threshold gets additional 0.9%
    const result = calcMedicare(3000, 199000, RATE, ADDITIONAL_RATE, THRESHOLD);
    // The function rounds after base tax, then adds additional
    // Base: r2(3000 * 0.0145) = 43.5
    // Additional: r2(2000 * 0.009) = 18.0 (2000 = 202000 - 200000)
    // Total: r2(43.5 + 18.0) = 61.5
    expect(result).toBe(61.5);
  });

  it("applies additional tax to full gross when already over threshold", () => {
    const result = calcMedicare(3000, 250000, RATE, ADDITIONAL_RATE, THRESHOLD);
    const baseTax = r2(3000 * 0.0145);
    const additionalTax = r2(3000 * 0.009);
    expect(result).toBe(r2(baseTax + additionalTax));
  });

  it("no additional tax when under threshold", () => {
    const result = calcMedicare(3000, 50000, RATE, ADDITIONAL_RATE, THRESHOLD);
    expect(result).toBe(r2(3000 * 0.0145));
  });
});

// ── FUTA ──────────────────────────────────────────────────────────

describe("calcFuta()", () => {
  const FUTA_RATE = 0.06;
  const FUTA_CREDIT = 0.054;
  const FUTA_WAGE_BASE = 7000;

  it("calculates net FUTA rate (0.6%) on taxable wages", () => {
    expect(calcFuta(2400, 0, FUTA_RATE, FUTA_CREDIT, FUTA_WAGE_BASE)).toBe(r2(2400 * 0.006));
  });

  it("caps at $7,000 wage base", () => {
    const result = calcFuta(2400, 6000, FUTA_RATE, FUTA_CREDIT, FUTA_WAGE_BASE);
    expect(result).toBe(r2(1000 * 0.006)); // Only $1000 remaining
  });

  it("returns 0 when already over wage base", () => {
    expect(calcFuta(2400, 8000, FUTA_RATE, FUTA_CREDIT, FUTA_WAGE_BASE)).toBe(0);
  });
});

// ── SUTA (Kentucky) ───────────────────────────────────────────────

describe("calcSuta()", () => {
  const SUTA_RATE = 0.027;
  const SUTA_WAGE_BASE = 11400;

  it("calculates 2.7% on taxable wages", () => {
    expect(calcSuta(2400, 0, SUTA_RATE, SUTA_WAGE_BASE)).toBe(r2(2400 * 0.027));
  });

  it("caps at wage base", () => {
    const result = calcSuta(2400, 10000, SUTA_RATE, SUTA_WAGE_BASE);
    expect(result).toBe(r2(1400 * 0.027));
  });

  it("returns 0 when already over wage base", () => {
    expect(calcSuta(2400, 12000, SUTA_RATE, SUTA_WAGE_BASE)).toBe(0);
  });
});

// ── Full Paycheck Scenario ────────────────────────────────────────

describe("Full paycheck: single filer, biweekly, $30/hr, 80 hours", () => {
  const grossPay = 2400; // 80 hours * $30/hr
  const profile = makeProfile();

  it("all tax components are positive for standard gross pay", () => {
    const federal = calcFederalWithholding(grossPay, profile, FEDERAL_BRACKETS_SINGLE, STD_DEDUCTIONS);
    const state = r2(grossPay * 0.04);
    const ss = calcSocialSecurity(grossPay, 0, 0.062, 176100);
    const medicare = calcMedicare(grossPay, 0, 0.0145, 0.009, 200000);
    const futa = calcFuta(grossPay, 0, 0.06, 0.054, 7000);
    const suta = calcSuta(grossPay, 0, 0.027, 11400);

    expect(federal).toBeGreaterThan(0);
    expect(state).toBe(96); // 2400 * 0.04
    expect(ss).toBe(r2(2400 * 0.062));
    expect(medicare).toBe(r2(2400 * 0.0145));
    expect(futa).toBe(r2(2400 * 0.006));
    expect(suta).toBe(r2(2400 * 0.027));
  });

  it("net pay is less than gross pay", () => {
    const federal = calcFederalWithholding(grossPay, profile, FEDERAL_BRACKETS_SINGLE, STD_DEDUCTIONS);
    const state = r2(grossPay * 0.04);
    const ss = calcSocialSecurity(grossPay, 0, 0.062, 176100);
    const medicare = calcMedicare(grossPay, 0, 0.0145, 0.009, 200000);

    const totalDeductions = r2(federal + state + ss + medicare);
    const netPay = r2(grossPay - totalDeductions);

    expect(netPay).toBeLessThan(grossPay);
    expect(netPay).toBeGreaterThan(0);
    // Sanity: deductions should be between 20-40% for this income
    const effectiveRate = totalDeductions / grossPay;
    expect(effectiveRate).toBeGreaterThan(0.15);
    expect(effectiveRate).toBeLessThan(0.45);
  });
});
