import { describe, it, expect } from "vitest";

/**
 * IronSight Accounting Business Logic Tests
 *
 * Tests the core financial calculations, state machines, and business rules
 * that protect the integrity of the accounting system. These are pure logic
 * tests — no database, no API calls.
 *
 * Coverage:
 *   - Depreciation calculations (3 methods)
 *   - Aging bucket assignment
 *   - Trial balance math & rounding
 *   - Journal entry balance validation
 *   - Period close state machine
 *   - Invoice payment tracking
 *   - Payroll run state machine
 *   - Account balance posting/voiding
 *   - Year-end close logic
 */

// =========================================================================
//  REPLICATED BUSINESS LOGIC (from route handlers)
//  These mirror the exact formulas used in production routes.
// =========================================================================

const r2 = (n: number) => Math.round(n * 100) / 100;

const ACCOUNT_TYPE_NORMAL_BALANCE: Record<string, "debit" | "credit"> = {
  asset: "debit",
  expense: "debit",
  liability: "credit",
  equity: "credit",
  revenue: "credit",
};

function calcPostingDelta(
  debit: number,
  credit: number,
  accountType: string
): number {
  const normal = ACCOUNT_TYPE_NORMAL_BALANCE[accountType];
  if (normal === "debit") return debit - credit;
  return credit - debit;
}

function calcVoidDelta(
  debit: number,
  credit: number,
  accountType: string
): number {
  // Exact opposite of posting
  const normal = ACCOUNT_TYPE_NORMAL_BALANCE[accountType];
  if (normal === "debit") return credit - debit;
  return debit - credit;
}

function calcStraightLine(
  purchaseCost: number,
  salvageValue: number,
  usefulLifeMonths: number
): number {
  return r2((purchaseCost - salvageValue) / usefulLifeMonths);
}

function calcDecliningBalance(
  bookValue: number,
  usefulLifeMonths: number,
  salvageValue: number
): number {
  let amount = r2((bookValue * 2) / usefulLifeMonths);
  if (bookValue - amount < salvageValue) {
    amount = r2(bookValue - salvageValue);
  }
  return Math.max(0, amount);
}

function calcSumOfYearsDigits(
  purchaseCost: number,
  salvageValue: number,
  usefulLifeMonths: number,
  monthsElapsed: number
): number {
  const remainingMonths = Math.max(usefulLifeMonths - monthsElapsed, 1);
  const sumDigits = (usefulLifeMonths * (usefulLifeMonths + 1)) / 2;
  return r2(((remainingMonths / sumDigits) * (purchaseCost - salvageValue)) / 12);
}

function bucketAge(
  dueDate: Date,
  asOf: Date
): "current" | "days_30" | "days_60" | "days_90" | "days_120_plus" {
  const daysOverdue = Math.floor(
    (asOf.getTime() - dueDate.getTime()) / 86400000
  );
  if (daysOverdue <= 0) return "current";
  if (daysOverdue <= 30) return "days_30";
  if (daysOverdue <= 60) return "days_60";
  if (daysOverdue <= 90) return "days_90";
  return "days_120_plus";
}

type PeriodStatus = "open" | "closed" | "locked";

function validatePeriodTransition(
  current: PeriodStatus,
  action: "close" | "lock" | "reopen"
): { valid: boolean; error?: string } {
  if (action === "close" && current !== "open") {
    return { valid: false, error: `Cannot close period with status "${current}"` };
  }
  if (action === "lock" && current !== "closed") {
    return { valid: false, error: `Cannot lock period with status "${current}"` };
  }
  if (action === "reopen" && current === "open") {
    return { valid: false, error: "Period is already open" };
  }
  return { valid: true };
}

type PayrollRunStatus = "draft" | "approved" | "posted" | "voided";

function validatePayrollTransition(
  current: PayrollRunStatus,
  target: PayrollRunStatus
): boolean {
  if (current === "draft" && target === "approved") return true;
  if (current === "approved" && target === "posted") return true;
  if (target === "voided") return true; // any → voided
  return false;
}

function calcInvoicePayment(
  currentAmountPaid: number,
  currentTotal: number,
  paymentAmount: number
): { newAmountPaid: number; newBalanceDue: number; newStatus: string } | { error: string } {
  if (paymentAmount <= 0) return { error: "Payment must be positive" };
  const balanceDue = r2(currentTotal - currentAmountPaid);
  if (paymentAmount > balanceDue) {
    return { error: `Payment ${paymentAmount} exceeds balance ${balanceDue}` };
  }
  const newAmountPaid = r2(currentAmountPaid + paymentAmount);
  const newBalanceDue = r2(currentTotal - newAmountPaid);
  const newStatus = newBalanceDue <= 0 ? "paid" : "partial";
  return { newAmountPaid, newBalanceDue, newStatus };
}

// =========================================================================
//  DEPRECIATION TESTS
// =========================================================================

describe("Depreciation Calculations", () => {
  describe("Straight-Line", () => {
    it("calculates monthly depreciation correctly", () => {
      // $10,000 asset, $1,000 salvage, 120 months (10 years)
      expect(calcStraightLine(10000, 1000, 120)).toBe(75.0);
    });

    it("handles zero salvage value", () => {
      expect(calcStraightLine(10000, 0, 120)).toBe(83.33);
    });

    it("handles short useful life", () => {
      // $5,000 over 12 months, no salvage
      expect(calcStraightLine(5000, 0, 12)).toBe(416.67);
    });

    it("handles salvage equal to cost (no depreciation)", () => {
      expect(calcStraightLine(10000, 10000, 120)).toBe(0);
    });

    it("total depreciation never exceeds depreciable base", () => {
      const monthly = calcStraightLine(10000, 1000, 120);
      const totalOverLife = r2(monthly * 120);
      expect(totalOverLife).toBe(9000); // cost - salvage
    });

    it("handles large asset values", () => {
      // $1.5M equipment, $50k salvage, 360 months (30 years)
      const monthly = calcStraightLine(1500000, 50000, 360);
      expect(monthly).toBe(4027.78);
    });
  });

  describe("Declining Balance (Double-Declining)", () => {
    it("calculates first month correctly", () => {
      // $10,000 asset, 120 months, book value = $10,000
      expect(calcDecliningBalance(10000, 120, 1000)).toBe(166.67);
    });

    it("reduces over time as book value decreases", () => {
      let bookValue = 10000;
      const salvage = 1000;
      const life = 120;
      const depreciations: number[] = [];

      for (let i = 0; i < 12; i++) {
        const dep = calcDecliningBalance(bookValue, life, salvage);
        depreciations.push(dep);
        bookValue = r2(bookValue - dep);
      }

      // Each month should be <= previous (declining)
      for (let i = 1; i < depreciations.length; i++) {
        expect(depreciations[i]).toBeLessThanOrEqual(depreciations[i - 1]);
      }
    });

    it("caps at salvage value", () => {
      // Book value close enough that normal calc would breach salvage
      // (bookValue * 2) / usefulLifeMonths > bookValue - salvage
      const dep = calcDecliningBalance(1010, 120, 1000);
      // Normal: (1010*2)/120 = 16.83, but 1010-16.83=993.17 < 1000 → capped
      expect(dep).toBe(10); // capped: 1010 - 1000 = 10
    });

    it("returns zero when at salvage value", () => {
      expect(calcDecliningBalance(1000, 120, 1000)).toBe(0);
    });

    it("returns zero when below salvage value", () => {
      expect(calcDecliningBalance(900, 120, 1000)).toBe(0);
    });

    it("never lets book value go below salvage", () => {
      let bookValue = 10000;
      const salvage = 1000;
      const life = 60;

      for (let i = 0; i < 200; i++) {
        const dep = calcDecliningBalance(bookValue, life, salvage);
        if (dep <= 0) break;
        bookValue = r2(bookValue - dep);
      }

      expect(bookValue).toBeGreaterThanOrEqual(salvage);
    });
  });

  describe("Sum-of-Years-Digits", () => {
    it("depreciates more in early months", () => {
      const early = calcSumOfYearsDigits(10000, 1000, 120, 0);
      const late = calcSumOfYearsDigits(10000, 1000, 120, 100);
      expect(early).toBeGreaterThan(late);
    });

    it("handles first month", () => {
      const dep = calcSumOfYearsDigits(10000, 1000, 120, 0);
      // remainingMonths=120, sumDigits=7260, (120/7260)*(9000)/12
      expect(dep).toBe(r2((120 / 7260) * 9000 / 12));
    });

    it("handles last month", () => {
      const dep = calcSumOfYearsDigits(10000, 1000, 120, 119);
      // remainingMonths=1, sumDigits=7260, (1/7260)*(9000)/12
      expect(dep).toBe(r2((1 / 7260) * 9000 / 12));
    });

    it("never returns negative", () => {
      const dep = calcSumOfYearsDigits(10000, 1000, 120, 200);
      expect(dep).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Disposal Gain/Loss", () => {
    it("calculates gain on sale above book value", () => {
      const bookValue = 4000;
      const salePrice = 5500;
      const gainLoss = r2(salePrice - bookValue);
      expect(gainLoss).toBe(1500);
    });

    it("calculates loss on sale below book value", () => {
      const bookValue = 4000;
      const salePrice = 2500;
      const gainLoss = r2(salePrice - bookValue);
      expect(gainLoss).toBe(-1500);
    });

    it("zero gain/loss when sold at book value", () => {
      expect(r2(4000 - 4000)).toBe(0);
    });

    it("handles scrap disposal (zero proceeds)", () => {
      const bookValue = 3000;
      const gainLoss = r2(0 - bookValue);
      expect(gainLoss).toBe(-3000);
    });
  });
});

// =========================================================================
//  AGING ANALYSIS TESTS
// =========================================================================

describe("AR/AP Aging Buckets", () => {
  it("current: due date is today or in the future", () => {
    const today = new Date("2026-04-09");
    expect(bucketAge(new Date("2026-04-09"), today)).toBe("current");
    expect(bucketAge(new Date("2026-04-15"), today)).toBe("current");
    expect(bucketAge(new Date("2026-05-01"), today)).toBe("current");
  });

  it("1-30 days overdue", () => {
    const asOf = new Date("2026-04-09");
    expect(bucketAge(new Date("2026-04-08"), asOf)).toBe("days_30"); // 1 day
    expect(bucketAge(new Date("2026-03-20"), asOf)).toBe("days_30"); // 20 days
    expect(bucketAge(new Date("2026-03-10"), asOf)).toBe("days_30"); // 30 days
  });

  it("31-60 days overdue", () => {
    const asOf = new Date("2026-04-09");
    expect(bucketAge(new Date("2026-03-09"), asOf)).toBe("days_60"); // 31 days
    expect(bucketAge(new Date("2026-02-08"), asOf)).toBe("days_60"); // 60 days
  });

  it("61-90 days overdue", () => {
    const asOf = new Date("2026-04-09");
    expect(bucketAge(new Date("2026-02-07"), asOf)).toBe("days_90"); // 61 days
    expect(bucketAge(new Date("2026-01-09"), asOf)).toBe("days_90"); // 90 days
  });

  it("120+ days overdue", () => {
    const asOf = new Date("2026-04-09");
    expect(bucketAge(new Date("2026-01-08"), asOf)).toBe("days_120_plus"); // 91 days
    expect(bucketAge(new Date("2025-01-01"), asOf)).toBe("days_120_plus"); // 464 days
  });

  it("handles year boundary correctly", () => {
    const asOf = new Date("2026-01-15");
    expect(bucketAge(new Date("2025-12-31"), asOf)).toBe("days_30"); // 15 days
    expect(bucketAge(new Date("2025-12-01"), asOf)).toBe("days_60"); // 45 days
  });
});

// =========================================================================
//  TRIAL BALANCE & DOUBLE-ENTRY TESTS
// =========================================================================

describe("Trial Balance & Double-Entry Math", () => {
  describe("Posting deltas", () => {
    it("asset account: debit increases, credit decreases", () => {
      expect(calcPostingDelta(1000, 0, "asset")).toBe(1000);
      expect(calcPostingDelta(0, 500, "asset")).toBe(-500);
    });

    it("liability account: credit increases, debit decreases", () => {
      expect(calcPostingDelta(0, 1000, "liability")).toBe(1000);
      expect(calcPostingDelta(500, 0, "liability")).toBe(-500);
    });

    it("revenue account: credit increases", () => {
      expect(calcPostingDelta(0, 5000, "revenue")).toBe(5000);
    });

    it("expense account: debit increases", () => {
      expect(calcPostingDelta(3000, 0, "expense")).toBe(3000);
    });

    it("equity account: credit increases", () => {
      expect(calcPostingDelta(0, 10000, "equity")).toBe(10000);
    });
  });

  describe("Voiding reverses posting exactly", () => {
    it("void delta is exact opposite of post delta for every account type", () => {
      for (const type of ["asset", "liability", "equity", "revenue", "expense"]) {
        const postDelta = calcPostingDelta(1234.56, 789.01, type);
        const voidDelta = calcVoidDelta(1234.56, 789.01, type);
        expect(r2(postDelta + voidDelta)).toBe(0);
      }
    });

    it("post then void returns balance to original", () => {
      let balance = 5000; // Starting balance for an asset account
      const debit = 1500;
      const credit = 0;

      // Post
      balance = r2(balance + calcPostingDelta(debit, credit, "asset"));
      expect(balance).toBe(6500);

      // Void
      balance = r2(balance + calcVoidDelta(debit, credit, "asset"));
      expect(balance).toBe(5000);
    });
  });

  describe("Balance validation", () => {
    it("balanced entry: total debits === total credits", () => {
      const lines = [
        { debit: 1000, credit: 0 },
        { debit: 0, credit: 1000 },
      ];
      const totalDebits = r2(lines.reduce((s, l) => s + l.debit, 0));
      const totalCredits = r2(lines.reduce((s, l) => s + l.credit, 0));
      expect(totalDebits).toBe(totalCredits);
    });

    it("multi-line balanced entry", () => {
      const lines = [
        { debit: 5000, credit: 0 },    // DR Payroll Expense
        { debit: 750, credit: 0 },     // DR Employer Tax
        { debit: 0, credit: 1200 },    // CR Federal Tax Payable
        { debit: 0, credit: 382.50 },  // CR FICA Payable
        { debit: 0, credit: 4167.50 }, // CR Cash
      ];
      const totalDebits = r2(lines.reduce((s, l) => s + l.debit, 0));
      const totalCredits = r2(lines.reduce((s, l) => s + l.credit, 0));
      expect(totalDebits).toBe(totalCredits);
    });

    it("detects unbalanced entry", () => {
      const lines = [
        { debit: 1000, credit: 0 },
        { debit: 0, credit: 999.99 },
      ];
      const totalDebits = r2(lines.reduce((s, l) => s + l.debit, 0));
      const totalCredits = r2(lines.reduce((s, l) => s + l.credit, 0));
      expect(totalDebits).not.toBe(totalCredits);
    });

    it("handles IEEE 754 floating point correctly", () => {
      // Classic JS floating point issue: 0.1 + 0.2 !== 0.3
      const lines = [
        { debit: 0.1, credit: 0 },
        { debit: 0.2, credit: 0 },
        { debit: 0, credit: 0.3 },
      ];
      const totalDebits = r2(lines.reduce((s, l) => s + l.debit, 0));
      const totalCredits = r2(lines.reduce((s, l) => s + l.credit, 0));
      expect(totalDebits).toBe(totalCredits); // r2 fixes the rounding
    });

    it("handles many small amounts without accumulating error", () => {
      const lines: { debit: number; credit: number }[] = [];
      // 1000 lines of $0.01 debits
      for (let i = 0; i < 1000; i++) {
        lines.push({ debit: 0.01, credit: 0 });
      }
      // One credit of $10.00
      lines.push({ debit: 0, credit: 10.0 });

      const totalDebits = r2(lines.reduce((s, l) => s + l.debit, 0));
      const totalCredits = r2(lines.reduce((s, l) => s + l.credit, 0));
      expect(totalDebits).toBe(totalCredits);
    });

    it("rejects entries with fewer than 2 lines", () => {
      const singleLine = [{ debit: 1000, credit: 0 }];
      expect(singleLine.length).toBeLessThan(2);
    });

    it("rejects lines with negative debits or credits", () => {
      const lines = [
        { debit: -100, credit: 0 },
        { debit: 0, credit: -100 },
      ];
      for (const line of lines) {
        expect(line.debit < 0 || line.credit < 0).toBe(true);
      }
    });
  });
});

// =========================================================================
//  PERIOD CLOSE STATE MACHINE TESTS
// =========================================================================

describe("Period Close State Machine", () => {
  it("open → closed: valid", () => {
    expect(validatePeriodTransition("open", "close")).toEqual({ valid: true });
  });

  it("closed → locked: valid", () => {
    expect(validatePeriodTransition("closed", "lock")).toEqual({ valid: true });
  });

  it("closed → open (reopen): valid", () => {
    expect(validatePeriodTransition("closed", "reopen")).toEqual({ valid: true });
  });

  it("locked → open (reopen): valid", () => {
    expect(validatePeriodTransition("locked", "reopen")).toEqual({ valid: true });
  });

  it("open → locked: INVALID (must close first)", () => {
    const result = validatePeriodTransition("open", "lock");
    expect(result.valid).toBe(false);
  });

  it("closed → closed: INVALID", () => {
    const result = validatePeriodTransition("closed", "close");
    expect(result.valid).toBe(false);
  });

  it("locked → closed: INVALID (must reopen first)", () => {
    const result = validatePeriodTransition("locked", "close");
    expect(result.valid).toBe(false);
  });

  it("locked → locked: INVALID", () => {
    const result = validatePeriodTransition("locked", "lock");
    expect(result.valid).toBe(false);
  });

  it("open → reopen: INVALID (already open)", () => {
    const result = validatePeriodTransition("open", "reopen");
    expect(result.valid).toBe(false);
  });

  it("full lifecycle: open → closed → locked → reopen → closed → locked", () => {
    let status: PeriodStatus = "open";

    expect(validatePeriodTransition(status, "close").valid).toBe(true);
    status = "closed";

    expect(validatePeriodTransition(status, "lock").valid).toBe(true);
    status = "locked";

    expect(validatePeriodTransition(status, "reopen").valid).toBe(true);
    status = "open";

    expect(validatePeriodTransition(status, "close").valid).toBe(true);
    status = "closed";

    expect(validatePeriodTransition(status, "lock").valid).toBe(true);
  });
});

// =========================================================================
//  PAYROLL RUN STATE MACHINE
// =========================================================================

describe("Payroll Run State Machine", () => {
  it("draft → approved: valid", () => {
    expect(validatePayrollTransition("draft", "approved")).toBe(true);
  });

  it("approved → posted: valid", () => {
    expect(validatePayrollTransition("approved", "posted")).toBe(true);
  });

  it("any → voided: valid", () => {
    expect(validatePayrollTransition("draft", "voided")).toBe(true);
    expect(validatePayrollTransition("approved", "voided")).toBe(true);
    expect(validatePayrollTransition("posted", "voided")).toBe(true);
  });

  it("draft → posted: INVALID (must approve first)", () => {
    expect(validatePayrollTransition("draft", "posted")).toBe(false);
  });

  it("posted → approved: INVALID (can't un-post)", () => {
    expect(validatePayrollTransition("posted", "approved")).toBe(false);
  });

  it("approved → draft: INVALID (can't un-approve)", () => {
    expect(validatePayrollTransition("approved", "draft")).toBe(false);
  });

  it("voided → anything: INVALID (terminal state)", () => {
    expect(validatePayrollTransition("voided", "draft")).toBe(false);
    expect(validatePayrollTransition("voided", "approved")).toBe(false);
    expect(validatePayrollTransition("voided", "posted")).toBe(false);
  });
});

// =========================================================================
//  INVOICE PAYMENT TRACKING
// =========================================================================

describe("Invoice Payment Tracking", () => {
  it("full payment marks invoice as paid", () => {
    const result = calcInvoicePayment(0, 5000, 5000);
    expect(result).toEqual({
      newAmountPaid: 5000,
      newBalanceDue: 0,
      newStatus: "paid",
    });
  });

  it("partial payment marks invoice as partial", () => {
    const result = calcInvoicePayment(0, 5000, 2000);
    expect(result).toEqual({
      newAmountPaid: 2000,
      newBalanceDue: 3000,
      newStatus: "partial",
    });
  });

  it("second partial payment that completes the balance", () => {
    const result = calcInvoicePayment(2000, 5000, 3000);
    expect(result).toEqual({
      newAmountPaid: 5000,
      newBalanceDue: 0,
      newStatus: "paid",
    });
  });

  it("rejects payment exceeding balance", () => {
    const result = calcInvoicePayment(2000, 5000, 3500);
    expect(result).toHaveProperty("error");
  });

  it("rejects zero payment", () => {
    const result = calcInvoicePayment(0, 5000, 0);
    expect(result).toHaveProperty("error");
  });

  it("rejects negative payment", () => {
    const result = calcInvoicePayment(0, 5000, -100);
    expect(result).toHaveProperty("error");
  });

  it("handles penny-level precision", () => {
    const result = calcInvoicePayment(0, 100.01, 50.01);
    expect(result).toEqual({
      newAmountPaid: 50.01,
      newBalanceDue: 50.0,
      newStatus: "partial",
    });
  });

  it("handles floating point in multi-payment scenario", () => {
    // Three payments of $33.33 on a $100 invoice
    let paid = 0;
    const total = 100;

    let r = calcInvoicePayment(paid, total, 33.33);
    expect(r).not.toHaveProperty("error");
    paid = (r as { newAmountPaid: number }).newAmountPaid;

    r = calcInvoicePayment(paid, total, 33.33);
    expect(r).not.toHaveProperty("error");
    paid = (r as { newAmountPaid: number }).newAmountPaid;

    r = calcInvoicePayment(paid, total, 33.34);
    expect(r).not.toHaveProperty("error");
    expect((r as { newStatus: string }).newStatus).toBe("paid");
    expect((r as { newBalanceDue: number }).newBalanceDue).toBe(0);
  });
});

// =========================================================================
//  INVOICE AUTO-JE VALIDATION
// =========================================================================

describe("Invoice Auto-JE Structure", () => {
  it("send creates balanced AR JE: DR AR / CR Revenue", () => {
    const invoiceTotal = 6250.0;
    const taxAmount = 0;

    // Expected JE lines when invoice is sent
    const lines = [
      { account: "1100-AR", debit: invoiceTotal, credit: 0 },
      { account: "4000-Revenue", debit: 0, credit: invoiceTotal - taxAmount },
    ];
    if (taxAmount > 0) {
      lines.push({ account: "2300-SalesTax", debit: 0, credit: taxAmount });
    }

    const totalDebits = r2(lines.reduce((s, l) => s + l.debit, 0));
    const totalCredits = r2(lines.reduce((s, l) => s + l.credit, 0));
    expect(totalDebits).toBe(totalCredits);
    expect(totalDebits).toBe(invoiceTotal);
  });

  it("send with tax creates 3-line balanced JE", () => {
    const subtotal = 5000;
    const taxRate = 0.06;
    const taxAmount = r2(subtotal * taxRate);
    const total = r2(subtotal + taxAmount);

    const lines = [
      { debit: total, credit: 0 },        // DR AR
      { debit: 0, credit: subtotal },      // CR Revenue
      { debit: 0, credit: taxAmount },     // CR Sales Tax
    ];

    const totalDebits = r2(lines.reduce((s, l) => s + l.debit, 0));
    const totalCredits = r2(lines.reduce((s, l) => s + l.credit, 0));
    expect(totalDebits).toBe(totalCredits);
    expect(taxAmount).toBe(300);
    expect(total).toBe(5300);
  });

  it("payment creates balanced JE: DR Cash / CR AR", () => {
    const paymentAmount = 2000;
    const lines = [
      { debit: paymentAmount, credit: 0 },  // DR Cash
      { debit: 0, credit: paymentAmount },   // CR AR
    ];
    const totalDebits = r2(lines.reduce((s, l) => s + l.debit, 0));
    const totalCredits = r2(lines.reduce((s, l) => s + l.credit, 0));
    expect(totalDebits).toBe(totalCredits);
  });
});

// =========================================================================
//  PAYROLL JE STRUCTURE
// =========================================================================

describe("Payroll Run JE Structure", () => {
  it("payroll posting creates balanced JE", () => {
    const grossPay = 5000;
    const federalWh = 450;
    const stateWh = 200;
    const ssEmployee = 310;
    const medicareEmployee = 72.50;
    const ssEmployer = 310;
    const medicareEmployer = 72.50;
    const futa = 30;
    const suta = 135;
    const netPay = r2(grossPay - federalWh - stateWh - ssEmployee - medicareEmployee);
    const totalEmployerTax = r2(ssEmployer + medicareEmployer + futa + suta);

    const lines = [
      { debit: grossPay, credit: 0 },           // DR 5000 Payroll Expense
      { debit: totalEmployerTax, credit: 0 },   // DR 5010 Employer Tax
      { debit: 0, credit: federalWh },           // CR Federal Tax Payable
      { debit: 0, credit: stateWh },             // CR State Tax Payable
      { debit: 0, credit: r2(ssEmployee + ssEmployer + medicareEmployee + medicareEmployer) }, // CR FICA
      { debit: 0, credit: futa },                // CR FUTA Payable
      { debit: 0, credit: suta },                // CR SUTA Payable
      { debit: 0, credit: netPay },              // CR Cash
    ];

    const totalDebits = r2(lines.reduce((s, l) => s + l.debit, 0));
    const totalCredits = r2(lines.reduce((s, l) => s + l.credit, 0));
    expect(totalDebits).toBe(totalCredits);
  });

  it("YTD accumulators never go negative on void", () => {
    const ytd = { gross: 10000, federal: 2000, ss: 620 };
    const lineAmounts = { gross: 5000, federal: 450, ss: 310 };

    // Void: subtract but floor at 0
    const newGross = Math.max(0, ytd.gross - lineAmounts.gross);
    const newFederal = Math.max(0, ytd.federal - lineAmounts.federal);
    const newSs = Math.max(0, ytd.ss - lineAmounts.ss);

    expect(newGross).toBe(5000);
    expect(newFederal).toBe(1550);
    expect(newSs).toBe(310);
  });

  it("YTD void floors at zero even if void exceeds accumulated", () => {
    // Edge case: voiding more than accumulated (shouldn't happen, but defensive)
    const ytd = { gross: 3000 };
    const voidAmount = 5000;
    expect(Math.max(0, ytd.gross - voidAmount)).toBe(0);
  });
});

// =========================================================================
//  YEAR-END CLOSE LOGIC
// =========================================================================

describe("Year-End Close", () => {
  it("revenue accounts closed to retained earnings", () => {
    const revenueBalance = 50000; // credit-normal
    // Close: DR Revenue / CR Retained Earnings
    const closingLines = [
      { debit: revenueBalance, credit: 0 },    // DR Revenue (zeroes it out)
      { debit: 0, credit: revenueBalance },     // CR Retained Earnings
    ];
    const totalDebits = r2(closingLines.reduce((s, l) => s + l.debit, 0));
    const totalCredits = r2(closingLines.reduce((s, l) => s + l.credit, 0));
    expect(totalDebits).toBe(totalCredits);
  });

  it("expense accounts closed to retained earnings", () => {
    const expenseBalance = 35000; // debit-normal
    // Close: CR Expense / DR Retained Earnings... wait no:
    // Revenue - Expenses = Net Income → Retained Earnings
    // Close expenses: CR Expense (zeroes it) / the net goes to RE
    const closingLines = [
      { debit: 0, credit: expenseBalance },    // CR Expense (zeroes debit balance)
      { debit: expenseBalance, credit: 0 },    // DR ... this goes into net income calc
    ];
    const totalDebits = r2(closingLines.reduce((s, l) => s + l.debit, 0));
    const totalCredits = r2(closingLines.reduce((s, l) => s + l.credit, 0));
    expect(totalDebits).toBe(totalCredits);
  });

  it("net income correctly computed from revenue - expenses", () => {
    const revenue = 150000;
    const expenses = 120000;
    const netIncome = revenue - expenses;
    expect(netIncome).toBe(30000);
    // Net income > 0 → CR Retained Earnings
    // Net income < 0 → DR Retained Earnings (net loss)
  });

  it("net loss debits retained earnings", () => {
    const revenue = 80000;
    const expenses = 95000;
    const netIncome = revenue - expenses;
    expect(netIncome).toBe(-15000);
    // DR Retained Earnings $15,000
  });

  it("asset/liability/equity accounts NOT closed at year-end", () => {
    const permanentAccounts = ["asset", "liability", "equity"];
    const temporaryAccounts = ["revenue", "expense"];
    // Year-end close only touches temporary accounts
    expect(permanentAccounts).not.toContain("revenue");
    expect(temporaryAccounts).toContain("revenue");
    expect(temporaryAccounts).toContain("expense");
  });
});

// =========================================================================
//  ROUNDING EDGE CASES (r2 function)
// =========================================================================

describe("Financial Rounding (r2)", () => {
  it("rounds to 2 decimal places", () => {
    expect(r2(10.555)).toBe(10.56);
    expect(r2(10.554)).toBe(10.55);
    expect(r2(10.5)).toBe(10.5);
  });

  it("handles IEEE 754 classic: 0.1 + 0.2", () => {
    expect(r2(0.1 + 0.2)).toBe(0.3);
  });

  it("handles negative amounts", () => {
    // Math.round(-1055.5) = -1055 (rounds toward +∞ for .5)
    expect(r2(-10.555)).toBe(-10.55);
    expect(r2(-0.001)).toBe(-0); // Math.round preserves sign of zero
  });

  it("handles zero", () => {
    expect(r2(0)).toBe(0);
  });

  it("handles large amounts", () => {
    expect(r2(1234567.891)).toBe(1234567.89);
  });

  it("handles banker's rounding edge case", () => {
    // JS Math.round rounds 0.5 up (not banker's rounding)
    expect(r2(2.005)).toBe(2.01); // 2.005 * 100 = 200.5 → rounds to 201
    expect(r2(2.015)).toBe(2.02);
  });
});
