# QuickBooks Replacement Roadmap

## IronSight Company OS — Full Accounting Independence

**Company**: B&B Metals, Inc. — Railroad TPS contractor, Shepherdsville, KY
**Fleet**: ~36 Mack trucks, Norfolk Southern contracts
**Current state**: QuickBooks handles accounting + payroll. IronSight OS has a working double-entry bookkeeping foundation but lacks the full feature set needed to cut over.

**Goal**: Eliminate the QuickBooks subscription entirely by building every critical accounting, payroll, invoicing, and compliance feature directly into IronSight OS — tightly integrated with the timesheets, per diem, inventory, and fleet modules that already exist.

---

## 1. What's Already Built

IronSight OS already has a solid accounting foundation that QuickBooks cannot match in terms of integration with field operations:

| Feature | Status | Details |
|---------|--------|---------|
| **Double-entry bookkeeping** | Live | Enforced balanced debits/credits on every transaction |
| **Chart of Accounts** | Live | 32 seeded accounts across 5 types (Assets 1000-1999, Liabilities 2000-2999, Equity 3000-3999, Revenue 4000-4999, Expenses 5000-9999) |
| **Journal Entries** | Live | Create, post, void workflow with full audit trail. Filter by status, source, date range |
| **Trial Balance** | Live | As-of-date computation from posted entries, balanced/unbalanced indicator |
| **Profit & Loss (Income Statement)** | Live | Revenue vs. expenses with net income/loss, derived from trial balance data |
| **Auto-generated journal entries** | Live | Timesheet approval auto-posts per diem (DR 5100 / CR 2110) and expense entries. Rejection/withdrawal auto-voids |
| **Payroll export** | Live | CSV/JSON export of approved timesheets with hours, per diem, mileage, expenses, maintenance/shop time |
| **Timesheets** | Live | 12 sub-sections: daily logs, railroad time, inspections, IFTA, expenses, maintenance, shop, mileage, flight, holiday, vacation pay |
| **Per Diem** | Live | Auto-calculated from nights_out and layovers, linked to timesheets |
| **Receipt capture** | Live | Photo upload to Supabase Storage via timesheet expense entries |
| **Mileage tracking** | Live | Mileage pay sub-section in timesheets |
| **Inventory & Parts** | Live | 22 seeded parts, usage logging, low-stock alerts, reorder points |
| **Audit trail** | Live | All accounting actions logged with user, timestamp, and details |
| **Role-based access** | Live | Manager/developer access for financial operations, all roles for viewing |
| **Print-ready reports** | Live | CSS print styles on financial reports page |

**Database**: 3 core accounting tables (`chart_of_accounts`, `journal_entries`, `journal_entry_lines`) with proper constraints, indexes, and triggers. Migration 009 applied.

**Shared types**: Full TypeScript type system in `packages/shared/src/accounting.ts` — Account, JournalEntry, JournalEntryLine, TrialBalance, constants, and helpers.

**API routes**: `/api/accounting/accounts`, `/api/accounting/entries`, `/api/accounting/trial-balance`, `/api/payroll/export`.

**Pages**: `/accounting`, `/accounting/new`, `/accounting/[id]`, `/accounting/reports`, `/payroll`.

---

## 2. Core Accounting Gaps

These are the fundamental accounting features QuickBooks provides that IronSight does not yet have.

### 2.1 Accounts Payable (AP)

**What it does**: Track bills from vendors (parts suppliers, fuel companies, insurance providers), schedule payments, and see what's owed at any point. Aging reports show 30/60/90/120-day buckets.

**Why B&B needs it**: B&B has dozens of vendors — truck parts, fuel, tools, insurance, shop rent. Right now these are tracked in QB. Without AP, there's no way to see total outstanding obligations or plan cash outflows.

**What to build**:
- `vendors` table — name, contact, terms (Net 30, Net 60), default expense account
- `bills` table — vendor_id, bill_date, due_date, amount, status (open/partial/paid/voided), line items with account mapping
- `bill_payments` table — payment_date, amount, method, check_number, links to bills
- AP aging report — 30/60/90/120-day buckets per vendor
- Vendor statement view
- Auto-generate journal entries: DR Expense accounts / CR 2000 Accounts Payable on bill entry; DR 2000 AP / CR 1000 Cash on payment

**Complexity**: Large

### 2.2 Accounts Receivable (AR)

**What it does**: Track money owed by customers (Norfolk Southern, other railroads). Create invoices, record payments, see outstanding receivables with aging.

**Why B&B needs it**: Norfolk Southern contract billing is the primary revenue source. Need to track what's been invoiced, what's been paid, and what's outstanding. Aging matters for cash flow planning.

**What to build**:
- `customers` table — name, contact, billing terms, credit limit
- `invoices` table — customer_id, invoice_number (auto-increment), date, due_date, status (draft/sent/partial/paid/voided/overdue), line items
- `invoice_payments` table — payment_date, amount, method, reference, allocation to specific invoices
- AR aging report — 30/60/90/120-day buckets per customer
- Customer statement view
- Auto-generate journal entries: DR 1100 Accounts Receivable / CR 4000-4020 Revenue on invoice; DR 1000 Cash / CR 1100 AR on payment

**Complexity**: Large

### 2.3 Bank Reconciliation

**What it does**: Match transactions in the system against the bank statement to ensure every dollar is accounted for. Identify discrepancies, outstanding checks, and deposits in transit.

**Why B&B needs it**: Monthly bank reconciliation is a fundamental accounting control. Without it, errors and fraud go undetected. This is one of the most-used QB features.

**What to build**:
- `bank_accounts` table — name, institution, account_number_last4, current_balance
- `bank_transactions` table — date, amount, type (deposit/withdrawal/transfer), cleared status, matched_journal_entry_id
- Reconciliation workflow UI — import statement, match transactions, flag unmatched items
- Reconciliation report — beginning balance, cleared items, outstanding items, ending balance vs. bank statement
- Statement import parser (CSV from bank, eventually Plaid)

**Complexity**: Large

### 2.4 General Ledger Report

**What it does**: Complete chronological list of all transactions posted to each account, with running balances. The master record of all financial activity.

**Why B&B needs it**: The trial balance shows totals, but auditors and accountants need to see every individual transaction that hit each account. This is table-stakes for any accounting system.

**What to build**:
- API endpoint that returns all posted journal entry lines for a given account (or all accounts) within a date range, ordered chronologically with running balance
- GL report page with account filter, date range, and running balance column
- Export to CSV/PDF

**Complexity**: Small — the data already exists in `journal_entry_lines` joined to `journal_entries`. This is primarily a query and UI task.

### 2.5 Balance Sheet Report

**What it does**: Point-in-time snapshot showing Assets = Liabilities + Equity. The fundamental accounting equation.

**Why B&B needs it**: Banks, investors, and the IRS all require a balance sheet. It shows the financial position of the company at any given date.

**What to build**:
- API endpoint that groups trial balance data into Assets, Liabilities, Equity sections with subtotals
- Compute retained earnings (prior year P&L net income rolled into equity)
- Balance Sheet page with proper formatting: Current Assets, Fixed Assets, Current Liabilities, Long-term Liabilities, Equity
- Verify Assets = Liabilities + Equity

**Complexity**: Small — the trial balance API already computes per-account balances. This is primarily a presentation layer that reorganizes existing data.

### 2.6 Cash Flow Statement

**What it does**: Shows where cash came from and where it went during a period. Three sections: Operating, Investing, Financing activities.

**Why B&B needs it**: Critical for understanding whether the business is generating enough cash to cover operations, even if P&L shows a profit. Equipment purchases, debt payments, and owner draws all affect cash differently than profit.

**What to build**:
- Account classification for cash flow purposes (operating/investing/financing)
- Indirect method computation: start with net income, adjust for non-cash items (depreciation, changes in AR/AP/inventory)
- Cash flow report page
- Period comparison (this quarter vs. last quarter)

**Complexity**: Medium — requires classifying accounts and computing period-over-period changes in balance sheet accounts.

### 2.7 Budget vs. Actual

**What it does**: Set budget amounts per account per month/quarter, then compare actual spending against the budget with variance analysis.

**Why B&B needs it**: Controlling costs on a 36-truck fleet requires knowing whether fuel, maintenance, payroll, and per diem are tracking to plan. Variance alerts can catch problems early.

**What to build**:
- `budgets` table — fiscal_year, account_id, period (month/quarter), budgeted_amount
- Budget entry UI — per-account monthly amounts with copy-from-prior-year
- Budget vs. actual report — budget column, actual column, variance ($ and %), favorable/unfavorable
- Variance alert thresholds (e.g., flag when actual exceeds budget by >10%)

**Complexity**: Medium

### 2.8 Fixed Asset Tracking / Depreciation Schedules

**What it does**: Track physical assets (trucks, equipment, tools), their purchase cost, depreciation method (straight-line, MACRS), useful life, and auto-generate monthly depreciation journal entries.

**Why B&B needs it**: 36 Mack trucks are the primary capital assets. Each needs depreciation tracked for tax purposes. Currently this is probably done manually or in QB's fixed asset module.

**What to build**:
- `fixed_assets` table — name, description, purchase_date, cost, salvage_value, useful_life_months, depreciation_method, linked_truck_id (optional), current_book_value
- `depreciation_schedule` table — asset_id, period, depreciation_amount, accumulated_depreciation, book_value
- Monthly depreciation batch — auto-generate JE: DR 6000 Depreciation Expense / CR 1310 Accumulated Depreciation
- Asset register report — all assets with current book value
- Disposal/sale workflow — remove asset, record gain/loss

**Complexity**: Medium

### 2.9 Recurring Journal Entries

**What it does**: Define journal entries that repeat on a schedule (monthly, quarterly, annually) — e.g., rent, insurance, loan payments. System auto-generates drafts at each interval.

**Why B&B needs it**: Shop rent, insurance premiums, equipment lease payments, and other fixed costs recur every month. Manually creating these entries each period is tedious and error-prone.

**What to build**:
- `recurring_journal_entries` table — template fields (description, lines, frequency, next_date, end_date, active flag)
- Scheduled job (cron or Supabase Edge Function) that creates draft entries from templates when next_date arrives
- UI to create/edit/pause/delete recurring templates
- Dashboard indicator showing upcoming recurring entries

**Complexity**: Small

### 2.10 Multi-Period Closing

**What it does**: Close an accounting period (month/quarter/year) to prevent changes to posted entries in prior periods. Roll net income into retained earnings at year-end.

**Why B&B needs it**: Without period closing, someone can accidentally (or intentionally) modify a prior-month entry and corrupt financial statements. This is a basic internal control.

**What to build**:
- `accounting_periods` table — start_date, end_date, status (open/closed/locked)
- Close-period workflow — verify all entries posted, lock the period, prevent new entries in closed periods
- Year-end close — create closing entry that zeros revenue/expense accounts into retained earnings (3100)
- Re-open period (manager override with audit log)

**Complexity**: Small

---

## 3. Payroll Gaps

The current payroll export provides raw data from approved timesheets. To fully replace QuickBooks payroll, these features are needed.

### 3.1 Tax Calculation Engine

**What it does**: Compute federal income tax withholding (W-4 based), state income tax (Kentucky), FICA (Social Security 6.2% + Medicare 1.45%), FUTA (federal unemployment), SUTA (state unemployment), and any local taxes.

**Why B&B needs it**: This is the core of payroll. Without automated tax calculation, payroll has to be processed through QB or a third-party service. Getting this wrong has legal consequences.

**What to build**:
- `employee_tax_profiles` table — W-4 data (filing status, allowances/withholding), state, additional withholding
- Federal withholding tables (IRS Publication 15-T, updated annually)
- Kentucky state withholding (flat 4% as of 2026)
- FICA computation — 6.2% SS (up to wage base) + 1.45% Medicare (+ 0.9% Additional Medicare over $200k)
- FUTA — 6.0% on first $7,000 (minus state credit)
- KY SUTA — rate varies by employer experience
- Payroll register report — gross pay, each deduction, net pay per employee
- Year-to-date accumulation for wage base limits

**Complexity**: Large — tax tables change annually, edge cases around wage bases, multiple states if workers cross state lines (railroad work does this).

### 3.2 Direct Deposit / ACH File Generation

**What it does**: Generate NACHA-format ACH files that can be uploaded to the bank to execute direct deposit payments, or integrate with a direct deposit API.

**Why B&B needs it**: Writing 30+ checks every pay period is impractical. Most employees expect direct deposit. QB payroll handles this through Intuit's banking integration.

**What to build**:
- `employee_bank_accounts` table — routing_number, account_number (encrypted), account_type
- NACHA ACH file generator — batch header, entry detail records, batch control, file control
- Upload workflow — generate file, review, submit to bank portal (or API)
- Payment confirmation tracking
- Alternative: integrate with a payroll payment API (Gusto, Check/Checkhq)

**Complexity**: Large — NACHA format is strict, encryption of bank details is critical, and any error means employees don't get paid.

### 3.3 W-2 / 1099 Generation

**What it does**: Generate year-end tax forms. W-2 for employees (wages, withholding, benefits). 1099-NEC for independent contractors ($600+ threshold).

**Why B&B needs it**: These are legally required by January 31 each year. Incorrect or late filing means IRS penalties.

**What to build**:
- W-2 data assembly — YTD wages, federal/state/FICA withholding, benefits
- 1099-NEC data assembly — vendor payments over $600
- PDF generation for employee/contractor copies
- Electronic filing format (W-2 = EFW2, 1099 = FIRE system)
- Mailing labels / distribution tracking

**Complexity**: Large — strict IRS formatting requirements, data accuracy is critical.

### 3.4 Payroll Tax Filing (941, 940, State)

**What it does**: Prepare and file quarterly Form 941 (federal income tax + FICA), annual Form 940 (FUTA), and state withholding returns.

**Why B&B needs it**: These filings are legally required. Late filing incurs penalties and interest. QB payroll automates this; IronSight needs to match.

**What to build**:
- Form 941 data assembly — quarterly wages, withholding, FICA, deposit schedule
- Form 940 data assembly — annual FUTA liability
- Kentucky withholding return
- Filing reminders with due dates
- Deposit schedule tracking (semi-weekly or monthly based on liability)
- PDF generation for paper filing, or e-file format for IRS EFTPS

**Complexity**: Large

### 3.5 Workers Compensation Tracking

**What it does**: Track workers comp insurance premiums based on job classification codes and payroll. Railroad/construction work has higher rates than office work.

**Why B&B needs it**: Workers comp is mandatory and expensive for a construction/railroad contractor. Premiums are based on payroll by classification. Annual audits compare estimated vs. actual payroll.

**What to build**:
- `workers_comp_classes` table — NCCI code, description, rate per $100 of payroll
- Employee classification assignment
- Premium estimation — payroll by class x rate
- Audit preparation report — actual payroll by class for the policy period
- Experience modifier tracking

**Complexity**: Small — primarily reporting and classification, not transactional.

### 3.6 Benefits Deduction Management

**What it does**: Track and deduct employee benefits (health insurance, dental, vision, 401k, HSA) from each paycheck. Handle pre-tax vs. post-tax deductions.

**Why B&B needs it**: Even basic health insurance deductions need to be tracked per employee, deducted correctly (pre-tax for Section 125), and reported on W-2s.

**What to build**:
- `benefit_plans` table — name, type, pre_tax flag, employer_contribution, employee_contribution
- `employee_benefits` table — employee_id, plan_id, enrollment_date, deduction_amount
- Per-paycheck deduction calculation
- Employer contribution tracking (for benefits that have employer match)
- Annual benefit summary per employee

**Complexity**: Medium

---

## 4. Invoicing & Billing

### 4.1 Customer Management

**What it does**: Maintain a database of customers with billing contacts, payment terms, credit limits, and historical transaction summary.

**Why B&B needs it**: Norfolk Southern is the primary customer, but there may be others. Each has different terms, contacts, and billing requirements. This is the foundation for AR.

**What to build**:
- `customers` table — company_name, contact_name, email, phone, billing_address, payment_terms (Net 30/45/60), credit_limit, notes
- Customer list page with search and filter
- Customer detail page with contact info, open invoices, payment history, credit utilization

**Complexity**: Small

### 4.2 Invoice Generation with Line Items

**What it does**: Create professional invoices with line items (description, quantity, rate, amount), subtotals, taxes if applicable, and terms.

**Why B&B needs it**: Norfolk Southern contracts likely require formal invoices for each job or billing period. These need to reference specific work performed — which the timesheet system already captures.

**What to build**:
- `invoices` table — customer_id, invoice_number (auto-sequence), date, due_date, status, subtotal, tax, total, notes
- `invoice_line_items` table — description, quantity, unit_price, amount, linked_timesheet_id (optional)
- Invoice creation page — customer picker, line item editor, auto-populate from approved timesheets
- Auto-generate journal entry on send: DR 1100 AR / CR 4010 Railroad Services

**Complexity**: Medium

### 4.3 Invoice Templates / PDF Generation

**What it does**: Generate branded PDF invoices with B&B Metals logo, address, terms, and line items that can be emailed or printed.

**Why B&B needs it**: Professional invoices matter for a company billing major railroads. PDFs are the standard format for invoice delivery.

**What to build**:
- Invoice PDF template — header with logo/address, customer block, line items table, totals, payment instructions, terms
- PDF generation (react-pdf, puppeteer, or server-side HTML-to-PDF)
- Email invoice directly from the system
- Invoice numbering and sequential tracking

**Complexity**: Medium

### 4.4 Payment Recording and Application

**What it does**: Record customer payments and apply them to specific outstanding invoices. Handle partial payments, overpayments, and credits.

**Why B&B needs it**: When Norfolk Southern pays, that payment needs to be matched to the correct invoice(s) and the AR balance reduced.

**What to build**:
- Payment recording UI — customer, amount, date, method (check/ACH/wire), reference number
- Payment application — select which invoices to apply the payment to
- Overpayment handling — create credit memo
- Auto-generate journal entry: DR 1000 Cash / CR 1100 AR

**Complexity**: Medium

### 4.5 Late Payment Reminders

**What it does**: Automatically identify overdue invoices and send reminder emails at configurable intervals (7 days, 30 days, 60 days past due).

**Why B&B needs it**: Cash flow depends on timely collection. Automated reminders save administrative time and reduce the chance of invoices slipping through the cracks.

**What to build**:
- Overdue invoice detection query
- Email template for payment reminders (friendly, firm, final notice tiers)
- Reminder schedule configuration per customer
- Reminder history log
- Integration with email service (Resend, SendGrid, or SES)

**Complexity**: Small

### 4.6 Estimates / Quotes Converting to Invoices

**What it does**: Create estimates or quotes for potential work. When the work is approved, convert the estimate to an invoice with one click.

**Why B&B needs it**: Bidding on railroad jobs requires providing estimates. Converting accepted estimates to invoices eliminates double-entry and maintains a clean quote-to-cash pipeline.

**What to build**:
- `estimates` table — mirrors invoice structure but with estimate-specific statuses (draft/sent/accepted/rejected/expired)
- Estimate creation page
- Convert-to-invoice action — copy all line items, link estimate to invoice
- Estimate tracking — acceptance rate, average time to acceptance

**Complexity**: Small

---

## 5. Expense Management

### 5.1 Receipt Capture

**What it does**: Photograph and upload receipts, attach them to expense entries, extract key data (vendor, amount, date).

**Why B&B needs it**: Field workers buy parts, fuel, and supplies. Paper receipts get lost. Digital capture is already partially built in the timesheet expense sub-section.

**What to build**:
- Already built: receipt photo upload via timesheet expenses to Supabase Storage
- Enhancement: standalone receipt capture outside of timesheets (for non-timesheet expenses like credit card purchases)
- Future: OCR extraction (vendor name, amount, date) via AI vision

**Complexity**: Small (enhancement to existing system)

### 5.2 Credit Card Transaction Import

**What it does**: Import credit card statements (CSV) and match transactions to expense categories and accounts.

**Why B&B needs it**: Company credit cards are used for fuel, parts, and supplies. Manually entering every transaction is time-consuming and error-prone.

**What to build**:
- CSV import parser for major credit card statement formats
- Transaction matching UI — suggested categories based on vendor name
- Auto-categorization rules (e.g., "Shell" always maps to 5400 Fuel & IFTA)
- Journal entry generation from imported transactions
- Duplicate detection

**Complexity**: Medium

### 5.3 Expense Categorization Rules

**What it does**: Define rules that auto-assign expense categories based on vendor name, amount range, or description keywords.

**Why B&B needs it**: With dozens of transactions per week, manual categorization wastes time. Rules like "any purchase from AutoZone goes to 5600 Tools & Supplies" save significant effort.

**What to build**:
- `expense_rules` table — match_type (vendor_contains, amount_range, description_contains), match_value, target_account_id, priority
- Rule matching engine — applied during credit card import and manual expense entry
- Rule management UI — create/edit/delete rules, test against sample transactions
- Suggestion mode — suggest category but allow override

**Complexity**: Small

### 5.4 Mileage Tracking

**What it does**: Track business miles driven for reimbursement and tax deduction purposes using IRS standard mileage rates.

**Why B&B needs it**: Employees drive personal vehicles to job sites. The mileage pay timesheet sub-section already captures this data. Enhancement needed for IRS rate tracking and annual summary.

**What to build**:
- Already built: mileage pay sub-section in timesheets
- Enhancement: IRS mileage rate table (updated annually, currently $0.67/mile for 2024)
- Enhancement: annual mileage summary per employee for tax reporting
- Enhancement: auto-calculate reimbursement amount from miles x IRS rate

**Complexity**: Small (enhancement to existing system)

---

## 6. Reporting & Compliance

### 6.1 Quarterly Tax Reports

**What it does**: Generate data needed for quarterly federal (941) and state tax filings. Summary of wages, withholding, and employer taxes.

**Why B&B needs it**: Quarterly filings are legally required. Currently QB generates this data. IronSight needs to provide the same information.

**What to build**:
- Quarterly summary report — total wages, federal withholding, Social Security, Medicare, by month
- Form 941 worksheet — pre-populated from payroll data
- State quarterly report — Kentucky withholding summary
- Filing deadline reminders with calendar integration

**Complexity**: Medium (depends on payroll tax engine being built first)

### 6.2 1099 Vendor Tracking

**What it does**: Track payments to independent contractors and vendors throughout the year, flagging those over the $600 threshold for 1099-NEC filing.

**Why B&B needs it**: If B&B pays any independent contractors (subcontractors, consultants), 1099s are legally required. Missing them means IRS penalties.

**What to build**:
- Vendor TIN (Tax Identification Number) collection — W-9 tracking
- YTD payment tracking per vendor from AP data
- 1099 threshold alert — flag vendors approaching $600
- 1099-NEC preparation report
- TIN verification (optional IRS TIN matching)

**Complexity**: Small (primarily reporting from AP data)

### 6.3 Sales Tax

**What it does**: Calculate, collect, and remit sales tax if applicable to any services or parts sold.

**Why B&B needs it**: Kentucky has a 6% sales tax. Whether B&B's railroad services are taxable depends on the specific service classification. Parts resale may be taxable.

**What to build**:
- Tax rate table — state and local rates
- Tax applicability rules per service/product type
- Tax collection on invoices
- Tax remittance tracking and filing
- Note: railroad services may be exempt — research needed

**Complexity**: Small (if mostly exempt) to Medium (if actively collecting)

### 6.4 Audit Trail

**What it does**: Immutable log of every financial transaction, modification, and user action with timestamps.

**Why B&B needs it**: Already built. The existing audit system logs all accounting actions via `logAuditDirect()`. Enhancement would add reporting views for auditors.

**What to build**:
- Already built: audit logging on all journal entry operations
- Enhancement: audit report page — searchable/filterable audit log for accounting actions
- Enhancement: export audit trail to PDF for external auditors
- Enhancement: change history on individual records (who changed what, when)

**Complexity**: Small (enhancement to existing system)

### 6.5 Year-End Closing

**What it does**: Close the fiscal year by zeroing all revenue and expense accounts into Retained Earnings, generating the closing journal entry, and locking the prior year.

**Why B&B needs it**: Required annually. This is the formal process that resets the income statement for the new year and carries the net result into the balance sheet.

**What to build**:
- Year-end closing wizard — review open items, generate closing entry
- Closing journal entry — DR all revenue accounts, CR all expense accounts, net to 3100 Retained Earnings
- Lock prior year (part of multi-period closing in 2.10)
- Year-end financial package — Balance Sheet, P&L, Cash Flow for the year

**Complexity**: Small (mostly automated from existing data)

---

## 7. Integrations Needed

### 7.1 Bank Feed (Plaid API)

**What it does**: Automatically import bank and credit card transactions daily via Plaid, eliminating manual CSV imports.

**Why B&B needs it**: Manual bank statement imports are time-consuming and delay reconciliation. Live bank feeds are what makes QB "just work" for daily bookkeeping.

**What to build**:
- Plaid Link integration — connect bank accounts through their OAuth flow
- Daily transaction sync — fetch new transactions, store in `bank_transactions`
- Transaction matching engine — auto-match to journal entries by amount/date
- Plaid webhook handler for real-time transaction notifications
- Plaid costs: ~$0.30/transaction or flat monthly fee depending on plan

**Complexity**: Large — Plaid integration requires production approval, security review, and handling edge cases (duplicate transactions, pending vs. posted, account reconnection).

### 7.2 Payment Processing (Stripe or Square)

**What it does**: Accept customer payments electronically — credit card, ACH bank transfer, or digital invoicing with a pay-now link.

**Why B&B needs it**: If Norfolk Southern or other customers want to pay electronically, a payment processing integration eliminates check handling and speeds up cash collection.

**What to build**:
- Stripe Connect or Square integration
- Payment link generation on invoices
- Webhook handler for payment confirmation
- Auto-record payment and update AR on successful charge
- Fee tracking (Stripe charges ~2.9% + $0.30 per card transaction, ACH is ~0.8%)

**Complexity**: Medium

### 7.3 ACH / Direct Deposit Integration

**What it does**: Send payroll payments directly to employee bank accounts via ACH network.

**Why B&B needs it**: Covered in 3.2 above. This is the integration layer — either direct NACHA file upload to the bank, or using a payroll payments API.

**What to build**:
- Option A: NACHA file generation + manual bank upload
- Option B: API integration with a payroll payment provider (Check/Checkhq, Gusto API)
- Option C: Direct bank API (if B&B's bank offers one)
- Payment confirmation and reconciliation

**Complexity**: Large

### 7.4 Tax Filing (IRS E-File)

**What it does**: Electronically file tax forms (941, 940, W-2, 1099) with the IRS and state agencies.

**Why B&B needs it**: Paper filing is slow and error-prone. E-filing is faster, provides confirmation, and is required for businesses filing 10+ W-2s.

**What to build**:
- IRS EFTPS integration for tax deposits (941 payments)
- EFW2 format for W-2 electronic filing via SSA BSO
- FIRE system format for 1099 electronic filing
- Kentucky state e-file integration
- Filing confirmation tracking and receipt storage

**Complexity**: Large — strict formatting requirements, testing with IRS systems, security certifications.

---

## 8. Implementation Priority

### Phase 1 — Replace QB Core Accounting (Target: 3-4 months)

These features let B&B stop using QuickBooks for daily bookkeeping. Payroll can continue through a standalone service (ADP, Gusto) during this phase.

| Feature | Section | Complexity | Est. Effort | Priority Rationale |
|---------|---------|------------|-------------|-------------------|
| **Balance Sheet** | 2.5 | Small | 1-2 days | Low effort, high value. Completes the financial statement trio (Trial Balance + P&L already exist) |
| **General Ledger Report** | 2.4 | Small | 1-2 days | Low effort, essential for any accountant. Uses existing data |
| **Accounts Receivable** | 2.2 | Large | 2-3 weeks | Core revenue tracking. Norfolk Southern invoicing is the lifeblood of the business |
| **Invoice Generation** | 4.2 | Medium | 1-2 weeks | Tightly coupled with AR. No AR without invoices |
| **Invoice PDF/Email** | 4.3 | Medium | 1 week | Professional invoices are required for railroad contracts |
| **Payment Recording** | 4.4 | Medium | 1 week | Complete the AR cycle: invoice -> payment -> reconcile |
| **Customer Management** | 4.1 | Small | 2-3 days | Foundation for AR/invoicing |
| **Accounts Payable** | 2.1 | Large | 2-3 weeks | Track vendor obligations, plan cash outflows |
| **Bank Reconciliation** | 2.3 | Large | 2-3 weeks | Fundamental accounting control, monthly requirement |
| **Recurring Journal Entries** | 2.9 | Small | 2-3 days | Eliminates repetitive monthly entries (rent, insurance) |
| **Multi-Period Closing** | 2.10 | Small | 2-3 days | Prevents accidental modification of prior periods |
| **Year-End Closing** | 6.5 | Small | 1-2 days | Required annually, builds on period closing |

**Phase 1 milestone**: B&B can manage all daily bookkeeping, invoicing, bill payment, and bank reconciliation in IronSight. QuickBooks is only needed for payroll.

### Phase 2 — Payroll Independence (Target: 4-6 months after Phase 1)

These features let B&B stop using any external payroll service. This is the hardest phase because tax compliance has legal consequences.

| Feature | Section | Complexity | Est. Effort | Priority Rationale |
|---------|---------|------------|-------------|-------------------|
| **Tax Calculation Engine** | 3.1 | Large | 3-4 weeks | Foundation for all payroll processing |
| **Benefits Deduction Management** | 3.6 | Medium | 1-2 weeks | Must deduct benefits before computing net pay |
| **Direct Deposit / ACH** | 3.2 | Large | 2-3 weeks | Employees need to get paid electronically |
| **Workers Comp Tracking** | 3.5 | Small | 3-5 days | Premium tracking and audit prep |
| **Quarterly Tax Reports** | 6.1 | Medium | 1-2 weeks | Required filings (941, state) |
| **Payroll Tax Filing** | 3.4 | Large | 2-3 weeks | Automate required filings |
| **W-2 / 1099 Generation** | 3.3 | Large | 2-3 weeks | Year-end compliance requirement |
| **1099 Vendor Tracking** | 6.2 | Small | 3-5 days | Year-round tracking for year-end filing |

**Phase 2 milestone**: B&B processes payroll entirely through IronSight — tax calculation, deductions, direct deposit, and all required filings. No external payroll service needed.

**Risk note**: Consider keeping a payroll service as a backup during the first year. Payroll tax errors are expensive (IRS Trust Fund Recovery Penalty holds officers personally liable). An alternative is to integrate with a payroll tax engine API (e.g., Symmetry Tax Engine) rather than building the full tax calculation from scratch.

### Phase 3 — Advanced Features (Ongoing)

These features add convenience, automation, and advanced financial management. Build as time and need dictate.

| Feature | Section | Complexity | Est. Effort | Priority Rationale |
|---------|---------|------------|-------------|-------------------|
| **Bank Feed (Plaid)** | 7.1 | Large | 2-3 weeks | Eliminates manual transaction import |
| **Credit Card Import** | 5.2 | Medium | 1-2 weeks | Automate expense tracking from card statements |
| **Expense Categorization Rules** | 5.3 | Small | 2-3 days | Speeds up categorization of imported transactions |
| **Fixed Asset / Depreciation** | 2.8 | Medium | 1-2 weeks | Automate monthly depreciation for 36 trucks |
| **Budget vs. Actual** | 2.7 | Medium | 1-2 weeks | Cost control for fleet operations |
| **Cash Flow Statement** | 2.6 | Medium | 1 week | Complete financial reporting package |
| **Estimates / Quotes** | 4.6 | Small | 3-5 days | Streamline job bidding process |
| **Late Payment Reminders** | 4.5 | Small | 2-3 days | Automated AR collections |
| **Payment Processing (Stripe)** | 7.2 | Medium | 1-2 weeks | Accept electronic payments |
| **Tax Filing (E-File)** | 7.4 | Large | 3-4 weeks | Automate IRS/state submissions |
| **Sales Tax** | 6.3 | Small-Med | 1-2 weeks | If applicable to B&B services |
| **Audit Trail Report** | 6.4 | Small | 2-3 days | Enhance existing audit system for auditors |
| **Mileage Rate Enhancement** | 5.4 | Small | 1-2 days | IRS rate table + annual summary |
| **Receipt OCR** | 5.1 | Medium | 1-2 weeks | AI-powered receipt data extraction |

---

## Key Advantages Over QuickBooks

Once fully built, IronSight OS has structural advantages that QuickBooks can never match:

1. **Timesheet-to-payroll-to-journal-entry pipeline** — Approved timesheets auto-generate per diem, expense, and payroll journal entries. Zero manual re-entry.

2. **Fleet integration** — Truck maintenance costs, IFTA fuel data, and equipment depreciation are directly linked to the asset that generated them. QuickBooks has no concept of a "truck."

3. **Field-first design** — Receipt capture, mileage logging, and expense tracking happen on the phone at the job site, not after the fact in an office.

4. **Single source of truth** — One system for timesheets, payroll, invoicing, inventory, fleet diagnostics, and accounting. No data silos, no sync issues, no duplicate entry.

5. **Railroad-specific features** — Norfolk Southern job codes, per diem rules, railroad time tracking, and IFTA compliance are built into the workflow, not bolted on.

6. **No per-user licensing** — QuickBooks charges per user per month. IronSight costs whatever Supabase and Vercel cost to run (likely far less for 30+ users).

7. **Full audit trail** — Every action, every change, every approval is logged. QuickBooks audit trail is limited and hard to export.

---

## Database Migration Estimates

Phase 1 will require approximately 3 new Supabase migrations:

- **012_ar_ap.sql** — customers, vendors, invoices, invoice_line_items, invoice_payments, bills, bill_line_items, bill_payments tables
- **013_bank_reconciliation.sql** — bank_accounts, bank_transactions, reconciliation_sessions tables
- **014_accounting_periods.sql** — accounting_periods, recurring_journal_entries tables

Phase 2 will require approximately 2 more:

- **015_payroll_tax.sql** — employee_tax_profiles, tax_tables, payroll_runs, payroll_run_lines, payroll_deductions tables
- **016_benefits.sql** — benefit_plans, employee_benefits, workers_comp_classes tables

Phase 3 migrations as needed per feature.

---

## Open Questions

1. **Does B&B currently use QuickBooks Desktop or QuickBooks Online?** Migration path differs significantly. QBO data can be exported via API; Desktop requires IIF/CSV export.

2. **Who does B&B's tax filing today?** If an external CPA handles quarterly and annual filings, Phase 2 can focus on data preparation (reports and forms) rather than direct e-filing, reducing complexity substantially.

3. **Does B&B use QB's payroll service or a separate payroll provider?** If already using ADP/Gusto/Paychex, those can coexist with IronSight OS indefinitely while Phase 2 payroll features are built.

4. **Are there multi-state payroll considerations?** If crews work across state lines (common in railroad), state tax withholding becomes significantly more complex — reciprocity agreements, nexus rules, etc.

5. **What bank does B&B use?** This affects Plaid compatibility, ACH file format requirements, and whether a direct bank API is available.

6. **What's the annual QuickBooks spend?** Helps justify the development investment and set a break-even timeline.
