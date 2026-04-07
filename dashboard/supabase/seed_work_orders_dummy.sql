-- Seed: Comprehensive work order dummy data for demo
-- Ensures both trucks have a mix of active, blocked, completed work orders
-- with subtasks, notes, linked DTCs, and proper user references.
--
-- Run: SUPABASE_ACCESS_TOKEN=... supabase db query --linked -f dashboard/supabase/seed_work_orders_dummy.sql --workdir dashboard

-- ============================================================================
-- Fix existing work orders: assign truck + match user IDs to chat dummy users
-- ============================================================================

-- "Replace alternator" had no truck — assign to truck-01
UPDATE work_orders SET truck_id = 'truck-01' WHERE title = 'Replace alternator on truck 1' AND truck_id IS NULL;

-- ============================================================================
-- TRUCK-02 WORK ORDERS (currently has none)
-- ============================================================================

-- WO: Active — tie rod inspection (Sarah reported pulling right in chat)
INSERT INTO work_orders (id, truck_id, title, description, status, priority, assigned_to, assigned_to_name, created_by, created_by_name, linked_dtcs, created_at, updated_at)
VALUES (
  'c0000000-0000-0000-0000-000000000001',
  'truck-02',
  'Inspect tie rod ends — pulling right',
  'Sarah reported Truck 02 pulling to the right on the last run. Could be tie rod end or alignment. Check both sides, measure play.',
  'in_progress', 'normal',
  'user_jose', 'Jose Garcia',
  'user_corey', 'Corey Smith',
  '[]',
  now() - interval '1 day', now() - interval '4 hours'
);

INSERT INTO work_order_subtasks (work_order_id, title, is_done, sort_order) VALUES
  ('c0000000-0000-0000-0000-000000000001', 'Jack up front axle and check for play', true, 0),
  ('c0000000-0000-0000-0000-000000000001', 'Inspect inner and outer tie rod ends', true, 1),
  ('c0000000-0000-0000-0000-000000000001', 'Check drag link and steering gear for leaks', false, 2),
  ('c0000000-0000-0000-0000-000000000001', 'Replace if worn — order Mack part #25156020', false, 3),
  ('c0000000-0000-0000-0000-000000000001', 'Test drive and verify alignment', false, 4);

INSERT INTO work_order_notes (work_order_id, author_id, author_name, body, created_at) VALUES
  ('c0000000-0000-0000-0000-000000000001', 'user_jose', 'Jose Garcia', 'Outer tie rod on passenger side has about 1/8" of play. Ordering replacement now.', now() - interval '4 hours'),
  ('c0000000-0000-0000-0000-000000000001', 'user_corey', 'Corey Smith', 'Part should be here tomorrow morning. Dont put the truck back out until this is fixed.', now() - interval '3 hours');

-- WO: Active — exhaust bracket repair
INSERT INTO work_orders (id, truck_id, title, description, status, priority, assigned_to, assigned_to_name, created_by, created_by_name, linked_dtcs, created_at, updated_at)
VALUES (
  'c0000000-0000-0000-0000-000000000002',
  'truck-02',
  'Weld loose exhaust bracket',
  'Loose bracket near turbo downpipe. Rattles bad at idle. Quick weld job.',
  'open', 'low',
  'user_jose', 'Jose Garcia',
  'user_corey', 'Corey Smith',
  '[]',
  now() - interval '2 days', now() - interval '2 days'
);

-- WO: Completed — oil change
INSERT INTO work_orders (id, truck_id, title, description, status, priority, assigned_to, assigned_to_name, created_by, created_by_name, linked_dtcs, completed_at, created_at, updated_at)
VALUES (
  'c0000000-0000-0000-0000-000000000003',
  'truck-02',
  'Oil & filter change — 15,000 mile service',
  'Standard PM. Rotella T6 15W-40, Donaldson P551005 filter. Check for metal in drain plug magnet.',
  'done', 'normal',
  'user_jose', 'Jose Garcia',
  'user_corey', 'Corey Smith',
  '[]',
  now() - interval '5 days',
  now() - interval '7 days', now() - interval '5 days'
);

INSERT INTO work_order_subtasks (work_order_id, title, is_done, sort_order) VALUES
  ('c0000000-0000-0000-0000-000000000003', 'Drain oil and inspect for metal', true, 0),
  ('c0000000-0000-0000-0000-000000000003', 'Replace oil filter (Donaldson P551005)', true, 1),
  ('c0000000-0000-0000-0000-000000000003', 'Replace drain plug gasket', true, 2),
  ('c0000000-0000-0000-0000-000000000003', 'Fill with 10 gal Rotella T6 15W-40', true, 3),
  ('c0000000-0000-0000-0000-000000000003', 'Run engine 5 min, check for leaks', true, 4),
  ('c0000000-0000-0000-0000-000000000003', 'Record mileage on maintenance log', true, 5);

INSERT INTO work_order_notes (work_order_id, author_id, author_name, body, created_at) VALUES
  ('c0000000-0000-0000-0000-000000000003', 'user_jose', 'Jose Garcia', 'No metal on drain plug. Oil looked normal, maybe slightly dark but fine for 15k. Filter was clean.', now() - interval '5 days'),
  ('c0000000-0000-0000-0000-000000000003', 'user_jose', 'Jose Garcia', 'Done. 42,387 miles on odometer. Next service at 57,387.', now() - interval '5 days' + interval '2 hours');

-- WO: Completed — IronSight install
INSERT INTO work_orders (id, truck_id, title, description, status, priority, assigned_to, assigned_to_name, created_by, created_by_name, linked_dtcs, completed_at, created_at, updated_at)
VALUES (
  'c0000000-0000-0000-0000-000000000004',
  'truck-02',
  'Install IronSight monitoring system',
  'Pi 5 + Pi Zero install. CAN HAT wiring, OBD port tap, Tailscale setup, Viam config.',
  'done', 'normal',
  'user_andrew', 'Andrew Sieg',
  'user_andrew', 'Andrew Sieg',
  '[]',
  now() - interval '3 days',
  now() - interval '4 days', now() - interval '3 days'
);

INSERT INTO work_order_subtasks (work_order_id, title, is_done, sort_order) VALUES
  ('c0000000-0000-0000-0000-000000000004', 'Mount Pi 5 in cab (behind dash)', true, 0),
  ('c0000000-0000-0000-0000-000000000004', 'Mount Pi Zero near OBD port', true, 1),
  ('c0000000-0000-0000-0000-000000000004', 'Wire CAN HAT to J1939 pins 3/11', true, 2),
  ('c0000000-0000-0000-0000-000000000004', 'Verify 250kbps listen-only CAN bus', true, 3),
  ('c0000000-0000-0000-0000-000000000004', 'Configure Viam cloud sync', true, 4),
  ('c0000000-0000-0000-0000-000000000004', 'Test data flow to dashboard', true, 5),
  ('c0000000-0000-0000-0000-000000000004', 'Confirm Tailscale connectivity', true, 6);

INSERT INTO work_order_notes (work_order_id, author_id, author_name, body, created_at) VALUES
  ('c0000000-0000-0000-0000-000000000004', 'user_andrew', 'Andrew Sieg', 'CAN bus reading clean. 250kbps, zero frame drops. All 15 PGNs decoding correctly.', now() - interval '3 days'),
  ('c0000000-0000-0000-0000-000000000004', 'user_andrew', 'Andrew Sieg', 'Dashboard confirmed live. Truck 02 visible on fleet page. Data syncing at 1Hz.', now() - interval '3 days' + interval '1 hour');

-- ============================================================================
-- TRUCK-01: Add more depth (some already exist, adding what's missing)
-- ============================================================================

-- WO: Completed — SCR sensor replacement (ties to the DTC chat thread)
INSERT INTO work_orders (id, truck_id, title, description, status, priority, assigned_to, assigned_to_name, created_by, created_by_name, linked_dtcs, completed_at, created_at, updated_at)
VALUES (
  'c0000000-0000-0000-0000-000000000010',
  'truck-01',
  'Replace SCR inlet temp sensor — SPN 4364',
  'SCR inlet temp signal missing. DEF disabled, efficiency at 28%, Protect Lamp active. Sensor is dead, connector was fine.',
  'done', 'urgent',
  'user_jose', 'Jose Garcia',
  'user_corey', 'Corey Smith',
  '[{"spn": 4364, "fmi": 18, "ecuLabel": "Engine"}]',
  now() - interval '3 hours',
  now() - interval '12 hours', now() - interval '3 hours'
);

INSERT INTO work_order_subtasks (work_order_id, title, is_done, sort_order) VALUES
  ('c0000000-0000-0000-0000-000000000010', 'Remove exhaust heat shield', true, 0),
  ('c0000000-0000-0000-0000-000000000010', 'Inspect 4-pin connector at SCR brick', true, 1),
  ('c0000000-0000-0000-0000-000000000010', 'Replace SCR inlet temp sensor', true, 2),
  ('c0000000-0000-0000-0000-000000000010', 'Reinstall heat shield', true, 3),
  ('c0000000-0000-0000-0000-000000000010', 'Clear DTC via dashboard', true, 4),
  ('c0000000-0000-0000-0000-000000000010', 'Verify SCR efficiency > 90% after warmup', true, 5);

INSERT INTO work_order_notes (work_order_id, author_id, author_name, body, created_at) VALUES
  ('c0000000-0000-0000-0000-000000000010', 'user_mike', 'Mike Johnson', 'Connector looked fine — no corrosion. The sensor itself is dead. No resistance reading.', now() - interval '6 hours'),
  ('c0000000-0000-0000-0000-000000000010', 'user_jose', 'Jose Garcia', 'New sensor in. Heat shield back on. Starting truck now to verify.', now() - interval '4 hours'),
  ('c0000000-0000-0000-0000-000000000010', 'user_jose', 'Jose Garcia', 'SCR inlet temp reading 285°F after warmup. Efficiency climbing back up. Clearing DTC now.', now() - interval '3 hours' - interval '30 minutes'),
  ('c0000000-0000-0000-0000-000000000010', 'user_andrew', 'Andrew Sieg', 'Confirmed on dashboard: DTC cleared, Protect Lamp off, SCR efficiency at 94%. All good.', now() - interval '3 hours');

-- WO: Completed — IronSight install on Truck 01 (historical)
INSERT INTO work_orders (id, truck_id, title, description, status, priority, assigned_to, assigned_to_name, created_by, created_by_name, linked_dtcs, completed_at, created_at, updated_at)
VALUES (
  'c0000000-0000-0000-0000-000000000011',
  'truck-01',
  'Install IronSight monitoring — Truck 01',
  'First truck install. Pi 5 for TPS + Pi Zero for J1939 diagnostics.',
  'done', 'normal',
  'user_andrew', 'Andrew Sieg',
  'user_andrew', 'Andrew Sieg',
  '[]',
  now() - interval '14 days',
  now() - interval '16 days', now() - interval '14 days'
);

INSERT INTO work_order_subtasks (work_order_id, title, is_done, sort_order) VALUES
  ('c0000000-0000-0000-0000-000000000011', 'Mount Pi 5 + PLC Ethernet', true, 0),
  ('c0000000-0000-0000-0000-000000000011', 'Mount Pi Zero + CAN HAT', true, 1),
  ('c0000000-0000-0000-0000-000000000011', 'Wire J1939 pins 3/11 with 120R terminator', true, 2),
  ('c0000000-0000-0000-0000-000000000011', 'Validate 6.6M CAN frames zero drops', true, 3),
  ('c0000000-0000-0000-0000-000000000011', 'Deploy dashboard to Vercel', true, 4);

INSERT INTO work_order_notes (work_order_id, author_id, author_name, body, created_at) VALUES
  ('c0000000-0000-0000-0000-000000000011', 'user_andrew', 'Andrew Sieg', 'First truck fully online. CAN bus validated: 6.6M frames, zero drops. Remote DTC clear tested and working.', now() - interval '14 days');

-- WO: Active — fan clutch inspection (from the chat conversation)
INSERT INTO work_orders (id, truck_id, title, description, status, priority, assigned_to, assigned_to_name, created_by, created_by_name, linked_dtcs, created_at, updated_at,
  truck_snapshot)
VALUES (
  'c0000000-0000-0000-0000-000000000012',
  'truck-01',
  'Check fan clutch — coolant running hot at idle',
  'Coolant at 215°F at idle, drops to 210°F under load. Possible fan clutch not fully engaging. Check for silicone fluid leaks around hub.',
  'open', 'normal',
  'user_mike', 'Mike Johnson',
  'user_andrew', 'Andrew Sieg',
  '[]',
  now() - interval '1 day', now() - interval '1 day',
  '{"engine_rpm": 1250, "coolant_temp_f": 215, "oil_pressure_psi": 42, "battery_voltage": 13.8}'
);

INSERT INTO work_order_subtasks (work_order_id, title, is_done, sort_order) VALUES
  ('c0000000-0000-0000-0000-000000000012', 'Check fan engages at cold start (should roar)', false, 0),
  ('c0000000-0000-0000-0000-000000000012', 'Inspect hub for silicone fluid leaks', false, 1),
  ('c0000000-0000-0000-0000-000000000012', 'Check coolant level and bleed air if needed', false, 2),
  ('c0000000-0000-0000-0000-000000000012', 'Clean radiator fins of debris', false, 3),
  ('c0000000-0000-0000-0000-000000000012', 'Monitor temp on IronSight dashboard after fix', false, 4);

INSERT INTO work_order_notes (work_order_id, author_id, author_name, body, created_at) VALUES
  ('c0000000-0000-0000-0000-000000000012', 'user_dave', 'Dave Wilson', 'She runs warm all week. Usually settles around 210 once moving but at idle it creeps up.', now() - interval '1 day'),
  ('c0000000-0000-0000-0000-000000000012', 'user_mike', 'Mike Johnson', 'Ill check it Thursday when we swap the filters. Sounds like the fan clutch is getting lazy.', now() - interval '1 day' + interval '30 minutes');

-- ============================================================================
-- GENERAL (no truck) — shop-level work
-- ============================================================================

-- WO: Active — tool inventory
INSERT INTO work_orders (id, truck_id, title, description, status, priority, assigned_to, assigned_to_name, created_by, created_by_name, linked_dtcs, created_at, updated_at)
VALUES (
  'c0000000-0000-0000-0000-000000000020',
  NULL,
  'Monthly tool inventory and calibration check',
  'Check torque wrenches, pressure gauges, and multimeters. Log any out-of-cal tools.',
  'open', 'low',
  NULL, NULL,
  'user_corey', 'Corey Smith',
  '[]',
  now() - interval '2 days', now() - interval '2 days'
);

-- WO: Active — order DEF in bulk
INSERT INTO work_orders (id, truck_id, title, description, status, priority, assigned_to, assigned_to_name, created_by, created_by_name, linked_dtcs, created_at, updated_at)
VALUES (
  'c0000000-0000-0000-0000-000000000021',
  NULL,
  'Order DEF fluid — fleet bulk purchase',
  'Running low on DEF stock. Need 3 totes (275 gal each) for the fleet. Check pricing at Brenntag and Blue Sky.',
  'in_progress', 'normal',
  'user_corey', 'Corey Smith',
  'user_corey', 'Corey Smith',
  '[]',
  now() - interval '3 days', now() - interval '1 day'
);

INSERT INTO work_order_notes (work_order_id, author_id, author_name, body, created_at) VALUES
  ('c0000000-0000-0000-0000-000000000021', 'user_corey', 'Corey Smith', 'Brenntag quoted $2.10/gal for 3 totes. Blue Sky at $2.35. Going with Brenntag.', now() - interval '1 day'),
  ('c0000000-0000-0000-0000-000000000021', 'user_corey', 'Corey Smith', 'Order placed. Delivery scheduled for Wednesday.', now() - interval '12 hours');

-- ============================================================================
-- DONE — Seed adds:
--   Truck-02: 4 work orders (1 in_progress, 1 open, 2 done)
--   Truck-01: 3 more work orders (1 done SCR fix, 1 done install, 1 open fan clutch)
--   General: 2 shop-level work orders (no truck)
--   Notes: 12 activity notes showing who did what
--   Subtasks: 33 subtask steps across all new orders
--   Linked DTCs: SCR sensor WO linked to SPN 4364 / FMI 18
--   Truck snapshot: Fan clutch WO has sensor readings at creation time
-- ============================================================================
