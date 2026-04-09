-- Migration 032: Compound indexes for common query patterns
-- These cover the most frequent WHERE + ORDER BY combinations in the app.

-- Work orders: list by truck filtered by status (work board)
CREATE INDEX IF NOT EXISTS idx_work_orders_truck_status
  ON work_orders (truck_id, status);

-- Work orders: list by assigned user filtered by status
CREATE INDEX IF NOT EXISTS idx_work_orders_assigned_status
  ON work_orders (assigned_to, status);

-- Timesheets: list by user + status (my timesheets page)
CREATE INDEX IF NOT EXISTS idx_timesheets_user_status
  ON timesheets (user_id, status);

-- Chat messages: thread listing ordered by time (most common query)
CREATE INDEX IF NOT EXISTS idx_chat_messages_thread_created
  ON chat_messages (thread_id, created_at DESC);

-- Chat threads: entity lookup (by-entity endpoint)
CREATE INDEX IF NOT EXISTS idx_chat_threads_entity
  ON chat_threads (entity_type, entity_id);

-- Journal entries: period queries for accounting reports
CREATE INDEX IF NOT EXISTS idx_journal_entries_date_status
  ON journal_entries (entry_date, status);

-- Invoices: aging report queries
CREATE INDEX IF NOT EXISTS idx_invoices_customer_status
  ON invoices (customer_id, status);

-- Bills: AP queries by vendor
CREATE INDEX IF NOT EXISTS idx_bills_vendor_status
  ON bills (vendor_id, status);

-- DTC history: lookup by truck + time range
CREATE INDEX IF NOT EXISTS idx_dtc_history_truck_time
  ON dtc_history (truck_id, first_seen_at DESC);

-- Truck snapshots: list by truck ordered by capture time
CREATE INDEX IF NOT EXISTS idx_truck_snapshots_truck_captured
  ON truck_snapshots (truck_id, captured_at DESC);

-- Report query log: recent queries for analysis
CREATE INDEX IF NOT EXISTS idx_report_query_log_user_created
  ON report_query_log (user_id, created_at DESC);

-- Audit log: filtered by action type + time
CREATE INDEX IF NOT EXISTS idx_audit_log_action_created
  ON audit_log (action, created_at DESC);

-- Activity feed: entity timeline queries
CREATE INDEX IF NOT EXISTS idx_activity_feed_entity
  ON activity_feed (entity_type, entity_id, created_at DESC);
