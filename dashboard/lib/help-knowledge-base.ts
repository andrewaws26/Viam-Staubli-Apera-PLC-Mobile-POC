/**
 * help-knowledge-base.ts — AI-optimized knowledge base for the IronSight help assistant.
 * Contains curated documentation content from all platform guides, formatted for Claude's
 * context window with prompt caching.
 */

export const HELP_KNOWLEDGE_BASE = `
## Fleet & Monitoring

IronSight Fleet Monitoring provides real-time visibility into every truck in the fleet.
Each truck has a Raspberry Pi 5 that reads engine data (J1939 CAN bus), TPS production
data (PLC via Modbus TCP), and robot cell data. Data syncs at 1 Hz to the cloud.

### Fleet Dashboard (/fleet)
- Shows all trucks as cards with live status indicators
- Summary bar: total trucks, online, offline, engines running, TPS active, active DTCs, maintenance overdue
- Truck cards show: status dot (green/red/gray), TPS metrics, engine status, location, assigned personnel, maintenance badges
- Auto-refreshes every 10 seconds
- Click a truck card to open its individual dashboard
- Accessible to Mechanic, Manager, Developer roles (NOT Operator)

### Truck Dashboard (/?truck_id=XX)
- Gauge grid with 14 categories of sensor data and threshold-based color coding
- DTC panel with active trouble codes, severity badges, and "Diagnose with AI" buttons
- AI Chat panel for conversational diagnostics
- Trend charts showing historical sparklines (coolant, RPM, speed, battery)
- Truck notes, team chat, maintenance tracker, work orders
- Live readings poll every 3 seconds; historical data refreshes every 5 minutes
- Truck ID "00" is a demo truck with simulated data
- Accessible to all roles

### Sensor Data
- Truck mode: Engine (RPM, load, torque), Temperatures (coolant warn 203°F/crit 221°F, oil, intake), Pressures (oil crit <14.5 PSI), Vehicle (speed, gear, battery crit <11.5V), Aftertreatment (SCR efficiency, DEF level, DPF soot), and more
- TPS data: plate count (DS7), plates per minute (DS8), encoder distance (DS10), detector offset, tie spacing, operating mode
- Color coding: white/gray=normal, yellow=warning, red=critical
- Some thresholds are inverted (lower is worse for pressures, battery, fluid levels)

### DTC Codes
- J1939 format: SPN (system/component) + FMI (failure type) + ECU (reporting module)
- Severity levels: Critical (red), Warning (yellow), Info (blue)
- Lamp indicators: MIL, STOP, WARN, PROT (Protect Lamp)
- Clear DTCs via the red button on the truck dashboard
- If codes return immediately after clearing, the root cause hasn't been resolved
- "Diagnose with AI" sends DTC info to AI chat with full context
- DTC history tracks codes appearing and clearing over time

### Shift Reports (/shift-report)
- Generate reports for any time range: presets (Day 6am-6pm, Night 6pm-6am, Full 6am-6am) or custom
- Summary KPIs: engine hours, idle %, plates placed, plates per hour
- Alerts, DTC events, trip timeline, route map (if GPS), peak readings, trend charts
- Print-optimized for 8.5x11" paper
- Accessible to all roles

### Fleet Management (/admin)
- Add trucks with Viam Part ID, Machine Address, capabilities
- Assign operators, mechanics, managers to trucks
- Truck statuses: Active, Inactive, Maintenance, Decommissioned (permanent)
- Requires Manager or Developer role

## AI Diagnostics

### AI Chat (Truck Dashboard)
- Conversational AI mechanic receiving live readings + 24h trends + DTC history + activity data
- 6 suggested quick questions on first open
- Every message includes latest live readings so analysis stays current
- Ends responses with 2-3 follow-up questions

### Full Diagnosis (Truck Dashboard)
- One-click comprehensive 6-section report:
  1. Data Summary — current readings + trends + utilization
  2. Active Trouble Codes — meaning, causes, severity, cost estimates, urgency
  3. Engine Health Assessment — temps, pressures, fuel trims vs 24h trends and 7-day baselines
  4. What I'd Want to Know — diagnostic questions for the mechanic
  5. Maintenance Recommendations — immediate, soon, at next service
  6. Fleet Note — what would flag for a fleet manager

### @ai in Team Chat
- Type @ai in any chat thread for inline diagnostic input
- AI receives last 10 messages + sensor snapshot
- Shorter, more conversational responses than truck dashboard AI

### What the AI Knows
- Live readings: engine, temps, pressures, fuel, aftertreatment, transmission, brakes, lamps, DTCs
- 24h trends: recent value, average, min/max, 7-day baseline, trend direction, status flags
- Activity data (7-day): trip count, durations, speeds, estimated miles, engine hours, idle %
- DTC history (48h): codes with timestamps

### What the AI Does NOT Know
- GPS locations (only estimated miles), video/camera feeds, previous repair history (unless told), driver behavior (only inferred), physical condition, parts availability

### Ethical Boundaries
- Never says "safe to drive" or "unsafe" — mechanic's judgment
- Never blames previous work without context
- Says "COULD indicate" not "IS caused by"
- Presents data analysis, not decisions

### Aftertreatment System
- SCR: converts NOx using DEF, normal efficiency 85-99%, critical <50%
- DPF: captures soot, >80% needs regen, >90% may need forced regen
- DEF dosing: actual + commanded rates should be >0 g/s when warm
- Common cascade: SCR temp lost → DEF disabled → efficiency collapse → EPA inducement
- EPA Inducement: Stage 1=Protect Lamp, Stage 2=5mph derate, Stage 3=idle-only
- Protect Lamp + zero DTCs = ECU reasserting lamp, root cause unresolved

### Diagnostic Rules Engine (19 rules)
- Camera (4): detection degrading, sudden loss, intermittent, no ties
- Encoder (7): disconnected, spinning no distance, stopped, unexpected motion, speed mismatch, noise, drift
- Eject (2): no Air Eagle confirmation, plates not dropping
- PLC Communication (2): slow response, frequent errors
- Operation (4): wrong spacing, backward travel, drops disabled, no mode selected

### Cost Estimates
- AI provides parts + labor cost ranges, DIY vs shop recommendation, urgency assessment
- Estimates are AI-generated approximations, not quotes

## Operations (Work Orders & Chat)

### Work Board (/work)
- Kanban view: Open → In Progress → Blocked → Done
- "My Work" filter shows only your assigned work orders
- Drag-and-drop between columns to change status
- Moving to Blocked prompts for a reason
- Cards show: title, priority badge, truck, assignee, subtask progress, due date
- Auto-refreshes every 15 seconds

### Creating a Work Order
- Title (required), description, priority (Urgent/Normal/Low)
- Assign to truck and/or person
- Due date, subtask checklist
- AI-suggested steps: enter title + optional DTCs → get 4-12 mechanic-grade action steps
- Creating requires Mechanic, Manager, or Developer role (Operators cannot create)

### Work Order Lifecycle
- Open → In Progress → Blocked (requires reason) → Done
- Done → Open to reopen
- Subtasks track step-by-step completion
- All changes logged in audit trail

### Team Chat (/chat)
- Entity-anchored threads: Truck, Work Order, DTC, or Direct Message
- Thread list with search, entity type filters, unread badges
- Auto-created on first access for entity threads
- DMs: click "New Message" and select a person
- Polls: 3s for active thread, 5s for thread list
- Push notifications via Expo for mobile

### Sensor Snapshots
- Auto-captured when sending messages from truck context
- Show key readings (RPM, coolant, oil, battery, DTCs) at time of message
- Expandable card in chat messages
- Preserves truck state for historical reference

### Reactions
- 4 domain reactions: 👍 Acknowledged, 🔧 I'll handle this, ✅ Done, 👀 Looking into it

## People & HR (Timesheets, PTO, Training, Profiles)

### Timesheets (/timesheets)
Weekly field operations time tracking with 12 sub-sections.

#### Creating a Timesheet (/timesheets/new)
- Week ending date (Sunday), railroad, chase vehicles, semi trucks, work location
- Nights out + layovers (for per diem calculation), co-workers, notes

#### 12 Sub-Sections
1. Daily Logs — start/end time, hours, travel, lunch, semi truck travel, description per day
2. Railroad Time — hours on railroad jobs, NS job code, clock in/out
3. Railroad Timecards — formal entries with supervisor names, image uploads
4. Inspections — time, photos, notes
5. IFTA — state code, reportable miles, gallons purchased
6. Expenses — categorized (Fuel, Safety, Repairs, Parts, Parking, Lodging, Travel, Supplies, Other), receipts, reimbursable flag
7. Maintenance Time — equipment maintenance hours
8. Shop Time — in-shop work hours
9. Mileage Pay — miles driven for compensation
10. Flight Pay — travel flights
11. Holiday Pay — paid holiday hours
12. Vacation Pay — vacation hours used

#### Submit & Approve Workflow
- Draft → Submit → Manager Review → Approve/Reject
- On approval: per diem auto-calculated (nights_out × rate + layovers × rate)
- Auto-creates journal entries: DR 5100 Per Diem / CR 2110, DR expenses / CR 2120
- Rejected timesheets return to draft for editing and resubmission
- Approved timesheets cannot be edited without manager withdrawal

#### Manager Admin (/timesheets/admin)
- Pending queue, employee summaries, bulk approve/reject, withdrawal
- Requires Manager or Developer role

### PTO (/pto)
- Types: Vacation (80h), Sick (40h), Personal (24h), Bereavement, Other
- Request workflow: Pending → Approved (hours deducted) / Rejected / Cancelled
- Cancelling approved PTO refunds hours
- Manager admin at /pto/admin: pending requests, monthly stats, upcoming calendar
- All roles can request; Manager/Developer can approve

### Training Compliance (/training)
- Requirements: company-defined training items with name, frequency, required flag
- Compliance statuses: Current (green), Expiring Soon (yellow, within 30 days), Expired (red), Missing (gray)
- Employee is "compliant" when all required trainings are Current
- Admin matrix at /training/admin shows all employees × all requirements
- Certificate uploads supported
- Manager/Developer can record completions; all roles view own status

### Employee Profiles (/profile)
- Fields: phone, emergency contact, hire date, job title, department
- Profile picture upload (Supabase Storage)
- Auto-created on first visit from Clerk user data
- All roles can edit own profile

### Per Diem
- Auto-calculated from timesheet nights_out and layovers on approval
- Rate managed via API (default company-wide rates)
- Creates journal entry: DR 5100 Per Diem Expense / CR 2110 Per Diem Payable

## AI Report Generator (/reports)
Ask any question about your company data in plain English — the AI generates a SQL query, runs it, and returns results. Requires Manager or Developer role.

### How It Works
- Type a natural language question (e.g., "What is the most common error code for the trucks")
- The AI (Claude) generates a SQL query against the IronSight database
- The query is validated for safety (read-only, no mutations, sandboxed execution)
- Results display in a sortable table with row count and execution time
- If the first query fails, the AI automatically retries with the error context

### Features
- 10 pre-built example questions as quick-start chips
- Sortable result columns (click headers)
- CSV download for any result set
- SQL toggle to see the generated query
- Save reports for reuse (name, description, category, share with team)
- Saved reports library with search, category filters, and re-run
- All queries logged for analysis (prompt, SQL, success/failure, errors)

### What You Can Ask
- Fleet: "Show trucks with DTCs in the last 30 days", "What is the most common error code"
- HR: "Which employees have pending timesheets", "Compare overtime hours by employee"
- Finance: "Show overdue invoices over $5,000", "Total invoiced vs paid by customer"
- Payroll: "Show payroll totals by employee for Q1 2026"
- Training: "Show certifications expiring in the next 60 days"
- Operations: "Show active work orders with assigned person"
- Per diem: "Average per diem cost per railroad for March"
- Any combination across all 65+ database tables

### Tips
- Be specific: "overtime hours for March 2026" works better than "show me overtime"
- The AI knows exact column names and table relationships
- Results are limited to 500 rows by default
- Saved reports can be re-run anytime with fresh data
- Share reports with your team using the share toggle

## Finance & Accounting (/accounting)
Complete QuickBooks replacement. Requires Manager or Developer role.

### Key Features
- Chart of Accounts (40+ accounts, 5 types: Asset/Liability/Equity/Revenue/Expense)
- Journal Entries: Draft → Posted → Voided
- Invoicing (AR): Create → Send → Partial/Paid. Auto-JE on send/payment.
- Bills (AP): Enter → Pay. Auto-JE.
- Customers & Vendors directory with 1099 tracking
- Bank Reconciliation with CSV import
- Recurring Journal Entries (monthly, quarterly, annually)
- Accounting Periods: Open → Closed → Locked. Year-end close.
- Payroll: full tax calc (federal, KY 4%, SS 6.2%, Medicare, FUTA, SUTA)
- Employee Tax Setup: W-4, pay rates, benefits, workers comp
- Fixed Assets: depreciation (straight-line/declining/sum-of-years), disposal
- Estimates: Draft → Sent → Accepted → Convert to Invoice
- CC Rules: 27 pre-configured vendor rules, CSV import, batch post
- Receipt Scanner: AI-powered OCR (Claude Vision)
- Payment Reminders: tiered overdue notices (7/30/60/90+ days)
- Sales Tax: KY 6% pre-configured, exemptions, filing summary
- Budget vs Actual: monthly budget entry + variance analysis
- Financial Reports: P&L, Balance Sheet, GL, AR/AP Aging, Cash Flow, Trial Balance
- Tax Reports: Form 941, 940, KY withholding, filing calendar
- 1099 Tracking: vendor payments, $600 threshold detection
- Audit Trail: filterable, CSV export, color-coded actions

### Auto-Generated Journal Entries
- Timesheet approved (per diem): DR 5100 / CR 2110
- Timesheet approved (expenses): DR various / CR 2120
- Invoice sent: DR 1100 AR / CR 4010 Revenue
- Invoice payment: DR 1000 Cash / CR 1100 AR
- Bill entered: DR expense / CR 2000 AP
- Bill payment: DR 2000 AP / CR 1000 Cash
- Payroll posted: DR 5000+5010 / CR tax liabilities + 1000 Cash
- Depreciation: DR 6000 / CR 1310
- CC transactions posted: DR expense / CR 2100 CC Payable

## System & Admin

### Roles & Permissions
- Operator: view dashboards + own timesheets/PTO/training/profile. Cannot access Fleet page, create work orders, use AI, or view Finance.
- Mechanic: Operator + Fleet page, AI diagnostics, truck commands, create work orders, team members list
- Manager: Mechanic + all Finance, approve timesheets/PTO, training admin, fleet admin, audit trail, push notifications, per diem rates, AI reports
- Developer: Manager + dev tools (/dev), vision (/vision), DEV mode on truck dashboard

### Key Admin Pages
- /admin — Fleet management (add/edit trucks, assign personnel)
- /timesheets/admin — Timesheet approval dashboard
- /pto/admin — PTO approval dashboard
- /training/admin — Training compliance matrix
- /accounting/audit-trail — Full audit log with filters and CSV export

### Inventory (/inventory)
- Parts catalog with SKU, category, stock levels, reorder points
- Location tracking, usage logging
- Alerts: Low Stock (yellow), Out of Stock (red)

### Mobile App
- iOS (React Native/Expo): fleet view, truck dashboard, work orders, chat, timesheets
- Push notifications for chat messages, work order assignments, timesheet status changes

## Navigation Map

### Fleet Section
- /fleet — Fleet overview (all trucks)
- /shift-report — Shift report generator
- /fleet/docs — Fleet & monitoring documentation
- /fleet/ai-docs — AI diagnostics documentation

### Operations Section
- /work — Work orders board
- /chat — Team chat
- /work/docs — Operations documentation

### People Section
- /timesheets — My timesheets
- /timesheets/new — Create new timesheet
- /timesheets/admin — Timesheet review (Manager+)
- /pto — Time off requests
- /pto/admin — PTO approvals (Manager+)
- /training — Training compliance
- /training/admin — Training admin (Manager+)
- /profile — My profile
- /timesheets/docs — People & HR documentation

### Reports Section (Manager+)
- /reports — AI Report Generator (natural language to SQL)

### Finance Section (Manager+)
- /accounting — Chart of Accounts + Journal Entries
- /accounting/invoices — Invoicing (AR)
- /accounting/bills — Bills (AP)
- /accounting/customers — Customers & Vendors
- /accounting/bank — Bank Reconciliation
- /accounting/recurring — Recurring Entries
- /accounting/periods — Accounting Periods
- /accounting/payroll-run — Run Payroll
- /accounting/employee-tax — Employee Tax Setup
- /accounting/fixed-assets — Fixed Assets
- /accounting/estimates — Estimates & Quotes
- /accounting/expense-rules — CC Rules & Import
- /accounting/receipt-ocr — Receipt Scanner
- /accounting/payment-reminders — Payment Reminders
- /accounting/sales-tax — Sales Tax
- /accounting/budget — Budget vs Actual
- /accounting/reports — Financial Reports
- /accounting/tax-reports — Tax Reports (941)
- /accounting/vendor-1099 — 1099 Tracking
- /accounting/audit-trail — Audit Trail
- /accounting/docs — Accounting documentation

### System Section
- /admin — Fleet admin & management (Manager+)
- /admin/docs — System & admin documentation
- /dev — Developer tools (Developer only)
- /vision — Vision system (Developer only)
- /inventory — Parts inventory
- /docs — Documentation index (all guides)

## Role Access Quick Reference

| Feature | Operator | Mechanic | Manager | Developer |
|---------|----------|----------|---------|-----------|
| Fleet page | No | Yes | Yes | Yes |
| Truck dashboard | Yes | Yes | Yes | Yes |
| AI diagnostics | No | Yes | Yes | Yes |
| Work orders (create) | No | Yes | Yes | Yes |
| Work orders (view) | Yes | Yes | Yes | Yes |
| Team chat | Yes | Yes | Yes | Yes |
| Timesheets (own) | Yes | Yes | Yes | Yes |
| Timesheets (approve) | No | No | Yes | Yes |
| PTO (own) | Yes | Yes | Yes | Yes |
| PTO (approve) | No | No | Yes | Yes |
| Training (own) | Yes | Yes | Yes | Yes |
| Training (admin) | No | No | Yes | Yes |
| Profile (own) | Yes | Yes | Yes | Yes |
| Finance/Accounting | No | No | Yes | Yes |
| Fleet admin | No | No | Yes | Yes |
| AI Report Generator | No | No | Yes | Yes |
| AI Reports | No | No | Yes | Yes |
| Dev tools | No | No | No | Yes |
`;
