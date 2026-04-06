# E2E Tests (Playwright)

End-to-end tests for the IronSight Fleet Monitor dashboard. Tests use Playwright
route interception to mock all Viam API calls, so they run without credentials
or real hardware.

## Setup

```bash
cd dashboard
npm install                    # install deps (includes @playwright/test)
npx playwright install chromium  # download browser binary
```

## Running tests

```bash
# Run all E2E tests (headless, starts dev server automatically)
npm run test:e2e

# Run with interactive UI (useful for debugging)
npm run test:e2e:ui

# Run a specific test file
npx playwright test tests/e2e/fleet.spec.ts

# Run with headed browser (see the browser)
npx playwright test --headed
```

## Structure

```
tests/
  mocks/
    sensor-data.ts     # Realistic mock data for PLC, truck, and fleet APIs
  e2e/
    dashboard.spec.ts  # Core page-load smoke tests (home, dev, shift-report, fleet)
    truck-panel.spec.ts # Truck diagnostics panel (lamps, DTCs, AI chat)
    fleet.spec.ts      # Fleet overview (truck cards, status, empty/error states)
  README.md            # This file
```

## How mocking works

Tests use `page.route()` to intercept API requests before they reach the
Next.js server. This means:

- No Viam credentials needed
- No PLC or CAN bus hardware needed
- Tests are fast and deterministic
- Mock data in `tests/mocks/sensor-data.ts` mirrors real API response shapes

## Test reports

After running tests, view the HTML report:

```bash
npx playwright show-report
```

Screenshots from failed tests are saved to `test-results/`.
