# IronSight Mobile Parity — Design Spec

**Date:** 2026-04-10
**Status:** Approved
**Approach:** Sprint Layers — 3 focused sprints, each independently shippable

## Context

The IronSight iOS app (React Native/Expo SDK 54) is far behind the web dashboard. The web has 80+ routes covering fleet monitoring, accounting, timesheets, job costing, chat, AI diagnostics, work orders, training, reports, and executive views. The mobile app has 23 routes with basic fleet, truck detail, chat, work orders, and AI screens.

All roles use mobile (operators, mechanics, managers). Crews currently suffer using the web dashboard on their phones for timesheets — the #1 pain point. The goal is a field-first subset of the web experience, not a full mirror. Speed is priority.

### Constraints

- **Offline-first**: op-sqlite + sync engine. Must work in the field without connectivity.
- **Dark theme only**: Background `#030712`. Outdoor visibility optimized.
- **Gloved-finger operation**: 56px minimum touch targets. Fat-finger tolerant.
- **Expo Go compatible**: No custom native modules, no GestureDetector for navigation.
- **J1939 truck data**: CAN bus listen-only. SPN/FMI format, not OBD-II.
- **Existing design tokens**: Barlow Semi Condensed + JetBrains Mono fonts, layered surfaces (surface0-2), glow tokens.

### Known Stability Issues

- React hooks violations: early returns before hooks cause "Rendered fewer hooks than expected" crashes
- GestureDetector crashes in Expo Go when calling JS navigation from UI thread
- Missing error boundaries, inconsistent loading states, no pull-to-refresh on data screens
- No network error handling or retry UI
- Inconsistent safe area handling

---

## Sprint 1: Stability + Timesheets/PTO

Fix the foundation, then build the #1 missing feature.

### 1A — Stability Fixes

Ship these before any new features.

**Critical:**
- Audit every screen for hooks ordering — no early returns before hooks
- Remove GestureDetector from any remaining primitives (Expo Go compat)
- Font loading graceful fallback (already partially done in root layout)
- Error boundaries on every tab screen — catch crashes, show recovery UI

**Important:**
- Consistent loading states on every screen (skeleton loaders, not bare spinners)
- Pull-to-refresh on all data screens (fleet list, work orders, chat threads)
- Network error handling + retry UI (toast or inline banner with "Retry" button)
- Empty states with actionable messages ("No work orders yet — create one")
- Safe area handling on all screens (SafeAreaView or useSafeAreaInsets)

### 1B — Navigation Restructure (7 tabs → 5 tabs)

The current 7-tab layout (Fleet, Truck, Cell, Chat, Work, AI, More) is cramped and won't scale. Restructure to 5 tabs:

| Tab | Contains | Notes |
|-----|----------|-------|
| **Home** | Role-based dashboard cards | New screen — quick actions based on user role |
| **Fleet** | Fleet list → Truck detail → AI diagnostics → Cell view | Merge current Fleet + Truck + Cell + AI into nested stack |
| **Work** | Work orders + Inspections | Merge current Work + hidden Inspect tab |
| **Chat** | Team chat (unchanged) | Same as current |
| **Me** | Timesheets, PTO, profile, training, settings | Replaces "More" — organized sections |

**Implementation:**
- `(tabs)/index.tsx` becomes Home dashboard
- `(tabs)/fleet.tsx` is entry to fleet stack; truck/cell/ai are push screens within it
- `(tabs)/work.tsx` unchanged, inspections accessible from work orders
- `(tabs)/chat.tsx` unchanged
- `(tabs)/me.tsx` replaces `more.tsx` — sectioned list linking to timesheet, PTO, profile, training, settings screens

**Tab icons:** Keep existing SVG path icons. Add Home icon (house), update Me icon (person outline).

### 1C — Timesheet System

Native mobile timesheet entry — replacing the painful web-on-phone experience. Uses existing API routes (`/api/timesheets/`) and shared types (`packages/shared/src/timesheet.ts`).

#### New Screens

**My Timesheets** (`me/timesheets/index.tsx`)
- List of weekly timesheets with status badges (draft/submitted/approved/rejected)
- Create new timesheet button
- Pull-to-refresh
- Color-coded status: draft=gray, submitted=blue, approved=green, rejected=red

**Timesheet Detail** (`me/timesheets/[id].tsx`)
- Week view with daily log entry (start/end time, hours worked, travel hours, description)
- Section tabs for the 11 specialized sub-sections: Railroad Time, Railroad Timecards, Inspections, IFTA, Expenses, Maintenance Time, Shop Time, Mileage Pay, Flight Pay, Holiday Pay, Vacation Pay (Daily Logs is the main week view, not a tab)
- Each sub-section is a collapsible card with inline add/edit
- Submit button (draft → submitted), edit button (rejected → draft)
- Lunch minutes, semi truck travel fields per daily log
- Uses existing `/api/timesheets/[id]/sections?section=<name>` API

**PTO Request** (`me/pto/index.tsx`)
- Request time off with date range picker, type selector (vacation/sick/personal)
- Balance display showing remaining hours per type (visual bars)
- List of existing requests with status
- Submit for approval
- Uses existing `/api/pto/` API routes

**Manager Approvals** (visible in Sprint 1 under Me tab, enhanced in Sprint 2)
- Basic list of pending timesheets for managers
- Tap to review, approve/reject with notes
- Uses existing `/api/timesheets/admin/` API

#### Mobile-Native Advantages

- **Offline draft saving**: Start a timesheet in the field, submit later when connected. Store drafts in op-sqlite, sync on connectivity.
- **GPS auto-fill**: Suggest work location from current GPS coordinates (already have `registerGpsTask` in root layout).
- **Quick daily entry**: Tap a day, enter hours + description, done. Optimize for one-handed entry.
- **Push notifications**: "Your timesheet was approved" / "Timesheet rejected — see notes". Uses existing push notification infrastructure.
- **Camera for receipts**: Snap expense receipts directly into the expense sub-section. Store locally, upload on sync.

#### Data Flow

```
User fills timesheet → op-sqlite (offline draft)
                     → POST /api/timesheets/ (when online)
                     → Supabase timesheets table
                     → Manager gets push notification
Manager approves     → PATCH /api/timesheets/[id]/ {status: 'approved'}
                     → Auto-generates per diem entries
                     → Auto-generates accounting JEs
                     → User gets push notification
```

---

## Sprint 2: Approvals + Training + Profiles

Manager workflows and employee self-service.

### 2A — Employee Profiles

Under the "Me" tab.

**My Profile** (`me/profile.tsx`)
- Photo upload via camera or gallery (expo-image-picker)
- Editable: emergency contact, phone, email
- Read-only: hire date, role, department (from Clerk + employee_profiles)
- Uses existing `/api/profiles/` API

**PTO Balance Widget**
- Visual balance bars for vacation/sick/personal hours
- Upcoming approved requests list
- Quick "Request Time Off" button linking to PTO screen

### 2B — Training Compliance

**My Training** (`me/training/index.tsx`)
- List of all required trainings with status badges:
  - Current (green) — valid, not expiring soon
  - Expiring Soon (amber) — within 30 days of expiry
  - Expired (red) — past expiry date
  - Missing (gray) — no record exists
- Expiry countdown display
- Tap to see certificate details
- Uses existing `/api/training/` API

**Training Admin** (`me/training/admin.tsx`) — manager/developer only
- Compliance matrix: employees × trainings grid
- Filter by status (expired, expiring, missing)
- Add/update training records
- Push notifications for approaching expirations
- Uses existing `/api/training/admin/` API

### 2C — Unified Approval Hub

Central approval screen for managers — replaces the basic Sprint 1 approval list.

**Approval Queue** (`me/approvals/index.tsx`) — manager/developer only
- All pending items in one filterable list: timesheets, PTO requests, work orders
- Filter pills: All | Timesheets | PTO | Work Orders
- **Swipe actions**: swipe right to approve, swipe left to reject (rejection requires a note). Use `react-native-gesture-handler` Swipeable component (not GestureDetector) for Expo Go compat.
- **Bulk approve**: multi-select mode, approve all at once
- **Inline preview**: tap to expand timesheet summary without leaving the queue
- Badge count on Home tab for pending approvals
- Uses existing admin API routes for each entity type

### 2D — Home Dashboard Enhancement

The Home tab gets role-based content cards.

**Operator cards:** Current timesheet status, assigned work orders, PTO balance, training due soon
**Mechanic cards:** Active truck alerts (DTCs), pending inspections, work orders assigned
**Manager cards:** Pending approval count (with badge), fleet health overview, training compliance %, active jobs summary

Each card is tappable — navigates to the relevant screen. Cards are conditionally rendered based on user role from Clerk metadata.

---

## Sprint 3: Reports + Job Costing + Polish

Business intelligence layer — turn data into decisions on the go.

### 3A — Job Costing (Mobile)

Track bids, costs, and profitability per job. Uses existing `/api/jobs/` API routes.

**Jobs List** (`work/jobs/index.tsx`)
- Active jobs with profit/loss color indicators
- Margin color coding: green >20%, amber 5-20%, red <5%
- Status filter tabs: Bidding | Active | Completed | Closed
- Summary stats: total revenue, total costs, average margin
- Uses existing `GET /api/jobs/` with profitability aggregation

**Job Detail** (`work/jobs/[id].tsx`)
- Financial summary cards (revenue, costs, profit, margin)
- Bid-vs-actual comparison bars
- Cost breakdown by category (labor, materials, fuel, equipment, etc.) with percentage bars
- Labor detail auto-calculated from linked timesheets
- **Add Field Cost** button: quick form to log material/fuel/equipment costs on-site
- Camera integration for receipt capture
- Uses existing `GET/POST /api/jobs/[id]/costs/`

### 3B — Reports (Read-Only)

Managers need quick access to reports on their phone. View-only — complex report creation stays on desktop.

**Reports Hub** (`me/reports/index.tsx`)
- Card grid linking to individual reports

**Available Reports:**
- **Fleet Health**: Truck status overview, DTC trends, uptime percentages
- **Payroll Summary**: Hours by employee, overtime, per diem totals
- **Job Profitability**: Revenue vs cost per job, margin rankings
- **Expense Report**: Spending by category, top vendors, budget vs actual

Charts rendered with `react-native-chart-kit`. Data from existing dashboard API routes (`/api/reports/`). Optimized for portrait phone viewing — stacked layouts, not side-by-side.

### 3C — Executive Quick View

One-screen KPI summary for leadership. Accessible from Home tab for executive/developer roles.

**KPI Cards (4-up grid):**
- Revenue MTD (green, monospace)
- Fleet Uptime % (blue, monospace)
- Average Margin % (amber, monospace)
- Training Compliance % (purple, monospace)

Each card is tappable — drills into the corresponding full report. Data refreshes on pull-to-refresh. Cached locally for offline access.

### 3D — Polish & Performance

Final production-readiness pass.

**Performance:**
- FlatList optimization: `windowSize`, `removeClippedSubviews`, `getItemLayout` where possible
- Image caching with `expo-image` (replaces RN Image)
- Skeleton loading screens (animated placeholder cards, not bare spinners)
- Bundle size audit — tree-shake unused imports
- Memory leak audit — verify all subscriptions/listeners cleaned up on unmount

**UX Polish:**
- Haptic feedback on all interactive elements (already on Button, extend to all)
- Consistent transition animations (slide_from_right for push, fade for modals)
- Keyboard avoiding views on all form screens
- Deep linking for push notifications (tap notification → navigate to relevant screen)
- Production app icon and splash screen

---

## Cross-Cutting Concerns

### Offline Strategy

All new screens follow the existing offline-first pattern:
1. Read from op-sqlite first (instant render)
2. Fetch from API in background
3. Merge server data into local DB
4. Writes go to local DB immediately, queue for sync
5. Sync engine handles upload when connectivity returns

Timesheet drafts are the highest-priority offline use case — operators must be able to fill timesheets with zero connectivity.

### Authentication & Authorization

- All new screens behind Clerk auth (existing AuthProvider)
- Manager-only screens (approvals, training admin) check role from Clerk metadata
- API routes already have auth middleware — mobile just passes the Clerk session token

### Push Notifications

Extend existing push notification handling in root layout:
- Timesheet approved/rejected → navigate to timesheet detail
- PTO approved/rejected → navigate to PTO screen
- New approval pending (for managers) → navigate to approval queue
- Training expiring → navigate to training screen

### Shared Types

All new screens use types from `packages/shared/src/`:
- `timesheet.ts` — Timesheet, TimesheetDailyLog, all 12 sub-section types
- `pto.ts` — PTO requests, balances
- `profile.ts` — Employee profiles
- `training.ts` — Training requirements, records, compliance status
- `accounting.ts` — Used by job costing for cost types

No new shared types needed — the web dashboard already defined them all.

### New File Structure

```
src/app/
  (tabs)/
    index.tsx          # Home dashboard (NEW - replaces fleet list as tab root)
    fleet.tsx          # Fleet list (moved from index)
    work.tsx           # Work orders (existing)
    chat.tsx           # Chat (existing)
    me.tsx             # Me hub (replaces more.tsx)
  fleet/
    [id].tsx           # Truck detail (existing, moved under fleet stack)
    [id]/ai.tsx        # AI diagnostics (existing, moved)
    [id]/cell.tsx      # Cell view (existing, moved)
  me/
    timesheets/
      index.tsx        # My Timesheets list
      [id].tsx         # Timesheet detail + sections
      new.tsx          # Create new timesheet
    pto/
      index.tsx        # PTO requests + balance
    profile.tsx        # My Profile
    training/
      index.tsx        # My Training
      admin.tsx        # Training admin (manager only)
    approvals/
      index.tsx        # Unified approval queue (manager only)
    reports/
      index.tsx        # Reports hub
      fleet-health.tsx
      payroll.tsx
      job-profitability.tsx
      expenses.tsx
    settings.tsx       # App settings
  work/
    jobs/
      index.tsx        # Jobs list
      [id].tsx         # Job detail + costs
```

### New Zustand Stores

- `timesheet-store.ts` — Timesheet list, current timesheet, daily logs, sub-sections, draft management
- `pto-store.ts` — PTO requests, balances
- `profile-store.ts` — Employee profile, training records
- `approval-store.ts` — Pending approvals queue (manager)
- `job-store.ts` — Jobs list, job detail, cost entries

Each store follows the existing pattern: fetch from API, cache in Zustand, persist critical data to op-sqlite for offline.

---

## What's NOT in Scope

These stay on the web dashboard only:
- **Full accounting module** (chart of accounts, journal entries, bank reconciliation, payroll processing)
- **Invoice/bill creation** (complex multi-line forms better suited to desktop)
- **Report generation** (mobile only views pre-built reports)
- **Admin settings** (user management, org settings, system config)
- **Data import/export** (QB import, CSV exports)
- **Receipt OCR processing** (camera capture is mobile, OCR processing is server-side)
