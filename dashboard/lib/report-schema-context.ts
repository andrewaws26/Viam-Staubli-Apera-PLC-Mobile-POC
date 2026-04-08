/**
 * report-schema-context.ts — Human-readable schema descriptions for AI SQL generation.
 *
 * This is the most critical file for the report generator. Claude uses this to
 * understand the database structure and generate correct SQL. Every table and
 * important column must be documented. Built by reading all 27+ migrations.
 *
 * Keep this file in sync with migrations — if you add a table, add it here.
 */

export const SCHEMA_CONTEXT = `
IronSight Database Schema — 65+ tables across fleet monitoring, operations, HR, and accounting.
All tables use UUID primary keys (gen_random_uuid()) and TIMESTAMPTZ for timestamps.
Use COALESCE for nullable numeric fields. Format dates with to_char(col, 'YYYY-MM-DD').

## Fleet & Monitoring

- fleet_trucks: Truck registry.
  Columns: id (UUID PK), truck_number (TEXT), name (TEXT), vin (TEXT), make (TEXT), model (TEXT), year (INT), status (TEXT: active/maintenance/decommissioned), viam_part_id (TEXT), created_at, updated_at

- sensor_readings: Real-time PLC and CAN bus telemetry snapshots (1 Hz).
  Columns: id (UUID PK), truck_id (TEXT), reading_type (TEXT: plc/j1939), readings (JSONB — keys vary by type), created_at
  JSONB keys for j1939: engine_rpm, coolant_temp_f, oil_pressure_psi, vehicle_speed_mph, fuel_level_pct, battery_voltage, intake_temp_f, boost_psi, oil_temp_f, engine_load_pct, etc.

- dtc_history: Diagnostic trouble codes detected on trucks.
  Columns: id (UUID PK), truck_id (TEXT), protocol (TEXT: j1939/obd2), code (TEXT), description (TEXT), severity (TEXT: info/warning/critical), spn (INT, J1939), fmi (INT, J1939), source_address (INT), detected_at (TIMESTAMPTZ), cleared_at (TIMESTAMPTZ), cleared_by (TEXT)

- maintenance_log: Maintenance work records.
  Columns: id (UUID PK), truck_id (TEXT), description (TEXT), category (TEXT), cost (NUMERIC), performed_by (TEXT), performed_at (TIMESTAMPTZ), created_at

- truck_notes: Free-form notes attached to trucks.
  Columns: id (UUID PK), truck_id (TEXT), user_id (TEXT), user_name (TEXT), content (TEXT), created_at

- truck_assignments: Which users are assigned to which trucks.
  Columns: id (UUID PK), truck_id (TEXT), user_id (TEXT), role (TEXT), assigned_at

## Work Orders

- work_orders: Maintenance and repair work orders.
  Columns: id (UUID PK), title (TEXT), description (TEXT), truck_id (TEXT), priority (TEXT: low/medium/high/urgent), status (TEXT: open/in_progress/completed/cancelled), assigned_to (TEXT), created_by (TEXT), due_date (DATE), completed_at (TIMESTAMPTZ), created_at, updated_at

- work_order_subtasks: Individual tasks within a work order.
  Columns: id (UUID PK), work_order_id (UUID FK->work_orders), title (TEXT), is_completed (BOOLEAN), completed_at (TIMESTAMPTZ), created_at

- work_order_notes: Comments/notes on work orders.
  Columns: id (UUID PK), work_order_id (UUID FK->work_orders), user_id (TEXT), user_name (TEXT), content (TEXT), created_at

## Team Chat

- chat_threads: Conversation threads anchored to entities.
  Columns: id (UUID PK), title (TEXT), entity_type (TEXT: truck/work_order/dtc/direct), entity_id (TEXT), created_by (TEXT), is_archived (BOOLEAN), created_at, updated_at

- chat_messages: Messages within threads.
  Columns: id (UUID PK), thread_id (UUID FK->chat_threads), user_id (TEXT), user_name (TEXT), content (TEXT), is_ai (BOOLEAN), sensor_snapshot (JSONB), is_deleted (BOOLEAN), created_at, updated_at

- chat_reactions: Emoji reactions on messages.
  Columns: id (UUID PK), message_id (UUID FK->chat_messages), user_id (TEXT), emoji (TEXT: thumbs_up/wrench/checkmark/eyes), created_at

- chat_thread_members: Thread membership.
  Columns: id (UUID PK), thread_id (UUID FK->chat_threads), user_id (TEXT), role (TEXT), joined_at

- message_reads: Read receipts.
  Columns: id (UUID PK), thread_id (UUID FK->chat_threads), user_id (TEXT), last_read_at (TIMESTAMPTZ)

## Timesheets & HR

- timesheets: Weekly timesheet headers.
  Columns: id (UUID PK), user_id (TEXT), week_ending (DATE), status (TEXT: draft/submitted/approved/rejected), railroad (TEXT), chase_vehicles (TEXT), semi_trucks (TEXT), work_location (TEXT), nights_out (INT), layovers (INT), co_workers (TEXT), notes (TEXT), submitted_at, approved_at, approved_by, rejected_reason, created_at, updated_at

- timesheet_daily_logs: Daily time entries within a timesheet.
  Columns: id (UUID PK), timesheet_id (UUID FK->timesheets), work_date (DATE), start_time (TEXT), end_time (TEXT), hours (NUMERIC), travel_hours (NUMERIC), description (TEXT), lunch_minutes (INT), semi_start_miles (NUMERIC), semi_end_miles (NUMERIC), created_at

- timesheet_railroad_time: Railroad-specific time entries.
  Columns: id (UUID PK), timesheet_id (UUID FK), work_date (DATE), railroad (TEXT), job_code (TEXT), hours (NUMERIC), description (TEXT)

- timesheet_railroad_timecards: Formal railroad timecard entries.
  Columns: id (UUID PK), timesheet_id (UUID FK), railroad (TEXT), timecard_number (TEXT), work_date (DATE), hours (NUMERIC), rate (NUMERIC)

- timesheet_inspections: Field inspection records.
  Columns: id (UUID PK), timesheet_id (UUID FK), inspection_date (DATE), type (TEXT), location (TEXT), result (TEXT), notes (TEXT)

- timesheet_ifta: Fuel tax tracking.
  Columns: id (UUID PK), timesheet_id (UUID FK), vehicle_id (UUID FK->company_vehicles), fuel_date (DATE), state (TEXT), gallons (NUMERIC), cost (NUMERIC), odometer_start (NUMERIC), odometer_end (NUMERIC)

- timesheet_expenses: Categorized expense line items.
  Columns: id (UUID PK), timesheet_id (UUID FK), expense_date (DATE), category (TEXT), description (TEXT), amount (NUMERIC), receipt_url (TEXT)

- timesheet_maintenance_time: Equipment maintenance hours.
  Columns: id (UUID PK), timesheet_id (UUID FK), work_date (DATE), equipment (TEXT), hours (NUMERIC), description (TEXT)

- timesheet_shop_time: In-shop work hours.
  Columns: id (UUID PK), timesheet_id (UUID FK), work_date (DATE), hours (NUMERIC), description (TEXT)

- timesheet_mileage_pay: Mileage-based compensation.
  Columns: id (UUID PK), timesheet_id (UUID FK), date (DATE), miles (NUMERIC), rate (NUMERIC), description (TEXT)

- timesheet_flight_pay: Travel flight compensation.
  Columns: id (UUID PK), timesheet_id (UUID FK), flight_date (DATE), amount (NUMERIC), description (TEXT)

- timesheet_holiday_pay: Holiday hours.
  Columns: id (UUID PK), timesheet_id (UUID FK), holiday_date (DATE), hours (NUMERIC), description (TEXT)

- timesheet_vacation_pay: Vacation hours.
  Columns: id (UUID PK), timesheet_id (UUID FK), vacation_date (DATE), hours (NUMERIC)

- company_vehicles: Company vehicle reference data.
  Columns: id (UUID PK), unit_number (TEXT), description (TEXT), vin (TEXT), license_plate (TEXT), is_active (BOOLEAN)

- employee_profiles: Employee HR data extending Clerk auth.
  Columns: id (UUID PK), user_id (TEXT UNIQUE), first_name (TEXT), last_name (TEXT), email (TEXT), phone (TEXT), hire_date (DATE), department (TEXT), job_title (TEXT), pay_type (TEXT: hourly/salary), pay_rate (NUMERIC), emergency_contact_name (TEXT), emergency_contact_phone (TEXT), picture_url (TEXT), created_at, updated_at

- training_requirements: Required certifications/training.
  Columns: id (UUID PK), name (TEXT), description (TEXT), validity_months (INT), is_active (BOOLEAN), created_at

- training_records: Employee training completion records.
  Columns: id (UUID PK), user_id (TEXT), requirement_id (UUID FK->training_requirements), completed_date (DATE), expiry_date (DATE), certificate_url (TEXT), recorded_by (TEXT), created_at

- pto_balances: PTO balance tracking per employee per type.
  Columns: id (UUID PK), user_id (TEXT), balance_type (TEXT: vacation/sick/personal), total_hours (NUMERIC), used_hours (NUMERIC), available_hours (NUMERIC), year (INT), created_at, updated_at

- pto_requests: PTO request workflow.
  Columns: id (UUID PK), user_id (TEXT), balance_type (TEXT), start_date (DATE), end_date (DATE), hours (NUMERIC), status (TEXT: pending/approved/rejected/cancelled), reason (TEXT), reviewer_id (TEXT), reviewed_at (TIMESTAMPTZ), created_at

- per_diem_rates: Per diem rates configuration.
  Columns: id (UUID PK), rate_type (TEXT), daily_rate (NUMERIC), effective_date (DATE), is_active (BOOLEAN), created_at

- per_diem_entries: Per diem payments linked to timesheets.
  Columns: id (UUID PK), user_id (TEXT), timesheet_id (UUID FK), nights (INT), layovers (INT), rate (NUMERIC), total_amount (NUMERIC), period_start (DATE), period_end (DATE), created_at

## Accounting & Finance

- chart_of_accounts: General ledger accounts.
  Columns: id (UUID PK), account_number (INT UNIQUE), name (TEXT), type (TEXT: asset/liability/equity/revenue/expense), sub_type (TEXT), description (TEXT), balance (NUMERIC default 0), is_active (BOOLEAN), created_at, updated_at

- journal_entries: Double-entry bookkeeping journal entries.
  Columns: id (UUID PK), entry_number (TEXT), entry_date (DATE), description (TEXT), source (TEXT: manual/invoice/bill/payroll/per_diem/expense/depreciation/cc_posting/disposal), status (TEXT: draft/posted/voided), reference (TEXT), void_reason (TEXT), voided_at (TIMESTAMPTZ), posted_at (TIMESTAMPTZ), posted_by (TEXT), created_by (TEXT), created_at, updated_at

- journal_entry_lines: Individual debit/credit lines on journal entries.
  Columns: id (UUID PK), entry_id (UUID FK->journal_entries), account_id (UUID FK->chart_of_accounts), description (TEXT), debit (NUMERIC default 0), credit (NUMERIC default 0), created_at

- accounting_periods: Fiscal period close/lock management.
  Columns: id (UUID PK), period_name (TEXT), start_date (DATE), end_date (DATE), status (TEXT: open/closed/locked), closed_by (TEXT), closed_at (TIMESTAMPTZ), created_at

- recurring_journal_entries: Template entries for auto-generation.
  Columns: id (UUID PK), name (TEXT), description (TEXT), frequency (TEXT: daily/weekly/monthly/quarterly/yearly), next_run_date (DATE), end_date (DATE), is_active (BOOLEAN), template_lines (JSONB), last_generated_at (TIMESTAMPTZ), created_by (TEXT), created_at

- customers: Customer records for AR/invoicing.
  Columns: id (UUID PK), company_name (TEXT), contact_name (TEXT), email (TEXT), phone (TEXT), address (TEXT), city (TEXT), state (TEXT), zip (TEXT), payment_terms (TEXT: net_30/net_60/due_on_receipt), tax_id (TEXT), is_active (BOOLEAN), notes (TEXT), created_at, updated_at

- vendors: Vendor records for AP/bills.
  Columns: id (UUID PK), company_name (TEXT), contact_name (TEXT), email (TEXT), phone (TEXT), address (TEXT), city (TEXT), state (TEXT), zip (TEXT), payment_terms (TEXT), tax_id (TEXT), is_1099 (BOOLEAN), default_expense_account_id (UUID FK), is_active (BOOLEAN), notes (TEXT), created_at, updated_at

- invoices: Accounts receivable invoices.
  Columns: id (UUID PK), invoice_number (INT), customer_id (UUID FK->customers), invoice_date (DATE), due_date (DATE), status (TEXT: draft/sent/partial/paid/overdue/voided), subtotal (NUMERIC), tax_amount (NUMERIC), total_amount (NUMERIC), amount_paid (NUMERIC), balance_due (NUMERIC), notes (TEXT), journal_entry_id (UUID FK), created_by (TEXT), created_at, updated_at

- invoice_line_items: Line items on invoices.
  Columns: id (UUID PK), invoice_id (UUID FK->invoices), description (TEXT), quantity (NUMERIC), unit_price (NUMERIC), amount (NUMERIC), account_id (UUID FK->chart_of_accounts), created_at

- invoice_payments: Payments received against invoices.
  Columns: id (UUID PK), invoice_id (UUID FK->invoices), payment_date (DATE), amount (NUMERIC), method (TEXT: check/ach/wire/cash/credit_card), reference (TEXT), journal_entry_id (UUID FK), created_at

- bills: Accounts payable bills from vendors.
  Columns: id (UUID PK), bill_number (TEXT), vendor_id (UUID FK->vendors), bill_date (DATE), due_date (DATE), status (TEXT: draft/entered/partial/paid/overdue/voided), subtotal (NUMERIC), tax_amount (NUMERIC), total_amount (NUMERIC), amount_paid (NUMERIC), balance_due (NUMERIC), notes (TEXT), journal_entry_id (UUID FK), created_by (TEXT), created_at, updated_at

- bill_line_items: Line items on bills.
  Columns: id (UUID PK), bill_id (UUID FK->bills), description (TEXT), quantity (NUMERIC), unit_price (NUMERIC), amount (NUMERIC), account_id (UUID FK->chart_of_accounts), created_at

- bill_payments: Payments made against bills.
  Columns: id (UUID PK), bill_id (UUID FK->bills), payment_date (DATE), amount (NUMERIC), method (TEXT), reference (TEXT), journal_entry_id (UUID FK), created_at

- bank_accounts: Company bank accounts.
  Columns: id (UUID PK), name (TEXT), account_number_last4 (TEXT), bank_name (TEXT), account_type (TEXT: checking/savings), gl_account_id (UUID FK->chart_of_accounts), current_balance (NUMERIC), is_active (BOOLEAN), created_at

- bank_transactions: Imported or manual bank transactions.
  Columns: id (UUID PK), bank_account_id (UUID FK->bank_accounts), transaction_date (DATE), description (TEXT), amount (NUMERIC), type (TEXT: debit/credit), reference (TEXT), is_reconciled (BOOLEAN), reconciliation_id (UUID FK), matched_entry_id (UUID FK), category (TEXT), import_hash (TEXT UNIQUE), created_at

- reconciliation_sessions: Bank reconciliation sessions.
  Columns: id (UUID PK), bank_account_id (UUID FK), statement_date (DATE), statement_balance (NUMERIC), status (TEXT: in_progress/completed), completed_at (TIMESTAMPTZ), completed_by (TEXT), created_at

- employee_tax_profiles: W-4 and payroll tax config per employee.
  Columns: id (UUID PK), user_id (TEXT UNIQUE), filing_status (TEXT: single/married_jointly/head_of_household), allowances (INT), additional_withholding (NUMERIC), is_exempt (BOOLEAN), state_filing_status (TEXT), state_allowances (INT), workers_comp_class_id (UUID FK), created_at, updated_at

- tax_rate_tables: Federal/state/FICA tax brackets and rates.
  Columns: id (UUID PK), tax_type (TEXT: federal/state/social_security/medicare/futa/suta), filing_status (TEXT), bracket_min (NUMERIC), bracket_max (NUMERIC), rate (NUMERIC), flat_amount (NUMERIC), effective_year (INT), jurisdiction (TEXT), created_at

- payroll_runs: Payroll batch processing.
  Columns: id (UUID PK), pay_period_start (DATE), pay_period_end (DATE), pay_date (DATE), status (TEXT: draft/approved/posted), total_gross (NUMERIC), total_net (NUMERIC), total_employer_tax (NUMERIC), journal_entry_id (UUID FK), approved_by (TEXT), approved_at (TIMESTAMPTZ), created_by (TEXT), created_at

- payroll_run_lines: Individual employee payroll records per run.
  Columns: id (UUID PK), payroll_run_id (UUID FK->payroll_runs), user_id (TEXT), employee_name (TEXT), gross_pay (NUMERIC), federal_tax (NUMERIC), state_tax (NUMERIC), social_security_ee (NUMERIC), medicare_ee (NUMERIC), social_security_er (NUMERIC), medicare_er (NUMERIC), futa (NUMERIC), suta (NUMERIC), additional_withholding (NUMERIC), net_pay (NUMERIC), hours_worked (NUMERIC), pay_rate (NUMERIC), ytd_gross (NUMERIC), ytd_ss_wages (NUMERIC), created_at

- benefit_plans: Company benefit plans.
  Columns: id (UUID PK), name (TEXT), type (TEXT: health/dental/vision/401k/hsa/life/disability), employer_contribution (NUMERIC), employee_contribution (NUMERIC), is_active (BOOLEAN), created_at

- employee_benefits: Employee benefit enrollment.
  Columns: id (UUID PK), user_id (TEXT), benefit_plan_id (UUID FK->benefit_plans), enrollment_date (DATE), status (TEXT: active/terminated), created_at

- workers_comp_classes: Workers comp classification codes.
  Columns: id (UUID PK), class_code (TEXT), description (TEXT), rate_per_100 (NUMERIC), effective_date (DATE), is_active (BOOLEAN), created_at

- budgets: Budget amounts by account and period.
  Columns: id (UUID PK), fiscal_year (INT), account_id (UUID FK->chart_of_accounts), period (TEXT: q1/q2/q3/q4 or month names), budgeted_amount (NUMERIC), notes (TEXT), created_by (TEXT), created_at, updated_at

- fixed_assets: Capital asset register.
  Columns: id (UUID PK), name (TEXT), description (TEXT), acquisition_date (DATE), acquisition_cost (NUMERIC), useful_life_months (INT), salvage_value (NUMERIC), depreciation_method (TEXT: straight_line/declining_balance/sum_of_years), asset_account_id (UUID FK->chart_of_accounts), depreciation_account_id (UUID FK), accumulated_depreciation_account_id (UUID FK), status (TEXT: active/disposed/fully_depreciated), disposed_at (TIMESTAMPTZ), disposal_amount (NUMERIC), serial_number (TEXT), location (TEXT), created_by (TEXT), created_at, updated_at

- depreciation_entries: Depreciation calculation records.
  Columns: id (UUID PK), fixed_asset_id (UUID FK->fixed_assets), depreciation_date (DATE), amount (NUMERIC), book_value_after (NUMERIC), journal_entry_id (UUID FK), created_at

- estimates: Estimates/quotes sent to customers.
  Columns: id (UUID PK), estimate_number (TEXT), customer_id (UUID FK->customers), estimate_date (DATE), expiry_date (DATE), status (TEXT: draft/sent/accepted/rejected/expired/converted/voided), subtotal (NUMERIC), tax_amount (NUMERIC), total_amount (NUMERIC), notes (TEXT), converted_invoice_id (UUID FK), created_by (TEXT), created_at, updated_at

- estimate_line_items: Line items on estimates.
  Columns: id (UUID PK), estimate_id (UUID FK->estimates), description (TEXT), quantity (NUMERIC), unit_price (NUMERIC), amount (NUMERIC), created_at

- expense_categorization_rules: Auto-categorization rules for CC transactions.
  Columns: id (UUID PK), name (TEXT), match_type (TEXT: contains/starts_with/exact/regex), match_pattern (TEXT), gl_account_id (UUID FK->chart_of_accounts), priority (INT), is_active (BOOLEAN), created_at

- credit_card_accounts: Company credit card accounts.
  Columns: id (UUID PK), name (TEXT), last_four (TEXT), gl_account_id (UUID FK), is_active (BOOLEAN), created_at

- credit_card_transactions: Imported CC transactions.
  Columns: id (UUID PK), credit_card_account_id (UUID FK), transaction_date (DATE), description (TEXT), amount (NUMERIC), category (TEXT), gl_account_id (UUID FK), status (TEXT: pending/categorized/posted/excluded), import_hash (TEXT UNIQUE), journal_entry_id (UUID FK), created_at

- mileage_rates: IRS mileage reimbursement rates.
  Columns: id (UUID PK), effective_date (DATE), rate_per_mile (NUMERIC), rate_type (TEXT: standard/medical/charitable/custom), description (TEXT), is_active (BOOLEAN), created_at

- payment_reminders: Invoice payment reminder tracking.
  Columns: id (UUID PK), invoice_id (UUID FK->invoices), reminder_type (TEXT: upcoming/overdue_7/overdue_30/overdue_60/overdue_90/final_notice), scheduled_date (DATE), sent_at (TIMESTAMPTZ), status (TEXT: pending/sent/skipped/cancelled), notes (TEXT), created_by (TEXT), created_at

- sales_tax_rates: Tax rate configuration.
  Columns: id (UUID PK), name (TEXT), jurisdiction (TEXT), rate (NUMERIC), tax_type (TEXT: sales/use/excise/other), applies_to (TEXT: all/goods/services/specific), is_active (BOOLEAN), effective_date (DATE), expiration_date (DATE), created_at

- sales_tax_exemptions: Customer tax exemptions.
  Columns: id (UUID PK), customer_id (UUID FK->customers), exemption_type (TEXT: resale/government/nonprofit/railroad/manufacturing/other), certificate_number (TEXT), effective_date (DATE), expiration_date (DATE), notes (TEXT), is_active (BOOLEAN), created_at

- sales_tax_collected: Tax amounts collected on invoices.
  Columns: id (UUID PK), invoice_id (UUID FK), tax_rate_id (UUID FK), taxable_amount (NUMERIC), tax_amount (NUMERIC), period_date (DATE), status (TEXT: collected/filed/remitted), created_at

- saved_reports: AI-generated report definitions.
  Columns: id (UUID PK), created_by (TEXT), created_by_name (TEXT), name (TEXT), description (TEXT), prompt (TEXT), generated_sql (TEXT), is_shared (BOOLEAN), category (TEXT), last_run_at (TIMESTAMPTZ), run_count (INT), created_at, updated_at

## Platform

- audit_log: System-wide audit trail.
  Columns: id (UUID PK), user_id (TEXT), user_name (TEXT), user_role (TEXT), action (TEXT), truck_id (TEXT), details (JSONB), created_at

- documents: Polymorphic file attachments.
  Columns: id (UUID PK), entity_type (TEXT), entity_id (TEXT), file_name (TEXT), file_url (TEXT), file_size (INT), mime_type (TEXT), uploaded_by (TEXT), created_at

- activity_feed: Unified activity timeline.
  Columns: id (UUID PK), entity_type (TEXT), entity_id (TEXT), action (TEXT), user_id (TEXT), user_name (TEXT), details (JSONB), created_at

- entity_tags: Cross-domain tagging.
  Columns: id (UUID PK), entity_type (TEXT), entity_id (TEXT), tag (TEXT), created_at

- expense_categories: Reference data for expense tracking.
  Columns: id (UUID PK), name (TEXT), gl_account_id (UUID FK), is_active (BOOLEAN), created_at

- inventory_items: Inventory item master.
  Columns: id (UUID PK), sku (TEXT), name (TEXT), description (TEXT), category (TEXT), unit_of_measure (TEXT), unit_cost (NUMERIC), quantity_on_hand (NUMERIC), reorder_point (NUMERIC), location (TEXT), gl_asset_account_id (UUID FK), gl_expense_account_id (UUID FK), is_active (BOOLEAN), created_at, updated_at

- inventory_transactions: Inventory movement records.
  Columns: id (UUID PK), item_id (UUID FK->inventory_items), transaction_type (TEXT: receive/issue/adjust/transfer), quantity (NUMERIC), unit_cost (NUMERIC), reference (TEXT), notes (TEXT), work_order_id (UUID FK), truck_id (TEXT), created_by (TEXT), created_at

## Key Relationships
- timesheets.user_id = employee_profiles.user_id (TEXT, Clerk user ID)
- invoices.customer_id = customers.id (UUID)
- bills.vendor_id = vendors.id (UUID)
- journal_entry_lines.account_id = chart_of_accounts.id (UUID)
- payroll_run_lines.user_id = employee_profiles.user_id (TEXT)
- work_orders.truck_id = fleet_trucks.id::TEXT (cast needed)
- dtc_history.truck_id = fleet_trucks.id::TEXT (cast needed)
- Per diem entries link to timesheets via timesheet_id

## Important Notes for SQL Generation
- User IDs are TEXT (Clerk format: "user_xxx"), not UUIDs
- truck_id in sensor_readings, dtc_history, work_orders is TEXT
- fleet_trucks.id is UUID — cast to TEXT when joining with truck_id fields
- Use COALESCE(col, 0) for nullable numeric aggregations
- Use to_char(date_col, 'YYYY-MM-DD') for readable date output
- Always include LIMIT 500 unless the user asks for all results
- customers table uses company_name (not name)
- vendors table uses company_name (not name)
`;

export const EXAMPLE_QUERIES = `
Example prompt-to-SQL pairs:

User: "Show me all trucks that had DTCs in the last 30 days"
SQL:
SELECT ft.truck_number, ft.name, COUNT(dh.id) as dtc_count,
       MAX(to_char(dh.detected_at, 'YYYY-MM-DD HH24:MI')) as most_recent_dtc
FROM fleet_trucks ft
JOIN dtc_history dh ON dh.truck_id = ft.id::text
WHERE dh.detected_at > now() - interval '30 days'
GROUP BY ft.id, ft.truck_number, ft.name
ORDER BY dtc_count DESC LIMIT 500

User: "Which employees have pending timesheets?"
SQL:
SELECT ep.first_name, ep.last_name, to_char(t.week_ending, 'YYYY-MM-DD') as week_ending, t.status, to_char(t.created_at, 'YYYY-MM-DD') as created
FROM timesheets t
JOIN employee_profiles ep ON ep.user_id = t.user_id
WHERE t.status = 'submitted'
ORDER BY t.week_ending DESC LIMIT 500

User: "Show total invoiced vs. total paid by customer"
SQL:
SELECT c.company_name as customer,
       COALESCE(SUM(i.total_amount), 0) as total_invoiced,
       COALESCE(SUM(i.amount_paid), 0) as total_paid,
       COALESCE(SUM(i.balance_due), 0) as outstanding
FROM customers c
LEFT JOIN invoices i ON i.customer_id = c.id AND i.status != 'voided'
GROUP BY c.id, c.company_name
ORDER BY outstanding DESC LIMIT 500

User: "Compare overtime hours by employee for March 2026"
SQL:
SELECT ep.first_name || ' ' || ep.last_name as employee,
       SUM(tdl.hours) as total_hours,
       SUM(CASE WHEN tdl.hours > 8 THEN tdl.hours - 8 ELSE 0 END) as overtime_hours
FROM timesheet_daily_logs tdl
JOIN timesheets t ON t.id = tdl.timesheet_id
JOIN employee_profiles ep ON ep.user_id = t.user_id
WHERE t.status = 'approved'
  AND tdl.work_date >= '2026-03-01' AND tdl.work_date < '2026-04-01'
GROUP BY ep.first_name, ep.last_name
ORDER BY overtime_hours DESC LIMIT 500

User: "Show overdue invoices over $5,000"
SQL:
SELECT i.invoice_number, c.company_name as customer,
       to_char(i.due_date, 'YYYY-MM-DD') as due_date,
       i.total_amount, i.balance_due,
       (CURRENT_DATE - i.due_date) as days_overdue
FROM invoices i
JOIN customers c ON c.id = i.customer_id
WHERE i.status IN ('sent', 'overdue', 'partial')
  AND i.due_date < CURRENT_DATE
  AND i.balance_due > 5000
ORDER BY days_overdue DESC LIMIT 500
`;
