# CLAUDE.md — IronSight Mobile

Instructions for Claude Code when working on this repository.

## Project overview

IronSight Mobile is a React Native (Expo) fleet diagnostics app for B&B Metals.
It connects to Supabase for backend data and uses Clerk for auth. The app shows
real-time J1939 truck sensor data, DTC fault codes, AI-powered diagnostics, and
supports pre/post-shift inspections with offline-first sync.

## Tech stack

- **Framework**: Expo SDK 54 with expo-router (file-based routing)
- **Language**: TypeScript (strict mode)
- **State**: Zustand stores (`src/stores/`)
- **Database**: op-sqlite for local offline storage, Supabase for cloud sync
- **Auth**: Clerk (`@clerk/clerk-expo`)
- **UI**: Custom components in `src/components/ui/`, dark theme only
- **Testing**: Jest + ts-jest + @testing-library/react-native

## Directory structure

```
src/
  app/              # Expo Router file-based routes
    (auth)/         # Auth screens (sign-in)
    (tabs)/         # Bottom tab navigator (index, truck, ai, inspect, more)
    ai/chat/        # Per-truck AI chat [truckId].tsx
    ai/diagnosis/   # Cached diagnosis view [id].tsx
    truck/          # Truck detail [id].tsx
    inspection/     # Inspection detail [id].tsx
    maintenance/    # Maintenance detail [id].tsx
  auth/             # Auth provider (Clerk)
  components/       # Shared components (DTCBadge, LampIndicators, etc.)
    ui/             # Primitive UI components (Button, Card, GaugeCircular, etc.)
  db/               # SQLite schema, migrations, queries
  services/         # API client, AI client, GPS tracker, push notifications
  stores/           # Zustand state stores (fleet-store, ai-store)
  sync/             # Offline sync engine and status
  theme/            # Colors, spacing, typography (dark theme)
  types/            # TypeScript type definitions
  utils/            # Formatting, gauge thresholds, SPN/PCode lookups
supabase/           # Supabase SQL migrations
tests/
  mocks/            # Mock sensor data for testing
  unit/             # Unit tests
```

## Commands

```bash
npx expo start          # Start dev server
npx expo start --ios    # Start on iOS simulator
npx expo start --android # Start on Android emulator
npx jest                # Run unit tests
npx tsc --noEmit        # Type-check without emitting
```

## Path aliases

The project uses `@/*` mapped to `src/*`. Always import from `@/` rather than
relative paths when importing from `src/`.

## Key conventions

- **Dark theme only**: Background is `#030712` (gray-950). All colors are in `src/theme/colors.ts`.
- **Gauge thresholds**: `src/utils/gauge-thresholds.ts` defines warn/crit thresholds for each sensor. Thresholds can be "normal" (high=bad, like coolant temp) or "inverted" (low=bad, like oil pressure).
- **J1939 protocol**: Truck data comes from J1939 CAN bus. DTC codes use SPN/FMI format, not OBD-II P-codes. The SPN lookup table is in `src/utils/spn-lookup.ts`.
- **Offline-first**: Local SQLite stores inspections, notes, and cached data. The sync engine (`src/sync/`) handles Supabase upload when connectivity returns.
- **CAN bus safety**: The truck Pi Zero uses listen-only mode on J1939. Never send commands to the bus.

## Environment variables

Required in `.env` (not committed):
- `EXPO_PUBLIC_SUPABASE_URL` — Supabase project URL
- `EXPO_PUBLIC_SUPABASE_ANON_KEY` — Supabase anonymous key
- `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` — Clerk publishable key
- `EXPO_PUBLIC_API_BASE_URL` — Vercel dashboard API base URL

## Testing

Tests live in `tests/unit/`. Mock data in `tests/mocks/sensor-data.ts` reflects
real 2024 Mack Granite sensor values. Run tests with `npx jest`.

## Do not

- Do not commit `.env` or any credentials
- Do not use light theme colors; this is dark-mode only
- Do not send CAN bus write commands; the truck connection is listen-only
- Do not use relative imports for files under `src/`; use `@/` alias
