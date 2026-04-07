-- Seed: Dummy chat data for development/demo
-- Run: SUPABASE_ACCESS_TOKEN=... supabase db query --linked -f dashboard/supabase/seed_chat_dummy_data.sql --workdir dashboard

-- ============================================================================
-- DUMMY USERS (referenced by Clerk-style IDs)
-- These don't create Clerk users — they're just IDs used in chat records.
-- The UI will show sender_name from the message rows.
-- ============================================================================
-- user_andrew    — Andrew Sieg (developer)
-- user_corey     — Corey Smith (manager)
-- user_mike      — Mike Johnson (mechanic)
-- user_jose      — Jose Garcia (mechanic)
-- user_dave      — Dave Wilson (operator)
-- user_sarah     — Sarah Chen (operator)

-- ============================================================================
-- THREADS
-- ============================================================================

-- Thread 1: Truck 01 entity thread
INSERT INTO chat_threads (id, entity_type, entity_id, title, created_by, created_at)
VALUES (
  'a0000000-0000-0000-0000-000000000001',
  'truck', 'truck-01', 'Truck 01', 'user_andrew',
  now() - interval '3 days'
);

-- Thread 2: Truck 02 entity thread
INSERT INTO chat_threads (id, entity_type, entity_id, title, created_by, created_at)
VALUES (
  'a0000000-0000-0000-0000-000000000002',
  'truck', 'truck-02', 'Truck 02', 'user_corey',
  now() - interval '2 days'
);

-- Thread 3: DTC thread (SCR issue on Truck 01)
INSERT INTO chat_threads (id, entity_type, entity_id, title, created_by, created_at)
VALUES (
  'a0000000-0000-0000-0000-000000000003',
  'dtc', 'SPN-4364-FMI-18', 'DTC: SCR Inlet Temp Signal Missing', 'user_mike',
  now() - interval '1 day'
);

-- Thread 4: Work order thread
INSERT INTO chat_threads (id, entity_type, entity_id, title, created_by, created_at)
VALUES (
  'a0000000-0000-0000-0000-000000000004',
  'work_order', 'WO-2026-0042', 'WO-2026-0042: DEF System Service', 'user_corey',
  now() - interval '12 hours'
);

-- Thread 5: Direct message (Andrew <-> Mike)
INSERT INTO chat_threads (id, entity_type, entity_id, title, created_by, created_at)
VALUES (
  'a0000000-0000-0000-0000-000000000005',
  'direct', NULL, NULL, 'user_andrew',
  now() - interval '6 hours'
);

-- Thread 6: Direct message (Corey <-> Jose)
INSERT INTO chat_threads (id, entity_type, entity_id, title, created_by, created_at)
VALUES (
  'a0000000-0000-0000-0000-000000000006',
  'direct', NULL, NULL, 'user_corey',
  now() - interval '4 hours'
);

-- ============================================================================
-- THREAD MEMBERS
-- ============================================================================

-- Thread 1 (Truck 01): Andrew, Mike, Dave
INSERT INTO chat_thread_members (thread_id, user_id, last_read_at, joined_at) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'user_andrew', now() - interval '1 hour', now() - interval '3 days'),
  ('a0000000-0000-0000-0000-000000000001', 'user_mike', now() - interval '2 hours', now() - interval '3 days'),
  ('a0000000-0000-0000-0000-000000000001', 'user_dave', now() - interval '5 hours', now() - interval '2 days');

-- Thread 2 (Truck 02): Corey, Jose, Sarah
INSERT INTO chat_thread_members (thread_id, user_id, last_read_at, joined_at) VALUES
  ('a0000000-0000-0000-0000-000000000002', 'user_corey', now() - interval '30 minutes', now() - interval '2 days'),
  ('a0000000-0000-0000-0000-000000000002', 'user_jose', now() - interval '1 hour', now() - interval '2 days'),
  ('a0000000-0000-0000-0000-000000000002', 'user_sarah', now() - interval '3 hours', now() - interval '1 day');

-- Thread 3 (DTC): Mike, Andrew, Corey
INSERT INTO chat_thread_members (thread_id, user_id, last_read_at, joined_at) VALUES
  ('a0000000-0000-0000-0000-000000000003', 'user_mike', now() - interval '20 minutes', now() - interval '1 day'),
  ('a0000000-0000-0000-0000-000000000003', 'user_andrew', now() - interval '40 minutes', now() - interval '1 day'),
  ('a0000000-0000-0000-0000-000000000003', 'user_corey', now() - interval '3 hours', now() - interval '1 day');

-- Thread 4 (Work Order): Corey, Jose, Mike
INSERT INTO chat_thread_members (thread_id, user_id, last_read_at, joined_at) VALUES
  ('a0000000-0000-0000-0000-000000000004', 'user_corey', now() - interval '10 minutes', now() - interval '12 hours'),
  ('a0000000-0000-0000-0000-000000000004', 'user_jose', now() - interval '1 hour', now() - interval '12 hours'),
  ('a0000000-0000-0000-0000-000000000004', 'user_mike', now() - interval '2 hours', now() - interval '10 hours');

-- Thread 5 (DM Andrew <-> Mike)
INSERT INTO chat_thread_members (thread_id, user_id, last_read_at, joined_at) VALUES
  ('a0000000-0000-0000-0000-000000000005', 'user_andrew', now() - interval '30 minutes', now() - interval '6 hours'),
  ('a0000000-0000-0000-0000-000000000005', 'user_mike', now() - interval '1 hour', now() - interval '6 hours');

-- Thread 6 (DM Corey <-> Jose)
INSERT INTO chat_thread_members (thread_id, user_id, last_read_at, joined_at) VALUES
  ('a0000000-0000-0000-0000-000000000006', 'user_corey', now() - interval '15 minutes', now() - interval '4 hours'),
  ('a0000000-0000-0000-0000-000000000006', 'user_jose', now() - interval '2 hours', now() - interval '4 hours');

-- ============================================================================
-- MESSAGES
-- ============================================================================

-- ---------- Thread 1: Truck 01 ----------

INSERT INTO chat_messages (id, thread_id, sender_id, sender_name, sender_role, message_type, body, created_at) VALUES
  ('b0000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-000000000001',
   'user_andrew', 'Andrew Sieg', 'developer', 'user',
   'Just set up the IronSight monitoring on Truck 01. CAN bus is reading clean — 250kbps, zero frame drops so far.',
   now() - interval '3 days');

INSERT INTO chat_messages (id, thread_id, sender_id, sender_name, sender_role, message_type, body, created_at) VALUES
  ('b0000000-0000-0000-0000-000000000002',
   'a0000000-0000-0000-0000-000000000001',
   'user_mike', 'Mike Johnson', 'mechanic', 'user',
   'Nice. Coolant temp has been running a little hot on this one — been meaning to check the thermostat. Can you see it on the dashboard?',
   now() - interval '3 days' + interval '15 minutes');

INSERT INTO chat_messages (id, thread_id, sender_id, sender_name, sender_role, message_type, body, created_at) VALUES
  ('b0000000-0000-0000-0000-000000000003',
   'a0000000-0000-0000-0000-000000000001',
   'user_andrew', 'Andrew Sieg', 'developer', 'user',
   'Yeah, seeing 215°F on coolant right now. Gauge threshold is set to warn at 220°F. I''ll keep an eye on the trend.',
   now() - interval '3 days' + interval '20 minutes');

INSERT INTO chat_messages (id, thread_id, sender_id, sender_name, sender_role, message_type, body, snapshot, created_at) VALUES
  ('b0000000-0000-0000-0000-000000000004',
   'a0000000-0000-0000-0000-000000000001',
   'user_andrew', 'Andrew Sieg', 'developer', 'snapshot',
   'Sensor snapshot from Truck 01',
   '{"engine_rpm": 1250, "coolant_temp_f": 215, "oil_pressure_psi": 42, "boost_pressure_psi": 18.5, "battery_voltage": 13.8, "vehicle_speed_mph": 0, "fuel_rate_gph": 3.2, "transmission_temp_f": 185}',
   now() - interval '3 days' + interval '21 minutes');

INSERT INTO chat_messages (id, thread_id, sender_id, sender_name, sender_role, message_type, body, created_at) VALUES
  ('b0000000-0000-0000-0000-000000000005',
   'a0000000-0000-0000-0000-000000000001',
   'user_dave', 'Dave Wilson', 'operator', 'user',
   'She''s been running warm all week. Usually settles around 210 once we get moving but at idle it creeps up.',
   now() - interval '2 days');

INSERT INTO chat_messages (id, thread_id, sender_id, sender_name, sender_role, message_type, body, created_at) VALUES
  ('b0000000-0000-0000-0000-000000000006',
   'a0000000-0000-0000-0000-000000000001',
   'user_mike', 'Mike Johnson', 'mechanic', 'user',
   'Sounds like the fan clutch might be getting lazy. I''ll check it Thursday when we swap the filters.',
   now() - interval '2 days' + interval '30 minutes');

INSERT INTO chat_messages (id, thread_id, sender_id, sender_name, sender_role, message_type, body, created_at) VALUES
  ('b0000000-0000-0000-0000-000000000007',
   'a0000000-0000-0000-0000-000000000001',
   'user_andrew', 'Andrew Sieg', 'developer', 'user',
   '@ai What could cause coolant temp running 215°F at idle on a 2013 Mack Granite? Fan clutch was suggested.',
   now() - interval '1 day');

INSERT INTO chat_messages (id, thread_id, sender_id, sender_name, sender_role, message_type, body, created_at) VALUES
  ('b0000000-0000-0000-0000-000000000008',
   'a0000000-0000-0000-0000-000000000001',
   'IronSight AI', 'IronSight AI', 'ai', 'ai',
   '215°F at idle on a Mack Granite could indicate a few things:\n\n1. **Fan clutch engagement** — if the viscous clutch isn''t fully engaging at temp, airflow at idle will be insufficient. Check for silicone fluid leaks around the hub.\n2. **Thermostat sticking partially open** — opens too early, never lets the engine reach optimal temp under load, but at idle with no airflow the reduced circulation can''t shed heat fast enough.\n3. **Coolant level/air pocket** — low coolant or trapped air near the sensor can give artificially high readings.\n4. **Radiator fins** — railroad dust and debris clog the fins fast on these trucks.\n\nThe fan clutch theory is solid — that''s the #1 idle overheat cause on MP7/MP8 engines. Does the fan roar on startup when it''s cold? If yes, clutch is probably fine. If it''s always quiet, the clutch needs replacement.\n\nQuestions to narrow it down:\n- Has anyone checked the coolant level recently?\n- Does the temp drop back to normal range when driving at speed?',
   now() - interval '1 day' + interval '1 minute');

-- ---------- Thread 2: Truck 02 ----------

INSERT INTO chat_messages (id, thread_id, sender_id, sender_name, sender_role, message_type, body, created_at) VALUES
  ('b0000000-0000-0000-0000-000000000010',
   'a0000000-0000-0000-0000-000000000002',
   'user_corey', 'Corey Smith', 'manager', 'user',
   'Truck 02 is next on the install list. Jose, can you make sure it''s parked in Bay 3 tomorrow morning?',
   now() - interval '2 days');

INSERT INTO chat_messages (id, thread_id, sender_id, sender_name, sender_role, message_type, body, created_at) VALUES
  ('b0000000-0000-0000-0000-000000000011',
   'a0000000-0000-0000-0000-000000000002',
   'user_jose', 'Jose Garcia', 'mechanic', 'user',
   'Will do. I think it has a loose exhaust bracket too — want me to knock that out while it''s in?',
   now() - interval '2 days' + interval '45 minutes');

INSERT INTO chat_messages (id, thread_id, sender_id, sender_name, sender_role, message_type, body, created_at) VALUES
  ('b0000000-0000-0000-0000-000000000012',
   'a0000000-0000-0000-0000-000000000002',
   'user_corey', 'Corey Smith', 'manager', 'user',
   'Yeah go ahead. Log it as a separate work order though so we can track hours.',
   now() - interval '2 days' + interval '1 hour');

INSERT INTO chat_messages (id, thread_id, sender_id, sender_name, sender_role, message_type, body, created_at) VALUES
  ('b0000000-0000-0000-0000-000000000013',
   'a0000000-0000-0000-0000-000000000002',
   'user_sarah', 'Sarah Chen', 'operator', 'user',
   'Heads up — Truck 02 is pulling a little to the right. Noticed it on the last run. Alignment maybe?',
   now() - interval '1 day');

INSERT INTO chat_messages (id, thread_id, sender_id, sender_name, sender_role, message_type, body, created_at) VALUES
  ('b0000000-0000-0000-0000-000000000014',
   'a0000000-0000-0000-0000-000000000002',
   'user_jose', 'Jose Garcia', 'mechanic', 'user',
   'Thanks for the heads up Sarah. Could be a tie rod end. I''ll inspect when it comes in.',
   now() - interval '1 day' + interval '2 hours');

-- ---------- Thread 3: DTC (SCR Issue) ----------

INSERT INTO chat_messages (id, thread_id, sender_id, sender_name, sender_role, message_type, body, created_at) VALUES
  ('b0000000-0000-0000-0000-000000000020',
   'a0000000-0000-0000-0000-000000000003',
   'user_mike', 'Mike Johnson', 'mechanic', 'system',
   'DTC Alert: SPN 4364, FMI 18 — SCR Inlet Temperature Signal Missing (Truck 01)',
   now() - interval '1 day');

INSERT INTO chat_messages (id, thread_id, sender_id, sender_name, sender_role, message_type, body, created_at) VALUES
  ('b0000000-0000-0000-0000-000000000021',
   'a0000000-0000-0000-0000-000000000003',
   'user_mike', 'Mike Johnson', 'mechanic', 'user',
   'This is the one that''s been killing our DEF efficiency. Protect lamp came on last week because of it.',
   now() - interval '1 day' + interval '5 minutes');

INSERT INTO chat_messages (id, thread_id, sender_id, sender_name, sender_role, message_type, body, created_at) VALUES
  ('b0000000-0000-0000-0000-000000000022',
   'a0000000-0000-0000-0000-000000000003',
   'user_andrew', 'Andrew Sieg', 'developer', 'user',
   'I can see it in the diagnostics — SCR efficiency dropped to 28%. The sensor signal is completely missing, not just intermittent.',
   now() - interval '1 day' + interval '15 minutes');

INSERT INTO chat_messages (id, thread_id, sender_id, sender_name, sender_role, message_type, body, created_at) VALUES
  ('b0000000-0000-0000-0000-000000000023',
   'a0000000-0000-0000-0000-000000000003',
   'user_corey', 'Corey Smith', 'manager', 'user',
   'How much is the sensor? And how long to swap it? We can''t have this truck derated much longer.',
   now() - interval '23 hours');

INSERT INTO chat_messages (id, thread_id, sender_id, sender_name, sender_role, message_type, body, created_at) VALUES
  ('b0000000-0000-0000-0000-000000000024',
   'a0000000-0000-0000-0000-000000000003',
   'user_mike', 'Mike Johnson', 'mechanic', 'user',
   'Sensor is about $180, maybe 2 hours with the exhaust heat shield removal. Could also be the wiring harness — I''ll check connectors first.',
   now() - interval '22 hours');

INSERT INTO chat_messages (id, thread_id, sender_id, sender_name, sender_role, message_type, body, created_at) VALUES
  ('b0000000-0000-0000-0000-000000000025',
   'a0000000-0000-0000-0000-000000000003',
   'user_corey', 'Corey Smith', 'manager', 'user',
   'Do it. Order the sensor now as backup. If it''s just a connector, even better.',
   now() - interval '21 hours');

-- ---------- Thread 4: Work Order ----------

INSERT INTO chat_messages (id, thread_id, sender_id, sender_name, sender_role, message_type, body, created_at) VALUES
  ('b0000000-0000-0000-0000-000000000030',
   'a0000000-0000-0000-0000-000000000004',
   'user_corey', 'Corey Smith', 'manager', 'system',
   'Work order WO-2026-0042 created: DEF System Service — Truck 01',
   now() - interval '12 hours');

INSERT INTO chat_messages (id, thread_id, sender_id, sender_name, sender_role, message_type, body, created_at) VALUES
  ('b0000000-0000-0000-0000-000000000031',
   'a0000000-0000-0000-0000-000000000004',
   'user_corey', 'Corey Smith', 'manager', 'user',
   'Jose, this one''s yours. SCR inlet temp sensor replacement + full DEF system check. Parts are on the way.',
   now() - interval '12 hours' + interval '5 minutes');

INSERT INTO chat_messages (id, thread_id, sender_id, sender_name, sender_role, message_type, body, created_at) VALUES
  ('b0000000-0000-0000-0000-000000000032',
   'a0000000-0000-0000-0000-000000000004',
   'user_jose', 'Jose Garcia', 'mechanic', 'user',
   'Got it. I''ll pull the heat shield first thing. Mike mentioned the connector might be corroded too.',
   now() - interval '11 hours');

INSERT INTO chat_messages (id, thread_id, sender_id, sender_name, sender_role, message_type, body, created_at) VALUES
  ('b0000000-0000-0000-0000-000000000033',
   'a0000000-0000-0000-0000-000000000004',
   'user_mike', 'Mike Johnson', 'mechanic', 'user',
   'Yeah check the 4-pin connector at the SCR brick. These Macks are notorious for heat damage on that harness.',
   now() - interval '10 hours');

INSERT INTO chat_messages (id, thread_id, sender_id, sender_name, sender_role, message_type, body, created_at) VALUES
  ('b0000000-0000-0000-0000-000000000034',
   'a0000000-0000-0000-0000-000000000004',
   'user_jose', 'Jose Garcia', 'mechanic', 'user',
   'Update: connector looked fine but the sensor itself is dead. Swapping it now. Should be done by lunch.',
   now() - interval '4 hours');

-- ---------- Thread 5: DM (Andrew <-> Mike) ----------

INSERT INTO chat_messages (id, thread_id, sender_id, sender_name, sender_role, message_type, body, created_at) VALUES
  ('b0000000-0000-0000-0000-000000000040',
   'a0000000-0000-0000-0000-000000000005',
   'user_andrew', 'Andrew Sieg', 'developer', 'user',
   'Hey Mike, quick question — when you clear DTCs on the Mack, does the ECU need a key cycle to fully reset?',
   now() - interval '6 hours');

INSERT INTO chat_messages (id, thread_id, sender_id, sender_name, sender_role, message_type, body, created_at) VALUES
  ('b0000000-0000-0000-0000-000000000041',
   'a0000000-0000-0000-0000-000000000005',
   'user_mike', 'Mike Johnson', 'mechanic', 'user',
   'Depends on the DTC. Active codes clear right away with DM11 but stored codes need a key cycle. Some emissions codes won''t clear until the fault condition is actually fixed.',
   now() - interval '5 hours');

INSERT INTO chat_messages (id, thread_id, sender_id, sender_name, sender_role, message_type, body, created_at) VALUES
  ('b0000000-0000-0000-0000-000000000042',
   'a0000000-0000-0000-0000-000000000005',
   'user_andrew', 'Andrew Sieg', 'developer', 'user',
   'That makes sense. I''m adding remote DTC clear to the dashboard and want to set expectations right. I''ll add a note that says "active codes cleared — key cycle may be needed for stored codes."',
   now() - interval '4 hours');

INSERT INTO chat_messages (id, thread_id, sender_id, sender_name, sender_role, message_type, body, created_at) VALUES
  ('b0000000-0000-0000-0000-000000000043',
   'a0000000-0000-0000-0000-000000000005',
   'user_mike', 'Mike Johnson', 'mechanic', 'user',
   'Perfect. Also maybe add a warning that clearing emissions codes without fixing the problem just means they come back. Don''t want operators thinking clear = fixed 😄',
   now() - interval '3 hours');

-- ---------- Thread 6: DM (Corey <-> Jose) ----------

INSERT INTO chat_messages (id, thread_id, sender_id, sender_name, sender_role, message_type, body, created_at) VALUES
  ('b0000000-0000-0000-0000-000000000050',
   'a0000000-0000-0000-0000-000000000006',
   'user_corey', 'Corey Smith', 'manager', 'user',
   'Jose, how''s the DEF job looking? Parts arrive yet?',
   now() - interval '4 hours');

INSERT INTO chat_messages (id, thread_id, sender_id, sender_name, sender_role, message_type, body, created_at) VALUES
  ('b0000000-0000-0000-0000-000000000051',
   'a0000000-0000-0000-0000-000000000006',
   'user_jose', 'Jose Garcia', 'mechanic', 'user',
   'Sensor came in this morning. I''m about halfway through — heat shield is off, old sensor is out. New one goes in after lunch.',
   now() - interval '3 hours');

INSERT INTO chat_messages (id, thread_id, sender_id, sender_name, sender_role, message_type, body, created_at) VALUES
  ('b0000000-0000-0000-0000-000000000052',
   'a0000000-0000-0000-0000-000000000006',
   'user_corey', 'Corey Smith', 'manager', 'user',
   'Good deal. Let me know when it''s done and we''ll clear the DTC from the dashboard to verify.',
   now() - interval '2 hours');

-- ============================================================================
-- REACTIONS
-- ============================================================================

-- Reactions on Thread 1 messages
INSERT INTO chat_reactions (message_id, user_id, reaction) VALUES
  ('b0000000-0000-0000-0000-000000000001', 'user_mike', 'thumbs_up'),
  ('b0000000-0000-0000-0000-000000000001', 'user_dave', 'thumbs_up'),
  ('b0000000-0000-0000-0000-000000000003', 'user_mike', 'eyes'),
  ('b0000000-0000-0000-0000-000000000006', 'user_andrew', 'wrench'),
  ('b0000000-0000-0000-0000-000000000006', 'user_dave', 'thumbs_up'),
  ('b0000000-0000-0000-0000-000000000008', 'user_mike', 'thumbs_up'),
  ('b0000000-0000-0000-0000-000000000008', 'user_andrew', 'thumbs_up'),
  ('b0000000-0000-0000-0000-000000000008', 'user_dave', 'eyes');

-- Reactions on Thread 3 (DTC) messages
INSERT INTO chat_reactions (message_id, user_id, reaction) VALUES
  ('b0000000-0000-0000-0000-000000000025', 'user_mike', 'checkmark'),
  ('b0000000-0000-0000-0000-000000000025', 'user_andrew', 'thumbs_up');

-- Reactions on Thread 4 (Work Order) messages
INSERT INTO chat_reactions (message_id, user_id, reaction) VALUES
  ('b0000000-0000-0000-0000-000000000034', 'user_corey', 'thumbs_up'),
  ('b0000000-0000-0000-0000-000000000034', 'user_mike', 'wrench');

-- Reaction on DM
INSERT INTO chat_reactions (message_id, user_id, reaction) VALUES
  ('b0000000-0000-0000-0000-000000000043', 'user_andrew', 'thumbs_up');

-- ============================================================================
-- DONE — 6 threads, 6 users, 28 messages, 13 reactions
-- ============================================================================
