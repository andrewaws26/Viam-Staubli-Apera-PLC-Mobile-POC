#!/bin/bash
# IronSight AI Diagnosis — pulls live vehicle data from Viam Cloud and pipes to Claude CLI
#
# Usage: ./ai-diagnose.sh [dashboard-url]
# Default: viam-staubli-apera-plc-mobile-poc.vercel.app

DASHBOARD="${1:-viam-staubli-apera-plc-mobile-poc.vercel.app}"
COMPONENT="truck-engine"

echo "=========================================="
echo "  IronSight AI Vehicle Diagnosis"
echo "=========================================="
echo ""
echo "Pulling live readings from $DASHBOARD..."
echo ""

# Pull live readings
READINGS=$(curl -s "https://${DASHBOARD}/api/truck-readings?component=${COMPONENT}" 2>/dev/null)

if [ -z "$READINGS" ] || echo "$READINGS" | grep -q '"error"'; then
  echo "ERROR: Could not pull readings from dashboard."
  echo "Response: $READINGS"
  exit 1
fi

echo "Live data received. Running AI analysis..."
echo ""

# Pipe to Claude CLI
echo "$READINGS" | claude -p "You are a master ASE-certified diesel and automotive mechanic with 30 years of experience. You are looking at live diagnostic data from a vehicle's CAN bus, pulled remotely via a cloud-connected IoT sensor.

Analyze this data and provide:

1. **VEHICLE STATUS** — Is this vehicle safe to drive right now? One clear sentence.

2. **ACTIVE TROUBLE CODES** — If any DTCs are present (look for active_dtc_count > 0 and obd2_dtc_* fields), explain each code in plain English:
   - What the code means
   - What's likely causing it on this specific vehicle
   - Severity (critical/warning/minor)
   - Estimated repair cost range
   - Can it wait or needs immediate attention?

3. **ENGINE HEALTH ASSESSMENT** — Based on the live readings:
   - Are temperatures normal? (coolant, oil, intake, catalyst)
   - Are pressures normal? (oil, fuel, manifold, barometric)
   - Are fuel trims within spec? (short-term should be ±10%, long-term ±10%)
   - Is battery voltage healthy? (should be 13.5-14.5V running)
   - Any readings that suggest a developing problem?

4. **MAINTENANCE RECOMMENDATIONS** — Based on what you see, what should be done?
   - Immediate (do now)
   - Soon (within 2 weeks)
   - At next service

5. **FLEET NOTE** — If this were one truck in a fleet of 36, what would you flag for the fleet manager?

Keep it conversational but professional. A head mechanic is reading this. Don't dumb it down but don't use unnecessary jargon either. Be specific about numbers — reference the actual values you see in the data.

Here is the live vehicle data:
$(echo "$READINGS" | python3 -m json.tool 2>/dev/null || echo "$READINGS")"

echo ""
echo "=========================================="
