# IronSight Mobile UI/UX Audit

## Iteration 1 — Foundation, Tab Bar, Fleet Screen (2026-04-10)

### Aesthetic Direction: Industrial Command Center
Military/aviation HUD meets rugged equipment dashboard. High-contrast for outdoor visibility, data-dense but organized. Monospace for sensor readings, condensed display font for headers, aggressive purple accents against near-black backgrounds.

### Findings

#### 1. Typography — CRITICAL
- **Issue**: Uses system fonts exclusively. No personality, indistinguishable from any default app.
- **Fix**: Install Barlow (semi-condensed grotesque) for display/headers, JetBrains Mono for data readings. System font as body fallback.
- **Impact**: Instant brand recognition. Barlow's industrial character matches the fleet/heavy equipment domain perfectly.

#### 2. Tab Bar — HIGH
- **Issue**: Uses emoji icons (🚛📊🤖💬📋🧠⋯). Looks unprofessional on a production app. No animated active indicator, no visual weight hierarchy, no backdrop blur.
- **Fix**: Custom tab bar component with SVG path icons, animated sliding indicator, subtle backdrop blur, and proper iOS safe area handling.
- **Impact**: Tab bar is seen on every screen — fixing it elevates the entire app perception.

#### 3. Fleet Home Screen — HIGH
- **Issue**: Flat list of cards with basic layout. No entrance animations, no data hierarchy, status pills use hardcoded hex colors with opacity instead of theme tokens. Summary bar feels tacked on.
- **Fix**: Staggered card entrance animations, refined truck cards with subtle left-border status accent, monospace readings, pulse animation on live status dots, better summary header with gradient background.
- **Impact**: First screen users see — sets the tone for the entire app experience.

#### 4. Color System — MEDIUM
- **Issue**: Missing depth layers. Only 3 grays (background, card, cardElevated). No surface variants for hover states, no glow/shadow tokens, hardcoded hex+opacity throughout components instead of using theme.
- **Fix**: Add surface layers (surface0 through surface3), shadow definitions, glow colors for status, animation timing constants to theme.
- **Impact**: Consistent depth hierarchy across all screens.

#### 5. Card Component — MEDIUM
- **Issue**: No press feedback animation (just opacity), no shadow/elevation, static border. Feels flat and lifeless.
- **Fix**: Add Reanimated scale-down on press, subtle shadow on elevated variant, optional left accent border for status indication.
- **Impact**: Every screen uses Card — animation upgrade propagates everywhere.

#### 6. Button Component — LOW (already decent)
- **Issue**: Has haptics and variants, which is good. Text is uppercase with letter spacing — slightly aggressive for all contexts. Missing press scale animation.
- **Fix**: Add Reanimated spring scale animation on press. Consider non-uppercase variant for inline actions.
- **Impact**: Minor polish, already functional.

#### 7. Badge Component — LOW
- **Issue**: Hardcoded hex+opacity backgrounds. Works fine but not using theme tokens.
- **Fix**: Move variant colors to theme, add optional pulse animation for "danger" variant.
- **Impact**: Consistency improvement.

### Screens Not Yet Audited
- Truck detail screen
- AI chat screen
- Work orders (board + detail)
- Chat (list + thread)
- Cell monitoring
- Inspect (pre/post-shift)
- More/Settings
- All detail screens (truck/[id], work-order/[id], etc.)

### Changes Made This Iteration
- Installed `expo-font`, `@expo-google-fonts/barlow`, `@expo-google-fonts/jetbrains-mono`
- Redesigned theme system: colors (depth layers, glow tokens), typography (custom fonts), spacing (shadow/elevation), animation timing
- Built custom animated tab bar replacing emoji icons
- Redesigned Fleet home screen with staggered animations and refined data cards
- Upgraded Card, Button, Badge primitives with press animations
- Created font loading provider

---

## Iteration 2 — Sprint 1A Stability Fixes (2026-04-10)

### Design Spec
Full mobile parity spec written: `docs/superpowers/specs/2026-04-10-mobile-parity-design.md`

### Audit Results (all 19 screens)

| Category | Status |
|----------|--------|
| Hooks ordering violations | 0 found (all correct) |
| ErrorBoundary components | 0 existed → Now on all 7 tab screens |
| Network error handling | 8 screens silently swallowed errors → Fixed fleet, truck, cell with NetworkError component |
| Safe area handling | 0 screens (only TabBar had it) |
| Loading states | 4 of 15+ screens used LoadingState |
| Pull-to-refresh | 6 screens (good coverage) |
| Empty states | Good — EmptyState component used widely |
| GestureDetector issues | 0 (already fixed in iteration 1) |

### Changes Made
- Created `ErrorBoundary` component — class component with crash recovery UI
- Created `NetworkError` component — inline error banner with retry button
- Wrapped all 7 tab screens with ErrorBoundary (fleet, truck, cell, work, ai, inspect, more)
- Added network error state + NetworkError banner to fleet screen (was silent catch)
- Added network error state + NetworkError banner to truck screen (was silent catch)
- Replaced inline error banner in cell screen with NetworkError component (with retry)
- Removed unused errorBanner/errorText styles from cell.tsx
- All 68 tests passing, 0 new type errors

### Still Needed (Sprint 1A)
- SafeAreaView wrapping on all tab screens
- LoadingState component used consistently on all data screens
- Pull-to-refresh on chat, ai, inspect, more screens
- Network error handling on work orders, chat, more screens
