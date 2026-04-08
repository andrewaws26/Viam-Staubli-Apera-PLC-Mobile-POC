# IronSight Company OS -- Unified Data Architecture

> Strategic reference for the IronSight platform data model, infrastructure, security, and growth plan.
> Covers every existing table, cross-domain connectivity patterns, future module design, and UI architecture
> for the transition from fleet monitoring dashboard to full Company Operating System.

---

## Table of Contents

1. [Vision](#1-vision)
2. [Current Data Model](#2-current-data-model)
3. [Data Flow Architecture](#3-data-flow-architecture)
4. [Cross-Domain Data Strategy](#4-cross-domain-data-strategy)
5. [Future Modules](#5-future-modules)
6. [Security Model](#6-security-model)
7. [Infrastructure and Cost Strategy](#7-infrastructure-and-cost-strategy)
8. [Scalability Considerations](#8-scalability-considerations)
9. [Data Reliability and Backup](#9-data-reliability-and-backup)
10. [UI Architecture Considerations](#10-ui-architecture-considerations)

---

## 1. Vision

### From Fleet Monitor to Company OS

IronSight started as a real-time monitoring dashboard for railroad trucks -- CAN bus diagnostics,
PLC telemetry, and AI-assisted fault analysis. It has grown into something fundamentally larger:
a **Company Operating System** that manages the full scope of B&B Metals field operations.

The platform today already spans:

- **Fleet diagnostics** -- live sensor data from 30+ trucks via Viam Cloud
- **Work order management** -- task assignment, blocker tracking, DTC-linked repairs
- **Timesheets** -- weekly field reports with daily logs, expenses, IFTA, railroad timecards, inspections, maintenance time, shop time, mileage/flight/holiday/vacation pay
- **HR** -- employee profiles, training compliance with expiry tracking
- **PTO** -- time-off requests with approval workflows
- **Finance** -- per diem auto-calculation, expense categorization, reimbursement tracking
- **Communication** -- contextual team chat anchored to trucks, work orders, and DTCs
- **Platform infrastructure** -- polymorphic documents, unified activity feed, cross-domain tagging, security audit log

### Core Principle: Connect All the Data

The goal is not to build isolated modules. It is to build a **connected data graph** where every
piece of company information -- from a fuel receipt on a Tuesday to a DTC code on truck ST-03 to
an employee's OSHA certification expiry -- lives in one system and can be queried together.

This enables questions that no collection of spreadsheets, paper forms, and disconnected apps can answer:

- "What is the total cost per employee per month, including hours, per diem, mileage, and expenses?"
- "Which trucks have the highest maintenance cost per operating hour?"
- "Who is non-compliant on safety training AND has PTO coming up next week?"
- "Show all expenses tagged to the Norfolk Southern Q2 project across all employees."
- "What is our IFTA liability by state for this quarter?"

### Design Tenets

| Tenet | Meaning |
|---|---|
| **Sustainable** | Schema grows by adding tables and entity_type values, not by restructuring |
| **Secure** | RBAC at the route level, audit trail on every sensitive action, service key never exposed |
| **Reliable** | Offline-first mobile, idempotent APIs, automatic backups, JSONL buffers on-device |
| **Cost-effective** | Free/low tiers until real scale demands upgrades; no premature infrastructure spend |

---

## 2. Current Data Model

### Complete Table Inventory

Every table in the IronSight database, organized by domain.

---

### Fleet / Diagnostics

Sensor data flows from truck hardware through Viam Cloud. These tables track fleet configuration,
assignments, and fault code history in Supabase.

| Table | Purpose | Key Columns |
|---|---|---|
| `truck_notes` | Mechanic/operator notes per truck | `truck_id`, `author_id`, `author_role`, `body` |
| `truck_assignments` | Which users can access which trucks | `user_id`, `truck_id`, `assigned_by` |
| `maintenance_events` | Service history per truck (oil, tires, etc.) | `truck_id`, `event_type`, `mileage`, `engine_hours`, `next_due_mileage`, `next_due_date` |
| `dtc_history` | Fault code lifecycle: first seen, last seen, cleared | `truck_id`, `spn`, `fmi`, `source_address`, `occurrence_count`, `active`, `cleared_at` |
| `company_vehicles` | Reference table for chase vehicles and semi trucks | `vehicle_number`, `vehicle_type` (chase/semi/other), `is_active` |

*Note: Live sensor readings (TPS, J1939 CAN, robot cell) are stored in Viam Cloud, not Supabase.
The dashboard queries Viam's Data API for historical telemetry via `exportTabularData`.*

---

### Operations

| Table | Purpose | Key Columns |
|---|---|---|
| `work_orders` | Shop floor task management with status tracking | `truck_id`, `title`, `status` (open/in_progress/blocked/done), `priority`, `blocker_reason`, `assigned_to`, `linked_dtcs`, `truck_snapshot` |
| `work_order_notes` | Activity feed / context per work order | `work_order_id` (FK), `author_id`, `body` |
| `work_order_subtasks` | Breakable checklist steps within a work order | `work_order_id` (FK), `title`, `is_done`, `sort_order` |

---

### Timesheets

The timesheet system mirrors the full B&B Metals weekly work report. Each section is its own table,
linked to the parent `timesheets` record via `timesheet_id` FK with `ON DELETE CASCADE`.

| Table | Purpose | Key Columns |
|---|---|---|
| `timesheets` | One per employee per week (Saturday week-ending) | `user_id`, `week_ending`, `status` (draft/submitted/approved/rejected), `railroad_working_on`, `chase_vehicles`, `semi_trucks`, `nights_out`, `layovers`, `norfolk_southern_job_code`, `ifta_odometer_start/end` |
| `timesheet_daily_logs` | Daily clock in/out with hours and travel | `timesheet_id`, `log_date`, `start_time`, `end_time`, `hours_worked`, `travel_hours`, `lunch_minutes`, `semi_truck_travel`, `traveling_from`, `destination`, `travel_miles` |
| `timesheet_expenses` | Categorized expenses with receipt capture | `timesheet_id`, `expense_date`, `amount`, `category`, `needs_reimbursement`, `payment_type`, `receipt_image_url`, `is_fuel`, `fuel_vehicle_number` |
| `timesheet_ifta_entries` | Per-state fuel tax reporting | `timesheet_id`, `state_code`, `reportable_miles`, `gallons_purchased` |
| `timesheet_railroad_timecards` | Railroad billing documentation with photos | `timesheet_id`, `railroad`, `track_supervisor`, `division_engineer`, `images` |
| `timesheet_inspections` | Equipment inspection records with photos | `timesheet_id`, `inspection_time`, `images`, `notes` |
| `timesheet_maintenance_time` | Vehicle/equipment maintenance hours | `timesheet_id`, `log_date`, `start_time`, `stop_time`, `hours_worked`, `parts_used` |
| `timesheet_shop_time` | Non-field shop work hours | `timesheet_id`, `log_date`, `start_time`, `stop_time`, `lunch_minutes`, `hours_worked` |
| `timesheet_mileage_pay` | Personal vehicle mileage reimbursement | `timesheet_id`, `log_date`, `traveling_from`, `destination`, `miles`, `chase_vehicle` |
| `timesheet_flight_pay` | Air travel compensation | `timesheet_id`, `log_date`, `traveling_from`, `destination` |
| `timesheet_holiday_pay` | Holidays worked or observed | `timesheet_id`, `holiday_date` |
| `timesheet_vacation_pay` | Vacation time taken during timesheet week | `timesheet_id`, `start_date`, `end_date`, `hours_per_day`, `total_hours` |

---

### HR

| Table | Purpose | Key Columns |
|---|---|---|
| `employee_profiles` | Company-specific fields extending Clerk user data | `user_id`, `user_name`, `user_email`, `phone`, `emergency_contact_name/phone`, `hire_date`, `job_title`, `department`, `profile_picture_url` |
| `training_requirements` | Company-wide certification definitions | `name`, `description`, `frequency_months` (NULL = never expires), `is_required`, `is_active` |
| `training_records` | Individual training completion with expiry tracking | `user_id`, `requirement_id` (FK), `completed_date`, `expiry_date`, `certificate_url`, `recorded_by` |

---

### Time Off

| Table | Purpose | Key Columns |
|---|---|---|
| `pto_balances` | Available PTO hours per user per year | `user_id`, `year`, `vacation_hours`, `sick_hours`, `personal_hours` |
| `pto_requests` | Time-off requests with approval workflow | `user_id`, `request_type` (vacation/sick/personal/bereavement/other), `start_date`, `end_date`, `hours_requested`, `status` (pending/approved/rejected/cancelled), `approved_by` |

---

### Finance

| Table | Purpose | Key Columns |
|---|---|---|
| `per_diem_rates` | Configurable daily/layover rates with effective dates | `name`, `daily_rate`, `layover_rate`, `effective_date`, `is_active` |
| `per_diem_entries` | Auto-calculated per diem linked to approved timesheets | `timesheet_id` (FK), `user_id`, `rate_id` (FK), `nights_count`, `layover_count`, `total_amount`, `week_ending` |
| `expense_categories` | Reference table for consistent categorization | `name`, `description`, `sort_order`, `is_active` |

---

### Communication

| Table | Purpose | Key Columns |
|---|---|---|
| `chat_threads` | Conversation containers anchored to entities | `entity_type` (truck/work_order/dtc/direct), `entity_id`, `title`, `created_by`, `pinned_message_id` |
| `chat_thread_members` | Thread membership and read tracking | `thread_id` (FK), `user_id`, `role` (member/muted), `last_read_at` |
| `chat_messages` | Individual messages with type classification | `thread_id` (FK), `sender_id`, `message_type` (user/system/ai/snapshot), `body`, `snapshot`, `attachments` |
| `chat_reactions` | Domain-specific quick reactions | `message_id` (FK), `user_id`, `reaction` (thumbs_up/wrench/checkmark/eyes) |
| `message_reads` | Per-message read receipts | `message_id` (FK), `reader_id`, `read_at` |

---

### Platform Infrastructure

These tables are domain-agnostic by design. They use `entity_type` + `entity_id` polymorphism
so any current or future module can use them without schema changes.

| Table | Purpose | Key Columns |
|---|---|---|
| `documents` | Polymorphic file attachments to any entity | `user_id`, `entity_type`, `entity_id`, `file_name`, `file_url`, `file_size`, `mime_type`, `tags` (JSONB) |
| `activity_feed` | Unified timeline of actions across all modules | `user_id`, `action`, `entity_type`, `entity_id`, `summary`, `metadata` (JSONB) |
| `entity_tags` | Cross-domain categorization / labeling | `entity_type`, `entity_id`, `tag`, `created_by` |
| `audit_log` | Security-focused action trail | `user_id`, `user_name`, `user_role`, `action`, `truck_id`, `details` (JSONB) |

---

### Auth

Authentication is managed entirely by **Clerk** (external service). No auth tables in Supabase.

| Concept | Implementation |
|---|---|
| User identity | Clerk user ID (text), stored as `user_id` across all tables |
| Roles | Clerk `publicMetadata.role`: `developer`, `manager`, `mechanic`, `operator` |
| Sessions | Clerk JWT, verified server-side on every API request |
| Mobile auth | Bearer token from Clerk, passed in Authorization header |

---

### Entity Relationship Summary

```
                                    timesheets
                                        |
           +----------+---------+-------+-------+--------+---------+--------+--------+
           |          |         |       |       |        |         |        |        |
      daily_logs  expenses   ifta  railroad  inspect  maint_time  shop  mileage  flight
                                 timecards                              pay      pay
                                                                    +--------+
                                                                    | holiday |
                                                                    | vacation|
                                                                    +---------+
           per_diem_entries --FK--> timesheets
           per_diem_entries --FK--> per_diem_rates

           work_orders
               |
           +---+---+
           |       |
         notes  subtasks

           training_records --FK--> training_requirements

           chat_messages --FK--> chat_threads
           chat_thread_members --FK--> chat_threads
           chat_reactions --FK--> chat_messages
           message_reads --FK--> chat_messages

           documents ----polymorphic----> ANY entity (via entity_type + entity_id)
           activity_feed --polymorphic--> ANY entity
           entity_tags ---polymorphic---> ANY entity
```

---

## 3. Data Flow Architecture

### End-to-End Data Paths

```
 TRUCK HARDWARE                    CLOUD / BACKEND                    CLIENT APPS
 ===============                   ===============                    ===========

 +-------------+     CAN bus       +-------------+     1 Hz capture   +-------------+
 | J1939 ECUs  |-----(pins 3/11)-->| Raspberry   |---(Viam SDK)----->| Viam Cloud  |
 | (250 kbps)  |                   | Pi 5        |                   | (sensor DB) |
 +-------------+                   | w/ CAN HAT  |                   +------+------+
                                   +------+------+                          |
 +-------------+     Modbus TCP           |                                 |
 | Click PLC   |-----(port 502)---------->|                                 |
 | C0-10DD2E-D |     (Ethernet)           |                                 |
 +-------------+                          |                                 |
                                   +------+------+    6-sec sync            |
 +-------------+                   | Offline     |<-----(if WiFi down)      |
 | Staubli CS9 |---(REST API)---->| JSONL Buffer |                         |
 +-------------+                   | (50MB cap)  |                         |
                                   +-------------+                         |
 +-------------+                                                           |
 | Apera Vue   |---(socket 14040)->        Pi 5                            |
 +-------------+                                                           |
                                                                           |
                                                                           v
                                   +------------------------------------------+
                                   |           Vercel (Next.js)                |
                                   |                                          |
                                   |  API Routes:                             |
                                   |    /api/sensor-readings  <--Viam Cloud   |
                                   |    /api/truck-readings   <--Viam Cloud   |
                                   |    /api/sensor-history   <--Viam Data API|
                                   |    /api/timesheets       <--Supabase     |
                                   |    /api/work-orders      <--Supabase     |
                                   |    /api/chat/*           <--Supabase     |
                                   |    /api/pto              <--Supabase     |
                                   |    /api/training         <--Supabase     |
                                   |    /api/profiles         <--Supabase     |
                                   |    /api/per-diem         <--Supabase     |
                                   |    /api/audit-log        <--Supabase     |
                                   |                                          |
                                   |  Auth: Clerk JWT verified on every req   |
                                   |  DB: Supabase service_role key (server)  |
                                   +----------+------------+------------------+
                                              |            |
                                              v            v
                                   +----------+--+  +------+------+
                                   | Supabase    |  | Clerk       |
                                   | PostgreSQL  |  | Auth Service|
                                   | + Storage   |  | (RBAC, JWT) |
                                   | + Realtime  |  +-------------+
                                   +------+------+
                                          |
                              +-----------+-----------+
                              |                       |
                              v                       v
                      +-------+-------+       +-------+-------+
                      | Web Dashboard |       | Mobile App    |
                      | (Next.js SSR) |       | (Expo/RN)     |
                      | Desktop + Mob |       | iOS + Android |
                      +---------------+       +---------------+
```

### Authentication Flow

```
  Mobile App / Web Browser
       |
       | 1. User signs in via Clerk
       v
  +----------+
  | Clerk    |---> Returns JWT with user ID + role in publicMetadata
  +----------+
       |
       | 2. Every API request includes JWT (cookie or Bearer token)
       v
  +------------------+
  | Next.js API Route|
  |                  |
  |  a. Verify JWT via Clerk middleware
  |  b. Extract userId, role from session
  |  c. Check ROUTE_PERMISSIONS map
  |  d. Query Supabase with service_role key
  |  e. Filter data by role:
  |     - operator/mechanic: own data only (timesheets, PTO, etc.)
  |     - manager/developer: all data
  |  f. Write audit_log entry for sensitive actions
  |                  |
  +--------+---------+
           |
           v
  +--------+---------+
  | Supabase         |
  | (service_role)   |
  +------------------+
```

### Timesheet Approval Flow (Example Cross-Domain Data Path)

```
  Employee                    System                        Manager
  ========                    ======                        =======

  1. Create timesheet
     (status: draft)
       |
  2. Fill daily logs,
     expenses, IFTA,
     inspections, etc.
       |
  3. Submit
     (status: submitted)
       |                  4. activity_feed entry:
       +---------------->    "Andrew submitted timesheet
                              for week ending 4/12"
                                |
                                +----> 5. Manager sees in
                                       activity feed
                                              |
                          6. Manager reviews  |
                             all sections <---+
                                |
                          7. Approve
                             (status: approved)
                                |
                          8. System auto-creates
                             per_diem_entry:
                             - Looks up active per_diem_rate
                             - Calculates: nights * daily_rate
                                         + layovers * layover_rate
                             - Links to timesheet via FK
                                |
                          9. audit_log entry:
                             "timesheet_approved"
                                |
                         10. activity_feed entry:
                             "Manager approved Andrew's
                              timesheet for week ending 4/12"
```

---

## 4. Cross-Domain Data Strategy

### The Polymorphic Pattern

Three platform tables -- `documents`, `activity_feed`, and `entity_tags` -- use the same
`entity_type` + `entity_id` pattern to attach data to any record in any module.

```
 entity_type values (current):
   'timesheet'        'expense'          'pto_request'
   'work_order'       'training_record'  'profile'
   'inspection'       'maintenance'      'truck'
   'dtc'              'chat_thread'

 Future modules just add new values:
   'invoice'          'contract'         'safety_incident'
   'purchase_order'   'parts_request'    'dot_audit'
```

This means:

- **Documents**: Attach a receipt photo to an expense. Attach a safety manual to a training requirement. Attach a contract to a work order. Same table, same API, same storage bucket.
- **Activity feed**: Every action across every module flows into one timeline. Filter by entity_type, user_id, date range, or action type.
- **Entity tags**: Tag a timesheet "Norfolk Southern Q2", an expense "Norfolk Southern Q2", and a work order "Norfolk Southern Q2". Now query all three together.

### Cross-Domain Query Examples

**Total cost per employee per month:**
```sql
SELECT
  ep.user_name,
  DATE_TRUNC('month', t.week_ending) AS month,
  SUM(tdl.hours_worked) AS total_field_hours,
  SUM(tst.hours_worked) AS total_shop_hours,
  SUM(tmt.hours_worked) AS total_maintenance_hours,
  SUM(te.amount) AS total_expenses,
  SUM(pde.total_amount) AS total_per_diem,
  SUM(te.amount) + SUM(pde.total_amount) AS total_non_wage_cost
FROM timesheets t
JOIN employee_profiles ep ON ep.user_id = t.user_id
LEFT JOIN timesheet_daily_logs tdl ON tdl.timesheet_id = t.id
LEFT JOIN timesheet_shop_time tst ON tst.timesheet_id = t.id
LEFT JOIN timesheet_maintenance_time tmt ON tmt.timesheet_id = t.id
LEFT JOIN timesheet_expenses te ON te.timesheet_id = t.id
LEFT JOIN per_diem_entries pde ON pde.timesheet_id = t.id
WHERE t.status = 'approved'
GROUP BY ep.user_name, DATE_TRUNC('month', t.week_ending)
ORDER BY month DESC, total_non_wage_cost DESC;
```

**Expenses for a specific railroad project (via tags):**
```sql
SELECT
  te.expense_date, te.category, te.amount, te.description,
  t.user_name, t.railroad_working_on
FROM timesheet_expenses te
JOIN timesheets t ON t.id = te.timesheet_id
JOIN entity_tags et ON et.entity_type = 'timesheet'
  AND et.entity_id = t.id
  AND et.tag = 'Norfolk Southern Q2'
ORDER BY te.expense_date;
```

**Non-compliant employees with upcoming PTO:**
```sql
WITH non_compliant AS (
  SELECT DISTINCT tr.user_id, tr.user_name
  FROM training_requirements treq
  CROSS JOIN (SELECT DISTINCT user_id, user_name FROM training_records) tr
  LEFT JOIN training_records rec
    ON rec.user_id = tr.user_id
    AND rec.requirement_id = treq.id
    AND (rec.expiry_date IS NULL OR rec.expiry_date > CURRENT_DATE)
  WHERE treq.is_required = true AND treq.is_active = true
    AND rec.id IS NULL
)
SELECT nc.user_name, pr.start_date, pr.end_date, pr.request_type
FROM non_compliant nc
JOIN pto_requests pr ON pr.user_id = nc.user_id
WHERE pr.status = 'approved'
  AND pr.start_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '14 days';
```

**Fleet maintenance costs correlated with operating hours:**
```sql
SELECT
  me.truck_id,
  COUNT(me.id) AS service_count,
  SUM(te.amount) FILTER (WHERE te.category IN ('Repairs & Maintenance', 'Parts')) AS parts_cost,
  SUM(tmt.hours_worked) AS maintenance_labor_hours
FROM maintenance_events me
LEFT JOIN timesheet_maintenance_time tmt
  ON tmt.description ILIKE '%' || me.truck_id || '%'
LEFT JOIN timesheet_expenses te
  ON te.fuel_vehicle_number = me.truck_id
  AND te.category IN ('Repairs & Maintenance', 'Parts')
GROUP BY me.truck_id
ORDER BY parts_cost DESC NULLS LAST;
```

**IFTA quarterly summary by state:**
```sql
SELECT
  ie.state_code,
  SUM(ie.reportable_miles) AS total_miles,
  SUM(ie.gallons_purchased) AS total_gallons,
  CASE WHEN SUM(ie.gallons_purchased) > 0
    THEN ROUND(SUM(ie.reportable_miles) / SUM(ie.gallons_purchased), 2)
    ELSE 0 END AS mpg
FROM timesheet_ifta_entries ie
JOIN timesheets t ON t.id = ie.timesheet_id
WHERE t.status = 'approved'
  AND t.week_ending BETWEEN '2026-01-01' AND '2026-03-31'
GROUP BY ie.state_code
ORDER BY total_miles DESC;
```

---

## 5. Future Modules

Each planned module describes what tables it needs and how it connects to existing data.
The key constraint: **new modules should use the existing platform tables (documents, activity_feed,
entity_tags, audit_log) and only add domain-specific tables.**

---

### 5.1 Financials / Bookkeeping

**Purpose**: Invoicing, accounts payable/receivable, general ledger, and cost tracking.

**New tables:**

| Table | Purpose | Key Links |
|---|---|---|
| `invoices` | Customer invoices for completed work | FK to `timesheets` (hours billed), `work_orders` (work performed) |
| `invoice_line_items` | Individual billable items | FK to `invoices`, references `timesheet_expenses` for pass-through costs |
| `accounts_payable` | Vendor bills and payment tracking | Tags via `entity_tags` for project allocation |
| `accounts_receivable` | Customer payment tracking | FK to `invoices` |
| `gl_entries` | General ledger journal entries | Links to any source via `entity_type` + `entity_id` pattern |
| `payment_records` | Check/ACH/wire payment records | FK to `accounts_payable` or `accounts_receivable` |

**Cross-domain connections:**
- Timesheet `hours_worked` and `per_diem_entries` feed invoice line item calculations
- `timesheet_expenses` with `needs_reimbursement = true` appear in accounts payable
- Approved timesheets trigger payroll-ready export with all compensation types
- `entity_tags` allow project-based cost aggregation across invoices, expenses, and timesheets

---

### 5.2 Documentation Management

**Purpose**: Central repository for contracts, SOPs, safety manuals, equipment specs, and regulatory documents.

**New tables:**

| Table | Purpose | Key Links |
|---|---|---|
| `document_folders` | Hierarchical folder structure | Self-referencing `parent_id` FK |
| `document_versions` | Version history for controlled documents | FK to `documents` (existing table) |
| `document_approvals` | Approval workflow for controlled documents | FK to `documents`, approval status + reviewer |

**Cross-domain connections:**
- The existing `documents` table already supports file attachment to any entity
- SOPs link to `training_requirements` (employees must read before certification)
- Equipment manuals link to `company_vehicles` by truck_id
- Contracts link to projects via `entity_tags`

---

### 5.3 Legal / Compliance

**Purpose**: DOT audit records, OSHA incident tracking, IFTA quarterly filing, FRA compliance.

**New tables:**

| Table | Purpose | Key Links |
|---|---|---|
| `compliance_audits` | DOT/OSHA/FRA audit records | Links to `training_records`, `timesheet_inspections`, `maintenance_events` |
| `safety_incidents` | Workplace incident reports | FK to `employee_profiles`, links to `work_orders` for corrective action |
| `ifta_quarterly_filings` | IFTA filing records with status tracking | Aggregates from `timesheet_ifta_entries` |
| `dot_inspection_results` | Roadside inspection records per vehicle | FK via `truck_id` to fleet data |

**Cross-domain connections:**
- IFTA filing is already 80% automated: `timesheet_ifta_entries` capture per-state miles and gallons weekly
- `timesheet_inspections` provide equipment inspection photo evidence for DOT audits
- `training_records` with `expiry_date` prove compliance status at any point in time
- `maintenance_events` with `next_due_date` demonstrate preventive maintenance programs

---

### 5.4 Inventory / Parts

**Purpose**: Parts tracking linked to maintenance work and expense purchasing.

**New tables:**

| Table | Purpose | Key Links |
|---|---|---|
| `parts_catalog` | Master list of parts with specs and suppliers | Referenced by `parts_inventory` |
| `parts_inventory` | Current stock levels and locations | FK to `parts_catalog` |
| `parts_transactions` | Check-in/check-out log | FK to `parts_inventory`, `work_orders`, `timesheet_maintenance_time` |
| `purchase_orders` | Parts ordering with approval | FK to `parts_catalog`, links to `accounts_payable` |

**Cross-domain connections:**
- `timesheet_maintenance_time.parts_used` (currently free text) links to `parts_catalog` entries
- `timesheet_expenses` with category "Parts" reconcile against `parts_transactions`
- `work_orders` reference specific parts needed (currently in description, would become FK)
- Low-stock alerts feed into `activity_feed` for visibility

---

### 5.5 Payroll Integration

**Purpose**: Timesheet data feeds payroll systems with all compensation types calculated.

**New tables:**

| Table | Purpose | Key Links |
|---|---|---|
| `payroll_periods` | Pay period definitions and status | Date ranges aligned with `timesheets.week_ending` |
| `payroll_summaries` | Calculated pay per employee per period | Aggregates from all timesheet sections |
| `payroll_exports` | Export records for external payroll system | FK to `payroll_periods`, tracks sent/confirmed status |

**Cross-domain connections:**
- Field hours from `timesheet_daily_logs`
- Shop hours from `timesheet_shop_time`
- Maintenance hours from `timesheet_maintenance_time`
- Per diem from `per_diem_entries`
- Mileage reimbursement from `timesheet_mileage_pay`
- Flight pay from `timesheet_flight_pay`
- Holiday pay from `timesheet_holiday_pay`
- Vacation pay from `timesheet_vacation_pay`
- Expense reimbursements from `timesheet_expenses` where `needs_reimbursement = true`

All of this data already exists in structured, queryable form. Payroll integration is primarily
a **reporting and export** problem, not a data capture problem.

---

### 5.6 Reporting / Analytics

**Purpose**: Cross-domain dashboards, KPI tracking, executive summaries.

**New tables:**

| Table | Purpose | Key Links |
|---|---|---|
| `report_definitions` | Saved report configurations | Stores query parameters, filters, visualization type |
| `report_schedules` | Automated report generation and delivery | FK to `report_definitions`, cron schedule, delivery method |
| `kpi_snapshots` | Daily/weekly KPI metric snapshots | Pre-computed aggregates for fast dashboard loading |

**Key reports enabled by existing data:**

| Report | Data Sources |
|---|---|
| Employee cost summary | `timesheets` + `per_diem_entries` + `timesheet_expenses` + all pay sections |
| Fleet health scorecard | `dtc_history` + `maintenance_events` + Viam sensor data |
| Training compliance matrix | `training_requirements` + `training_records` + `employee_profiles` |
| IFTA quarterly filing | `timesheet_ifta_entries` + `timesheets` |
| Project profitability | `entity_tags` + `invoices` + `timesheet_expenses` + `timesheet_daily_logs` |
| PTO utilization | `pto_balances` + `pto_requests` + `employee_profiles` |
| Expense trends by category | `timesheet_expenses` + `expense_categories` |

---

## 6. Security Model

### Role-Based Access Control

Four roles, managed in Clerk `publicMetadata.role`:

| Role | Scope | Examples |
|---|---|---|
| `developer` | Full system access, all admin panels | Andrew (platform builder) |
| `manager` | All data, approval workflows, admin panels | Corey, project managers |
| `mechanic` | Fleet access, own timesheets/PTO, team chat, AI diagnostics | Field mechanics |
| `operator` | Assigned trucks only, own timesheets/PTO, basic features | Truck operators |

### Route Permission Matrix

Permissions are enforced in the `ROUTE_PERMISSIONS` map (`packages/shared/src/auth.ts`).
Every API route and web page checks the user's role before allowing access.

| Category | Route Pattern | developer | manager | mechanic | operator |
|---|---|:---:|:---:|:---:|:---:|
| Fleet commands | `/api/plc-command`, `/api/truck-command` | Y | Y | Y | -- |
| AI features | `/api/ai-chat`, `/api/ai-diagnose` | Y | Y | Y | -- |
| Telemetry | `/api/sensor-readings`, `/api/truck-readings` | Y | Y | Y | Y |
| Fleet mgmt | `/api/fleet/*` | Y | Y | Y | Y |
| Timesheets (own) | `/api/timesheets` | Y | Y | Y | Y |
| Timesheets (admin) | `/api/timesheets/admin` | Y | Y | -- | -- |
| PTO (own) | `/api/pto` | Y | Y | Y | Y |
| PTO (admin) | `/api/pto/admin` | Y | Y | -- | -- |
| Training (own) | `/api/training` | Y | Y | Y | Y |
| Training (admin) | `/api/training/admin` | Y | Y | -- | -- |
| Push send | `/api/push/send` | Y | Y | -- | -- |
| Audit log | `/api/audit-log` | Y | Y | -- | -- |
| Dev panel | `/dev` | Y | -- | -- | -- |

### Data Isolation Rules

| Rule | Implementation |
|---|---|
| Operators see only assigned trucks | `truck_assignments` table filters fleet views; `canSeeAllTrucks()` returns false for operators |
| Users see own timesheets/PTO/profile | API routes filter by `user_id` from Clerk session |
| Managers see all timesheets/PTO | Admin routes (`/admin`) skip user_id filter for manager+ roles |
| Audit log restricted to manager+ | Route permission blocks mechanic and operator access |

### Service Key Isolation

| Key | Usage | Exposure |
|---|---|---|
| Supabase service_role key | Server-side only (Next.js API routes) | Never sent to browser or mobile app |
| Supabase anon key | Not used (all queries go through API routes) | N/A |
| Clerk publishable key | Client-side auth UI | Public by design |
| Clerk secret key | Server-side JWT verification | Server only |
| Viam credentials | Server-side sensor queries | Server only, proxied through API routes |

### Audit Trail

The `audit_log` table captures every sensitive action with full context:

```
Tracked actions (AuditAction type):
  dtc_clear             plc_command           role_change
  ai_diagnosis          ai_chat               note_created
  note_deleted          assignment_created    assignment_deleted
  maintenance_logged    maintenance_deleted   work_order_created
  work_order_updated    work_order_deleted    timesheet_created
  timesheet_updated     timesheet_submitted   timesheet_approved
  timesheet_rejected    profile_updated       profile_picture_uploaded
  pto_requested         pto_approved          pto_rejected
  pto_cancelled         training_recorded     training_deleted
  per_diem_rate_updated
```

Each entry records: `user_id`, `user_name`, `user_role`, `action`, `truck_id` (if applicable),
`details` (JSONB with action-specific context), `created_at`.

Audit writes are **fire-and-forget** -- they never block the primary operation and errors are
logged to console but never thrown to the user.

---

## 7. Infrastructure and Cost Strategy

### Current Stack

| Service | Role | Current Tier | Monthly Cost |
|---|---|---|---|
| **Supabase** | PostgreSQL, Storage, Realtime | Free | $0 |
| **Vercel** | Next.js hosting, serverless API routes | Pro | $20 |
| **Viam Cloud** | Sensor data capture, sync, Data API | Team | $0 (included) |
| **Clerk** | Authentication, user management, RBAC | Free | $0 |
| **Expo/EAS** | Mobile app builds (iOS + Android) | Free | $0 |
| | | **Total** | **~$20/mo** |

### Supabase Growth Path

| Metric | Free Tier | Pro ($25/mo) | Enterprise |
|---|---|---|---|
| Database size | 500 MB | 8 GB | Custom |
| Storage | 1 GB | 100 GB | Custom |
| Bandwidth | 2 GB | 250 GB | Custom |
| Realtime connections | 200 | 500 | Custom |
| Daily backups | 7 days | Point-in-time recovery | Custom |
| Row count (practical) | ~500K rows | ~10M+ rows | Unlimited |

Current usage is well within free tier. The transition to Pro is warranted when:
- Database exceeds 400 MB (~estimated at 50+ employees with 1 year of data)
- Storage exceeds 800 MB (receipt photos, inspection images, profile pictures)
- Point-in-time recovery becomes a business requirement

### Cost Projection by Company Size

| | 10 employees | 50 employees | 100 employees |
|---|---|---|---|
| **Supabase** | Free ($0) | Pro ($25) | Pro ($25) |
| **Vercel** | Pro ($20) | Pro ($20) | Pro ($20) |
| **Clerk** | Free ($0) | Free ($0) | Free ($0) |
| **Viam Cloud** | Team ($0) | Team ($0) | Team/custom |
| **Expo EAS** | Free ($0) | Production ($99) | Production ($99) |
| **Est. database size** | ~50 MB | ~500 MB | ~2 GB |
| **Est. storage** | ~200 MB | ~5 GB | ~20 GB |
| **Est. rows/year** | ~50K | ~500K | ~2M |
| **Total/month** | **~$20** | **~$144** | **~$144** |
| **Per employee/month** | $2.00 | $2.88 | $1.44 |

Note: Clerk free tier supports up to 10,000 monthly active users, which covers all realistic
company sizes. Viam Cloud costs depend on fleet size and capture frequency, not employee count.

### Where the Money Goes (and Doesn't)

| Expensive at scale | Why it stays cheap |
|---|---|
| Cloud storage (receipts, photos) | Supabase Storage is $0.021/GB beyond included tier |
| Database size | PostgreSQL is efficient; 2 GB supports 100 employees for years |
| API compute | Vercel serverless scales to zero; no idle cost |
| Auth | Clerk free tier is absurdly generous for B2B use cases |

The platform reaches $150/month at 50 employees. That is less than a single employee's
weekly per diem. The cost-per-insight ratio is effectively zero.

---

## 8. Scalability Considerations

### Database Performance

**Current indexing strategy** (already implemented):

Every table has targeted indexes on the most common query patterns:
- `user_id` indexes on all user-scoped tables (fast "my data" queries)
- `created_at DESC` indexes for timeline-ordered queries
- `status` indexes for workflow queries (draft/submitted/approved)
- Partial indexes where appropriate (e.g., `WHERE active = true`, `WHERE status != 'done'`)
- Composite indexes for common JOIN patterns (e.g., `(user_id, year)` on `pto_balances`)

**Future indexing needs:**

| When | What | Why |
|---|---|---|
| 1M+ activity_feed rows | Partition by `created_at` (monthly) | Activity feed grows fastest; partitioning keeps queries fast |
| 500K+ timesheet rows | Composite index on `(user_id, week_ending, status)` | Covers the most common admin query pattern |
| 100K+ documents | GIN index on `tags` JSONB column | Enables fast tag-based document search |
| Cross-domain reporting | Materialized views for KPI dashboards | Pre-compute expensive JOINs, refresh on schedule |

### JSONB Strategy

Several columns use JSONB for flexible metadata:

| Column | Table | Contents |
|---|---|---|
| `chase_vehicles` | `timesheets` | Array of vehicle number strings |
| `semi_trucks` | `timesheets` | Array of semi truck number strings |
| `coworkers` | `timesheets` | Array of `{id, name}` objects |
| `images` | `timesheet_railroad_timecards`, `timesheet_inspections` | Array of Supabase Storage URLs |
| `linked_dtcs` | `work_orders` | Array of `{spn, fmi, ecuLabel}` |
| `truck_snapshot` | `work_orders` | Full sensor readings at work order creation |
| `snapshot` | `chat_messages` | Sensor snapshot attached to message |
| `attachments` | `chat_messages` | Array of file attachment objects |
| `tags` | `documents` | Array of tag strings |
| `metadata` | `activity_feed` | Action-specific context (varies per action) |
| `details` | `audit_log` | Action-specific audit context |

**Design rule**: Use JSONB for truly flexible data (metadata, snapshots, arbitrary tags) where
the schema would change frequently. Use relational columns for data that is queried, filtered,
or JOINed regularly. The current schema follows this rule consistently.

### Caching Strategy

| Layer | Method | What |
|---|---|---|
| **Vercel ISR** | Incremental Static Regeneration | Fleet overview page (revalidate every 30s) |
| **Client-side** | React Query / SWR with stale-while-revalidate | Reference data (vehicles, expense categories, training requirements) |
| **Mobile** | Zustand stores with AsyncStorage persistence | Offline-capable timesheet drafts, cached truck data |
| **API-level** | Vercel Edge Cache headers | Static reference data (per diem rates, expense categories) |

---

## 9. Data Reliability and Backup

### Backup Strategy

| Layer | Method | Recovery Time |
|---|---|---|
| **Supabase (free)** | Automatic daily backups, 7-day retention | Hours (support request) |
| **Supabase (Pro)** | Point-in-time recovery, 7-day retention | Minutes (self-service) |
| **Viam Cloud** | Sensor data retained per organization policy | N/A (historical query API) |
| **Supabase Storage** | Replicated blob storage (S3-backed) | Automatic (built-in redundancy) |
| **Clerk** | Managed auth service with built-in redundancy | N/A (external service) |

### Offline-First Mobile Design

```
  Mobile App (Expo)
       |
       | User fills out timesheet offline
       v
  +----------------+
  | Zustand Store  |  <-- Persisted to AsyncStorage
  | (local state)  |      Draft survives app restart
  +-------+--------+
          |
          | When connectivity restored:
          v
  +-------+--------+
  | Sync Engine    |
  | - Retry queue  |
  | - Conflict     |
  |   resolution   |
  +-------+--------+
          |
          v
  +-------+--------+
  | Dashboard API  |
  +----------------+
```

**Key reliability patterns:**

| Pattern | Implementation |
|---|---|
| Idempotent writes | Timesheet `UNIQUE(user_id, week_ending)` prevents duplicate submissions |
| Optimistic updates | UI updates immediately, rolls back on server error |
| Retry with backoff | Failed API calls retry with exponential backoff |
| Conflict detection | `updated_at` timestamp comparison on write; reject stale updates |
| Offline sensor buffering | Pi writes to JSONL buffer (`~/.viam/offline-buffer/`, 50MB cap) when WiFi is down; Viam syncs automatically on reconnection |

### Audit Trail as Safety Net

The `audit_log` table serves as a secondary record of all state changes. Even if a row is
modified or deleted, the audit trail preserves what happened, who did it, and when. This is
especially critical for:

- Timesheet approvals (financial impact)
- DTC clears (safety-critical actions)
- Role changes (access control changes)
- PTO approvals (scheduling impact)

---

## 10. UI Architecture Considerations

### The Problem: Dashboard to OS

The current UI was designed as a **monitoring dashboard** -- header nav links across the top,
suited for a handful of pages. As IronSight grows into a Company OS with 15+ modules, the
header nav pattern breaks down:

- Too many links to fit in a horizontal bar
- No visual grouping of related modules
- No way to indicate the current module context
- Mobile web experience is cramped
- No room for user-level quick actions (notifications, profile, settings)

### Recommendation: Sidebar Navigation

The OS pattern used by Notion, Linear, Slack, and every enterprise SaaS product that manages
multiple domains within one application.

**Desktop layout:**

```
+--------+----------------------------------------------------------+
|        |  Breadcrumb: Operations > Timesheets > Week of 4/12      |
|  IRON  |----------------------------------------------------------|
|  SIGHT |                                                          |
|        |                                                          |
|  ------+|                     Main Content                        |
|        ||                                                         |
| Ops    ||  (Full width of remaining space)                        |
|  Fleet ||                                                         |
|  Work  ||  Tables, forms, dashboards, chat panels                 |
|  Time  ||  render here based on current route.                    |
|        ||                                                         |
| HR     ||                                                         |
|  Team  ||                                                         |
|  Train ||                                                         |
|  PTO   ||                                                         |
|        ||                                                         |
| Money  ||                                                         |
|  Expen ||                                                         |
|  Per D ||                                                         |
|        ||                                                         |
| Admin  ||                                                         |
|  Audit ||                                                         |
|  Dev   ||                                                         |
|        ||                                                         |
| -------+|                                                         |
| [Avatar]|                                                         |
| Andrew ||                                                         |
+--------+----------------------------------------------------------+
```

**Module groups:**

| Group | Modules | Roles |
|---|---|---|
| **Operations** | Fleet Monitor, Work Board, Timesheets | All (fleet restricted for operators) |
| **HR** | Team Directory, Training, PTO | All (admin views for manager+) |
| **Finance** | Expenses, Per Diem, (future: Invoicing, Bookkeeping) | All (admin views for manager+) |
| **Admin** | Audit Log, Settings, Dev Tools | Manager+ (Dev for developer only) |

**Sidebar behavior:**

| Screen size | Behavior |
|---|---|
| Desktop (>1024px) | Sidebar always visible, collapsible to icon-only rail |
| Tablet (768-1024px) | Sidebar collapsed to rail by default, expandable on hover/tap |
| Mobile web (<768px) | Sidebar hidden, accessible via hamburger menu |

### Mobile App (Expo): Bottom Tab Navigation

The native mobile app uses a different pattern than the web because of platform conventions.

```
+----------------------------------------------------------+
|                                                          |
|                     Screen Content                       |
|                                                          |
|  (Timesheet form, fleet view, work order details, etc.) |
|                                                          |
|                                                          |
+----------------------------------------------------------+
|  [Fleet]  [Work]  [Time]  [HR]  [More]                  |
+----------------------------------------------------------+
         Bottom tab bar (5 tabs max)
```

| Tab | Contains |
|---|---|
| Fleet | Fleet overview, truck detail, sensor data |
| Work | Work board, work order detail |
| Time | Timesheets, daily logs, expenses |
| HR | Profile, training, PTO |
| More | Chat, settings, per diem, audit (manager+) |

### Consistent Page Layout Template

Every page across both web and mobile should follow a consistent structure:

```
+----------------------------------------------------------+
| Page Header                                              |
|   Title + subtitle                                       |
|   Action buttons (New, Export, Filter)                   |
+----------------------------------------------------------+
| Filter Bar (optional)                                    |
|   Status filter | Date range | Search | Role filter     |
+----------------------------------------------------------+
|                                                          |
| Content Area                                             |
|   - Table view (list pages)                              |
|   - Form view (create/edit pages)                        |
|   - Detail view (single record pages)                    |
|   - Dashboard view (overview pages)                      |
|                                                          |
+----------------------------------------------------------+
```

### Platform Parity Strategy

| Capability | Web (Next.js) | Mobile (Expo) | Notes |
|---|---|---|---|
| Fleet monitoring | Full dashboard with gauges | Simplified card view | Mobile focuses on alerts, not continuous monitoring |
| Timesheets | Full form with all sections | Full form (scrollable) | Feature parity -- this is the primary mobile use case |
| Work orders | Kanban board + detail | List + detail | Board layout not practical on phone |
| Chat | Full thread list + messages | Full thread list + messages | Feature parity |
| Training | Status view + admin | Status view only | Admin management stays on desktop |
| PTO | Request + calendar | Request + list | Calendar view not practical on phone |
| Offline | N/A (always online) | Full offline draft support | Truck operators in the field need this |
| Push notifications | N/A | Full support | Critical alerts for DTC codes, approval requests |
| Photo capture | File upload | Native camera integration | Receipts, inspections, timecards |

### Android

The mobile app is built with Expo (React Native). Android support requires:

1. **EAS Build configuration** for Android (already supported by Expo)
2. **Platform-specific UI adjustments** (status bar, navigation bar, back button)
3. **Push notifications via FCM** (Expo handles the abstraction)
4. **Testing on physical devices** (Android emulator for development)

Expo's cross-platform abstraction means the vast majority of code is shared between iOS and
Android. The primary additional work is testing and any platform-specific edge cases in
camera access, file storage, and notification handling.

---

## Appendix: Table Count Summary

| Domain | Tables | Status |
|---|---|---|
| Fleet / Diagnostics | 5 | Deployed |
| Operations | 3 | Deployed |
| Timesheets | 12 | Deployed |
| HR | 3 | Deployed |
| Time Off | 2 | Deployed |
| Finance | 3 | Deployed |
| Communication | 5 | Deployed |
| Platform Infrastructure | 4 | Deployed |
| **Total (current)** | **37** | |
| | | |
| Financials / Bookkeeping | ~6 | Planned |
| Documentation Management | ~3 | Planned |
| Legal / Compliance | ~4 | Planned |
| Inventory / Parts | ~4 | Planned |
| Payroll Integration | ~3 | Planned |
| Reporting / Analytics | ~3 | Planned |
| **Total (planned)** | **~23** | |
| **Total (full OS)** | **~60** | |
