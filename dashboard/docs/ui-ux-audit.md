# IronSight UI/UX Audit

Comprehensive audit of every major dashboard page and component. Findings organized by severity and category.

**Pages audited:** HomeScreen, SectionLayout, TopNav, SectionSidebar, Breadcrumb, Truck Dashboard, TruckPanel, GaugeGrid, TPS, CellSection, StaubliPanel, AperaPanel, DTCPanel, AIChatPanel, WorkBoard (Kanban), Accounting (COA, Invoices, Payroll), Jobs, Timesheets, Team, Training, Profile, Chat, Reports, Manager, Executive, Dev Portal, Fleet, PTO

---

## Executive Summary

The dashboard has a **strong foundation**: consistent dark theme (gray-950), a coherent color system, responsive grids, and good hover/loading states. The main gaps are in **mobile data table UX**, **accessibility**, **cross-page consistency**, **navigation on mobile**, and **interaction polish**. 28 pages/components audited — the patterns repeat, so fixing them at the component level cascades across the entire app.

---

## Critical Issues (High Impact)

### 1. Mobile Data Tables Are Broken
**Pages affected:** Accounting, Invoices, Payroll, Jobs, Executive, Reports
**Problem:** Tables use `min-w-[640px]` to `min-w-[1100px]` with `overflow-x-auto`, forcing horizontal scroll on mobile. Users can't see full rows without swiping.
**Proposal:** 
- For <5 column tables: use responsive card layout on mobile (`hidden md:table` + visible card list)
- For dense tables (payroll, GL): add sticky first column so the employee/account name stays visible while scrolling
- Add a subtle horizontal scroll indicator (gradient fade on right edge)

### 2. No Keyboard Navigation / Focus States
**Pages affected:** All
**Problem:** No visible `focus-visible` outlines on interactive elements. Tab navigation is invisible. Module cards, table rows, and buttons lack focus indicators.
**Proposal:**
- Add global `focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-950` to interactive elements
- Add skip-to-content link in SectionLayout

### 3. Inconsistent Loading States
**Pages affected:** All
**Problem:** At least 4 different loading patterns: full-screen spinner (HomeScreen), skeleton cards (Manager), minimal spinner (Executive), component-level spinners (Chat). Inconsistent feels unpolished.
**Proposal:**
- Create a shared `<LoadingSkeleton variant="page|cards|table|inline" />` component
- Page-level: skeleton matching the page layout shape
- Inline: small spinner for buttons and refresh actions

### 4. No Pagination on Any Data Table
**Pages affected:** Accounting, Jobs, Invoices, Payroll, Timesheets, Executive
**Problem:** All lists load everything. As B&B grows (30+ trucks, hundreds of invoices, years of journal entries), these will become slow and overwhelming.
**Proposal:**
- Add cursor-based pagination to all list API routes
- Show 25 items per page with Previous/Next controls
- Add "Showing X of Y" count

---

## High-Priority Improvements (Medium Impact)

### 5. SectionLayout Has No Content Padding
**File:** `components/nav/SectionLayout.tsx:41`
**Problem:** Main content area has no padding or max-width when sidebar is present. Content stretches to full viewport width on ultrawide screens. The conditional class `${hasSidebar ? "" : ""}` is a no-op.
**Proposal:**
```tsx
<main className={`flex-1 min-w-0 px-4 sm:px-6 lg:px-8 py-6 ${hasSidebar ? "max-w-6xl" : "max-w-7xl mx-auto"}`}>
```

### 6. HomeScreen Module Cards Lack ARIA Labels
**File:** `components/HomeScreen.tsx`
**Problem:** Cards are `<a>` tags with icon + text, but screen readers get no context about what the icon represents. No `aria-label` on icon-only elements.
**Proposal:**
- Add `aria-label={card.label}` to each card link
- Add `role="img" aria-hidden="true"` to decorative SVG icons

### 7. Chat Mobile UX Is Good But Incomplete
**File:** `app/(operations)/chat/page.tsx`
**Problem:** Mobile chat correctly hides sidebar when thread is selected, but:
- No swipe gesture to go back (relies on button)
- No unread indicator badge on threads
- Thread list doesn't show last message preview on mobile (saves space but loses context)
**Proposal:**
- Add unread count badge on thread list items
- Show truncated last message in thread list (1 line, `line-clamp-1`)
- Consider pull-to-refresh for thread list

### 8. Form Validation Is Invisible
**Pages affected:** Profile, Timesheets, Accounting (new account), Jobs (new job), Invoices
**Problem:** Required fields have no inline validation. Errors only appear as a red box at form top after submission. Users don't know which field failed.
**Proposal:**
- Add `aria-invalid` and red border ring on invalid fields
- Show helper text below each invalid field
- Validate on blur for required fields, not just on submit

### 9. Date Inputs Need Native Pickers
**Pages affected:** Timesheets, Payroll, Invoices, Jobs
**Problem:** Date fields are plain text inputs requiring manual typing. Mobile users have to type dates instead of using the native date picker.
**Proposal:**
- Use `type="date"` on all date inputs — this gives iOS/Android native date pickers for free
- Style the native picker to match dark theme

### 10. Empty States Are Inconsistent
**Pages affected:** All list pages
**Problem:** Some pages show an icon + message (Timesheets), others show plain text (Jobs), some show nothing (Accounting when no JEs). Inconsistent empty states feel like broken pages.
**Proposal:**
- Create shared `<EmptyState icon={...} title="..." description="..." action={<Button>} />` component
- Use consistently across all list views

---

## Polish & Refinement (Lower Impact, High Visual Payoff)

### 11. Executive Dashboard Aging Bars Need Labels
**File:** `app/executive/page.tsx`
**Problem:** The horizontal stacked bars show AR/AP aging but the color segments have no legend or inline labels. Users must guess which color means what.
**Proposal:**
- Add a compact legend below the bar (Current / 30d / 60d / 90d / 120d+)
- Show hover tooltip with exact dollar amount per segment

### 12. Manager Command Center Could Show Trends
**File:** `app/manager/page.tsx`
**Problem:** KPI cards show current numbers only. No indication of whether things are improving or worsening. The "5 pending approvals" number means nothing without "was 3 yesterday."
**Proposal:**
- Add sparkline or delta indicator (arrow up/down + percentage) on KPI cards
- Store previous period values for comparison
- Color the delta: green for improvement, red for deterioration

### 13. Reports Page SQL Display Is Jarring
**File:** `app/reports/page.tsx`
**Problem:** Toggle to show SQL query renders raw SQL in monospace. Useful for devs but confusing for non-technical managers who also use reports.
**Proposal:**
- Hide SQL toggle for non-developer roles
- Or rename to "View technical details" with a clear warning label

### 14. Module Card Descriptions Are Too Subtle
**File:** `components/HomeScreen.tsx`
**Problem:** Card descriptions use `text-xs text-gray-600` which is nearly invisible on the gray-950 background. Fails WCAG contrast ratio (estimated ~2.5:1, needs 4.5:1).
**Proposal:**
- Change to `text-xs text-gray-400` (better contrast, ~6:1 ratio)
- Or `text-gray-500` as a minimum (~4:1 ratio)

### 15. Timesheets Need Previous/Next Navigation
**File:** `app/timesheets/[id]/page.tsx`
**Problem:** Viewing a timesheet only has a "Back" link. No way to navigate to adjacent timesheets without going back to the list.
**Proposal:**
- Add Previous/Next arrows in the header
- Pass adjacent timesheet IDs from the list page via URL params or fetch them

### 16. Team Roster Cards Could Show More Context
**File:** `app/team/page.tsx`
**Problem:** Cards show name, email, role badge only. No information about training compliance, active timesheets, or current work assignments.
**Proposal:**
- Add a small compliance indicator (green dot / red dot) from training data
- Show "Currently on: [job name]" if assigned to an active job
- These make the team page a quick health check, not just a directory

### 17. Training Page Needs Drill-Down
**File:** `app/training/page.tsx`
**Problem:** Shows compliance status but no way to see certificate details, upload documents, or view training history for a specific requirement.
**Proposal:**
- Make training cards clickable → expand to show history, cert upload, notes
- Add "Upload Certificate" button per training item

### 18. Inconsistent Max-Width Constraints
**Pages affected:** All
**Problem:** Different pages use different max-widths: `max-w-4xl` (timesheets), `max-w-3xl` (training), `max-w-2xl` (profile), `max-w-6xl` (team, accounting), `max-w-7xl` (reports), `max-w-5xl` (home). This creates inconsistent visual rhythm as users navigate.
**Proposal:**
- Standardize: `max-w-7xl` for full-width pages (accounting, reports, executive)
- `max-w-5xl` for standard content pages (timesheets, training, profile)
- Let SectionLayout enforce the constraint so individual pages don't diverge

---

## Design System Gaps

### Missing Shared Components
These patterns repeat across 10+ pages and should be extracted:

| Component | Used in | Pattern |
|-----------|---------|---------|
| `<StatusBadge>` | Timesheets, Jobs, Invoices, Payroll, Work Orders | Color-coded pill with status text |
| `<MetricCard>` | Manager, Executive, Jobs, Invoices | Number + label + optional delta |
| `<DataTable>` | Accounting, Jobs, Invoices, Payroll, Executive, Reports | Sortable, responsive, with empty state |
| `<EmptyState>` | All list pages | Icon + title + description + CTA |
| `<LoadingSkeleton>` | All pages | Page/card/table/inline variants |
| `<DateInput>` | Timesheets, Payroll, Invoices, Jobs | Native picker with dark theme styling |
| `<ConfirmDialog>` | Delete actions across modules | Destructive action confirmation |

### Color System Documentation
The color system is consistent but undocumented. Developers (and AI) must reverse-engineer the patterns from existing pages. Should be documented:
- Status colors: gray (draft), blue (submitted/sent), green (approved/paid), amber (partial/warning), red (rejected/overdue/voided)
- Accent colors by module: violet (primary/auth), amber (operations), indigo (timesheets), lime (accounting), cyan (chat/dev)
- Contrast requirements: text-gray-400 minimum on gray-950 backgrounds

---

## Cross-Cutting Themes

1. **Mobile-first is declared but not fully delivered** — Responsive grids work, but data-heavy pages (accounting, payroll, executive) degrade to horizontal scroll on phones.

2. **Accessibility is the biggest gap** — No focus indicators, no skip links, poor color contrast on descriptions, no ARIA labels on icon elements.

3. **The design system is implicit** — Patterns exist but aren't extracted into shared components. This leads to drift (4 different loading states, 3 different badge styles).

4. **Data density vs. readability** — Pages like payroll-run (11 columns) and executive aging need a mobile-specific information architecture, not just responsive grid collapse.

5. **No micro-interactions or transitions** — Page transitions are instant (no fade/slide). List items appear all at once (no stagger). This makes the app feel utilitarian rather than polished.

---

## Priority Implementation Order

If tackling these improvements, recommended order:

1. **Shared `<StatusBadge>` + `<EmptyState>` + `<LoadingSkeleton>`** — Quick wins, cascade everywhere
2. **Focus states + skip link** — Accessibility baseline
3. **Mobile data table strategy** — Biggest UX pain point
4. **Form validation improvements** — Inline errors, native date pickers
5. **SectionLayout content padding + max-width** — One change, all pages benefit
6. **HomeScreen description contrast fix** — 1-line CSS change
7. **Chat unread badges + message preview** — High-usage feature
8. **Pagination** — Required before data grows
9. **Manager KPI deltas** — High-value polish
10. **Design system documentation** — Prevents future drift

---

---

## Iteration 2: Truck Dashboard, Cell Monitoring, WorkBoard, Navigation, Dev Portal

### 19. Truck Dashboard Has No Visual Hierarchy
**Files:** `Dashboard.tsx`, `TruckPanel.tsx` (573 lines), `GaugeGrid.tsx`
**Problem:** TruckPanel renders 11 major sections (DTCs, gauges, AI chat, TPS, cell, etc.) with no clear "hero" metric. Users don't know what to focus on first. The panel extends infinitely with no pagination or virtualization.
**Proposal:**
- Add a "vitals strip" at top showing 3-4 key metrics (RPM, coolant temp, active DTCs, data freshness)
- Collapse secondary sections by default on mobile
- Add section jump links or a floating TOC

### 20. `text-[10px]` Used Everywhere — WCAG Violation
**Files:** Dashboard.tsx (3 locations), TruckPanel.tsx (6 locations), TPS/index.tsx (7 locations), CellSection, StaubliPanel, AperaPanel
**Problem:** Hardcoded 10px text fails WCAG 1.4.4 minimum (12px for body text). Used extensively for labels, metadata, timestamps, and badges. Nearly unreadable on mobile.
**Proposal:**
- Global find-and-replace: `text-[10px]` → `text-xs` (12px)
- For truly tiny labels (section headers): use `text-[11px]` minimum with `uppercase tracking-widest` for legibility

### 21. Status Dots Are Color-Only — Colorblind Inaccessible
**Files:** CellSection, StaubliPanel, AperaPanel, TPS, DTCPanel, DevPortal
**Problem:** Connection/status dots (w-2.5 h-2.5, 10px circles) convey state purely through color (green/red/gray). Red-green colorblind users (~8% of males) cannot distinguish connected from disconnected.
**Proposal:**
- Add shape variation: checkmark for connected, X for error, dash for idle
- Or add text label adjacent: "Connected" / "Offline"
- Increase dot size to w-3 h-3 minimum

### 22. Cell Monitoring Grids Overflow on Mobile
**Files:** `StaubliPanel.tsx`, `AperaPanel.tsx`
**Problem:** Detection class grids use hardcoded `grid-cols-5` with no responsive breakpoint. On 320-375px screens, each cell is ~64px wide — text truncates to nothing. Motor temperature grid (7 items in 2-col mobile) creates excessive vertical scroll.
**Proposal:**
- Change `grid-cols-5` → `grid-cols-2 sm:grid-cols-5`
- For motor temps: `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4` (cap columns to avoid odd wrapping with 7 items)

### 23. WorkBoard Kanban Has Critical Accessibility Gaps
**File:** `WorkBoard.tsx` (941 lines)
**Problem:**
- Expandable cards use `<div onClick>` — keyboard users can't Tab to them
- Create modal has no `role="dialog"`, no `aria-modal`, no focus trap
- Custom assignment dropdown has no ARIA roles (`listbox`/`option`)
- `prompt()` dialogs used for blocking reasons — bad mobile UX
**Proposal:**
- Convert card `<div onClick>` to `<button>` or add `role="button" tabIndex={0} onKeyDown`
- Add `role="dialog" aria-modal="true"` to modal, implement focus trap
- Replace `prompt()` with custom modal dialogs
- Add ARIA to custom dropdown

### 24. SectionSidebar Disappears Completely on Mobile
**File:** `SectionSidebar.tsx` — `hidden lg:block`
**Problem:** Below 1024px, the sidebar vanishes entirely. Mobile users lose section navigation. The hamburger menu partially compensates by including section links, but it's a dropdown — not a persistent nav.
**Proposal:**
- Add a slide-in drawer on mobile (triggered by hamburger or swipe from left edge)
- Or add a horizontal scrollable tab bar below the breadcrumb for the current section's links
- This is the single biggest mobile navigation gap

### 25. Breadcrumb Has No Overflow Handling
**File:** `Breadcrumb.tsx` (38 lines)
**Problem:** Long breadcrumb trails wrap onto multiple lines on narrow screens. No truncation, no ellipsis, no horizontal scroll. Also missing `<nav>` semantic element and `aria-current="page"`.
**Proposal:**
- Wrap in `<nav aria-label="Breadcrumb">`
- Add `overflow-x-auto whitespace-nowrap` for horizontal scroll on mobile
- Add `aria-current="page"` to the last breadcrumb item

### 26. AI Chat Input Is Well-Designed But Messages Lack Structure
**File:** `AIChatPanel.tsx` (262 lines)
**Strengths:** Touch-friendly 44px targets, flex layout prevents overflow, quick questions grid stacks on mobile.
**Problem:** Chat messages use generic `<div>` containers. "AI is thinking" message has no `role="status"`. Markdown responses don't have proper heading hierarchy. No way to copy AI response text.
**Proposal:**
- Add `role="status" aria-live="polite"` to thinking indicator
- Add a "Copy" button on AI responses (users want to share diagnostics)
- Wrap messages in `role="log"` container

### 27. TopNav Hamburger and Profile Share the Same Toggle
**File:** `TopNav.tsx` (214 lines)
**Problem:** Both the hamburger button and profile button toggle the same `menuOpen` state. Tapping hamburger opens a menu that contains both navigation AND profile options. Users expect separate menus for "navigate the app" vs "manage my account."
**Proposal:**
- Split into two menus: hamburger = section nav, profile = account/settings
- Or keep combined but add clear visual separation (divider + section labels) between nav and profile items

### 28. Drag-and-Drop on Mobile Touch Devices
**File:** `WorkBoard.tsx`
**Problem:** Kanban uses `@hello-pangea/dnd` with `touchAction: "none"`. Long-press to drag is not discoverable. No visual affordance (handle icon) indicating cards are draggable. No swipe-to-action alternative.
**Proposal:**
- Add a drag handle icon (grip dots) on the left side of each card
- Add a status dropdown as an alternative to drag-and-drop for changing status
- Both methods should work — drag on desktop, dropdown on mobile

### 29. Dev Portal Health Grid Needs Mobile Treatment
**File:** `dev-portal/page.tsx` (353 lines)
**Problem:** Health services grid uses `lg:grid-cols-6` — on mobile it falls to single column, creating a very long list. Status dots are tiny and color-only.
**Proposal:**
- Use `grid-cols-2 sm:grid-cols-3 lg:grid-cols-6` for a more compact mobile view
- Add status text label next to each dot

### 30. No Global Focus Indicator System
**Files affected:** All components
**Problem:** Buttons, links, cards, and interactive elements across the entire app lack visible `focus-visible` states. Keyboard navigation is completely invisible. This is the most pervasive accessibility issue.
**Proposal:**
- Add to global CSS or Tailwind base layer:
```css
@layer base {
  [tabindex]:focus-visible, button:focus-visible, a:focus-visible, select:focus-visible, input:focus-visible {
    @apply outline-2 outline-offset-2 outline-violet-500;
  }
}
```
- This single change improves keyboard accessibility across every page instantly

---

## Updated Design System Gaps

### Additional Shared Components Needed (from Iteration 2)

| Component | Used in | Pattern |
|-----------|---------|---------|
| `<StatusIndicator>` | Cell, TPS, DevPortal, Fleet | Dot + text + ARIA, colorblind-safe |
| `<DragHandle>` | WorkBoard | Grip dots affordance for draggable items |
| `<MobileDrawer>` | SectionSidebar, TopNav | Slide-in nav drawer for mobile |
| `<CopyButton>` | AIChatPanel, TPS (JSON), Reports (SQL) | Copy-to-clipboard with toast feedback |
| `<VitalsStrip>` | TruckPanel | Hero metrics bar for key vehicle readings |

---

## Updated Priority Implementation Order

1. **Global focus indicator CSS** — 1 line in globals.css, fixes keyboard a11y everywhere
2. **Replace `text-[10px]` globally** — ~25 instances, WCAG compliance
3. **Shared `<StatusBadge>` + `<StatusIndicator>` + `<EmptyState>` + `<LoadingSkeleton>`** — Design system foundation
4. **Mobile sidebar drawer** — Biggest navigation gap
5. **WorkBoard accessibility** — Modal ARIA, keyboard navigation, replace `prompt()`
6. **Cell monitoring responsive grids** — `grid-cols-5` → responsive
7. **Mobile data table strategy** — Card layout on mobile for accounting/payroll
8. **Form validation + native date pickers** — Inline errors, better mobile input
9. **SectionLayout content padding + max-width** — One change, all pages benefit
10. **Breadcrumb semantics + overflow** — Quick accessibility win
11. **HomeScreen description contrast** — 1-line CSS change
12. **Chat unread badges + message preview** — High-usage feature
13. **Pagination** — Required before data grows
14. **Manager KPI trend deltas** — Polish
15. **TruckPanel vitals strip + section collapse** — Mobile UX for core monitoring feature

---

---

## Iteration 3: Hard Data + Remaining Pages + Implementation Specs

### Codebase-Wide Issue Counts (Verified)

| Issue | Count | Severity |
|-------|-------|----------|
| `text-[10px]` instances | **742** | Critical (WCAG) |
| `grid-cols-5` without responsive | 3 (StaubliPanel, AperaPanel, Setup) | High |
| `grid-cols-5` with responsive | 22 (properly handled) | OK |
| `prompt()` native dialogs | **4** (WorkBoard x2, TimesheetAdmin, TimesheetForm) | High |

### Remaining Pages Audited

#### 31. Tour Page (440 lines)
- Navigation dots are `w-2 h-2` when inactive — **8px touch target, far below 44px minimum**
- Dots jump to `w-6` when active — jarring visual shift
- No `aria-label` on dot buttons (screen readers can't identify which stop)
- Progress bar has no accessible description
- "Try It" links open new tabs without visual indicator

#### 32. Setup Page (1,163 lines)
- `grid-cols-5` at line 335 (address: City/State/Zip) — **hardcoded, no responsive breakpoint**
- Step progress indicator missing `aria-current="step"` 
- Form errors have no `role="alert"`
- Required fields use red asterisk — not announced to screen readers
- No validation-on-blur, only on submit

#### 33. Shift Report (433 lines)
- Date/time inputs lack `htmlFor` label associations
- No debounce on input changes — every keystroke triggers state update
- Error messages have no `role="alert"` or `aria-live`
- Preset pill buttons are touch-friendly (44px) but no horizontal scroll prevention

#### 34. Snapshots Page (955 lines)
- 100+ section definitions hardcoded (lines 68-303) — maintenance burden
- No pagination or virtual scrolling for snapshot list
- Detail view state is component-local — can't link to specific snapshot via URL
- Map component has no fallback UI while loading

#### 35. Shared/[token] Page (677 lines)
- Emoji icons render differently across OS — no font icon fallback
- Map dynamically imported with no loading fallback
- Metrics grids jump from 2 → 4 columns (no 3-col intermediate)
- Print layout not optimized for page breaks

#### 36. Admin Page (44 lines)
- Thin wrapper — Access Denied state has no redirect link
- Loading spinner has no timeout or error fallback

### Design Token Inconsistencies (Cross-Page)

| Token | Variants Found | Should Be |
|-------|---------------|-----------|
| Hover background | `bg-gray-700`, `bg-gray-800`, `bg-gray-800/30`, `bg-gray-800/50` | Pick one: `hover:bg-gray-800/50` |
| Border color | `border-gray-700`, `border-gray-800`, `border-gray-800/50` | Standard: `border-gray-800` |
| Label text | `text-gray-400`, `text-gray-500`, `text-gray-600` | Standard: `text-gray-500` |
| Secondary text | `text-gray-400`, `text-gray-500` | Standard: `text-gray-400` |
| Card background | `bg-gray-900/30`, `bg-gray-900/40`, `bg-gray-900/50` | Standard: `bg-gray-900/50` |

---

## Implementation Specs (Top 5 Fixes)

### Fix 1: Global Focus Indicator (1 file, 5 minutes)

**File:** `dashboard/app/globals.css`

Add to the end:
```css
@layer base {
  a:focus-visible,
  button:focus-visible,
  select:focus-visible,
  input:focus-visible,
  textarea:focus-visible,
  [tabindex]:focus-visible {
    outline: 2px solid rgb(139 92 246); /* violet-500 */
    outline-offset: 2px;
  }
}
```

**Impact:** Fixes keyboard navigation visibility on every interactive element across all 36 pages instantly.

### Fix 2: Replace `text-[10px]` (742 instances, 30 minutes)

**Strategy:** Not a blind find-replace — 3 categories:

| Current Usage | Replacement | Rationale |
|--------------|-------------|-----------|
| Labels/metadata (most cases) | `text-xs` (12px) | WCAG minimum |
| Section headers (uppercase + tracking) | `text-[11px]` | Uppercase + letter-spacing adds perceived size |
| Footer/copyright text | `text-xs` | Still small but legible |

**Command:** 
```bash
# Phase 1: Replace in labels/values (vast majority)
find dashboard/components dashboard/app -name "*.tsx" -exec sed -i '' 's/text-\[10px\]/text-xs/g' {} +
# Phase 2: Manually review remaining ~10 section headers
```

**Impact:** WCAG 1.4.4 compliance. Improves readability on mobile for every page.

### Fix 3: Shared `<StatusBadge>` Component (1 new file, then replace across ~15 files)

**File:** `dashboard/components/ui/StatusBadge.tsx`

```tsx
const STATUS_COLORS = {
  draft: "bg-gray-700/50 text-gray-300 border-gray-600",
  submitted: "bg-blue-900/40 text-blue-300 border-blue-800/50",
  approved: "bg-emerald-900/40 text-emerald-300 border-emerald-800/50",
  rejected: "bg-red-900/40 text-red-300 border-red-800/50",
  active: "bg-green-900/40 text-green-300 border-green-800/50",
  // ... all status types
} as const;

export function StatusBadge({ status }: { status: keyof typeof STATUS_COLORS }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${STATUS_COLORS[status]}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}
```

**Impact:** Eliminates 15+ ad-hoc badge implementations. Single source of truth for status colors.

### Fix 4: Replace `prompt()` with Custom Modal (4 locations)

**Locations:**
1. `components/WorkBoard.tsx:154` — "What's blocking this?"
2. `components/WorkBoard.tsx:559` — "What's blocking this?"
3. `components/TimesheetAdmin.tsx:236` — "Rejection reason"
4. `components/TimesheetForm.tsx:782` — "Rejection reason"

**Component:** `dashboard/components/ui/PromptModal.tsx`

```tsx
interface PromptModalProps {
  open: boolean;
  title: string;
  placeholder?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}
```

**Impact:** Fixes mobile UX (native `prompt()` is platform-inconsistent), adds accessibility (`role="dialog"`, focus trap), and consistent dark theme styling.

### Fix 5: Mobile Sidebar Drawer (1 new component + modify 2 files)

**New file:** `dashboard/components/nav/MobileDrawer.tsx`
**Modify:** `SectionSidebar.tsx` (add mobile trigger), `TopNav.tsx` (hamburger opens drawer)

**Approach:**
- On `< lg`: sidebar becomes a slide-in drawer from left edge
- Triggered by hamburger menu or swipe from left
- Overlay backdrop (`bg-black/60`) closes on tap
- Same `SectionSidebar` content rendered inside drawer
- `role="dialog" aria-modal="true"` with focus trap

**Impact:** Fixes the biggest mobile navigation gap — section links are currently invisible on mobile/tablet.

---

## Final Severity Matrix

| # | Issue | Instances | Effort | Impact |
|---|-------|-----------|--------|--------|
| 1 | No focus indicators | Global | 5 min | All pages, keyboard a11y |
| 2 | `text-[10px]` WCAG fail | 742 | 30 min | All pages, readability |
| 3 | No shared StatusBadge | ~15 files | 2 hr | Design consistency |
| 4 | `prompt()` dialogs | 4 | 1 hr | Mobile UX, a11y |
| 5 | Sidebar hidden on mobile | 1 component | 2 hr | Mobile navigation |
| 6 | Color-only status dots | ~10 files | 1 hr | Colorblind a11y |
| 7 | No pagination | All lists | 4 hr | Performance, UX |
| 8 | Hardcoded grid-cols-5 | 3 files | 15 min | Mobile overflow |
| 9 | No inline form validation | ~8 forms | 3 hr | Form UX |
| 10 | Inconsistent loading states | ~10 pages | 2 hr | Polish |
| 11 | Mobile data tables | ~6 pages | 4 hr | Mobile UX |
| 12 | No breadcrumb semantics | 1 file | 15 min | Accessibility |
| 13 | Missing ARIA labels | ~20 files | 2 hr | Screen reader support |
| 14 | No unread chat badges | 1 file | 1 hr | Feature gap |
| 15 | Design token drift | ~30 files | 3 hr | Visual consistency |

**Total estimated effort: ~26 hours** to resolve all 15 categories.

---

*Updated: 2026-04-10 — Iteration 3 (final)*
*Complete audit: 36 pages/components, 742 text-[10px] instances, 30+ specific findings, 5 implementation specs*
