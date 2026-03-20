# TPS Remote Monitoring System

Remote production monitoring for the Tie Plate System (TPS) using [Viam Robotics](https://www.viam.com/). A Raspberry Pi 5 connects to a Click PLC via Modbus TCP, captures encoder and I/O data at 1 Hz, and syncs to Viam Cloud. A Next.js dashboard on Vercel displays live production data from any browser.

**Designed for fleet deployment** — plug a Pi into the PLC's Ethernet port, power it on, and it starts observing. Self-healing connections, offline buffering, and zero manual configuration per truck.

## What It Monitors

All data comes directly from the Click PLC C0-10DD2E-D ladder logic — no simulated or placeholder values:

| Signal Type | Details |
|---|---|
| **Encoder** (SICK DBS60E) | Pulse count, distance (ft/mm), speed (ft/min), direction, revolutions |
| **Discrete Inputs** (X1-X8) | TPS power loop, camera signal, Air Eagle 1/2/3 feedback |
| **Output Coils** (Y1-Y3) | Eject TPS-1, Eject Left TPS-2, Eject Right TPS-2 |
| **Internal Coils** (C1999-C2000) | Encoder reset, floating zero |
| **DS Registers** (DS1-DS14) | Encoder ignore, tie spacing, detector offset, and more |
| **Derived** | Plates per minute (rolling 60s window), plate drop count, encoder enabled state |

## What It Does NOT Collect

No camera feeds, no operator identity, no shift data, no audio. Fixed schema — expanding data requires new code, not config changes.

## Architecture

```
Click PLC ──Modbus TCP──▶ Raspberry Pi 5 ──Viam Cloud──▶ Vercel Dashboard
                           │
                           ├─ plc-sensor module (1 Hz reads)
                           ├─ offline buffer (JSONL, survives reboots)
                           ├─ viam-server (data capture + cloud sync)
                           └─ health-check (HTTP :8081)
```

## Project Structure

```
.
├── config/
│   ├── viam-server.json              # Single-truck Viam config
│   ├── fragment-tps-truck.json       # Fleet fragment template
│   └── tps-health-check.service      # systemd unit for health endpoint
├── dashboard/                        # Next.js on Vercel
│   ├── app/
│   │   ├── api/sensor-readings/      # Server-side Viam API proxy
│   │   ├── page.tsx                  # Main page
│   │   └── layout.tsx
│   ├── components/                   # Dashboard, StatusCard, PlcDetailPanel
│   ├── lib/                          # Viam client, sensor configs, types
│   └── .env.local.example            # Credential template
├── modules/
│   └── plc-sensor/                   # Viam sensor module
│       ├── src/plc_sensor.py         # Core module (Modbus reads + offline buffer)
│       ├── run.sh                    # Entry point (venv + validation)
│       ├── setup.sh                  # One-time setup
│       ├── requirements.txt          # Pinned: viam-sdk==0.69.0, pymodbus==3.7.4
│       └── meta.json
├── scripts/
│   ├── test_plc_modbus.py            # Manual PLC connectivity test
│   └── health-check.py              # Fleet health endpoint
├── docs/
│   ├── architecture.md
│   ├── deploy-rpi5.md
│   ├── click-plc-setup-guide.md
│   ├── encoder-setup-guide.md
│   ├── fleet-deployment-plan.md
│   └── data-management.md
└── requirements.txt                  # Top-level pinned deps
```

## Quick Start

### Mock mode (no hardware)

```bash
cd dashboard
cp .env.local.example .env.local
# .env.local already has NEXT_PUBLIC_MOCK_MODE=true
npm install && npm run dev
```

### Live mode (Pi + PLC)

1. **Deploy the Pi** — follow [docs/deploy-rpi5.md](docs/deploy-rpi5.md)
2. **Set Vercel env vars** — in Vercel Project Settings → Environment Variables:
   - `VIAM_MACHINE_ADDRESS` — your machine's cloud address
   - `VIAM_API_KEY_ID` — API key ID from Viam app
   - `VIAM_API_KEY` — API key value
   - `NEXT_PUBLIC_MOCK_MODE` — set to `false`
3. **Deploy** — push to main, Vercel builds automatically

### Health check

```bash
# From the Pi or any machine on the same network:
curl http://<pi-ip>:8081/health
```

## Fleet Deployment

For 30+ trucks, use the Viam Fragment workflow:

1. Create a fragment in app.viam.com using `config/fragment-tps-truck.json`
2. For each truck machine, add the fragment and override `host` with the truck's PLC IP
3. Install the health check service: `sudo cp config/tps-health-check.service /etc/systemd/system/ && sudo systemctl enable --now tps-health-check`

See [docs/fleet-deployment-plan.md](docs/fleet-deployment-plan.md) for the full rollout plan.

## Key Features

- **Plug and play** — Pi auto-connects to PLC on boot, self-heals on disconnect
- **Offline buffering** — JSONL files on local disk, auto-pruned at 50 MB cap
- **Self-healing** — exponential backoff (1s → 30s), auto-reconnect with diagnostic logs
- **Secure dashboard** — Viam credentials stay server-side (Vercel serverless functions)
- **Fleet-ready** — Viam Fragments for per-truck config, health endpoint on every Pi
- **Zero data loss** — Viam data manager buffers locally when cloud is unreachable

## Troubleshooting

```bash
# View live module logs
sudo journalctl -u viam-server -f | grep plc

# Check for connection errors
sudo journalctl -u viam-server --since "1 hour ago" | grep "🔴"

# Check for self-heal events
sudo journalctl -u viam-server | grep "self-healed"

# Test PLC connectivity directly
python3 scripts/test_plc_modbus.py --host 192.168.0.10 --watch

# Full health report
curl http://localhost:8081/health | python3 -m json.tool
```
