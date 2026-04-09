-- 041_job_costing_seed.sql
-- Demo data for job costing: customers, vendors, jobs, cost entries, invoices, bills

-- ─── Customers ────────────────────────────────────────────────────
INSERT INTO customers (id, company_name, contact_name, email, phone, payment_terms) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'Norfolk Southern Railway', 'Mike Patterson', 'mpatterson@nscorp.com', '(859) 555-0101', 'Net 30'),
  ('a0000000-0000-0000-0000-000000000002', 'KY Transportation Cabinet', 'Sarah Williams', 'swilliams@kytc.gov', '(502) 555-0202', 'Net 45'),
  ('a0000000-0000-0000-0000-000000000003', 'CSX Transportation', 'David Chen', 'dchen@csx.com', '(904) 555-0303', 'Net 30'),
  ('a0000000-0000-0000-0000-000000000004', 'Louisville Gas & Electric', 'Jennifer Brown', 'jbrown@lge.com', '(502) 555-0404', 'Net 30'),
  ('a0000000-0000-0000-0000-000000000005', 'Bluegrass Metals Inc', 'Tom Harmon', 'tharmon@bgmetals.com', '(859) 555-0505', 'Net 15')
ON CONFLICT (id) DO NOTHING;

-- ─── Vendors ──────────────────────────────────────────────────────
INSERT INTO vendors (id, company_name, contact_name, email, phone, payment_terms) VALUES
  ('d0000000-0000-0000-0000-000000000001', 'Bluegrass Steel Supply', 'Randy Moore', 'randy@bgsteel.com', '(859) 555-0601', 'Net 30'),
  ('d0000000-0000-0000-0000-000000000002', 'Night Owl Safety Services', 'Carla Jenkins', 'carla@nightowlsafety.com', '(859) 555-0602', 'Net 15'),
  ('d0000000-0000-0000-0000-000000000003', 'KY Environmental Services', 'Paul Fletcher', 'paul@kyenviro.com', '(502) 555-0603', 'Net 30'),
  ('d0000000-0000-0000-0000-000000000004', 'Central KY Equipment Rental', 'Amy Sloan', 'amy@ckequip.com', '(859) 555-0604', 'Net 15'),
  ('d0000000-0000-0000-0000-000000000005', 'Tri-State Galvanizing', 'Ron Pierce', 'ron@tristategalv.com', '(513) 555-0605', 'Net 30')
ON CONFLICT (id) DO NOTHING;

-- ─── Jobs ─────────────────────────────────────────────────────────
INSERT INTO jobs (id, job_number, customer_id, name, description, status, job_type, location, bid_amount, contract_amount, start_date, end_date, estimated_hours, notes) VALUES
  ('b0000000-0000-0000-0000-000000000001', 'J-1001', 'a0000000-0000-0000-0000-000000000001',
   'NS Track Repair — Lexington Yard',
   'Replace 2,400 ft of rail and 180 ties in the Lexington classification yard. Includes tamping and alignment.',
   'active', 'Railroad', 'Lexington, KY', 68000, 72500,
   '2026-03-10', NULL, 480,
   'Night work required per NS operating window (10pm-6am). Flagging crew provided by Night Owl Safety.'),

  ('b0000000-0000-0000-0000-000000000002', 'J-1002', 'a0000000-0000-0000-0000-000000000002',
   'KY-627 Bridge Deck Welding',
   'Structural steel repair and weld overlay on bridge deck plates. DOT inspection required upon completion.',
   'active', 'Bridge', 'Winchester, KY', 34000, 36200,
   '2026-03-18', '2026-04-30', 200,
   'Must maintain one-lane traffic during work hours. Flaggers needed.'),

  ('b0000000-0000-0000-0000-000000000003', 'J-1003', 'a0000000-0000-0000-0000-000000000005',
   'Guard Rail Fabrication — Phase 1',
   'Fabricate and deliver 600 linear feet of heavy-duty guard rail per customer spec BGM-2026-A.',
   'completed', 'Fabrication', 'Shop — Georgetown, KY', 18500, 19200,
   '2026-02-01', '2026-03-15', 120,
   'Material: A36 plate. Galvanized finish. Customer picked up.'),

  ('b0000000-0000-0000-0000-000000000004', 'J-1004', 'a0000000-0000-0000-0000-000000000003',
   'CSX Rail Grinding — Corbin Sub',
   'Profile grinding on 8 miles of the Corbin Subdivision mainline. Two passes required.',
   'bidding', 'Railroad', 'Corbin, KY', 92000, 0,
   NULL, NULL, 640,
   'Bid submitted 4/1. Awaiting response. Requires 24/7 operation for 2-week window.'),

  ('b0000000-0000-0000-0000-000000000005', 'J-1005', 'a0000000-0000-0000-0000-000000000004',
   'Emergency Generator Weld Repair',
   'Field repair of cracked mounting brackets on 2MW backup generator at Cane Run plant.',
   'closed', 'Service', 'Louisville, KY', 4200, 4200,
   '2026-01-15', '2026-01-17', 16,
   'Emergency callout. Completed in 2 days. Invoiced and paid.'),

  ('b0000000-0000-0000-0000-000000000006', 'J-1006', 'a0000000-0000-0000-0000-000000000001',
   'NS Derailment Recovery — Danville',
   'Rerail 3 freight cars and repair 400ft of damaged track after minor derailment in the Danville siding.',
   'active', 'Railroad', 'Danville, KY', 45000, 48000,
   '2026-04-01', NULL, 320,
   'FRA reporting handled by NS. Our scope is track repair and rerailing only.')
ON CONFLICT (id) DO NOTHING;

-- Advance sequence past seeded job numbers
SELECT setval('job_number_seq', GREATEST(
  (SELECT last_value FROM job_number_seq), 1006), true);

-- ─── Cost Entries ─────────────────────────────────────────────────

-- J-1001: NS Track Repair (active — $43,570 in costs so far)
INSERT INTO job_cost_entries (job_id, cost_type, description, quantity, rate, amount, date, source_type) VALUES
  ('b0000000-0000-0000-0000-000000000001', 'material', 'Rail — 115RE, 39ft sticks (qty 64)', 64, 285, 18240, '2026-03-12', 'manual'),
  ('b0000000-0000-0000-0000-000000000001', 'material', 'Crossties — hardwood 7x9x8.5 (qty 180)', 180, 52, 9360, '2026-03-12', 'manual'),
  ('b0000000-0000-0000-0000-000000000001', 'material', 'OTM spikes, tie plates, rail anchors', 1, 3200, 3200, '2026-03-14', 'manual'),
  ('b0000000-0000-0000-0000-000000000001', 'equipment', 'Crane rental — 2 weeks', 1, 4800, 4800, '2026-03-10', 'manual'),
  ('b0000000-0000-0000-0000-000000000001', 'equipment', 'Tamper rental — 1 week', 1, 2200, 2200, '2026-03-17', 'manual'),
  ('b0000000-0000-0000-0000-000000000001', 'fuel', 'Diesel — equipment + crew trucks (March)', 1, 1850, 1850, '2026-03-31', 'manual'),
  ('b0000000-0000-0000-0000-000000000001', 'subcontractor', 'Night Owl Safety — flagging (14 nights)', 14, 280, 3920, '2026-03-24', 'manual');

-- J-1002: Bridge Welding (active — $7,600 in costs so far)
INSERT INTO job_cost_entries (job_id, cost_type, description, quantity, rate, amount, date, source_type) VALUES
  ('b0000000-0000-0000-0000-000000000002', 'material', 'Weld wire ER70S-6 (1,200 lbs)', 1200, 1.85, 2220, '2026-03-20', 'manual'),
  ('b0000000-0000-0000-0000-000000000002', 'material', 'Steel plate A572-50, 3/4 in (8 pcs)', 8, 320, 2560, '2026-03-19', 'manual'),
  ('b0000000-0000-0000-0000-000000000002', 'equipment', 'Welding rig mobilization + boom', 1, 1800, 1800, '2026-03-18', 'manual'),
  ('b0000000-0000-0000-0000-000000000002', 'mileage', 'Crew travel — shop to Winchester (15 days RT)', 15, 68, 1020, '2026-04-01', 'manual');

-- J-1003: Guard Rail Fabrication (completed — $8,710 in costs)
INSERT INTO job_cost_entries (job_id, cost_type, description, quantity, rate, amount, date, source_type) VALUES
  ('b0000000-0000-0000-0000-000000000003', 'material', 'A36 plate 3/8" — 12 sheets', 12, 380, 4560, '2026-02-03', 'manual'),
  ('b0000000-0000-0000-0000-000000000003', 'material', 'Galvanizing — batch run', 1, 2800, 2800, '2026-03-01', 'manual'),
  ('b0000000-0000-0000-0000-000000000003', 'labor', 'OT weekend push to meet deadline', 24, 37.50, 900, '2026-03-08', 'manual'),
  ('b0000000-0000-0000-0000-000000000003', 'expense', 'Delivery to Bluegrass Metals', 1, 450, 450, '2026-03-15', 'manual');

-- J-1005: Generator Repair (closed — $1,381 in costs)
INSERT INTO job_cost_entries (job_id, cost_type, description, quantity, rate, amount, date, source_type) VALUES
  ('b0000000-0000-0000-0000-000000000005', 'material', 'Mounting bracket steel + hardware', 1, 280, 280, '2026-01-15', 'manual'),
  ('b0000000-0000-0000-0000-000000000005', 'labor', 'Emergency callout premium (2 welders x 8hr)', 16, 55, 880, '2026-01-15', 'manual'),
  ('b0000000-0000-0000-0000-000000000005', 'fuel', 'Service truck fuel — RT Louisville', 1, 85, 85, '2026-01-17', 'manual'),
  ('b0000000-0000-0000-0000-000000000005', 'mileage', 'Georgetown to Louisville round trip', 2, 68, 136, '2026-01-15', 'manual');

-- J-1006: Derailment Recovery (active — $17,320 in costs so far)
INSERT INTO job_cost_entries (job_id, cost_type, description, quantity, rate, amount, date, source_type) VALUES
  ('b0000000-0000-0000-0000-000000000006', 'material', 'Emergency rail stock 132RE (12 sticks)', 12, 310, 3720, '2026-04-02', 'manual'),
  ('b0000000-0000-0000-0000-000000000006', 'material', 'Crossties, spikes, tie plates', 1, 2100, 2100, '2026-04-02', 'manual'),
  ('b0000000-0000-0000-0000-000000000006', 'equipment', 'Crane + hydraulic rerail equipment', 1, 6500, 6500, '2026-04-01', 'manual'),
  ('b0000000-0000-0000-0000-000000000006', 'fuel', 'Diesel — heavy equipment ops', 1, 1200, 1200, '2026-04-07', 'manual'),
  ('b0000000-0000-0000-0000-000000000006', 'subcontractor', 'KY Environmental — DEP-required cleanup', 1, 3800, 3800, '2026-04-05', 'manual');

-- ─── Invoices (revenue) ──────────────────────────────────────────
-- Using high invoice numbers (5001+) to avoid conflict with existing data
INSERT INTO invoices (id, invoice_number, customer_id, job_id, invoice_date, due_date, status,
                      subtotal, tax_rate, tax_amount, total, amount_paid, balance_due,
                      created_by, created_by_name) VALUES
  -- J-1003: Guard Rail — fully paid
  ('c0000000-0000-0000-0000-000000000001', 5001,
   'a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000003',
   '2026-03-16', '2026-03-31', 'paid',
   19200, 0, 0, 19200, 19200, 0, 'system', 'Seed Data'),

  -- J-1005: Generator — fully paid
  ('c0000000-0000-0000-0000-000000000002', 5002,
   'a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000005',
   '2026-01-18', '2026-02-17', 'paid',
   4200, 0, 0, 4200, 4200, 0, 'system', 'Seed Data'),

  -- J-1001: NS Track — progress invoice (50% milestone)
  ('c0000000-0000-0000-0000-000000000003', 5003,
   'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001',
   '2026-03-31', '2026-04-30', 'sent',
   36250, 0, 0, 36250, 0, 36250, 'system', 'Seed Data'),

  -- J-1006: Derailment — progress invoice
  ('c0000000-0000-0000-0000-000000000004', 5004,
   'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000006',
   '2026-04-08', '2026-05-08', 'sent',
   24000, 0, 0, 24000, 0, 24000, 'system', 'Seed Data')
ON CONFLICT (id) DO NOTHING;

-- Advance invoice sequence past seeded values if needed
DO $$ BEGIN
  IF (SELECT last_value FROM invoice_number_seq) < 5005 THEN
    PERFORM setval('invoice_number_seq', 5005, false);
  END IF;
END $$;

-- ─── Bills (vendor costs linked to jobs) ─────────────────────────
INSERT INTO bills (id, vendor_id, job_id, bill_number, bill_date, due_date, status,
                   subtotal, tax_amount, total, amount_paid, balance_due,
                   created_by, created_by_name) VALUES
  -- J-1001: Steel supply bill
  ('e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001',
   'b0000000-0000-0000-0000-000000000001', 'BGS-4401', '2026-03-12', '2026-04-11', 'paid',
   30800, 0, 30800, 30800, 0, 'system', 'Seed Data'),

  -- J-1001: Flagging subcontractor
  ('e0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000002',
   'b0000000-0000-0000-0000-000000000001', 'NOS-0312', '2026-03-24', '2026-04-08', 'paid',
   3920, 0, 3920, 3920, 0, 'system', 'Seed Data'),

  -- J-1001: Crane rental
  ('e0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000004',
   'b0000000-0000-0000-0000-000000000001', 'CKE-2026-118', '2026-03-24', '2026-04-08', 'open',
   7000, 0, 7000, 0, 7000, 'system', 'Seed Data'),

  -- J-1002: Steel plate for bridge
  ('e0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000001',
   'b0000000-0000-0000-0000-000000000002', 'BGS-4415', '2026-03-19', '2026-04-18', 'paid',
   4780, 0, 4780, 4780, 0, 'system', 'Seed Data'),

  -- J-1003: Galvanizing
  ('e0000000-0000-0000-0000-000000000005', 'd0000000-0000-0000-0000-000000000005',
   'b0000000-0000-0000-0000-000000000003', 'TSG-26-0089', '2026-03-01', '2026-03-31', 'paid',
   2800, 0, 2800, 2800, 0, 'system', 'Seed Data'),

  -- J-1006: Environmental cleanup
  ('e0000000-0000-0000-0000-000000000006', 'd0000000-0000-0000-0000-000000000003',
   'b0000000-0000-0000-0000-000000000006', 'KYES-2026-042', '2026-04-05', '2026-05-05', 'open',
   3800, 0, 3800, 0, 3800, 'system', 'Seed Data')
ON CONFLICT (id) DO NOTHING;
