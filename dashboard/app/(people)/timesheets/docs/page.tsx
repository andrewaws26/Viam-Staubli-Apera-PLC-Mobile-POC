"use client";

import { DocsLayout } from "@/components/docs/DocsLayout";
import {
  DocSection, H3, P, BulletList, NumberedList, Table,
  Steps, InfoBox, Warning, Badge,
} from "@/components/docs/DocComponents";

const sections = [
  { id: "overview", label: "Overview" },
  { id: "getting-started", label: "Getting Started" },
  { id: "daily-logs", label: "Daily Logs" },
  { id: "railroad-time", label: "Railroad Time" },
  { id: "railroad-timecards", label: "Railroad Timecards" },
  { id: "inspections", label: "Inspections" },
  { id: "ifta", label: "IFTA" },
  { id: "expenses", label: "Expenses" },
  { id: "other-sections", label: "Other Time Sections" },
  { id: "submit-approve", label: "Submitting & Approval" },
  { id: "manager-admin", label: "Manager Admin" },
  { id: "pto", label: "Time Off (PTO)" },
  { id: "training", label: "Training Compliance" },
  { id: "profiles", label: "Employee Profiles" },
  { id: "per-diem", label: "Per Diem" },
  { id: "roles", label: "Roles & Access" },
  { id: "accounting-integration", label: "Accounting Integration" },
] as const;

export default function PeopleDocsPage() {
  return (
    <DocsLayout
      title="People & HR — User Guide"
      subtitle="Timesheets, PTO, training compliance, employee profiles, and per diem — everything for managing people in IronSight."
      sections={sections}
    >
      <DocSection id="overview" title="Overview">
        <P>
          IronSight&apos;s People & HR module covers the full employee lifecycle for field operations.
          Weekly timesheets are the central work report — they capture hours, expenses, inspections,
          fuel tax, and travel data across 12 specialized sections. PTO, training compliance, and
          employee profiles round out the HR system.
        </P>
        <H3>Key features</H3>
        <BulletList
          items={[
            "Weekly timesheets with 12 sub-sections for complete field reporting",
            "Draft → Submit → Approve/Reject workflow with manager dashboard",
            "Auto-calculated per diem from nights out and layovers",
            "Approved timesheets auto-create journal entries in accounting",
            "PTO request and balance tracking (vacation, sick, personal)",
            "Training compliance with expiry tracking and admin matrix",
            "Employee profiles with HR fields and photo upload",
          ]}
        />
      </DocSection>

      <DocSection id="getting-started" title="Timesheets: Getting Started">
        <H3>Creating a new timesheet</H3>
        <NumberedList
          items={[
            "Go to /timesheets",
            "Click \"New Timesheet\"",
            "Select the week ending date (always a Sunday)",
            "Enter the railroad you're working on (e.g., Norfolk Southern)",
            "Select chase vehicles and semi trucks used (from company fleet)",
            "Enter your work location",
            "Enter nights out and layovers (used for per diem calculation)",
            "Add co-workers (optional — for reference)",
            "Add any general notes",
            "Save — the timesheet starts as a draft",
          ]}
        />
        <H3>Timesheet fields</H3>
        <Table
          headers={["Field", "Description"]}
          rows={[
            ["Week Ending", "The Sunday that ends the work week (required)"],
            ["Railroad", "Which railroad you're working on (Norfolk Southern, CSX, etc.)"],
            ["Chase Vehicles", "Company vehicles used during the week"],
            ["Semi Trucks", "Semi trucks used for equipment transport"],
            ["Work Location", "City/town where work was performed"],
            ["Nights Out", "Number of nights away from home (for per diem)"],
            ["Layovers", "Number of layover days (for per diem)"],
            ["Co-workers", "Other employees on the same job (reference only)"],
          ]}
        />
      </DocSection>

      <DocSection id="daily-logs" title="Daily Logs">
        <P>
          The Daily Logs section records your work hours for each day of the week. This is
          the primary hours-tracking section.
        </P>
        <H3>Fields per day</H3>
        <Table
          headers={["Field", "Description"]}
          rows={[
            ["Date", "The specific date (auto-populated for each day of the week)"],
            ["Start Time", "When you started work"],
            ["End Time", "When you stopped work"],
            ["Hours Worked", "Total hours (auto-calculated or manual override)"],
            ["Travel Hours", "Time spent traveling to/from the job site"],
            ["Lunch Minutes", "Lunch break duration (deducted from hours)"],
            ["Description", "What you did that day"],
            ["Semi Truck Travel", "Toggle if using semi truck for travel"],
            ["Traveling From / Destination", "Travel origin and destination"],
            ["Travel Miles", "Miles traveled (for mileage tracking)"],
          ]}
        />
      </DocSection>

      <DocSection id="railroad-time" title="Railroad Time">
        <P>
          Railroad Time records hours worked specifically on railroad jobs. This section
          is separate from Daily Logs because railroad work often requires different
          reporting for billing and compliance.
        </P>
        <BulletList
          items={[
            "Norfolk Southern job code field for billing reference",
            "Clock in/out times specific to the railroad property",
            "Travel hours to and from the railroad site",
            "Used for railroad contractor compliance reporting",
          ]}
        />
      </DocSection>

      <DocSection id="railroad-timecards" title="Railroad Timecards">
        <P>
          Railroad Timecards are formal entries that may require supervisor sign-off. These
          are more structured than regular time logs and support image uploads for signed
          physical cards.
        </P>
        <H3>Fields</H3>
        <BulletList
          items={[
            "Railroad name (which railroad the timecard is for)",
            "Track Supervisor name",
            "Division Engineer name",
            "Image uploads — photos of signed physical timecards (stored in Supabase Storage)",
          ]}
        />
        <InfoBox title="Image uploads">
          Take a clear photo of the signed timecard and upload it directly. The image is
          stored securely and linked to the timesheet. Managers can view uploaded images
          during the approval process.
        </InfoBox>
      </DocSection>

      <DocSection id="inspections" title="Inspections">
        <P>
          Field inspection records with photo documentation. Each entry captures the inspection
          time, photos, and notes.
        </P>
        <BulletList
          items={[
            "Inspection time — when the inspection was performed",
            "Images — photos of the inspection (upload multiple)",
            "Notes — description of findings, pass/fail, follow-up needed",
          ]}
        />
      </DocSection>

      <DocSection id="ifta" title="IFTA (Fuel Tax)">
        <P>
          International Fuel Tax Agreement entries track fuel consumption and miles driven
          per state. This data is required for quarterly IFTA filing.
        </P>
        <H3>Fields per entry</H3>
        <Table
          headers={["Field", "Description"]}
          rows={[
            ["State Code", "Two-letter state abbreviation (KY, TN, OH, etc.)"],
            ["Reportable Miles", "Miles driven in that state"],
            ["Gallons Purchased", "Fuel purchased in that state"],
          ]}
        />
        <P>
          Create one entry per state per week. The accounting system aggregates these for
          quarterly IFTA returns.
        </P>
      </DocSection>

      <DocSection id="expenses" title="Expenses">
        <P>
          Categorized expense line items with receipt tracking. Expenses on approved timesheets
          automatically generate journal entries in accounting.
        </P>
        <H3>Expense categories</H3>
        <Table
          headers={["Category", "Examples"]}
          rows={[
            ["Fuel", "Diesel, gas for company vehicles"],
            ["Safety", "PPE, safety equipment, signs"],
            ["Repairs & Maintenance", "Parts, labor for vehicle/equipment repair"],
            ["Parts", "Replacement parts, consumables"],
            ["Parking", "Parking fees, tolls"],
            ["Lodging/Hotels", "Hotel stays while on the road"],
            ["Travel", "Flights, rental cars, other travel costs"],
            ["Supplies", "Office supplies, tools, miscellaneous"],
            ["MGT Approved Expense", "Manager-approved special expenses"],
            ["Other", "Anything that doesn't fit above"],
          ]}
        />
        <H3>Expense fields</H3>
        <BulletList
          items={[
            "Category — select from the list above",
            "Description — what the expense was for",
            "Amount — dollar amount",
            "Vendor — where it was purchased",
            "Receipt — upload a photo of the receipt",
            "Reimbursable — toggle if the employee should be reimbursed",
          ]}
        />
      </DocSection>

      <DocSection id="other-sections" title="Other Time Sections">
        <P>
          The remaining six sub-sections each track a specific type of time or compensation.
          They follow a simpler format: hours worked, type, and amount.
        </P>
        <Table
          headers={["Section", "What It Tracks", "Key Fields"]}
          rows={[
            ["Maintenance Time", "Hours spent on equipment maintenance", "Hours, type, description"],
            ["Shop Time", "Hours working in the shop (not in the field)", "Hours, type, description"],
            ["Mileage Pay", "Miles driven for mileage-based compensation", "Miles, rate, amount"],
            ["Flight Pay", "Travel flights for remote job sites", "Hours, amount, flight details"],
            ["Holiday Pay", "Paid holiday hours", "Hours, holiday name"],
            ["Vacation Pay", "Vacation hours used during the week", "Hours, date range"],
          ]}
        />
      </DocSection>

      <DocSection id="submit-approve" title="Submitting & Approval">
        <H3>Workflow</H3>
        <Steps
          items={[
            { label: "Draft", desc: "You can edit everything. Save as often as you want." },
            { label: "Submit", desc: "Sent to your manager for review. You can no longer edit." },
            { label: "Review", desc: "Manager reviews all sections, expenses, and attachments." },
            { label: "Approve/Reject", desc: "Manager approves or rejects with notes." },
          ]}
        />
        <H3>What happens on approval</H3>
        <NumberedList
          items={[
            "Per diem is automatically calculated from nights_out × nightly rate + layovers × layover rate",
            "A journal entry is created: DR 5100 Per Diem Expense / CR 2110 Per Diem Payable",
            "If the timesheet has reimbursable expenses, another JE is created for those",
            "The timesheet data becomes available for payroll calculation",
            "The timesheet status changes to \"Approved\" and cannot be edited",
          ]}
        />
        <H3>If your timesheet is rejected</H3>
        <BulletList
          items={[
            "The manager provides notes explaining what needs to change",
            "Your timesheet returns to draft status — you can edit it",
            "Make the requested changes, then submit again",
            "Resubmission goes back through the same approval process",
          ]}
        />
        <Warning>
          Once a timesheet is approved, it cannot be edited. If changes are needed after
          approval, the manager must first &quot;withdraw&quot; the approval, which returns the
          timesheet to draft status.
        </Warning>
      </DocSection>

      <DocSection id="manager-admin" title="Manager Admin">
        <P>
          The timesheet admin dashboard at <strong>/timesheets/admin</strong> gives managers
          a centralized view of all employee timesheets.
        </P>
        <H3>Features</H3>
        <BulletList
          items={[
            "Pending queue — all timesheets awaiting approval, sorted by submission date",
            "Employee summaries — hours, expenses, and submission status per person",
            "Bulk approve/reject — select multiple timesheets and approve or reject at once",
            "Withdrawal — return an approved timesheet to draft for corrections",
            "View all sections — click into any timesheet to review daily logs, expenses, inspections, etc.",
          ]}
        />
        <P>
          Requires <Badge>Manager</Badge> or <Badge>Developer</Badge> role.
        </P>
      </DocSection>

      <DocSection id="pto" title="Time Off (PTO)">
        <P>
          Request and track paid time off at <strong>/pto</strong>. IronSight manages balances
          for three categories of PTO.
        </P>
        <H3>PTO types and default balances</H3>
        <Table
          headers={["Type", "Annual Hours", "Notes"]}
          rows={[
            ["Vacation", "80 hours", "General time off, planned in advance"],
            ["Sick", "40 hours", "Illness, medical appointments"],
            ["Personal", "24 hours", "Personal errands, family events"],
            ["Bereavement", "As needed", "No balance — approved case-by-case"],
            ["Other", "As needed", "Special circumstances"],
          ]}
        />
        <H3>Requesting time off</H3>
        <NumberedList
          items={[
            "Go to /pto",
            "Click \"Request Time Off\"",
            "Select the PTO type (vacation, sick, personal, etc.)",
            "Set start and end dates",
            "Enter the number of hours",
            "Add notes (optional — reason for the request)",
            "Submit — the request goes to your manager for approval",
          ]}
        />
        <H3>Approval workflow</H3>
        <Steps
          items={[
            { label: "Pending", desc: "Waiting for manager review." },
            { label: "Approved", desc: "Hours deducted from balance. Time off confirmed." },
            { label: "Rejected", desc: "Not approved. Balance unchanged. Manager notes explain why." },
          ]}
        />
        <P>
          You can cancel a pending request. Cancelling an approved request refunds the hours
          back to your balance.
        </P>
        <H3>Manager PTO admin</H3>
        <P>
          Managers can review all PTO requests at <strong>/pto/admin</strong>. The admin dashboard
          shows pending requests, approved time off for the month, per-employee summaries,
          and upcoming scheduled time off.
        </P>
      </DocSection>

      <DocSection id="training" title="Training Compliance">
        <P>
          Track training requirements and completion records at <strong>/training</strong>.
          The system monitors compliance status and alerts when certifications are
          expiring or missing.
        </P>
        <H3>Training requirements</H3>
        <P>
          Requirements are company-defined training items that may be required for all employees
          or specific roles. Each requirement has a name, description, frequency (how often it
          must be renewed), and whether it&apos;s mandatory.
        </P>
        <H3>Compliance statuses</H3>
        <Table
          headers={["Status", "Color", "Meaning"]}
          rows={[
            ["Current", "Green", "Training completed and not expired"],
            ["Expiring Soon", "Yellow", "Expires within the next 30 days"],
            ["Expired", "Red", "Past the expiration date — needs renewal"],
            ["Missing", "Gray", "Required training never completed"],
          ]}
        />
        <P>
          An employee is considered &quot;compliant&quot; when all required, active training items
          have a &quot;Current&quot; status.
        </P>
        <H3>Recording training</H3>
        <BulletList
          items={[
            "Employees can view their own training status at /training",
            "Managers record completions at /training/admin",
            "Each record includes: employee, requirement, completion date, expiry date, certificate upload",
            "The admin matrix view shows all employees × all requirements at a glance",
          ]}
        />
        <H3>Training admin</H3>
        <P>
          The training admin page at <strong>/training/admin</strong> provides a compliance matrix
          showing every employee&apos;s status for every requirement. Managers can add completion
          records, manage requirements, and upload certificates. Requires <Badge>Manager</Badge> or <Badge>Developer</Badge> role.
        </P>
      </DocSection>

      <DocSection id="profiles" title="Employee Profiles">
        <P>
          Employee profiles at <strong>/profile</strong> extend Clerk authentication with
          company-specific HR fields. Profiles are auto-created on first visit.
        </P>
        <H3>Profile fields</H3>
        <Table
          headers={["Field", "Description"]}
          rows={[
            ["Phone Number", "Work or mobile phone"],
            ["Emergency Contact", "Name and phone for emergencies"],
            ["Emergency Phone", "Emergency contact's phone number"],
            ["Hire Date", "Date of hire at the company"],
            ["Job Title", "Current role or position"],
            ["Department", "Team or department assignment"],
            ["Profile Picture", "Photo uploaded to Supabase Storage"],
          ]}
        />
        <H3>Profile picture upload</H3>
        <P>
          Click the photo area on your profile page to upload a profile picture. Images are
          stored in Supabase Storage and displayed throughout the platform (chat messages,
          timesheet admin, etc.).
        </P>
      </DocSection>

      <DocSection id="per-diem" title="Per Diem">
        <P>
          Per diem is automatically calculated when a timesheet is approved. The calculation
          uses the number of nights out and layovers from the timesheet header, multiplied
          by the configured nightly and layover rates.
        </P>
        <H3>How it works</H3>
        <NumberedList
          items={[
            "Employee enters nights_out and layovers on the timesheet",
            "Manager approves the timesheet",
            "System calculates: (nights_out × nightly_rate) + (layovers × layover_rate)",
            "A per diem entry is created and linked to the timesheet",
            "A journal entry is auto-generated: DR 5100 Per Diem Expense / CR 2110 Per Diem Payable",
          ]}
        />
        <H3>Rate management</H3>
        <P>
          Per diem rates are managed via the API. The default rates are set at the company
          level and apply to all employees. Rate changes apply to timesheets approved after
          the change — previously approved timesheets retain their original calculation.
        </P>
      </DocSection>

      <DocSection id="roles" title="Roles & Access">
        <Table
          headers={["Feature", "Operator", "Mechanic", "Manager", "Developer"]}
          rows={[
            ["View own timesheets", "Yes", "Yes", "Yes", "Yes"],
            ["Create/edit timesheets", "Yes", "Yes", "Yes", "Yes"],
            ["Submit timesheets", "Yes", "Yes", "Yes", "Yes"],
            ["Approve/reject timesheets", "No", "No", "Yes", "Yes"],
            ["Timesheet admin dashboard", "No", "No", "Yes", "Yes"],
            ["Request PTO", "Yes", "Yes", "Yes", "Yes"],
            ["Approve PTO", "No", "No", "Yes", "Yes"],
            ["View own training", "Yes", "Yes", "Yes", "Yes"],
            ["Record training (admin)", "No", "No", "Yes", "Yes"],
            ["Edit own profile", "Yes", "Yes", "Yes", "Yes"],
          ]}
        />
      </DocSection>

      <DocSection id="accounting-integration" title="Accounting Integration">
        <P>
          Approved timesheets automatically create journal entries in the accounting system.
          This eliminates manual data entry and ensures accurate financial records.
        </P>
        <H3>Auto-generated entries</H3>
        <Table
          headers={["Trigger", "Debit Account", "Credit Account"]}
          rows={[
            ["Per diem calculated", "5100 Per Diem Expense", "2110 Per Diem Payable"],
            ["Reimbursable expenses", "Expense accounts (varies by category)", "2120 Expense Reimbursements Payable"],
          ]}
        />
        <P>
          These entries are created as posted journal entries with the timesheet ID as the
          reference number. They appear in the General Ledger and financial reports automatically.
        </P>
        <InfoBox title="Payroll integration">
          Approved timesheets also feed into the payroll system. When running payroll at
          /accounting/payroll-run, the system pulls hours from approved timesheets within
          the pay period dates.
        </InfoBox>
      </DocSection>
    </DocsLayout>
  );
}
