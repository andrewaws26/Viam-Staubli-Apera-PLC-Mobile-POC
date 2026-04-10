Run the full test suite (works on Mac).

Run these three test suites and report pass/fail counts for each:

1. **PLC sensor tests** (Python):
   ```
   python3 -m pytest modules/plc-sensor/tests/ -v
   ```

2. **J1939 sensor tests** (Python):
   ```
   python3 -m pytest modules/j1939-sensor/tests/ -v
   ```

3. **Dashboard unit tests** (vitest):
   ```
   cd dashboard && npx vitest run
   ```

IMPORTANT: Run the two pytest suites as separate commands — do NOT combine them in a single pytest invocation (conftest collision).

After all three complete, provide a summary table with pass/fail/skip counts per suite and overall result.
