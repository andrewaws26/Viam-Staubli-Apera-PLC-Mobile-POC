# Robot Cell Monitor — Dashboard

Next.js monitoring dashboard for the industrial robot cell POC. Displays live sensor readings from Viam Cloud with visual and audible fault alerts.

**One-sentence summary:** Pull a wire and watch this dashboard react.

## What it shows

Four status indicators, each with a large colour-coded circle:

| Indicator | Source | Healthy when |
|---|---|---|
| Robot Arm | `robot-arm-monitor` | `connected=true` and `fault=false` |
| Vision System | `vision-health-monitor` | `connected=true` and `process_running=true` |
| PLC / Controller | `plc-monitor` | `connected=true` and `fault=false` |
| Wire / Connection | `plc-monitor` (derived) | PLC connected with no fault |

When a fault fires:
- Indicator circle turns **red** and pulses
- Full-screen **red flash** for 0.7s
- **Industrial klaxon** (alternating 880 Hz / 1100 Hz sawtooth) plays
- **Alert banner** slides in at the top and stays until the fault clears
- **Fault history** panel logs every fault event with a timestamp

## Prerequisites

- Node.js 18 or newer
- npm or yarn

## Quick start (mock mode — no hardware needed)

```bash
cd dashboard

# 1. Copy the example env file
cp .env.local.example .env.local
# NEXT_PUBLIC_MOCK_MODE is already set to true in the example

# 2. Install dependencies
npm install

# 3. Start the dev server
npm run dev
```

Open http://localhost:3000. The dashboard starts immediately with simulated data. A fault fires automatically every ~15–20 seconds. Use the **Demo Controls** buttons to trigger a fault on demand.

## Connecting to real hardware

Once `viam-server` is running on the Raspberry Pi and connected to Viam Cloud:

1. In the Viam app, go to **Connect > API Keys** and create a key with Operator role
2. Edit `dashboard/.env.local`:

```bash
NEXT_PUBLIC_MOCK_MODE=false
NEXT_PUBLIC_VIAM_MACHINE_ADDRESS=your-machine.xyz123.viam.cloud
NEXT_PUBLIC_VIAM_API_KEY_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
NEXT_PUBLIC_VIAM_API_KEY=your-api-key-value
```

3. Restart the dev server: `npm run dev`

## Production build

```bash
npm run build
npm start
```

Or deploy to Vercel (zero config — connect the GitHub repo and set the env vars in the Vercel dashboard).

## File structure

```
dashboard/
├── app/
│   ├── globals.css       # Flash + banner keyframe animations
│   ├── layout.tsx        # HTML shell
│   └── page.tsx          # Loads Dashboard client-side (ssr: false)
├── components/
│   ├── Dashboard.tsx     # Main logic: polling, fault detection, audio
│   ├── StatusCard.tsx    # Individual component status display
│   ├── AlertBanner.tsx   # Fault alert banner
│   ├── FaultHistory.tsx  # Last 10 fault events
│   └── ConnectionDot.tsx # SDK connection status indicator
├── lib/
│   ├── types.ts          # Shared TypeScript types
│   ├── sensors.ts        # Sensor config + health/fault logic
│   ├── mock.ts           # Mock data generator with fault injection
│   └── viam.ts           # Viam SDK connection + getReadings wrapper
├── .env.local.example    # Environment variable template
├── next.config.mjs       # Webpack fallbacks for Viam SDK browser compat
└── README.md
```

## Privacy

This dashboard displays **machine and component state only**. No fields that could identify operators, shift times, or personnel are collected, displayed, or logged. This constraint is enforced architecturally — each sensor module has a fixed return schema, and the dashboard renders only those fields. See `docs/architecture.md` section 6 for the full privacy architecture.
