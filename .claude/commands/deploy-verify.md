Post-deploy smoke test — verify all API endpoints on production.

Hit every API endpoint on the live Vercel deployment and report pass/fail.
The production URL is: `https://viam-staubli-apera-plc-mobile-poc.vercel.app`

## Endpoint Registry (101 endpoints)

Test each endpoint with `curl`. Expected behavior:
- **GET routes**: Should return 200 or 401 (auth required). Never 500 or 404.
- **POST routes** (empty body): Should return 400 (validation) or 401. Never 500 or 404.
- Any 500 or 404 response means the endpoint is broken.

### Fleet & Sensor (16 endpoints)
```
GET  /api/sensor-readings
GET  /api/truck-readings
GET  /api/cell-readings?sim=true
GET  /api/shift-report?date=2026-04-01&startHour=6&startMin=0&endHour=18&endMin=0
GET  /api/sensor-history
GET  /api/dtc-history
GET  /api/fleet/status
GET  /api/fleet/trucks
GET  /api/snapshots
GET  /api/truck-notes
GET  /api/truck-history
GET  /api/truck-history-local
POST /api/truck-command
POST /api/truck-assignments
GET  /api/maintenance
GET  /api/pi-health
```

### Work Orders (4 endpoints)
```
GET   /api/work-orders
POST  /api/work-orders
PATCH /api/work-orders
GET   /api/team-members
```

### Chat (4 endpoints)
```
GET  /api/chat/threads
POST /api/chat/threads
GET  /api/chat/threads/by-entity?entity_type=truck&entity_id=01
GET  /api/chat/users
```

### AI Features (5 endpoints)
```
POST /api/ai-chat
POST /api/ai-diagnose
POST /api/ai-suggest-steps
POST /api/ai-report-summary
POST /api/reports/generate
```

### Timesheets (4 endpoints)
```
GET  /api/timesheets
POST /api/timesheets
GET  /api/timesheets/admin
GET  /api/timesheets/vehicles
```

### HR (10 endpoints)
```
GET  /api/training
GET  /api/training/requirements
GET  /api/training/admin
GET  /api/pto
POST /api/pto
GET  /api/pto/admin
GET  /api/pto/balance
GET  /api/per-diem
GET  /api/per-diem/rates
GET  /api/profiles
```

### Accounting (31 endpoints)
```
GET  /api/accounting/accounts
POST /api/accounting/accounts
GET  /api/accounting/entries
POST /api/accounting/entries
GET  /api/accounting/trial-balance
GET  /api/accounting/general-ledger
GET  /api/accounting/aging
GET  /api/accounting/cash-flow
GET  /api/accounting/invoices
POST /api/accounting/invoices
GET  /api/accounting/bills
POST /api/accounting/bills
GET  /api/accounting/customers
GET  /api/accounting/bank
GET  /api/accounting/recurring
GET  /api/accounting/budget
POST /api/accounting/budget
GET  /api/accounting/payroll-run
GET  /api/accounting/employee-tax
GET  /api/accounting/vendor-1099
GET  /api/accounting/fixed-assets
GET  /api/accounting/estimates
POST /api/accounting/estimates
GET  /api/accounting/expense-rules
GET  /api/accounting/receipt-ocr
GET  /api/accounting/audit-trail
GET  /api/accounting/payment-reminders
GET  /api/accounting/mileage-rates
GET  /api/accounting/sales-tax
GET  /api/accounting/tax-reports
```

### Inventory (4 endpoints)
```
GET  /api/inventory
POST /api/inventory
GET  /api/inventory/alerts
GET  /api/inventory/usage
```

### System (4 endpoints)
```
GET  /api/help
GET  /api/reports
GET  /api/audit-log
POST /api/webhooks/clerk
```

## Execution

For each endpoint, run curl and check the HTTP status code:
```bash
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "https://viam-staubli-apera-plc-mobile-poc.vercel.app/api/<path>")
```

For POST endpoints, send an empty JSON body:
```bash
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Content-Type: application/json" -d '{}' "https://viam-staubli-apera-plc-mobile-poc.vercel.app/api/<path>")
```

Run ALL endpoints in parallel (use `&` and `wait`) to keep it fast.

## Report Format

```
=== Deploy Verification (YYYY-MM-DD HH:MM) ===

Production URL: https://viam-staubli-apera-plc-mobile-poc.vercel.app

Fleet & Sensor:  16/16 OK
Work Orders:      4/4  OK
Chat:             4/4  OK
AI Features:      5/5  OK
Timesheets:       4/4  OK
HR:              10/10 OK
Accounting:      31/31 OK
Inventory:        4/4  OK
System:           4/4  OK

Total: 101/101 endpoints healthy

FAILED:
  (list any that returned 500 or 404)
```

A healthy endpoint returns: 200, 201, 400, 401, or 403.
A broken endpoint returns: 500 or 404.

If all 101 endpoints are healthy, end with: "Deploy verified — all endpoints operational."
If any are broken, list them with their status codes and suggest investigation.
