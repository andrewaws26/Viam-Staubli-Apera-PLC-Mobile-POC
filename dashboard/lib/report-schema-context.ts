/**
 * report-schema-context.ts — Exact database schema for AI SQL generation.
 *
 * CRITICAL: Every column name here MUST match the actual CREATE TABLE statements
 * in dashboard/supabase/migrations/. If you add or alter a table, update this file.
 *
 * This is verified by automated tests in report-generator.test.ts.
 */

export const SCHEMA_CONTEXT = `
IronSight Database Schema (PostgreSQL / Supabase).
All tables use UUID primary keys (gen_random_uuid()) and TIMESTAMPTZ for timestamps unless noted.
Use COALESCE for nullable numeric fields. Format dates with to_char(col, 'YYYY-MM-DD').

## Fleet & Monitoring

- fleet_trucks: Truck registry. Created outside migrations.
  Columns: id (TEXT PK — truck number string, NOT UUID), name (TEXT), vin (TEXT), year (INT), make (TEXT), model (TEXT), license_plate (TEXT), viam_part_id (TEXT), viam_machine_address (TEXT), home_base (TEXT), status (TEXT: active/inactive/maintenance/decommissioned), has_tps (BOOLEAN), has_cell (BOOLEAN), has_j1939 (BOOLEAN), notes (TEXT), created_at, updated_at
  NOTE: fleet_trucks.id is TEXT (e.g. "01", "02"), NOT UUID. No cast needed when joining with other truck_id TEXT fields.

- dtc_history: Diagnostic trouble codes detected on trucks. (Migration 002)
  Columns: id (UUID PK), truck_id (TEXT), spn (INT — Suspect Parameter Number), fmi (INT — Failure Mode Identifier), source_address (INT), description (TEXT), occurrence_count (INT DEFAULT 1), first_seen_at (TIMESTAMPTZ), last_seen_at (TIMESTAMPTZ), cleared_at (TIMESTAMPTZ — null means still active), active (BOOLEAN DEFAULT true), created_at
  NOTE: There is NO "code" column. DTC codes are identified by (spn, fmi) pair. To display a code string, use: 'SPN ' || spn || ' FMI ' || fmi

- maintenance_events: Maintenance work records. (Migration 002)
  Columns: id (UUID PK), truck_id (TEXT), event_type (TEXT: oil_change/filter_replace/def_fill/tire_rotation/brake_inspection/general_service/coolant_flush/belt_replace/battery_replace/other), description (TEXT), mileage (INT — odometer), engine_hours (NUMERIC), performed_by (TEXT — person name), performed_at (TIMESTAMPTZ), next_due_mileage (INT), next_due_date (TIMESTAMPTZ), created_by (TEXT — clerk user id), created_at
  NOTE: Table is named maintenance_events, NOT maintenance_log.

- truck_notes: Free-form notes attached to trucks. (Migration 001)
  Columns: id (UUID PK), truck_id (TEXT), author_id (TEXT — clerk user id), author_name (TEXT), author_role (TEXT), body (TEXT), created_at
  NOTE: Uses author_id/author_name/body, NOT user_id/user_name/content.

- truck_assignments: Which users are assigned to which trucks. (Migration 001)
  Columns: id (UUID PK), user_id (TEXT), user_name (TEXT), user_role (TEXT), truck_id (TEXT), assigned_by (TEXT), assigned_at (TIMESTAMPTZ)
  CONSTRAINT: UNIQUE(user_id, truck_id)

## Work Orders (Migration 003)

- work_orders: Maintenance and repair work orders.
  Columns: id (UUID PK), truck_id (TEXT), title (TEXT NOT NULL), description (TEXT), status (TEXT DEFAULT 'open': open/in_progress/blocked/done), priority (TEXT DEFAULT 'normal': low/normal/urgent), blocker_reason (TEXT), assigned_to (TEXT — clerk user id), assigned_to_name (TEXT), created_by (TEXT NOT NULL), created_by_name (TEXT NOT NULL), truck_snapshot (JSONB), linked_dtcs (JSONB DEFAULT '[]'), due_date (TIMESTAMPTZ), completed_at (TIMESTAMPTZ), created_at, updated_at
  NOTE: Status values are open/in_progress/blocked/done (NOT completed/cancelled). Priority values are low/normal/urgent (NOT medium/high).

- work_order_subtasks: Individual tasks within a work order.
  Columns: id (UUID PK), work_order_id (UUID FK), title (TEXT), is_done (BOOLEAN), sort_order (INT), created_at
  NOTE: Uses is_done, NOT is_completed. No completed_at column.

- work_order_notes: Comments on work orders.
  Columns: id (UUID PK), work_order_id (UUID FK), author_id (TEXT), author_name (TEXT), body (TEXT), created_at
  NOTE: Uses author_id/author_name/body, NOT user_id/user_name/content.

## Team Chat (Migration 004)

- chat_threads: Conversation threads anchored to entities.
  Columns: id (UUID PK), entity_type (TEXT: truck/work_order/dtc/direct), entity_id (TEXT), title (TEXT), created_by (TEXT), pinned_message_id (UUID FK), deleted_at (TIMESTAMPTZ), created_at
  NOTE: Uses deleted_at for soft-delete, NOT is_archived.

- chat_messages: Messages within threads.
  Columns: id (UUID PK), thread_id (UUID FK), sender_id (TEXT), sender_name (TEXT), sender_role (TEXT), message_type (TEXT), body (TEXT), snapshot (JSONB — sensor snapshot), attachments (JSONB), edited_at (TIMESTAMPTZ), deleted_at (TIMESTAMPTZ), created_at
  NOTE: Uses sender_id/sender_name/body, NOT user_id/user_name/content. Uses snapshot, NOT sensor_snapshot. No is_ai or is_deleted boolean.

- chat_reactions: Reactions on messages.
  Columns: id (UUID PK), message_id (UUID FK), user_id (TEXT), reaction (TEXT: thumbs_up/wrench/checkmark/eyes), created_at
  CONSTRAINT: UNIQUE(message_id, user_id, reaction)
  NOTE: Column is "reaction", NOT "emoji".

- chat_thread_members: Thread membership.
  Columns: id (UUID PK), thread_id (UUID FK), user_id (TEXT), role (TEXT), last_read_at (TIMESTAMPTZ), joined_at (TIMESTAMPTZ)
  CONSTRAINT: UNIQUE(thread_id, user_id)

- message_reads: Read receipts.
  Columns: id (UUID PK), message_id (UUID FK), reader_id (TEXT), read_at (TIMESTAMPTZ)
  CONSTRAINT: UNIQUE(message_id, reader_id)
  NOTE: Uses reader_id, NOT user_id. Uses read_at, NOT last_read_at.

## Timesheets & HR

- timesheets: Weekly timesheet headers. (Migration 005 + 007)
  Columns: id (UUID PK), user_id (TEXT), user_name (TEXT), user_email (TEXT), week_ending (DATE), status (TEXT: draft/submitted/approved/rejected), railroad_working_on (TEXT), chase_vehicles (JSONB), semi_trucks (JSONB), work_location (TEXT), nights_out (INT), layovers (INT), coworkers (JSONB), notes (TEXT), norfolk_southern_job_code (TEXT), ifta_odometer_start (NUMERIC), ifta_odometer_end (NUMERIC), submitted_at (TIMESTAMPTZ), approved_by (TEXT), approved_by_name (TEXT), approved_at (TIMESTAMPTZ), rejection_reason (TEXT), created_at, updated_at
  CONSTRAINT: UNIQUE(user_id, week_ending)
  NOTE: Uses railroad_working_on (NOT railroad), coworkers as JSONB (NOT co_workers TEXT), rejection_reason (NOT rejected_reason).

- timesheet_daily_logs: Daily time entries. (Migration 005 + 007)
  Columns: id (UUID PK), timesheet_id (UUID FK), log_date (DATE), start_time (TEXT), end_time (TEXT), hours_worked (NUMERIC), travel_hours (NUMERIC), description (TEXT), sort_order (INT), lunch_minutes (INT), semi_truck_travel (TEXT), traveling_from (TEXT), destination (TEXT), travel_miles (NUMERIC), created_at
  NOTE: Uses log_date (NOT work_date), hours_worked (NOT hours).

- timesheet_railroad_timecards: Railroad timecard entries. (Migration 007)
  Columns: id (UUID PK), timesheet_id (UUID FK), railroad (TEXT), track_supervisor (TEXT), division_engineer (TEXT), images (JSONB), created_at

- timesheet_inspections: Field inspection records. (Migration 007)
  Columns: id (UUID PK), timesheet_id (UUID FK), inspection_time (TEXT), images (JSONB), notes (TEXT), created_at

- timesheet_ifta_entries: Fuel tax tracking. (Migration 007)
  Columns: id (UUID PK), timesheet_id (UUID FK), state_code (TEXT), reportable_miles (NUMERIC), gallons_purchased (NUMERIC), created_at
  NOTE: Table is timesheet_ifta_entries, NOT timesheet_ifta.

- timesheet_expenses: Expense line items. (Migration 007)
  Columns: id (UUID PK), timesheet_id (UUID FK), expense_date (DATE), amount (NUMERIC), category (TEXT: Fuel/Safety Gear/Repairs/Parts/Parking/Lodging/Travel/Supplies/Other), description (TEXT), needs_reimbursement (BOOLEAN), payment_type (TEXT), receipt_image_url (TEXT), is_fuel (BOOLEAN), fuel_vehicle_type (TEXT), fuel_vehicle_number (TEXT), odometer_image_url (TEXT), created_at

- timesheet_maintenance_time: Equipment maintenance hours. (Migration 007)
  Columns: id (UUID PK), timesheet_id (UUID FK), log_date (DATE), start_time (TEXT), stop_time (TEXT), hours_worked (NUMERIC), description (TEXT), parts_used (TEXT), created_at

- timesheet_shop_time: In-shop work hours. (Migration 007)
  Columns: id (UUID PK), timesheet_id (UUID FK), log_date (DATE), start_time (TEXT), stop_time (TEXT), lunch_minutes (INT), hours_worked (NUMERIC), created_at

- timesheet_mileage_pay: Mileage-based compensation. (Migration 007)
  Columns: id (UUID PK), timesheet_id (UUID FK), log_date (DATE), traveling_from (TEXT), destination (TEXT), miles (NUMERIC), chase_vehicle (TEXT), description (TEXT), created_at

- timesheet_flight_pay: Travel flight compensation. (Migration 007)
  Columns: id (UUID PK), timesheet_id (UUID FK), log_date (DATE), traveling_from (TEXT), destination (TEXT), created_at

- timesheet_holiday_pay: Holiday hours. (Migration 007)
  Columns: id (UUID PK), timesheet_id (UUID FK), holiday_date (DATE), created_at

- timesheet_vacation_pay: Vacation hours. (Migration 007)
  Columns: id (UUID PK), timesheet_id (UUID FK), start_date (DATE), end_date (DATE), hours_per_day (NUMERIC), total_hours (NUMERIC), created_at

- company_vehicles: Company vehicle reference data. (Migration 005, seeded by 033)
  Columns: id (UUID PK), vehicle_number (TEXT UNIQUE), vehicle_type (TEXT: chase/semi/other), is_active (BOOLEAN), created_at
  NOTE: Seeded with real B&B Metals fleet — 40 chase vehicles (#4, #6, #12 ... #55 a, Rental Car) and 41 semi trucks (T-16 through T-59). Vehicle numbers are the actual fleet identifiers used in timesheets. Chase vehicles use '#' prefix (e.g. '#4'), semis use 'T-' prefix (e.g. 'T-16').

- employee_profiles: Employee HR data extending Clerk auth. (Migration 006)
  Columns: id (UUID PK), user_id (TEXT UNIQUE), user_name (TEXT), user_email (TEXT), phone (TEXT), emergency_contact_name (TEXT), emergency_contact_phone (TEXT), hire_date (DATE), job_title (TEXT), department (TEXT), profile_picture_url (TEXT), created_at, updated_at
  NOTE: Uses user_name (NOT first_name/last_name). Uses profile_picture_url (NOT picture_url). No pay_type or pay_rate columns — those are in employee_tax_profiles.

- training_requirements: Required certifications. (Migration 006)
  Columns: id (UUID PK), name (TEXT UNIQUE), description (TEXT), frequency_months (INT), is_required (BOOLEAN), is_active (BOOLEAN), created_at
  NOTE: Uses frequency_months (NOT validity_months). Has is_required field.

- training_records: Employee training completion records. (Migration 006)
  Columns: id (UUID PK), user_id (TEXT), user_name (TEXT), requirement_id (UUID FK), completed_date (DATE), expiry_date (DATE), certificate_url (TEXT), notes (TEXT), recorded_by (TEXT), recorded_by_name (TEXT), created_at

- pto_balances: PTO balance tracking per employee per year. (Migration 006 + 011)
  Columns: id (UUID PK), user_id (TEXT), year (INT), vacation_hours_total (NUMERIC), vacation_hours_used (NUMERIC), sick_hours_total (NUMERIC), sick_hours_used (NUMERIC), personal_hours_total (NUMERIC), personal_hours_used (NUMERIC), user_name (TEXT), created_at, updated_at
  CONSTRAINT: UNIQUE(user_id, year)
  NOTE: Uses individual type columns (vacation/sick/personal), NOT a generic balance_type column. To get available hours: vacation_hours_total - vacation_hours_used.

- pto_requests: PTO request workflow. (Migration 006)
  Columns: id (UUID PK), user_id (TEXT), user_name (TEXT), user_email (TEXT), request_type (TEXT: vacation/sick/personal/bereavement/other), start_date (DATE), end_date (DATE), hours_requested (NUMERIC), status (TEXT: pending/approved/rejected/cancelled), reason (TEXT), manager_notes (TEXT), approved_by (TEXT), approved_by_name (TEXT), approved_at (TIMESTAMPTZ), created_at, updated_at
  NOTE: Uses request_type (NOT balance_type), hours_requested (NOT hours).

- per_diem_rates: Per diem rate configuration. (Migration 006)
  Columns: id (UUID PK), name (TEXT), daily_rate (NUMERIC), layover_rate (NUMERIC), effective_date (DATE), is_active (BOOLEAN), created_at
  NOTE: Has both daily_rate and layover_rate. Uses name (NOT rate_type).

- per_diem_entries: Per diem payments linked to timesheets. (Migration 006)
  Columns: id (UUID PK), timesheet_id (UUID FK UNIQUE), user_id (TEXT), rate_id (UUID FK), nights_count (INT), layover_count (INT), nights_amount (NUMERIC), layover_amount (NUMERIC), total_amount (NUMERIC), week_ending (DATE), created_at
  NOTE: Uses nights_count/layover_count (NOT nights/layovers). Uses week_ending (NOT period_start/period_end).

## Accounting & Finance

- chart_of_accounts: General ledger accounts. (Migration 009)
  Columns: id (UUID PK), account_number (INT UNIQUE), name (TEXT), account_type (TEXT: asset/liability/equity/revenue/expense), normal_balance (TEXT: debit/credit), description (TEXT), parent_id (UUID FK self-ref), is_active (BOOLEAN), is_system (BOOLEAN), current_balance (NUMERIC), created_at, updated_at
  NOTE: Uses account_type (NOT type), current_balance (NOT balance). Has normal_balance and is_system. No sub_type column.

- journal_entries: Double-entry bookkeeping. (Migration 009)
  Columns: id (UUID PK), entry_date (DATE), description (TEXT), reference (TEXT), source (TEXT: manual/timesheet_approved/per_diem/expense_approved/payroll/invoice/adjustment), source_id (TEXT), status (TEXT: draft/posted/voided), total_amount (NUMERIC), created_by (TEXT), created_by_name (TEXT), posted_at (TIMESTAMPTZ), voided_at (TIMESTAMPTZ), voided_by (TEXT), voided_reason (TEXT), created_at, updated_at
  NOTE: No entry_number column. Uses voided_reason (NOT void_reason). Source values differ from what you might expect.

- journal_entry_lines: Individual debit/credit lines. (Migration 009)
  Columns: id (UUID PK), journal_entry_id (UUID FK), account_id (UUID FK), debit (NUMERIC DEFAULT 0), credit (NUMERIC DEFAULT 0), description (TEXT), line_order (INT), created_at
  NOTE: Uses journal_entry_id (NOT entry_id).

- accounting_periods: Fiscal period management. (Migration 016)
  Columns: id (UUID PK), start_date (DATE), end_date (DATE), label (TEXT), period_type (TEXT: month/quarter/year), status (TEXT: open/closed/locked), closed_by (TEXT), closed_by_name (TEXT), closed_at (TIMESTAMPTZ), notes (TEXT), created_at, updated_at
  NOTE: Uses label (NOT period_name). Has period_type.

- recurring_journal_entries: Template entries for auto-generation. (Migration 016)
  Columns: id (UUID PK), description (TEXT), reference (TEXT), frequency (TEXT: monthly/quarterly/annually), next_date (DATE), end_date (DATE), is_active (BOOLEAN), created_by (TEXT), created_by_name (TEXT), created_at, updated_at
  NOTE: Uses next_date (NOT next_run_date). No name or template_lines column.

- recurring_journal_entry_lines: Template line items. (Migration 016)
  Columns: id (UUID PK), recurring_entry_id (UUID FK), account_id (UUID FK), debit (NUMERIC), credit (NUMERIC), description (TEXT), line_order (INT)

- customers: Customer records for AR/invoicing. (Migration 017)
  Columns: id (UUID PK), company_name (TEXT), contact_name (TEXT), email (TEXT), phone (TEXT), billing_address (TEXT), payment_terms (TEXT: Net 15/Net 30/Net 45/Net 60/Net 90/Due on Receipt), credit_limit (NUMERIC), tax_id (TEXT), notes (TEXT), is_active (BOOLEAN), created_at, updated_at
  NOTE: Uses billing_address (NOT separate address/city/state/zip).

- vendors: Vendor records for AP/bills. (Migration 017)
  Columns: id (UUID PK), company_name (TEXT), contact_name (TEXT), email (TEXT), phone (TEXT), address (TEXT), payment_terms (TEXT), default_expense_account_id (UUID FK), tax_id (TEXT), is_1099_vendor (BOOLEAN), notes (TEXT), is_active (BOOLEAN), created_at, updated_at
  NOTE: Uses is_1099_vendor (NOT is_1099).

- invoices: Accounts receivable. (Migration 017)
  Columns: id (UUID PK), invoice_number (INT UNIQUE via sequence), customer_id (UUID FK), invoice_date (DATE), due_date (DATE), status (TEXT: draft/sent/partial/paid/voided/overdue), subtotal (NUMERIC), tax_rate (NUMERIC), tax_amount (NUMERIC), total (NUMERIC), amount_paid (NUMERIC), balance_due (NUMERIC), notes (TEXT), terms (TEXT), journal_entry_id (UUID FK), created_by (TEXT), created_by_name (TEXT), sent_at (TIMESTAMPTZ), created_at, updated_at
  NOTE: Uses total (NOT total_amount).

- invoice_line_items: Line items on invoices. (Migration 017)
  Columns: id (UUID PK), invoice_id (UUID FK), description (TEXT), quantity (NUMERIC), unit_price (NUMERIC), amount (NUMERIC), account_id (UUID FK — revenue account), timesheet_id (UUID FK), line_order (INT), created_at

- invoice_payments: Payments received. (Migration 017)
  Columns: id (UUID PK), invoice_id (UUID FK), payment_date (DATE), amount (NUMERIC), payment_method (TEXT: check/ach/wire/cash/credit_card/other), reference (TEXT), notes (TEXT), journal_entry_id (UUID FK), recorded_by (TEXT), recorded_by_name (TEXT), created_at
  NOTE: Uses payment_method (NOT method).

- bills: Accounts payable. (Migration 017)
  Columns: id (UUID PK), vendor_id (UUID FK), bill_number (TEXT), bill_date (DATE), due_date (DATE), status (TEXT: open/partial/paid/voided), subtotal (NUMERIC), tax_amount (NUMERIC), total (NUMERIC), amount_paid (NUMERIC), balance_due (NUMERIC), notes (TEXT), journal_entry_id (UUID FK), created_by (TEXT), created_by_name (TEXT), created_at, updated_at
  NOTE: Uses total (NOT total_amount). Status uses "open" (NOT "entered"/"draft").

- bill_line_items: Line items on bills. (Migration 017)
  Columns: id (UUID PK), bill_id (UUID FK), description (TEXT), quantity (NUMERIC), unit_price (NUMERIC), amount (NUMERIC), account_id (UUID FK — expense account), line_order (INT), created_at

- bill_payments: Payments made. (Migration 017)
  Columns: id (UUID PK), bill_id (UUID FK), payment_date (DATE), amount (NUMERIC), payment_method (TEXT: check/ach/wire/cash/credit_card/other), check_number (TEXT), reference (TEXT), notes (TEXT), journal_entry_id (UUID FK), recorded_by (TEXT), recorded_by_name (TEXT), created_at

- bank_accounts: Company bank accounts. (Migration 019)
  Columns: id (UUID PK), name (TEXT), institution (TEXT), account_last4 (TEXT), account_type (TEXT: checking/savings/credit_card), gl_account_id (UUID FK), current_balance (NUMERIC), is_active (BOOLEAN), created_at, updated_at
  NOTE: Uses institution (NOT bank_name), account_last4 (NOT account_number_last4).

- bank_transactions: Bank transactions. (Migration 019)
  Columns: id (UUID PK), bank_account_id (UUID FK), transaction_date (DATE), description (TEXT), amount (NUMERIC — positive=deposit, negative=withdrawal), type (TEXT: deposit/withdrawal/transfer/fee/interest/other), reference (TEXT), cleared (BOOLEAN), matched_je_id (UUID FK), reconciliation_id (UUID FK), import_source (TEXT), import_hash (TEXT UNIQUE), created_at
  NOTE: Uses cleared (NOT is_reconciled), matched_je_id (NOT matched_entry_id). No category column.

- reconciliation_sessions: Bank reconciliation. (Migration 019)
  Columns: id (UUID PK), bank_account_id (UUID FK), statement_date (DATE), statement_balance (NUMERIC), beginning_balance (NUMERIC), cleared_deposits (NUMERIC), cleared_withdrawals (NUMERIC), difference (NUMERIC), status (TEXT: in_progress/completed), completed_by (TEXT), completed_by_name (TEXT), completed_at (TIMESTAMPTZ), notes (TEXT), created_at, updated_at

- employee_tax_profiles: W-4 and payroll config. (Migration 020)
  Columns: id (UUID PK), user_id (TEXT UNIQUE), filing_status (TEXT), multiple_jobs (BOOLEAN), dependents_credit (NUMERIC), other_income (NUMERIC), deductions (NUMERIC), extra_withholding (NUMERIC), state (TEXT), state_withholding (NUMERIC), state_extra_wh (NUMERIC), pay_frequency (TEXT), hourly_rate (NUMERIC), salary_annual (NUMERIC), pay_type (TEXT), ytd_gross (NUMERIC), ytd_federal_wh (NUMERIC), ytd_state_wh (NUMERIC), ytd_ss_wages (NUMERIC), ytd_ss_wh (NUMERIC), ytd_medicare_wages (NUMERIC), ytd_medicare_wh (NUMERIC), ytd_futa_wages (NUMERIC), ytd_suta_wages (NUMERIC), bank_routing_number (TEXT), bank_account_number (TEXT), bank_account_type (TEXT), w4_signed_date (DATE), is_active (BOOLEAN), created_at, updated_at

- tax_rate_tables: Tax brackets and rates. (Migration 020)
  Columns: id (UUID PK), tax_year (INT), tax_type (TEXT: federal_bracket/ss_rate/ss_wage_base/medicare_rate/medicare_additional_rate/medicare_additional_threshold/futa_rate/futa_wage_base/suta_rate/suta_wage_base/state_flat), filing_status (TEXT), bracket_min (NUMERIC), bracket_max (NUMERIC), rate (NUMERIC), flat_amount (NUMERIC), description (TEXT), created_at
  NOTE: Uses tax_year (NOT effective_year). No jurisdiction column.

- payroll_runs: Payroll batch processing. (Migration 020)
  Columns: id (UUID PK), pay_period_start (DATE), pay_period_end (DATE), pay_date (DATE), status (TEXT: draft/approved/posted/voided), total_gross (NUMERIC), total_net (NUMERIC), total_employer_tax (NUMERIC), total_deductions (NUMERIC), employee_count (INT), journal_entry_id (UUID FK), notes (TEXT), created_by (TEXT), created_by_name (TEXT), approved_by (TEXT), approved_by_name (TEXT), approved_at (TIMESTAMPTZ), posted_at (TIMESTAMPTZ), created_at, updated_at

- payroll_run_lines: Individual employee payroll records. (Migration 020)
  Columns: id (UUID PK), payroll_run_id (UUID FK), user_id (TEXT), employee_name (TEXT), regular_hours (NUMERIC), overtime_hours (NUMERIC), holiday_hours (NUMERIC), vacation_hours (NUMERIC), hourly_rate (NUMERIC), regular_pay (NUMERIC), overtime_pay (NUMERIC), holiday_pay (NUMERIC), vacation_pay (NUMERIC), per_diem (NUMERIC), mileage_pay (NUMERIC), other_pay (NUMERIC), gross_pay (NUMERIC), federal_wh (NUMERIC), state_wh (NUMERIC), ss_employee (NUMERIC), medicare_employee (NUMERIC), benefits_deduction (NUMERIC), other_deductions (NUMERIC), total_deductions (NUMERIC), net_pay (NUMERIC), ss_employer (NUMERIC), medicare_employer (NUMERIC), futa (NUMERIC), suta (NUMERIC), total_employer_tax (NUMERIC), timesheet_id (UUID FK), notes (TEXT), created_at

- benefit_plans: Company benefit plans. (Migration 020)
  Columns: id (UUID PK), name (TEXT), plan_type (TEXT: health/dental/vision/401k/hsa/life/disability/other), is_pretax (BOOLEAN), employee_cost (NUMERIC), employer_cost (NUMERIC), description (TEXT), is_active (BOOLEAN), created_at
  NOTE: Uses plan_type (NOT type), employee_cost/employer_cost (NOT employee_contribution/employer_contribution).

- employee_benefits: Benefit enrollment. (Migration 020)
  Columns: id (UUID PK), user_id (TEXT), benefit_plan_id (UUID FK), enrollment_date (DATE), termination_date (DATE), employee_amount (NUMERIC), employer_amount (NUMERIC), created_at
  CONSTRAINT: UNIQUE(user_id, benefit_plan_id)
  NOTE: Uses termination_date (NOT status field), employee_amount/employer_amount.

- workers_comp_classes: Workers comp codes. (Migration 020)
  Columns: id (UUID PK), ncci_code (TEXT UNIQUE), description (TEXT), rate_per_100 (NUMERIC), state (TEXT), effective_date (DATE), is_active (BOOLEAN), created_at
  NOTE: Uses ncci_code (NOT class_code). Has state field.

- budgets: Budget amounts by account and period. (Migration 021)
  Columns: id (UUID PK), fiscal_year (INT), account_id (UUID FK), period (TEXT: annual/q1/q2/q3/q4/jan/feb/.../dec), budgeted_amount (NUMERIC), notes (TEXT), created_by (TEXT), created_by_name (TEXT), created_at, updated_at
  CONSTRAINT: UNIQUE(fiscal_year, account_id, period)

- fixed_assets: Capital asset register. (Migration 022)
  Columns: id (UUID PK), name (TEXT), description (TEXT), asset_tag (TEXT UNIQUE), category (TEXT), purchase_date (DATE), in_service_date (DATE), purchase_cost (NUMERIC), salvage_value (NUMERIC), useful_life_months (INT), depreciation_method (TEXT: straight_line/declining_balance/sum_of_years), accumulated_depreciation (NUMERIC), book_value (NUMERIC), status (TEXT: active/fully_depreciated/disposed/written_off), disposal_date (DATE), disposal_amount (NUMERIC), disposal_method (TEXT), gain_loss (NUMERIC), linked_truck_id (TEXT), gl_asset_account_id (UUID FK), gl_depreciation_account_id (UUID FK), gl_accum_depr_account_id (UUID FK), created_by (TEXT), created_by_name (TEXT), created_at, updated_at
  NOTE: Uses purchase_date/purchase_cost (NOT acquisition_date/acquisition_cost). Has asset_tag, disposal_method, gain_loss, linked_truck_id.

- depreciation_entries: Depreciation records. (Migration 022)
  Columns: id (UUID PK), fixed_asset_id (UUID FK), period_date (DATE), depreciation_amount (NUMERIC), accumulated_total (NUMERIC), book_value_after (NUMERIC), journal_entry_id (UUID FK), created_at
  CONSTRAINT: UNIQUE(fixed_asset_id, period_date)
  NOTE: Uses depreciation_amount (NOT amount), accumulated_total (new field).

- estimates: Estimates/quotes. (Migration 023)
  Columns: id (UUID PK), estimate_number (INT), customer_id (UUID FK), estimate_date (DATE), expiry_date (DATE), status (TEXT: draft/sent/accepted/rejected/expired/converted), subtotal (NUMERIC), tax_rate (NUMERIC), tax_amount (NUMERIC), total (NUMERIC), notes (TEXT), terms (TEXT), converted_invoice_id (UUID FK), created_by (TEXT), created_by_name (TEXT), sent_at (TIMESTAMPTZ), accepted_at (TIMESTAMPTZ), created_at, updated_at
  NOTE: Uses total (NOT total_amount).

- estimate_line_items: Line items on estimates. (Migration 023)
  Columns: id (UUID PK), estimate_id (UUID FK), description (TEXT), quantity (NUMERIC), unit_price (NUMERIC), amount (NUMERIC), line_order (INT), created_at

- expense_categorization_rules: Auto-categorization for CC transactions. (Migration 024)
  Columns: id (UUID PK), name (TEXT), match_type (TEXT: contains/starts_with/exact/regex), match_pattern (TEXT), category (TEXT), gl_account_id (UUID FK), priority (INT), is_active (BOOLEAN), created_by (TEXT), created_at, updated_at

- credit_card_accounts: Company credit cards. (Migration 024)
  Columns: id (UUID PK), name (TEXT), last_four (TEXT), gl_account_id (UUID FK), is_active (BOOLEAN), created_at

- credit_card_transactions: CC transactions. (Migration 024)
  Columns: id (UUID PK), credit_card_account_id (UUID FK), transaction_date (DATE), posted_date (DATE), description (TEXT), amount (NUMERIC), category (TEXT), gl_account_id (UUID FK), status (TEXT: pending/categorized/posted/excluded), journal_entry_id (UUID FK), import_batch (TEXT), duplicate_hash (TEXT), created_at, updated_at

- mileage_rates: IRS mileage rates. (Migration 025)
  Columns: id (UUID PK), effective_date (DATE), rate_per_mile (NUMERIC), rate_type (TEXT: standard/medical/charitable/custom), description (TEXT), is_active (BOOLEAN), created_at

- payment_reminders: Invoice reminder tracking. (Migration 025)
  Columns: id (UUID PK), invoice_id (UUID FK), reminder_type (TEXT: upcoming/overdue_7/overdue_30/overdue_60/overdue_90/final_notice), scheduled_date (DATE), sent_at (TIMESTAMPTZ), status (TEXT: pending/sent/skipped/cancelled), notes (TEXT), created_by (TEXT), created_at

- sales_tax_rates: Tax rates. (Migration 026)
  Columns: id (UUID PK), name (TEXT), jurisdiction (TEXT), rate (NUMERIC), tax_type (TEXT: sales/use/excise/other), applies_to (TEXT: all/goods/services/specific), is_active (BOOLEAN), effective_date (DATE), expiration_date (DATE), created_at

- sales_tax_exemptions: Customer tax exemptions. (Migration 026)
  Columns: id (UUID PK), customer_id (UUID FK), exemption_type (TEXT: resale/government/nonprofit/railroad/manufacturing/other), certificate_number (TEXT), effective_date (DATE), expiration_date (DATE), notes (TEXT), is_active (BOOLEAN), created_at

- sales_tax_collected: Tax on invoices. (Migration 026)
  Columns: id (UUID PK), invoice_id (UUID FK), tax_rate_id (UUID FK), taxable_amount (NUMERIC), tax_amount (NUMERIC), period_date (DATE), status (TEXT: collected/filed/remitted), created_at

- saved_reports: AI-generated report definitions. (Migration 028)
  Columns: id (UUID PK), created_by (TEXT), created_by_name (TEXT), name (TEXT), description (TEXT), prompt (TEXT), generated_sql (TEXT), is_shared (BOOLEAN), category (TEXT), last_run_at (TIMESTAMPTZ), run_count (INT), created_at, updated_at

## Additional Tables

- parts: Parts inventory master. (Migration 010)
  Columns: id (UUID PK), part_number (TEXT UNIQUE), name (TEXT), description (TEXT), category (TEXT: hydraulic/electrical/engine/transmission/brake/suspension/body/safety/consumable/tool/other), unit_cost (NUMERIC), unit (TEXT), quantity_on_hand (INT), reorder_point (INT), reorder_quantity (INT), location (TEXT: shop/truck/warehouse/field/other), supplier (TEXT), supplier_part_number (TEXT), status (TEXT: in_stock/low_stock/out_of_stock/discontinued), is_active (BOOLEAN), last_ordered (DATE), last_used (DATE), notes (TEXT), created_at, updated_at

- part_usage: Parts usage records. (Migration 010)
  Columns: id (UUID PK), part_id (UUID FK), quantity_used (NUMERIC), usage_type (TEXT: maintenance/repair/replacement/inspection/other), truck_id (TEXT), truck_name (TEXT), maintenance_entry_id (UUID), used_by (TEXT), used_by_name (TEXT), usage_date (DATE), notes (TEXT), created_at

- gps_tracks: GPS position tracking. (Migration 008)
  Columns: id (UUID PK), truck_id (TEXT), user_id (TEXT), latitude (NUMERIC), longitude (NUMERIC), altitude (NUMERIC), speed_mph (NUMERIC), heading (NUMERIC), accuracy_meters (NUMERIC), recorded_at (TIMESTAMPTZ), synced_at (TIMESTAMPTZ)

- inspections: Vehicle inspections. (Migration 008)
  Columns: id (UUID PK), truck_id (TEXT), inspector_id (TEXT), inspector_name (TEXT), inspector_role (TEXT), type (TEXT: pre_shift/post_shift), items_json (JSONB), overall_status (TEXT: pass/fail/incomplete), notes (TEXT), created_at

- shift_handoffs: Shift transition logs. (Migration 008)
  Columns: id (UUID PK), truck_id (TEXT), outgoing_user_id (TEXT), outgoing_user_name (TEXT), summary (TEXT), issues_json (JSONB), fuel_level_pct (NUMERIC), mileage (NUMERIC), created_at

## Platform

- audit_log: System-wide audit trail. (Migration 002)
  Columns: id (UUID PK), user_id (TEXT), user_name (TEXT), user_role (TEXT), action (TEXT), truck_id (TEXT), details (JSONB), created_at

- documents: File attachments. (Migration 007)
  Columns: id (UUID PK), user_id (TEXT), user_name (TEXT), entity_type (TEXT), entity_id (UUID), file_name (TEXT), file_url (TEXT), file_size (INT), mime_type (TEXT), description (TEXT), tags (JSONB), created_at

- activity_feed: Unified timeline. (Migration 007)
  Columns: id (UUID PK), user_id (TEXT), user_name (TEXT), action (TEXT), entity_type (TEXT), entity_id (UUID), summary (TEXT), metadata (JSONB), created_at

- entity_tags: Cross-domain tagging. (Migration 007)
  Columns: id (UUID PK), entity_type (TEXT), entity_id (UUID), tag (TEXT), created_by (TEXT), created_at
  CONSTRAINT: UNIQUE(entity_type, entity_id, tag)

- expense_categories: Expense category reference. (Migration 007)
  Columns: id (UUID PK), name (TEXT UNIQUE), description (TEXT), sort_order (INT), is_active (BOOLEAN), created_at

- inventory_items: Inventory item master. (No migration found — may be legacy)
  NOTE: Prefer using the "parts" table (migration 010) for inventory queries.

- inventory_transactions: Inventory movement records. (No migration found — may be legacy)
  NOTE: Prefer using the "part_usage" table (migration 010) for usage queries.

- report_query_log: Query execution log for analysis. (Migration 030)
  Columns: id (UUID PK), user_id (TEXT), user_name (TEXT), prompt (TEXT), generated_sql (TEXT), success (BOOLEAN), error_message (TEXT), row_count (INT), execution_time_ms (INT), retry_count (INT DEFAULT 0), created_at

- truck_snapshots: Digital twin snapshots — full sensor state at a point in time. (Migration 031)
  Columns: id (UUID PK), truck_id (TEXT), truck_name (TEXT), captured_at (TIMESTAMPTZ), created_at, created_by (TEXT), created_by_name (TEXT), label (TEXT), notes (TEXT), source (TEXT: live/historical), reading_data (JSONB — full sensor payload), engine_rpm (NUMERIC), vehicle_speed_mph (NUMERIC), coolant_temp_f (NUMERIC), battery_voltage_v (NUMERIC), engine_hours (NUMERIC), vehicle_distance_mi (NUMERIC), vin (TEXT), active_dtc_count (INT)

- push_tokens: Mobile push notification tokens. (Migration 008)
  Columns: id (UUID PK), user_id (TEXT), expo_token (TEXT), device_name (TEXT), platform (TEXT), created_at, updated_at

- employee_workers_comp: Workers compensation class assignments per employee. (Migration 020)
  Columns: id (UUID PK), user_id (TEXT), class_id (UUID FK workers_comp_classes.id), effective_date (DATE), created_at

## Key Relationships
- timesheets.user_id = employee_profiles.user_id (TEXT, Clerk user ID)
- invoices.customer_id = customers.id (UUID)
- bills.vendor_id = vendors.id (UUID)
- journal_entry_lines.account_id = chart_of_accounts.id (UUID)
- journal_entry_lines.journal_entry_id = journal_entries.id (UUID)
- payroll_run_lines.user_id = employee_profiles.user_id (TEXT)
- work_orders.truck_id = fleet_trucks.id (both TEXT — no cast needed)
- dtc_history.truck_id = fleet_trucks.id (both TEXT — no cast needed)
- truck_assignments.truck_id = fleet_trucks.id (both TEXT)
- Per diem entries link to timesheets via timesheet_id

## Important Notes for SQL Generation
- fleet_trucks.id is TEXT (truck number like "01"), NOT UUID — no ::text cast needed for joins
- User IDs are TEXT (Clerk format: "user_xxx"), not UUIDs
- DTC codes are stored as (spn, fmi) integer pairs, NOT as a "code" text column
- Table is maintenance_events, NOT maintenance_log
- Table is timesheet_ifta_entries, NOT timesheet_ifta
- Work order status values: open/in_progress/blocked/done (NOT completed/cancelled)
- Work order priority values: low/normal/urgent (NOT medium/high)
- Uses COALESCE(col, 0) for nullable numeric aggregations
- Use to_char(date_col, 'YYYY-MM-DD') for readable date output
- Always include LIMIT 500 unless the user asks for all results
- customers and vendors use company_name (not name)
- sensor_readings table does NOT exist in Supabase — sensor data is in Viam Cloud
`;

export const EXAMPLE_QUERIES = `
Example prompt-to-SQL pairs (using exact column names):

User: "What is the most common error code for the trucks"
SQL:
SELECT spn, fmi, 'SPN ' || spn || ' FMI ' || fmi as dtc_code,
       description, COUNT(*) as total_occurrences,
       SUM(occurrence_count) as total_events,
       COUNT(DISTINCT truck_id) as trucks_affected
FROM dtc_history
GROUP BY spn, fmi, description
ORDER BY total_occurrences DESC
LIMIT 20

User: "Show me all trucks that had DTCs in the last 30 days"
SQL:
SELECT ft.id as truck_number, ft.name, COUNT(dh.id) as dtc_count,
       to_char(MAX(dh.first_seen_at), 'YYYY-MM-DD HH24:MI') as most_recent_dtc
FROM fleet_trucks ft
JOIN dtc_history dh ON dh.truck_id = ft.id
WHERE dh.first_seen_at > now() - interval '30 days'
GROUP BY ft.id, ft.name
ORDER BY dtc_count DESC
LIMIT 500

User: "Which employees have pending timesheets?"
SQL:
SELECT ep.user_name as employee, to_char(t.week_ending, 'YYYY-MM-DD') as week_ending,
       t.status, to_char(t.submitted_at, 'YYYY-MM-DD') as submitted
FROM timesheets t
JOIN employee_profiles ep ON ep.user_id = t.user_id
WHERE t.status = 'submitted'
ORDER BY t.week_ending DESC
LIMIT 500

User: "Show total invoiced vs. total paid by customer"
SQL:
SELECT c.company_name as customer,
       COALESCE(SUM(i.total), 0) as total_invoiced,
       COALESCE(SUM(i.amount_paid), 0) as total_paid,
       COALESCE(SUM(i.balance_due), 0) as outstanding
FROM customers c
LEFT JOIN invoices i ON i.customer_id = c.id AND i.status != 'voided'
GROUP BY c.id, c.company_name
ORDER BY outstanding DESC
LIMIT 500

User: "Compare overtime hours by employee for March 2026"
SQL:
SELECT ep.user_name as employee,
       SUM(tdl.hours_worked) as total_hours,
       SUM(CASE WHEN tdl.hours_worked > 8 THEN tdl.hours_worked - 8 ELSE 0 END) as overtime_hours
FROM timesheet_daily_logs tdl
JOIN timesheets t ON t.id = tdl.timesheet_id
JOIN employee_profiles ep ON ep.user_id = t.user_id
WHERE t.status = 'approved'
  AND tdl.log_date >= '2026-03-01' AND tdl.log_date < '2026-04-01'
GROUP BY ep.user_name
ORDER BY overtime_hours DESC
LIMIT 500

User: "Show overdue invoices over $5,000"
SQL:
SELECT i.invoice_number, c.company_name as customer,
       to_char(i.due_date, 'YYYY-MM-DD') as due_date,
       ROUND(i.total, 2) as total_amount, ROUND(i.balance_due, 2) as balance_due,
       (CURRENT_DATE - i.due_date) as days_overdue
FROM invoices i
JOIN customers c ON c.id = i.customer_id
WHERE i.status IN ('sent', 'overdue', 'partial')
  AND i.due_date < CURRENT_DATE
  AND i.balance_due > 5000
ORDER BY days_overdue DESC
LIMIT 500

User: "Show active work orders with their assigned person"
SQL:
SELECT wo.title, wo.priority, wo.status, wo.assigned_to_name as assigned_to,
       wo.created_by_name as created_by, ft.name as truck,
       to_char(wo.due_date, 'YYYY-MM-DD') as due_date,
       to_char(wo.created_at, 'YYYY-MM-DD') as created
FROM work_orders wo
LEFT JOIN fleet_trucks ft ON ft.id = wo.truck_id
WHERE wo.status IN ('open', 'in_progress', 'blocked')
ORDER BY CASE wo.priority WHEN 'urgent' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 END,
         wo.created_at DESC
LIMIT 500

User: "Show training certifications expiring in the next 60 days"
SQL:
SELECT tr.user_name as employee, treq.name as requirement,
       to_char(tr.expiry_date, 'YYYY-MM-DD') as expires,
       (tr.expiry_date - CURRENT_DATE) as days_remaining
FROM training_records tr
JOIN training_requirements treq ON treq.id = tr.requirement_id
WHERE tr.expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + interval '60 days'
ORDER BY tr.expiry_date ASC
LIMIT 500

User: "What's the average per diem cost per railroad for March?"
SQL:
SELECT t.railroad_working_on as railroad,
       COUNT(DISTINCT pde.id) as entries,
       ROUND(AVG(pde.total_amount), 2) as avg_per_diem,
       ROUND(SUM(pde.total_amount), 2) as total_per_diem
FROM per_diem_entries pde
JOIN timesheets t ON t.id = pde.timesheet_id
WHERE pde.week_ending >= '2026-03-01' AND pde.week_ending < '2026-04-01'
GROUP BY t.railroad_working_on
ORDER BY total_per_diem DESC
LIMIT 500

User: "Show payroll totals by employee for Q1 2026"
SQL:
SELECT prl.employee_name,
       ROUND(SUM(prl.gross_pay), 2) as total_gross,
       ROUND(SUM(prl.net_pay), 2) as total_net,
       ROUND(SUM(prl.total_deductions), 2) as total_deductions,
       ROUND(SUM(prl.total_employer_tax), 2) as employer_taxes,
       SUM(prl.regular_hours) as regular_hours,
       SUM(prl.overtime_hours) as overtime_hours
FROM payroll_run_lines prl
JOIN payroll_runs pr ON pr.id = prl.payroll_run_id
WHERE pr.status = 'posted'
  AND pr.pay_period_start >= '2026-01-01' AND pr.pay_period_end < '2026-04-01'
GROUP BY prl.employee_name
ORDER BY total_gross DESC
LIMIT 500

User: "Show all truck snapshots for truck 01 in the last week"
SQL:
SELECT ts.label, ts.notes, ts.source,
       to_char(ts.captured_at, 'YYYY-MM-DD HH24:MI') as captured_at,
       ts.created_by_name as captured_by,
       ts.engine_rpm, ts.vehicle_speed_mph, ts.coolant_temp_f,
       ts.battery_voltage_v, ts.engine_hours, ts.active_dtc_count
FROM truck_snapshots ts
WHERE ts.truck_id = '01'
  AND ts.captured_at > now() - interval '7 days'
ORDER BY ts.captured_at DESC
LIMIT 500

User: "Which chase vehicles were used most in timesheets last month?"
SQL:
SELECT cv.vehicle_number, cv.vehicle_type,
       COUNT(DISTINCT t.id) as timesheet_count,
       COUNT(DISTINCT t.user_id) as unique_users
FROM company_vehicles cv
JOIN timesheets t ON t.chase_vehicles::jsonb @> to_jsonb(cv.vehicle_number)
WHERE cv.vehicle_type = 'chase'
  AND t.week_ending >= (date_trunc('month', CURRENT_DATE) - interval '1 month')::date
  AND t.week_ending < date_trunc('month', CURRENT_DATE)::date
GROUP BY cv.vehicle_number, cv.vehicle_type
ORDER BY timesheet_count DESC
LIMIT 500
`;
