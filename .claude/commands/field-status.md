Read and summarize current field status from the Pi 5 via SSH (Tailscale).

**Requires**: Pi 5 reachable at `100.112.68.52` via Tailscale.

SSH into `andrew@100.112.68.52` and read:

1. **Self-heal status**: `cat /tmp/ironsight-heal-status.json` — Parse and report current healing state, last check time, any active issues.

2. **Recent incidents**: `ls -t ~/Viam-Staubli-Apera-PLC-Mobile-POC/scripts/incidents/ | head -3` then read each file. Report what happened and when.

3. **Field log tail**: `tail -20 /var/log/ironsight-field.jsonl` — Parse JSON lines and summarize recent events (categories, successes/failures, timing).

Provide a structured summary:
- **Healthy**: what's working normally
- **Degraded**: anything showing warnings or intermittent failures
- **Down**: anything currently non-functional
- **Claude interventions**: any recent Tier 2 self-heal Claude calls

If SSH fails, report Pi unreachable and suggest checking Tailscale.
