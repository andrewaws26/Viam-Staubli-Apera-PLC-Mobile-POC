"use client";

import { useState } from "react";

/* ────────────────────────────────────────────────────────────────────────────
 * IronSight Accounting Documentation
 * Comprehensive user guide for managers and developers.
 * ──────────────────────────────────────────────────────────────────────────── */

const sections = [
  { id: "overview", label: "Overview" },
  { id: "getting-started", label: "Getting Started" },
  { id: "chart-of-accounts", label: "Chart of Accounts" },
  { id: "journal-entries", label: "Journal Entries" },
  { id: "invoicing", label: "Invoicing (AR)" },
  { id: "bills", label: "Bills (AP)" },
  { id: "customers-vendors", label: "Customers & Vendors" },
  { id: "bank", label: "Bank Reconciliation" },
  { id: "recurring", label: "Recurring Entries" },
  { id: "periods", label: "Accounting Periods" },
  { id: "payroll", label: "Payroll" },
  { id: "employee-setup", label: "Employee Tax Setup" },
  { id: "fixed-assets", label: "Fixed Assets" },
  { id: "estimates", label: "Estimates & Quotes" },
  { id: "expense-rules", label: "CC Rules & Expenses" },
  { id: "receipt-ocr", label: "Receipt Scanner" },
  { id: "reminders", label: "Payment Reminders" },
  { id: "sales-tax", label: "Sales Tax" },
  { id: "budget", label: "Budget vs. Actual" },
  { id: "reports", label: "Financial Reports" },
  { id: "tax-reports", label: "Tax Reports (941)" },
  { id: "vendor-1099", label: "1099 Tracking" },
  { id: "audit-trail", label: "Audit Trail" },
  { id: "glossary", label: "Glossary" },
] as const;

export default function AccountingDocsPage() {
  const [activeSection, setActiveSection] = useState<string>("overview");
  const [searchQuery, setSearchQuery] = useState("");

  const filteredSections = searchQuery
    ? sections.filter(
        (s) =>
          s.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
          s.id.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : sections;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-black tracking-tight">
            IronSight Accounting — User Guide
          </h1>
          <p className="text-gray-400 mt-2">
            Complete documentation for the IronSight Company OS financial system.
            Covers every module from chart of accounts to payroll tax filing.
          </p>
        </div>

        <div className="flex gap-8">
          {/* Sidebar Navigation */}
          <nav className="hidden lg:block w-64 shrink-0">
            <div className="sticky top-20">
              <input
                type="text"
                placeholder="Search docs..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full px-3 py-2 mb-4 rounded-lg bg-gray-900 border border-gray-800 text-sm text-gray-100 placeholder-gray-600 focus:border-violet-500 focus:outline-none"
              />
              <div className="space-y-0.5 max-h-[calc(100vh-12rem)] overflow-y-auto pr-2">
                {filteredSections.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => {
                      setActiveSection(s.id);
                      document.getElementById(s.id)?.scrollIntoView({ behavior: "smooth" });
                    }}
                    className={`w-full text-left px-3 py-1.5 rounded-md text-sm transition-colors ${
                      activeSection === s.id
                        ? "bg-violet-600/20 text-violet-300 font-semibold"
                        : "text-gray-500 hover:text-gray-300 hover:bg-gray-900"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          </nav>

          {/* Mobile section picker */}
          <div className="lg:hidden w-full mb-6">
            <select
              value={activeSection}
              onChange={(e) => {
                setActiveSection(e.target.value);
                document.getElementById(e.target.value)?.scrollIntoView({ behavior: "smooth" });
              }}
              className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-gray-100"
            >
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          {/* Main Content */}
          <div className="flex-1 min-w-0 space-y-16">
            {/* ── OVERVIEW ───────────────────────────────────────── */}
            <DocSection id="overview" title="Overview">
              <P>
                IronSight Accounting is a full double-entry bookkeeping system built to replace
                QuickBooks for B&B Metals. It is tightly integrated with IronSight&apos;s timesheets,
                per diem, fleet, and inventory modules — so data entered once flows automatically
                into invoices, payroll, and financial reports.
              </P>
              <H3>What you can do</H3>
              <BulletList
                items={[
                  "Create and send invoices to customers (Norfolk Southern, etc.)",
                  "Track bills from vendors and schedule payments",
                  "Run payroll with full federal + KY tax calculation",
                  "Reconcile bank statements against your books",
                  "Track fixed assets (trucks, equipment) with automatic depreciation",
                  "Create estimates/quotes and convert them to invoices",
                  "Import credit card transactions and auto-categorize expenses",
                  "Scan receipts with AI-powered OCR",
                  "Generate Form 941, 940, and KY withholding reports",
                  "Run P&L, Balance Sheet, Cash Flow, GL, and Aging reports",
                ]}
              />
              <H3>Who has access</H3>
              <P>
                All accounting features require <Badge>Manager</Badge> or <Badge>Developer</Badge> role.
                Operators can view the Chart of Accounts but cannot create entries or access
                financial pages.
              </P>
              <H3>How everything connects</H3>
              <InfoBox title="The IronSight Flow">
                <ol className="list-decimal list-inside space-y-1 text-sm text-gray-300">
                  <li>Employee submits a weekly timesheet (12 sections)</li>
                  <li>Manager approves → system auto-creates per diem &amp; expense journal entries</li>
                  <li>Manager creates an invoice from the work performed → sends to customer</li>
                  <li>Customer pays → record payment → AR balance updates</li>
                  <li>Import bank statement → reconcile against recorded transactions</li>
                  <li>End of month: run depreciation, close period, review reports</li>
                  <li>End of quarter: review 941 worksheet, file taxes</li>
                </ol>
              </InfoBox>
            </DocSection>

            {/* ── GETTING STARTED ────────────────────────────────── */}
            <DocSection id="getting-started" title="Getting Started">
              <H3>First-time setup checklist</H3>
              <NumberedList
                items={[
                  "Review the Chart of Accounts (/accounting) — the 40+ seeded accounts cover most needs. Add custom accounts if needed.",
                  "Add your customers (/accounting/customers) — at minimum, Norfolk Southern with payment terms (Net 30, etc.).",
                  "Add your vendors (/accounting/customers, Vendors tab) — parts suppliers, fuel companies, insurance.",
                  "Set up employee tax profiles (/accounting/employee-tax) — W-4 data, pay rates, benefits.",
                  "Configure bank accounts (/accounting/bank) — add your checking account for reconciliation.",
                  "Set up recurring entries (/accounting/recurring) — monthly rent, insurance, loan payments.",
                  "Review expense categorization rules (/accounting/expense-rules) — 27 rules seeded for common vendors.",
                  "Verify sales tax exemptions (/accounting/sales-tax) — railroad services are generally exempt in KY.",
                ]}
              />
              <H3>Navigation</H3>
              <P>
                All accounting pages are in the top navigation bar (desktop) or the hamburger menu
                (mobile). Look for: Finance, Invoices, Bills, Clients, Bank, Recurring, Periods,
                W-4, Payroll, 1099, Budget, Assets, Estimates, CC Rules, Receipts, Reminders,
                Tax, Reports, Audit, 941.
              </P>
            </DocSection>

            {/* ── CHART OF ACCOUNTS ──────────────────────────────── */}
            <DocSection id="chart-of-accounts" title="Chart of Accounts">
              <P>
                The Chart of Accounts (COA) is the foundation of double-entry bookkeeping. Every
                transaction ultimately flows into one or more accounts. IronSight comes with 40+
                pre-configured accounts.
              </P>
              <H3>Account types</H3>
              <Table
                headers={["Type", "Number Range", "Normal Balance", "Examples"]}
                rows={[
                  ["Asset", "1000–1999", "Debit", "Cash, AR, Fixed Assets, Inventory"],
                  ["Liability", "2000–2999", "Credit", "AP, Payroll Tax Liabilities, CC Payable"],
                  ["Equity", "3000–3999", "Credit", "Owner's Equity, Retained Earnings"],
                  ["Revenue", "4000–4999", "Credit", "Railroad Services, Equipment Rental"],
                  ["Expense", "5000–9999", "Debit", "Payroll, Fuel, Depreciation, Per Diem"],
                ]}
              />
              <H3>Adding a new account</H3>
              <NumberedList
                items={[
                  "Go to /accounting (Finance page)",
                  "Click \"New Account\" in the Chart of Accounts section",
                  "Enter the account number (must be unique), name, type, and normal balance",
                  "System accounts (seeded by IronSight) cannot be deleted",
                ]}
              />
              <Warning>
                Do not change the account numbers of system accounts (1000, 1100, 2000, etc.) —
                they are referenced by automated journal entries throughout the system.
              </Warning>
            </DocSection>

            {/* ── JOURNAL ENTRIES ────────────────────────────────── */}
            <DocSection id="journal-entries" title="Journal Entries">
              <P>
                A journal entry (JE) records a financial transaction. Every JE must balance:
                total debits must equal total credits. This is the core principle of double-entry
                bookkeeping.
              </P>
              <H3>Workflow</H3>
              <Steps
                items={[
                  { label: "Draft", desc: "Entry created but not yet posted. Can be edited or deleted." },
                  { label: "Posted", desc: "Entry finalized. Account balances updated. Cannot be edited." },
                  { label: "Voided", desc: "Posted entry reversed. Creates an offsetting entry. Requires a reason." },
                ]}
              />
              <H3>Creating a manual journal entry</H3>
              <NumberedList
                items={[
                  "Go to /accounting/new",
                  "Enter a date, description, and reference number",
                  "Add debit and credit lines — each line needs an account and amount",
                  "The total debits must equal total credits (the system enforces this)",
                  "Save as draft, then post when ready",
                ]}
              />
              <H3>Auto-generated entries</H3>
              <P>
                Many journal entries are created automatically by IronSight. You do not need to
                create these manually:
              </P>
              <Table
                headers={["Trigger", "Debit", "Credit"]}
                rows={[
                  ["Timesheet approved (per diem)", "5100 Per Diem Expense", "2110 Per Diem Payable"],
                  ["Timesheet approved (expenses)", "Various expense accounts", "2120 Expense Reimb. Payable"],
                  ["Invoice sent", "1100 Accounts Receivable", "4010 Revenue"],
                  ["Invoice payment received", "1000 Cash", "1100 Accounts Receivable"],
                  ["Bill entered", "Various expense accounts", "2000 Accounts Payable"],
                  ["Bill payment made", "2000 Accounts Payable", "1000 Cash"],
                  ["Payroll posted", "5000 Payroll + 5010 Employer Tax", "Tax liability accounts + 1000 Cash"],
                  ["Depreciation run", "6000 Depreciation Expense", "1310 Accumulated Depreciation"],
                  ["Asset disposal", "1000 Cash + 1310 Accum Depr", "1300 Fixed Assets ± 6010 Gain/Loss"],
                  ["CC transactions posted", "Various expense accounts", "2100 Credit Card Payable"],
                ]}
              />
            </DocSection>

            {/* ── INVOICING ──────────────────────────────────────── */}
            <DocSection id="invoicing" title="Invoicing (Accounts Receivable)">
              <P>
                Create invoices for work performed, send them to customers, and track payments.
                IronSight auto-generates the accounting entries so your books stay in sync.
              </P>
              <H3>Creating an invoice</H3>
              <NumberedList
                items={[
                  "Go to /accounting/invoices",
                  "Click \"New Invoice\"",
                  "Select a customer and enter the invoice date and due date",
                  "Add line items: description, quantity, unit price",
                  "Optionally set a tax rate (auto-calculates tax amount)",
                  "Add notes or payment terms",
                  "Save as draft",
                ]}
              />
              <H3>Sending an invoice</H3>
              <P>
                Click &quot;Send&quot; on a draft invoice. This changes the status to &quot;Sent&quot; and auto-creates
                a journal entry: DR 1100 Accounts Receivable / CR 4010 Revenue. The PDF
                can be downloaded via the &quot;Download PDF&quot; button for emailing or printing.
              </P>
              <H3>Recording a payment</H3>
              <P>
                On the invoice detail, click &quot;Record Payment.&quot; Enter the amount, date, and payment
                method. The system creates a JE: DR 1000 Cash / CR 1100 AR. Partial payments
                are supported — the balance due updates automatically.
              </P>
              <H3>Invoice statuses</H3>
              <Table
                headers={["Status", "Meaning"]}
                rows={[
                  ["Draft", "Created but not sent. Can be edited or deleted."],
                  ["Sent", "Delivered to customer. JE created. Awaiting payment."],
                  ["Partial", "Some payment received but balance remains."],
                  ["Paid", "Fully paid. Balance is zero."],
                  ["Overdue", "Past due date with outstanding balance."],
                  ["Voided", "Cancelled. Reversing JE created."],
                ]}
              />
            </DocSection>

            {/* ── BILLS ──────────────────────────────────────────── */}
            <DocSection id="bills" title="Bills (Accounts Payable)">
              <P>
                Track what you owe to vendors — parts suppliers, fuel companies, insurance, etc.
                Bills work like the mirror image of invoices.
              </P>
              <H3>Creating a bill</H3>
              <NumberedList
                items={[
                  "Go to /accounting/bills",
                  "Click \"New Bill\"",
                  "Select a vendor and enter the bill date, due date",
                  "Add line items with expense account mappings",
                  "Save — the system creates a JE: DR Expense / CR 2000 AP",
                ]}
              />
              <H3>Paying a bill</H3>
              <P>
                Click &quot;Record Payment&quot; on a bill. Enter the payment amount, date, and method.
                This creates a JE: DR 2000 AP / CR 1000 Cash. The bill status updates to
                Partial or Paid based on the remaining balance.
              </P>
            </DocSection>

            {/* ── CUSTOMERS & VENDORS ────────────────────────────── */}
            <DocSection id="customers-vendors" title="Customers & Vendors">
              <P>
                Manage your customer and vendor directory at /accounting/customers. Both share
                the same page with separate tabs.
              </P>
              <H3>Customer fields</H3>
              <BulletList
                items={[
                  "Company name, contact name, email, phone",
                  "Billing address (used on invoice PDFs)",
                  "Payment terms (Net 30, Net 45, Net 60, Due on Receipt)",
                  "Credit limit",
                  "Notes",
                ]}
              />
              <H3>Vendor fields</H3>
              <BulletList
                items={[
                  "Company name, contact name, email, phone",
                  "Default expense account (auto-filled when creating bills)",
                  "Payment terms",
                  "1099 eligible flag (tracks payments for 1099-NEC filing)",
                  "Tax ID / EIN (for 1099 reporting)",
                ]}
              />
            </DocSection>

            {/* ── BANK ───────────────────────────────────────────── */}
            <DocSection id="bank" title="Bank Reconciliation">
              <P>
                Match your book transactions against your bank statement to ensure every dollar
                is accounted for. This is a critical monthly control.
              </P>
              <H3>How to reconcile</H3>
              <NumberedList
                items={[
                  "Go to /accounting/bank",
                  "Select your bank account (or create one first)",
                  "Import your bank statement CSV (download from your bank's website)",
                  "The system will show imported transactions alongside your book entries",
                  "Match transactions by clicking them — matched items are cleared",
                  "Unmatched bank items may need journal entries created",
                  "Unmatched book items are outstanding checks/deposits in transit",
                  "When balanced, finalize the reconciliation",
                ]}
              />
              <InfoBox title="CSV Import">
                The CSV importer handles most bank statement formats. It looks for columns
                like Date, Description, Amount (or Debit/Credit). Duplicate transactions are
                automatically detected and skipped on reimport.
              </InfoBox>
            </DocSection>

            {/* ── RECURRING ──────────────────────────────────────── */}
            <DocSection id="recurring" title="Recurring Journal Entries">
              <P>
                Set up templates for entries that repeat every month (rent, insurance, loan payments).
                The system generates draft entries from templates so you don&apos;t have to create them
                manually each period.
              </P>
              <H3>Setting up a recurring entry</H3>
              <NumberedList
                items={[
                  "Go to /accounting/recurring",
                  "Click \"New Template\"",
                  "Enter description, frequency (monthly, quarterly, annually), and start/end dates",
                  "Add debit and credit lines just like a regular journal entry",
                  "Save the template",
                  "Click \"Generate Due Entries\" to create any entries that are due",
                ]}
              />
              <P>
                Generated entries are created as drafts. Review and post them as part of your
                monthly close process.
              </P>
            </DocSection>

            {/* ── PERIODS ────────────────────────────────────────── */}
            <DocSection id="periods" title="Accounting Periods">
              <P>
                Close accounting periods to prevent changes to prior months. This is a fundamental
                internal control.
              </P>
              <H3>Period workflow</H3>
              <Steps
                items={[
                  { label: "Open", desc: "Normal state. Entries can be created and posted." },
                  { label: "Closed", desc: "No new entries allowed. Can be reopened by a manager." },
                  { label: "Locked", desc: "Permanently closed. Cannot be reopened without developer access." },
                ]}
              />
              <H3>Monthly close process</H3>
              <NumberedList
                items={[
                  "Ensure all invoices and bills for the month are entered",
                  "Run depreciation for the month (/accounting/fixed-assets)",
                  "Post any recurring entries due this month",
                  "Review the trial balance for the period",
                  "Reconcile the bank account",
                  "Close the period at /accounting/periods",
                ]}
              />
              <H3>Year-end close</H3>
              <P>
                The year-end close zeros all revenue and expense accounts into Retained Earnings
                (3100). This creates a closing journal entry and prepares the books for the new
                fiscal year. Available at /accounting/periods under the year-end section.
              </P>
            </DocSection>

            {/* ── PAYROLL ────────────────────────────────────────── */}
            <DocSection id="payroll" title="Payroll">
              <P>
                Run payroll with full tax calculation: federal income tax (W-4 2020+ method),
                Kentucky state tax (flat 4%), Social Security (6.2%), Medicare (1.45%), FUTA,
                and SUTA. The system handles wage base caps and YTD accumulation.
              </P>
              <H3>Running payroll</H3>
              <NumberedList
                items={[
                  "Ensure employee tax profiles are set up (/accounting/employee-tax)",
                  "Go to /accounting/payroll-run",
                  "Select the pay period dates (start, end, pay date)",
                  "Click \"Preview\" — the system pulls approved timesheets and calculates all taxes",
                  "Review gross pay, deductions, employer taxes, and net pay per employee",
                  "Click \"Create Draft\" to save the payroll run",
                  "Click \"Approve\" after review",
                  "Click \"Post\" — this creates the journal entry and updates YTD accumulators",
                ]}
              />
              <H3>What gets calculated</H3>
              <Table
                headers={["Tax", "Rate", "Notes"]}
                rows={[
                  ["Federal Income Tax", "Progressive brackets", "Based on W-4 filing status, annualized"],
                  ["KY State Tax", "4.0% flat", "Applied to all gross pay"],
                  ["Social Security (Employee)", "6.2%", "Capped at $176,100 wage base (2026)"],
                  ["Social Security (Employer)", "6.2%", "Same cap, paid by company"],
                  ["Medicare (Employee)", "1.45%", "No cap; +0.9% over $200k"],
                  ["Medicare (Employer)", "1.45%", "No additional tax over $200k"],
                  ["FUTA", "0.6%", "First $7,000 per employee per year"],
                  ["KY SUTA", "2.7%", "First $11,400 per employee per year"],
                ]}
              />
              <Warning>
                Payroll tax calculation is based on 2026 IRS rates seeded in the system. Rates
                must be updated annually when the IRS publishes new tables. Check /accounting/employee-tax
                for current tax rate tables.
              </Warning>
            </DocSection>

            {/* ── EMPLOYEE TAX SETUP ─────────────────────────────── */}
            <DocSection id="employee-setup" title="Employee Tax Setup">
              <P>
                Configure each employee&apos;s W-4 information, pay rate, benefits enrollment, and
                workers comp classification.
              </P>
              <H3>W-4 information</H3>
              <BulletList
                items={[
                  "Filing status (Single, Married Filing Jointly, Head of Household)",
                  "Multiple jobs checkbox (Step 2c)",
                  "Dependents credit (Step 3)",
                  "Other income (Step 4a)",
                  "Deductions (Step 4b)",
                  "Extra withholding per period (Step 4c)",
                ]}
              />
              <H3>Pay configuration</H3>
              <BulletList
                items={[
                  "Pay type: Hourly or Salary",
                  "Hourly rate or annual salary",
                  "Pay frequency: Weekly, Biweekly, Semimonthly, Monthly",
                ]}
              />
              <H3>Benefits enrollment</H3>
              <P>
                Enroll employees in benefit plans (health, dental, vision, 401k, life insurance).
                Pre-tax deductions (Section 125) reduce taxable income before federal and state
                withholding is calculated.
              </P>
              <H3>Workers comp</H3>
              <P>
                Assign employees to NCCI workers comp classifications. The system tracks premiums
                based on payroll by class for annual audit preparation.
              </P>
            </DocSection>

            {/* ── FIXED ASSETS ───────────────────────────────────── */}
            <DocSection id="fixed-assets" title="Fixed Assets & Depreciation">
              <P>
                Track capital assets (trucks, equipment, buildings) and automatically compute
                monthly depreciation. The system generates journal entries for each depreciation
                run.
              </P>
              <H3>Adding an asset</H3>
              <NumberedList
                items={[
                  "Go to /accounting/fixed-assets",
                  "Click \"Add Asset\"",
                  "Enter: name, category, purchase date, in-service date, purchase cost, salvage value, useful life (months)",
                  "Select depreciation method: Straight-Line, Declining Balance, or Sum of Years' Digits",
                  "Optionally link to a fleet truck",
                  "GL accounts are auto-assigned (1300, 6000, 1310)",
                ]}
              />
              <H3>Running depreciation</H3>
              <P>
                Click &quot;Run Depreciation&quot; and select the period (first of month). The system
                calculates depreciation for all active assets, creates one batch journal entry
                (DR 6000 / CR 1310), and updates each asset&apos;s book value. Assets that reach
                salvage value are automatically marked as fully depreciated.
              </P>
              <H3>Disposing of an asset</H3>
              <P>
                Click &quot;Dispose&quot; on an asset. Enter the disposal date, amount received, and method
                (sold, scrapped, traded, donated). The system calculates gain/loss and creates
                a disposal journal entry that removes the asset from the books.
              </P>
              <H3>Depreciation methods</H3>
              <Table
                headers={["Method", "How It Works", "Best For"]}
                rows={[
                  ["Straight-Line", "(Cost − Salvage) ÷ Useful Life Months", "Most assets. Equal expense each month."],
                  ["Declining Balance", "Book Value × (2 ÷ Useful Life)", "Assets that lose value faster early on."],
                  ["Sum of Years' Digits", "Weighted by remaining useful life", "Accelerated, more conservative than DB."],
                ]}
              />
            </DocSection>

            {/* ── ESTIMATES ──────────────────────────────────────── */}
            <DocSection id="estimates" title="Estimates & Quotes">
              <P>
                Create estimates for prospective work. When the customer accepts, convert the
                estimate to an invoice with one click — all line items carry over.
              </P>
              <H3>Estimate workflow</H3>
              <Steps
                items={[
                  { label: "Draft", desc: "Created. Can be edited." },
                  { label: "Sent", desc: "Delivered to customer. Awaiting response." },
                  { label: "Accepted", desc: "Customer approved. Ready to convert." },
                  { label: "Converted", desc: "Turned into an invoice. Linked to the created invoice." },
                ]}
              />
              <P>
                Estimates can also be marked as Rejected or Expired if the customer declines or
                the quote validity period passes.
              </P>
              <H3>Converting to an invoice</H3>
              <P>
                Click &quot;Convert to Invoice&quot; on an accepted estimate. The system creates a new
                invoice with the same customer, line items, tax rate, and terms. The estimate
                is marked as &quot;Converted&quot; and linked to the new invoice.
              </P>
            </DocSection>

            {/* ── EXPENSE RULES ──────────────────────────────────── */}
            <DocSection id="expense-rules" title="Credit Card Rules & Expense Import">
              <P>
                Import credit card statements, auto-categorize transactions using rules, and
                batch-post them as journal entries.
              </P>
              <H3>Categorization rules</H3>
              <P>
                IronSight comes with 27 pre-configured rules for common vendors: gas stations
                (Shell, Pilot, Love&apos;s), hotels (Hilton, Marriott), office supplies (Amazon,
                Staples), meals (McDonald&apos;s, Cracker Barrel), tools (Home Depot, Harbor Freight),
                and auto parts (AutoZone, O&apos;Reilly, NAPA).
              </P>
              <Table
                headers={["Match Type", "How It Works", "Example"]}
                rows={[
                  ["Contains", "Description includes the pattern", "\"SHELL\" matches \"SHELL OIL #1234\""],
                  ["Starts With", "Description begins with the pattern", "\"AMAZON\" matches \"AMAZON.COM*AB12\""],
                  ["Exact", "Description matches exactly", "\"RENT PAYMENT\" matches only that"],
                  ["Regex", "Regular expression pattern", "\"(?i)pilot|loves\" matches either"],
                ]}
              />
              <H3>Importing transactions</H3>
              <NumberedList
                items={[
                  "Go to /accounting/expense-rules, Import tab",
                  "Select a credit card account (or create one first)",
                  "Upload a CSV from your credit card company",
                  "The system detects columns (Date, Description, Amount)",
                  "Transactions are imported with dedup detection (re-importing won't create duplicates)",
                  "Rules are automatically applied — matching transactions get categorized",
                ]}
              />
              <H3>Posting transactions</H3>
              <P>
                After review, select categorized transactions and click &quot;Post.&quot; The system creates
                journal entries: DR expense account / CR 2100 Credit Card Payable.
              </P>
            </DocSection>

            {/* ── RECEIPT OCR ────────────────────────────────────── */}
            <DocSection id="receipt-ocr" title="Receipt Scanner">
              <P>
                Upload a photo of a receipt and IronSight&apos;s AI (powered by Claude Vision) extracts
                the vendor name, date, line items, tax, total, payment method, and suggests an
                expense category.
              </P>
              <H3>How to scan</H3>
              <NumberedList
                items={[
                  "Go to /accounting/receipt-ocr",
                  "Drag-and-drop a receipt image (JPG, PNG, or WebP) or click to select",
                  "Click \"Scan Receipt\"",
                  "Review the extracted data — vendor, date, line items, total",
                  "Override the category suggestion if needed",
                  "Click \"Create Expense Entry\" to link it to the expense system",
                ]}
              />
              <InfoBox title="Tips for best results">
                Take clear, well-lit photos. Avoid shadows and glare. The AI handles crumpled
                receipts and faded text reasonably well, but clearer images produce better results.
              </InfoBox>
            </DocSection>

            {/* ── PAYMENT REMINDERS ──────────────────────────────── */}
            <DocSection id="reminders" title="Payment Reminders & Mileage">
              <P>
                Track overdue invoices and generate reminder records. Also manage IRS mileage
                rates for employee reimbursement.
              </P>
              <H3>Overdue invoices</H3>
              <P>
                The Overdue Invoices tab shows all unpaid invoices past their due date, color-coded
                by severity:
              </P>
              <Table
                headers={["Days Overdue", "Color", "Reminder Type"]}
                rows={[
                  ["1–7 days", "Green", "First notice"],
                  ["8–30 days", "Yellow", "Second notice"],
                  ["31–60 days", "Orange", "Third notice"],
                  ["61–90 days", "Red", "Urgent"],
                  ["90+ days", "Red", "Final notice"],
                ]}
              />
              <P>
                Click &quot;Generate Reminders&quot; to create reminder records for all overdue invoices.
                Reminders are tiered — the system won&apos;t create a duplicate reminder of the same
                type for the same invoice.
              </P>
              <H3>Mileage rates</H3>
              <P>
                The Mileage Rates tab manages IRS standard mileage rates. Pre-loaded with 2025
                and 2026 rates. Use the calculator to quickly compute reimbursement: enter miles
                and select rate type (standard, medical, charitable).
              </P>
            </DocSection>

            {/* ── SALES TAX ──────────────────────────────────────── */}
            <DocSection id="sales-tax" title="Sales Tax">
              <P>
                Manage tax rates, track customer exemptions, and monitor tax collected for filing.
              </P>
              <H3>Tax rates</H3>
              <P>
                Kentucky sales tax is pre-configured at 6%. Add additional jurisdictions or rate
                types as needed. Rates can be set to apply to goods, services, or all transactions.
              </P>
              <H3>Exemptions</H3>
              <P>
                Railroad construction services are generally exempt from KY sales tax. Create
                exemption records linked to customers with certificate numbers and effective dates.
                When checking a customer, the system tells you if they have active exemptions.
              </P>
              <H3>Filing summary</H3>
              <P>
                The Filing Summary tab shows total taxable amount and total tax collected by month.
                Use this to prepare your state sales tax return. Mark periods as filed/remitted
                to track compliance.
              </P>
            </DocSection>

            {/* ── BUDGET ─────────────────────────────────────────── */}
            <DocSection id="budget" title="Budget vs. Actual">
              <P>
                Set monthly budget amounts per account, then compare against actual spending with
                variance analysis.
              </P>
              <H3>Setting budgets</H3>
              <NumberedList
                items={[
                  "Go to /accounting/budget",
                  "Select the fiscal year",
                  "Enter monthly budget amounts for each account",
                  "The system shows Budget, Actual, Variance ($), and Variance (%)",
                ]}
              />
              <H3>Reading the variance report</H3>
              <BulletList
                items={[
                  "For expenses: actual < budget = favorable (green), actual > budget = unfavorable (red)",
                  "For revenue: actual > budget = favorable (green), actual < budget = unfavorable (red)",
                  "Watch for accounts with >10% unfavorable variance — these need attention",
                ]}
              />
            </DocSection>

            {/* ── REPORTS ────────────────────────────────────────── */}
            <DocSection id="reports" title="Financial Reports">
              <P>
                Access all financial reports at /accounting/reports. Reports are print-friendly.
              </P>
              <H3>Available reports</H3>
              <Table
                headers={["Report", "What It Shows"]}
                rows={[
                  ["Profit & Loss", "Revenue minus expenses for a period. Shows net income/loss."],
                  ["Balance Sheet", "Assets = Liabilities + Equity at a point in time."],
                  ["General Ledger", "Every transaction per account with running balance."],
                  ["AR Aging", "Outstanding invoices in 30/60/90/120+ day buckets per customer."],
                  ["AP Aging", "Outstanding bills in 30/60/90/120+ day buckets per vendor."],
                  ["Cash Flow", "Operating, investing, and financing cash flows (indirect method)."],
                  ["Trial Balance", "All account balances to verify debits = credits."],
                ]}
              />
              <InfoBox title="Printing reports">
                Click the &quot;Print&quot; button or use Ctrl+P / Cmd+P. The reports have print-specific
                CSS that hides navigation and formats the data for paper.
              </InfoBox>
            </DocSection>

            {/* ── TAX REPORTS ────────────────────────────────────── */}
            <DocSection id="tax-reports" title="Tax Reports (Form 941 / 940)">
              <P>
                Generate quarterly and annual tax worksheets from your payroll data. These provide
                the numbers you need for IRS filings.
              </P>
              <H3>Form 941 (Quarterly)</H3>
              <P>
                Select a year and quarter to see the 941 worksheet with all line items computed:
                total wages, federal withholding, Social Security taxes, Medicare taxes, and
                monthly liability breakdown. This matches the IRS Form 941 layout.
              </P>
              <H3>Form 940 (Annual FUTA)</H3>
              <P>
                Annual Federal Unemployment Tax worksheet showing per-employee FUTA wage tracking
                ($7,000 cap), quarterly liability, and total FUTA tax due.
              </P>
              <H3>Kentucky withholding</H3>
              <P>
                Quarterly summary of wages and state withholding for KY filing.
              </P>
              <H3>Filing calendar</H3>
              <P>
                Shows all required tax filings with due dates for the year. Color-coded: green
                (filed), yellow (due within 30 days), red (overdue), gray (future).
              </P>
              <Table
                headers={["Filing", "Frequency", "Due Date"]}
                rows={[
                  ["Form 941", "Quarterly", "April 30, July 31, Oct 31, Jan 31"],
                  ["Form 940", "Annual", "January 31"],
                  ["KY Withholding", "Quarterly", "Same as 941"],
                  ["W-2 / W-3", "Annual", "January 31"],
                  ["1099-NEC", "Annual", "January 31"],
                ]}
              />
            </DocSection>

            {/* ── VENDOR 1099 ────────────────────────────────────── */}
            <DocSection id="vendor-1099" title="1099 Vendor Tracking">
              <P>
                Track payments to 1099-eligible vendors throughout the year. The system monitors
                the $600 threshold and flags vendors who need a 1099-NEC filed.
              </P>
              <H3>How it works</H3>
              <BulletList
                items={[
                  "Mark vendors as \"1099 Eligible\" in the customer/vendor directory",
                  "Enter the vendor's Tax ID (EIN or SSN)",
                  "As you pay bills to 1099 vendors, the system aggregates YTD payments",
                  "The 1099 Tracking page (/accounting/vendor-1099) shows all eligible vendors with their YTD totals",
                  "Vendors approaching or exceeding $600 are flagged",
                  "Missing Tax IDs are highlighted so you can collect W-9s",
                ]}
              />
            </DocSection>

            {/* ── AUDIT TRAIL ────────────────────────────────────── */}
            <DocSection id="audit-trail" title="Audit Trail">
              <P>
                Every financial action is logged with the user, timestamp, and details. The
                audit trail at /accounting/audit-trail provides a searchable, filterable view.
              </P>
              <H3>Filters</H3>
              <BulletList
                items={[
                  "Date range (start and end)",
                  "Category: Invoicing, Bills, Journal Entries, Payroll, Assets, Estimates, Periods",
                  "User name (search by who performed the action)",
                  "Specific action (e.g., invoice_sent, payroll_posted)",
                ]}
              />
              <H3>Export</H3>
              <P>
                Click &quot;Export CSV&quot; to download the filtered audit trail for external auditors
                or compliance review.
              </P>
              <H3>Color coding</H3>
              <BulletList
                items={[
                  "Green — Created actions (new records)",
                  "Blue — Updated/posted actions (status changes)",
                  "Red — Deleted/voided actions (reversals)",
                  "Violet — Sent/approved actions (workflow transitions)",
                ]}
              />
            </DocSection>

            {/* ── GLOSSARY ───────────────────────────────────────── */}
            <DocSection id="glossary" title="Glossary">
              <Table
                headers={["Term", "Definition"]}
                rows={[
                  ["AR (Accounts Receivable)", "Money owed TO you by customers."],
                  ["AP (Accounts Payable)", "Money you OWE to vendors."],
                  ["COA (Chart of Accounts)", "The list of all accounts in the ledger."],
                  ["JE (Journal Entry)", "A single accounting transaction with balanced debits and credits."],
                  ["GL (General Ledger)", "The complete record of all transactions, organized by account."],
                  ["Trial Balance", "A report listing all account balances to verify debits = credits."],
                  ["P&L (Profit & Loss)", "Revenue minus expenses for a time period. Also called Income Statement."],
                  ["Balance Sheet", "A snapshot of Assets, Liabilities, and Equity at a point in time."],
                  ["FICA", "Federal Insurance Contributions Act — Social Security + Medicare taxes."],
                  ["FUTA", "Federal Unemployment Tax Act — employer-only tax on first $7,000/employee."],
                  ["SUTA", "State Unemployment Tax Act — KY employer tax on first $11,400/employee."],
                  ["W-4", "IRS form employees complete to determine federal income tax withholding."],
                  ["1099-NEC", "IRS form for reporting payments of $600+ to independent contractors."],
                  ["Form 941", "Quarterly federal payroll tax return (income tax + FICA withholding)."],
                  ["Form 940", "Annual FUTA tax return."],
                  ["Depreciation", "Spreading an asset's cost over its useful life as a monthly expense."],
                  ["Salvage Value", "Estimated value of an asset at the end of its useful life."],
                  ["Book Value", "Purchase cost minus accumulated depreciation."],
                  ["Contra Account", "An account that offsets another (e.g., Accumulated Depreciation offsets Fixed Assets)."],
                  ["Reconciliation", "Matching your records against the bank statement to find discrepancies."],
                  ["Accrual Basis", "Recording revenue when earned and expenses when incurred (not when cash moves)."],
                  ["Retained Earnings", "Accumulated profits kept in the business (not distributed to owners)."],
                ]}
              />
            </DocSection>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Reusable Documentation Components ────────────────────────────────── */

function DocSection({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="text-2xl font-bold text-gray-100 mb-4 pb-2 border-b border-gray-800">
        {title}
      </h2>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="text-lg font-semibold text-gray-200 mt-6 mb-2">{children}</h3>;
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-gray-400 leading-relaxed">{children}</p>;
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="list-disc list-inside space-y-1 text-sm text-gray-400">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

function NumberedList({ items }: { items: string[] }) {
  return (
    <ol className="list-decimal list-inside space-y-1 text-sm text-gray-400">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ol>
  );
}

function Table({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border border-gray-800 rounded-lg overflow-hidden">
        <thead>
          <tr className="bg-gray-900">
            {headers.map((h, i) => (
              <th key={i} className="px-4 py-2 text-left font-semibold text-gray-300 border-b border-gray-800">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className={i % 2 === 0 ? "bg-gray-950" : "bg-gray-900/50"}>
              {row.map((cell, j) => (
                <td key={j} className="px-4 py-2 text-gray-400 border-b border-gray-800/50">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Steps({ items }: { items: { label: string; desc: string }[] }) {
  return (
    <div className="flex flex-wrap gap-2 items-center">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="px-3 py-1.5 rounded-lg bg-violet-600/20 border border-violet-500/30">
            <span className="text-sm font-semibold text-violet-300">{item.label}</span>
          </div>
          <span className="text-xs text-gray-500 max-w-48">{item.desc}</span>
          {i < items.length - 1 && (
            <svg className="w-4 h-4 text-gray-700" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
            </svg>
          )}
        </div>
      ))}
    </div>
  );
}

function InfoBox({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-violet-950/30 border border-violet-500/20 rounded-lg p-4">
      <div className="flex items-center gap-2 mb-2">
        <svg className="w-4 h-4 text-violet-400" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
        </svg>
        <span className="text-sm font-semibold text-violet-300">{title}</span>
      </div>
      <div className="text-sm text-gray-400">{children}</div>
    </div>
  );
}

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-amber-950/30 border border-amber-500/20 rounded-lg p-4">
      <div className="flex items-center gap-2 mb-1">
        <svg className="w-4 h-4 text-amber-400" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
        </svg>
        <span className="text-sm font-semibold text-amber-300">Warning</span>
      </div>
      <div className="text-sm text-gray-400">{children}</div>
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex px-2 py-0.5 rounded text-xs font-bold bg-violet-600/30 text-violet-300 border border-violet-500/30">
      {children}
    </span>
  );
}
