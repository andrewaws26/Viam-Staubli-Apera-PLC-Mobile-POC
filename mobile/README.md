# IronSight Mobile

Fleet diagnostics mobile app for B&B Metals. Real-time J1939 truck telemetry, AI-powered fault diagnosis, pre/post-shift inspections, and offline-first data sync.

## Features

- **Fleet Overview** -- Live dashboard showing all trucks with status indicators
- **Truck Detail** -- Circular and bar gauges for RPM, coolant temp, oil pressure, fuel/DEF/DPF levels, lamp status, active DTCs
- **AI Mechanic** -- Per-truck chat interface for diagnosing fault codes and asking maintenance questions
- **Inspections** -- Pre/post-shift checklists with photo attachments and pass/fail tracking
- **GPS Tracking** -- Background location tracking during shifts with route history
- **Push Notifications** -- Alerts for critical sensor thresholds and new DTCs
- **Offline-First** -- Local SQLite storage with automatic Supabase sync when connectivity returns

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Expo SDK 54, React Native 0.81 |
| Routing | expo-router (file-based) |
| Language | TypeScript (strict) |
| State | Zustand |
| Local DB | op-sqlite |
| Cloud DB | Supabase (PostgreSQL) |
| Auth | Clerk |
| UI | Custom dark-theme components, react-native-svg gauges |

## Getting Started

### Prerequisites

- Node.js 20+
- Expo CLI (`npm install -g expo-cli`)
- iOS Simulator (Xcode) or Android Emulator

### Install

```bash
git clone https://github.com/your-org/ironsight-mobile.git
cd ironsight-mobile
npm install
```

### Environment

Create `.env` in the project root:

```env
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
EXPO_PUBLIC_AI_ENDPOINT=https://your-ai-endpoint.com
```

### Run

```bash
npx expo start          # Dev server with QR code
npx expo start --ios    # iOS simulator
npx expo start --android # Android emulator
```

### Test

```bash
npx jest                # Run unit tests
npx tsc --noEmit        # Type-check
```

## Project Structure

```
src/
  app/              Expo Router screens and layouts
    (auth)/         Sign-in flow
    (tabs)/         Bottom tab navigator (Fleet, Truck, AI, Inspect, More)
    ai/             AI chat and diagnosis detail screens
    truck/          Truck detail screen
    inspection/     Inspection detail screen
    maintenance/    Maintenance detail screen
  auth/             Clerk auth provider
  components/       Shared UI components
  db/               SQLite schema, migrations, queries
  services/         API client, AI client, GPS tracker, push notifications
  stores/           Zustand state stores
  sync/             Offline sync engine
  theme/            Dark theme tokens (colors, spacing, typography)
  types/            TypeScript type definitions
  utils/            Formatting, gauge thresholds, SPN/PCode lookups
supabase/           Cloud database migrations
tests/              Unit tests and mock data
```

## Supabase Setup

Run the migration in your Supabase SQL Editor to create the mobile-specific tables:

```bash
# File: supabase/migration_mobile.sql
# Tables: gps_tracks, push_tokens, inspections, shift_handoffs
```

## Architecture Notes

- **Sensor data** flows from J1939 CAN bus on the truck Pi Zero through Supabase to the mobile app
- **DTC codes** use SAE J1939 SPN/FMI format (not OBD-II P-codes)
- **Gauge thresholds** are defined per-sensor with warn/critical levels and support inverted ranges (low=bad for oil pressure, battery voltage)
- **Sync engine** queues writes locally in SQLite and flushes to Supabase when network is available

## License

Proprietary -- B&B Metals, Inc.
