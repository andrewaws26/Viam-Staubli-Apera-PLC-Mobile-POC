# TPS Remote Monitoring System

## What this is
A production monitoring system for Tie Plate Systems (TPS) deployed on 30+ railroad trucks. Each truck has a Raspberry Pi 5 connected to a Click PLC C0-10DD2E-D via Modbus TCP. The Pi reads PLC registers, sends data to Viam Cloud, and a Next.js dashboard on Vercel displays live status.

**There is NO E-Cat, NO servo/robot, NO vision in this system. TPS only.**

## Architecture
- **Pi → PLC**: Modbus TCP (host: 169.168.10.21, port: 502) over Ethernet
- **Pi → Cloud**: Viam SDK, captures at 1 Hz, syncs every 6 seconds
- **Dashboard → Cloud**: Next.js API route proxies Viam credentials server-side
- **Offline**: JSONL buffer at `/home/andrew/.viam/offline-buffer/` (50MB cap), Viam capture at `/home/andrew/.viam/capture`

## Key directories
- `modules/plc-sensor/src/plc_sensor.py` — Core sensor module (THE critical file). Reads all 25 DS registers, DD1 encoder, discrete inputs. Runs as a Viam module.
- `modules/plc-sensor/run.sh` — Module entry point
- `scripts/test_plc_modbus.py` — Standalone PLC register test script
- `dashboard/` — Next.js app deployed on Vercel
- `dashboard/components/Dashboard.tsx` — Main dashboard component
- `dashboard/components/PlcDetailPanel.tsx` — Detail panel with collapsible raw registers
- `dashboard/components/DiagnosticsPanel.tsx` — System diagnostics with if/then rules
- `dashboard/lib/sensors.ts` — Sensor field definitions and labels
- `dashboard/lib/mock.ts` — Mock data for development (NEXT_PUBLIC_MOCK_MODE=true)
- `dashboard/app/api/sensor-readings/route.ts` — Server-side Viam API proxy
- `config/viam-server.json` — Local viam-server config
- `config/fragment-tps-truck.json` — Fleet template for all trucks

## PLC data (55 fields per reading)
- **DS1-DS25**: Holding registers (Modbus addr 0-24). Labels are generic — need Click ladder logic docs for proper names.
- **DD1**: 32-bit encoder count (SICK DBS60E, addr 16384-16385)
- **X1-X8**: Discrete inputs (X4=TPS power loop, X5/X6/X7=Air Eagles, X3=camera signal)
- **Y1-Y3**: Output coils (eject solenoids)
- **C1999-C2000**: Internal coils (encoder reset, floating zero)
- Derived: encoder distance/speed in mm and ft, plates per minute, plate drop count

## Deployed module location
- Symlink: `/opt/viam-modules/plc-sensor/src/plc_sensor.py` → repo
- Copies (must manually update): `/opt/viam-modules/plc-sensor/run.sh`, `requirements.txt`
- After editing plc_sensor.py: `sudo systemctl restart viam-server`

## Dashboard deployment
- Hosted on Vercel: viam-staubli-apera-plc-mobile-poc.vercel.app
- Push to git triggers redeploy
- Env vars set in Vercel dashboard (Settings → Environment Variables)
- Mobile-responsive design (Tailwind breakpoints)
- Vercel Web Analytics enabled

## WiFi priority (NetworkManager)
1. B&B Shop (priority 30) — primary
2. Verizon_X6JPH6 (priority 20) — fallback
3. Andrew hotspot (priority 10) — last resort

## SSH access
- Tailscale IP: 100.112.68.52 (works from any network)
- `ssh andrew@100.112.68.52` or `ssh andrew@viam-pi`

## Known issues / context
- The core problem being solved: encoder gets out of sync with the tie plate dropper, plates don't drop at correct increments
- DS register labels (ds1-ds25) are placeholders — need Click PLC ladder logic documentation for proper names
- DS2 appears to be tie spacing setting, DS1 may be encoder-related (value 1310)
- Diagnostics include both reactive (spacing variance after drops) and predictive (drift detection during accumulation) checks

## Rules
- Never add E-Cat, servo, robot, or vision code
- Keep dashboard mobile-friendly
- All Viam credentials stay server-side (Next.js API route), never in browser
- Test with: `python3 scripts/test_plc_modbus.py` (reads live PLC)
- Build dashboard with: `cd dashboard && npm run build`
