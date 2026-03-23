# TPS Remote Monitoring System

## What this is
A production monitoring system for Tie Plate Systems (TPS) deployed on 30+ railroad trucks. Each truck has a Raspberry Pi 5 connected to a Click PLC C0-10DD2E-D via Modbus TCP. The Pi reads PLC registers, sends data to Viam Cloud, and a Next.js dashboard on Vercel displays live status.

**There is NO E-Cat, NO servo/robot, NO vision in this system. TPS only.**

## Architecture
- **Pi → PLC**: Modbus TCP (host: 169.168.10.21, port: 502) over Ethernet
- **Pi → Cloud**: Viam SDK, captures at 1 Hz, syncs every 6 seconds
- **Dashboard → Cloud**: Next.js API routes proxy Viam credentials server-side
- **History**: Viam Data API (`exportTabularData`) for shift summaries
- **Offline**: JSONL buffer at `/home/andrew/.viam/offline-buffer/` (50MB cap)

## Key directories
- `modules/plc-sensor/src/plc_sensor.py` — Core sensor module (THE critical file)
- `modules/plc-sensor/src/diagnostics.py` — Diagnostic rules engine (14 rules, standalone)
- `dashboard/` — Next.js app deployed on Vercel
- `dashboard/app/dev/page.tsx` — Dev mode page for testing/calibration
- `dashboard/app/api/sensor-readings/route.ts` — Live sensor data proxy
- `dashboard/app/api/sensor-history/route.ts` — Historical data via Viam Data API
- `config/viam-server.json` — Local viam-server config
- `config/fragment-tps-truck.json` — Fleet template for all trucks
- `docs/plc-register-map.md` — Complete PLC register map (478 registers decoded)
- `docs/dashboard-guide.md` — Field guide for operators
- `docs/analog-monitoring-spec.md` — Hardware upgrade spec for fuse/wire diagnosis

## ⚠️ CRITICAL: Encoder Distance Calculation
**DO NOT use DD1 for distance.** DD1 is NOT a cumulative counter.

The PLC resets DD1 every ~10 counts at its 0.1ms scan rate (Rung 0 in ladder logic).
The Pi reads at 1Hz and misses thousands of reset cycles. DD1 oscillates 0-13 continuously.
Using DD1 for distance produces garbage data.

**Distance MUST come from DS10 (Encoder Next Tie):**
- DS10 counts down from DS3 (typically 195 = 19.5") to 0 in 0.1-inch units
- Each full countdown cycle = one tie spacing of travel
- Track the countdown and accumulate distance from deltas
- 1 DS10 unit = 0.1 inch = 2.54mm
- This is reliable at any sample rate because DS10 changes slowly (~20 counts/sec at typical speeds)

DD1 is still read and reported as `encoder_count` for raw display, but is NOT used for distance, speed, or revolutions.

See `docs/encoder-distance.md` for the full explanation.

## PLC Register Map (decoded from .ckp project file)
478 registers fully decoded. Key registers:

**DS Registers (Holding 0-24):**
- DS1: Encoder Ignore (threshold)
- DS2: Adjustable Tie Spacing (×0.5", so 39 = 19.5")
- DS3: Tie Spacing (×0.1", so 195 = 19.5")
- DS5: Detector Offset Bits
- DS6: Detector Offset (×0.1", so 6070 = 607.0")
- DS7: Plate Count
- DS8: AVG Plates per Min
- DS9: Detector Next Tie
- DS10: **Encoder Next Tie** — THE distance source (see above)
- DS19: HMI screen control

**DD1**: Raw HSC encoder count (NOT usable for distance — see warning above)

**C-bits**: 34 application coils including operating modes (C20-C27), drop pipeline (C16/C17/C29/C30/C32), detection (C3/C12/C7)

**Full map**: `docs/plc-register-map.md`

## Diagnostic Engine
14 rules in `diagnostics.py` across 5 categories (camera, encoder, eject, PLC, operation). Each diagnostic includes severity, plain-English title, and step-by-step operator actions. Runs on every 1Hz reading after 60-second warmup.

Rolling signal metrics in `SignalMetrics` class: camera detection rate, eject rate, camera trend (stable/declining/dead/intermittent), encoder noise, Modbus response time, state durations.

## Deployed module location
- Symlink: `/opt/viam-modules/plc-sensor/src/plc_sensor.py` → repo
- Copies (must manually update): `/opt/viam-modules/plc-sensor/run.sh`, `requirements.txt`
- After editing plc_sensor.py: `sudo systemctl restart viam-server`

## Dashboard
- Production: viam-staubli-apera-plc-mobile-poc.vercel.app
- Dev mode: viam-staubli-apera-plc-mobile-poc.vercel.app/dev
- Env vars: VIAM_API_KEY, VIAM_API_KEY_ID, VIAM_MACHINE_ADDRESS, VIAM_PART_ID (server-side) + NEXT_PUBLIC_ variants (client-side)
- Push to git triggers Vercel redeploy

## WiFi priority (NetworkManager)
1. B&B Shop (priority 30) — primary
2. Verizon_X6JPH6 (priority 20) — fallback
3. Andrew hotspot (priority 10) — last resort

## SSH access
- Tailscale IP: 100.112.68.52 (works from any network)

## Rules
- **Never use DD1 for distance** — use DS10 countdown (see above)
- Never add E-Cat, servo, robot, or vision code
- Keep dashboard mobile-friendly
- All Viam credentials stay server-side (Next.js API route), never in browser
- Always branch and PR, never push directly to main (docs excepted)
- Test with: `python3 scripts/test_plc_modbus.py` (reads live PLC)
- Build dashboard with: `cd dashboard && npm run build`
