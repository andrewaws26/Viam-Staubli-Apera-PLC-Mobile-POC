/**
 * Payroll Tax Calculation Engine
 *
 * Pure functions for federal withholding, FICA, FUTA, SUTA, and state tax.
 * Extracted from the payroll-run route handler so they can be unit tested
 * with real tax bracket data and sample payroll scenarios.
 *
 * Uses the W-4 2020+ percentage method for federal withholding.
 */

// ── Types ─────────────────────────────────────────────────────────

export interface TaxRateRow {
  tax_type: string;
  filing_status: string | null;
  bracket_min: number;
  bracket_max: number | null;
  rate: number;
  flat_amount: number;
}

export interface TaxProfileRow {
  user_id: string;
  filing_status: string;
  dependents_credit: number;
  other_income: number;
  deductions: number;
  extra_withholding: number;
  state_withholding: number;
  state_extra_wh: number;
  pay_frequency: string;
  hourly_rate: number | null;
  salary_annual: number | null;
  pay_type: string;
  ytd_gross_pay: number;
  ytd_federal_wh: number;
  ytd_state_wh: number;
  ytd_ss_employee: number;
  ytd_medicare_employee: number;
  ytd_ss_employer: number;
  ytd_medicare_employer: number;
  ytd_futa: number;
  ytd_suta: number;
}

// ── Helpers ───────────────────────────────────────────────────────

/** Round to 2 decimal places — avoids floating-point dust. */
export function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function periodsPerYear(freq: string): number {
  switch (freq) {
    case "weekly":
      return 52;
    case "biweekly":
      return 26;
    case "semimonthly":
      return 24;
    case "monthly":
      return 12;
    default:
      return 52;
  }
}

export function getTaxValue(
  rates: TaxRateRow[],
  taxType: string,
  field: "rate" | "flat_amount" = "rate",
): number {
  const row = rates.find((r) => r.tax_type === taxType);
  return row ? Number(row[field]) : 0;
}

// ── Tax Calculations ──────────────────────────────────────────────

/**
 * Federal income tax withholding using the 2020+ W-4 percentage method.
 * Annualize -> apply brackets -> de-annualize.
 */
export function calcFederalWithholding(
  grossPay: number,
  profile: TaxProfileRow,
  brackets: TaxRateRow[],
  stdDeductions: TaxRateRow[],
): number {
  const periods = periodsPerYear(profile.pay_frequency);
  const annualized = grossPay * periods;

  const stdDed =
    stdDeductions.find((r) => r.filing_status === profile.filing_status)
      ?.flat_amount ?? 0;

  const taxableIncome =
    annualized -
    Number(stdDed) -
    Number(profile.deductions) +
    Number(profile.other_income);

  if (taxableIncome <= 0) {
    return r2(Math.max(0, Number(profile.extra_withholding)));
  }

  const filingBrackets = brackets
    .filter((b) => b.filing_status === profile.filing_status)
    .sort((a, b) => Number(a.bracket_min) - Number(b.bracket_min));

  let annualTax = 0;
  for (const bracket of filingBrackets) {
    const min = Number(bracket.bracket_min);
    const max = bracket.bracket_max != null ? Number(bracket.bracket_max) : Infinity;
    if (taxableIncome > min) {
      if (taxableIncome <= max) {
        annualTax = Number(bracket.flat_amount) + (taxableIncome - min) * Number(bracket.rate);
        break;
      }
    }
  }

  let periodTax = annualTax / periods;
  periodTax -= Number(profile.dependents_credit) / periods;
  periodTax += Number(profile.extra_withholding);

  return r2(Math.max(0, periodTax));
}

/** Social Security with wage base cap. */
export function calcSocialSecurity(
  grossPay: number,
  ytdGross: number,
  ssRate: number,
  ssWageBase: number,
): number {
  const remaining = Math.max(0, ssWageBase - ytdGross);
  const taxable = Math.min(grossPay, remaining);
  return r2(taxable * ssRate);
}

/** Medicare with additional tax above threshold. */
export function calcMedicare(
  grossPay: number,
  ytdGross: number,
  medicareRate: number,
  additionalRate: number,
  threshold: number,
): number {
  let tax = r2(grossPay * medicareRate);

  const totalGross = ytdGross + grossPay;
  if (totalGross > threshold) {
    const excessThisPeriod =
      ytdGross >= threshold
        ? grossPay
        : totalGross - threshold;
    tax = r2(tax + excessThisPeriod * additionalRate);
  }

  return tax;
}

/** FUTA with wage base cap and state credit. */
export function calcFuta(
  grossPay: number,
  ytdGross: number,
  futaRate: number,
  futaCredit: number,
  futaWageBase: number,
): number {
  const remaining = Math.max(0, futaWageBase - ytdGross);
  const taxable = Math.min(grossPay, remaining);
  return r2(taxable * (futaRate - futaCredit));
}

/** SUTA with wage base cap. */
export function calcSuta(
  grossPay: number,
  ytdGross: number,
  sutaRate: number,
  sutaWageBase: number,
): number {
  const remaining = Math.max(0, sutaWageBase - ytdGross);
  const taxable = Math.min(grossPay, remaining);
  return r2(taxable * sutaRate);
}
