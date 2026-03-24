# TPS Dashboard Guide

A field guide for operators and technicians. The dashboard shows real-time data from the Click PLC on each truck, updated every second.

Access: https://viam-staubli-apera-plc-mobile-poc.vercel.app

---

## Section 1: TPS Controller Status (Top Card)

The top card shows whether the Pi is talking to the PLC.

| Color | Meaning |
|-------|---------|
| Green | PLC connected, no faults |
| Red | Connection lost or fault active |

**If red:** Check the Ethernet cable between the Pi and PLC. Check that the PLC has power. The system auto-reconnects — if the cable is good and PLC is on, it'll go green within 5 seconds.

---

## Section 2: Encoder Details

The SICK DBS60E encoder on the track wheel. This is how the system knows how far the truck has moved.

| Field | What It Shows |
|-------|---------------|
| **Distance Traveled** | Total distance this session in feet. Derived from DS10 (Encoder Next Tie countdown), NOT from DD1. Resets when viam-server restarts. |
| **Track Speed** | Real-time ground speed in feet per minute. Derived from DS10 change rate. |
| **Direction** | "forward" or "reverse" based on DS10 counting down (forward) or up (reverse). |
| **Raw Pulse Count** | DD1 from PLC — oscillates 0-13 rapidly. Shows encoder is alive but NOT used for distance (the PLC resets DD1 thousands of times per second). |
| **Wheel Revolutions** | How many times the track wheel has turned. Calculated from accumulated distance ÷ wheel circumference. |
| **Shift Hours** | Time since this monitoring session started. |

### How distance actually works:
Distance comes from **DS10 (Encoder Next Tie)**, not DD1. DS10 counts down from 195 (= 19.5") to 0 in 0.1-inch units. Each full cycle = 19.5" of travel. The Pi tracks this countdown and accumulates distance. This is reliable because DS10 changes slowly enough for 1Hz sampling. See `docs/encoder-distance.md` for the full technical explanation.

### What to look for:
- **Speed reads 0 but truck is moving** → Encoder cable disconnected, encoder failure, or wheel not turning (lifted off rail)
- **Direction shows "reverse" during forward travel** → Encoder wired backwards (swap A/B channels at PLC terminals X1/X2)
- **Raw Pulse Count stuck at 0** → Encoder dead or cable disconnected. DD1 should oscillate 0-13 when moving.
- **DS10 not changing** → PLC not processing encoder counts. Check PLC is in RUN mode.
- **Speed fluctuating wildly at low speed** → Normal at very low speeds due to DS10 resolution (0.1" = 2.54mm)

---

## Section 3: TPS Machine Status

Core system inputs. These tell you whether the TPS is ready to operate.

| Field | PLC Register | What It Means |
|-------|-------------|---------------|
| **TPS Power Loop** | X4 | The main power circuit for the tie plate system. OFF = system is not running. This is the #1 thing to check — nothing works without it. |
| **Plate Flipper (X3)** | X3 | The plate flipper — a needle on a bearing that detects plate orientation. Pulses ON when it detects a tie passing under it. (Labeled "Camera" in PLC project file.) |
| **Encoder** | C2000 related | Encoder is active and counting. |
| **Floating Zero** | C2000 | The encoder zero reference. Used for calibration. |
| **Encoder Reset** | C1999 | PLC is resetting the encoder count (momentary). |

### What to look for:
- **TPS Power Loop OFF during operation** → Power circuit tripped, E-stop hit, or main switch off
- **Plate Flipper signal never fires while truck is on ties** → Flipper needle stuck, debris blocking it, bad cable, or 5-pin connector loose
- **Plate Flipper signal stuck ON** → Flipper jammed or wiring short on X3

---

## Section 4: TPS Eject System

The solenoids that physically drop tie plates, and the wireless relays that trigger them.

| Field | PLC Register | What It Means |
|-------|-------------|---------------|
| **Eject TPS-1** | Y1 | Center chute solenoid. Fires briefly (ON then OFF) for each plate drop. |
| **Eject Left TPS-2** | Y2 | Left chute solenoid (dual-chute mode). |
| **Eject Right TPS-2** | Y3 | Right chute solenoid (dual-chute mode). |
| **Air Eagle 1** | X5 | Wireless relay feedback — confirms the air solenoid actually fired. |
| **Air Eagle 2** | X6 | Second wireless relay feedback. |
| **Air Eagle 3 Drop** | X7 | Third wireless relay (enable signal). |

### What to look for:
- **Y1 fires but Air Eagle doesn't confirm** → Air pressure low, wireless relay out of range, or solenoid valve stuck
- **Y1 never fires while truck is moving with TPS on** → Drop not enabled, mode not set, or logic fault (check Drop Pipeline section)
- **Y1 chattering (rapid ON/OFF)** → Known Y1 bounce issue. The Pi debounces this in software for counting.
- **Left/Right chutes firing when in Single mode** → Mode misconfiguration

---

## Section 5: Production Stats

The numbers that matter for production output.

| Field | Source | What It Means |
|-------|--------|---------------|
| **Plate Rate** | Calculated | Plates per minute — how fast you're laying. |
| **Total Plates Dropped** | Y1 count | Pi's count of eject pulses this session. |
| **Tie Spacing (×0.5in)** | DS2 | The programmed distance between drops. DS2=39 means 39×0.5" = **19.5 inches**. This is set in the PLC and doesn't change during operation. |

### What to look for:
- **Plate Rate drops to 0 while moving** → Drops stopped. Check TPS Power, Drop Enable, and Operating Mode.
- **Plate Rate much lower than expected** → Truck moving slowly, or detector is skipping ties (check skipped tie indicators)
- **DS2 changed from expected value** → Someone changed the tie spacing setting at the PLC/HMI

---

## Section 6: Operating Mode

Which plate-dropping mode the PLC is running. Only one mode is active at a time.

| Mode | What It Does |
|------|-------------|
| **TPS-1 Single** | Standard: one plate drops from the center chute every 19.5 inches. Most common mode. |
| **TPS-1 Double** | Two plates per position: first plate drops, then a second plate 9 inches later. |
| **TPS-2 Both** | Dual chute: alternates left and right chutes. |
| **TPS-2 Left** | Left chute only. |
| **TPS-2 Right** | Right chute only. |
| **Tie Team** | Skip/lay pattern: the PLC follows a programmed sequence of which ties to skip and which to plate. Used when a tie gang is working the same track. |
| **2nd Pass** | Second pass over track that already has some plates. Fills in gaps. |
| **None** | No mode selected — TPS power is off or system just started. |

### What to look for:
- **Mode shows "None" while TPS is powered** → Mode not selected at HMI. Operator needs to select a mode before plates will drop.
- **Wrong mode active** → Operator selected wrong mode at HMI. Plates may drop at wrong spacing or from wrong chute.

---

## Section 7: Drop Pipeline

The chain of signals that must be active for a plate to drop. Think of it as a checklist — all the right signals need to be ON for the solenoid to fire.

| Signal | PLC Coil | Role |
|--------|----------|------|
| **Drop Enable** | C16 | Master enable. Must be ON for any drops. Controlled by TPS Power + HMI. |
| **Drop Latch** | C17 | Latched enable. Stays ON once enabled until manually cleared. |
| **Detector Eject** | C30 | Plate flipper detected a tie at the right position — fire the solenoid now. |
| **Encoder Eject** | C32 | Encoder counted 19.5" since last drop — fire the solenoid now. |
| **SW Eject** | C29 | Software/HMI triggered a manual eject. |
| **1st Tie Found** | C34 | Plate flipper has detected at least one tie since system started. The PLC waits for this before allowing encoder drops. |

### How a normal plate drop works:
1. Drop Enable = ON (TPS powered, mode selected)
2. Drop Latch = ON
3. Truck moves forward, encoder counts distance
4. Either: Flipper detects tie → Detector Eject fires → Y1 fires → plate drops
5. Or: Encoder hits 19.5" → Encoder Eject fires → Y1 fires → plate drops
6. If both would fire within 2", encoder yields to detector (Rung 4-5 in ladder)

### What to look for:
- **Drop Enable OFF while TPS is powered** → HMI Enable Drop (C5) not pressed, or a safety condition isn't met
- **Drop Latch OFF** → System was stopped and needs to be re-enabled
- **Detector Eject never fires but Encoder Eject does** → Flipper not detecting ties. System is running on encoder-only (blind dropping by distance). Plates may not align with ties.
- **Encoder Eject never fires but Detector fires** → Normal if flipper is working well — detector drops are preferred over encoder drops
- **Neither eject fires while truck is moving** → Drop Enable is probably OFF, or 1st Tie not found yet
- **1st Tie Found stays OFF for a long time** → Flipper not seeing any ties. Check flipper needle, debris, and X3 signal.

---

## Section 8: Detection & Control

Real-time detection and control flags.

| Field | PLC Coil | What It Means |
|-------|----------|---------------|
| **Encoder Mode** | C3 | Encoder-only mode — plate flipper is bypassed, plates drop purely by distance (every 19.5"). Use when flipper is not working. |
| **Flipper Detection** | C12 | Plate flipper currently detects a tie right now. Flashes as ties pass under the flipper. |
| **Backup Alarm** | C7 | Truck is moving backward. **Plates will NOT drop in reverse.** |
| **Lay Ties** | C13 | System is in lay mode — plates should be dropping. |
| **Drop Ties** | C14 | Drop command is active (similar to Lay Ties but more immediate). |

### What to look for:
- **Encoder Mode ON when you expect flipper detection** → Someone switched to encoder-only. Plates drop blind by distance — they won't skip rocks or adjust for actual tie positions.
- **Flipper Detection never flashes while on ties** → Flipper problem (see Section 3)
- **Backup Alarm ON** → Truck is going backwards. Stop and go forward. Plates won't drop and the encoder may behave erratically in reverse.
- **Lay Ties OFF during production** → System paused. Check HMI.
- **Flipper Detection flashing but no plates dropping** → Drop pipeline issue. Check Drop Enable, mode selection.

---

## Section 9: Raw Registers (Collapsible)

All 25 DS holding registers from the PLC with decoded labels. Expand this for deep debugging.

| Register | Label | Typical Value | What To Know |
|----------|-------|---------------|-------------|
| DS1 | Encoder Ignore | 1310 | Threshold for ignoring small encoder counts |
| DS2 | Tie Spacing (×0.5in) | 39 | **39 × 0.5" = 19.5"** — the drop spacing |
| DS3 | Tie Spacing (×0.1in) | 195 | Same spacing in tenths: **19.5"** |
| DS4 | Miles Laying/10 | 0 | Distance in tenths of mile |
| DS5 | Det Offset Bits | 1314 | Detector offset in encoder bit counts |
| DS6 | Det Offset (×0.1in) | 6070 | **607.0 inches = 50.6 ft** from camera to eject point |
| DS7 | Plate Count | varies | PLC's own plate count (persists across sessions) |
| DS8 | Avg Plates/Min | varies | PLC-calculated plate rate |
| DS9 | Det Next Tie | varies | Distance to next detector-triggered drop (0 when idle) |
| DS10 | Enc Next Tie | 195 | Distance to next encoder-triggered drop (195 = 19.5" = full spacing when idle) |
| DS11 | 1st Tie Distance | 6070 | Position of first detected tie |
| DS12 | Detector Bits | varies | Detector position in bit counts |
| DS13 | Last Det Laid (in) | varies | Spacing of last detector-triggered plate |
| DS14 | 2nd Pass Dbl Lay | varies | Position for double-lay second plate |
| DS15 | Tie Team Skips | 0 | Number of ties skipped in tie team mode |
| DS16 | Tie Team Lays | 0 | Number of ties laid in tie team mode |
| DS17 | Skip+Lay-1 | 0 | Tie team calculation |
| DS19 | HMI | 0 | HMI screen selection |

### What to look for in raw registers:
- **DS2 changed** → Spacing setting was modified at the PLC
- **DS7 not incrementing** → Plates not dropping (even though PLC thinks it should be)
- **DS9 counting down** → Detector has a tie in the pipeline approaching the eject point
- **DS10 counting down** → Encoder is counting down to the next distance-based drop
- **DS15/DS16 growing** → Tie team mode is actively skipping and laying

---

## Common Problems and What the Dashboard Shows

### Problem: Plates not dropping
**Dashboard clues:**
1. Check TPS Power Loop → OFF? System isn't powered.
2. Check Operating Mode → "None"? No mode selected.
3. Check Drop Enable → OFF? Enable not set at HMI.
4. Check Drop Pipeline → No eject signals? Check 1st Tie Found.
5. Check Speed → 0? Truck isn't moving.
6. Check Backup Alarm → ON? Truck is in reverse.

### Problem: Plates dropping at wrong spacing
**Dashboard clues:**
1. Check DS2 Tie Spacing → Is it 39 (19.5")? If different, someone changed it.
2. Check Encoder Mode → ON means camera is bypassed, drops are purely distance-based (won't adjust for actual tie positions).
3. Check Flipper Detection → Not flashing? Flipper is dead, all drops are encoder-based.
4. Check DS13 Last Det Laid → What was the actual spacing of the last detector drop?

### Problem: Plates dropping but skipping ties
**Dashboard clues:**
1. Check Flipper Detection → Flashing? Flipper sees ties but something else is wrong.
2. Check Detection section → Encoder Mode ON means no flipper-based detection.
3. Check DS15 Tie Team Skips → Growing? System is in tie team mode and intentionally skipping.
4. Check Speed → Too fast? At high speeds the camera may miss ties.

### Problem: Double plates (two plates on one tie)
**Dashboard clues:**
1. Check Operating Mode → TPS-1 Double or 2nd Pass? These intentionally double-lay.
2. Check Y1 Eject → Chattering? Y1 bounce issue causing double fires.
3. Check DS14 2nd Pass Dbl Lay → Non-zero means double lay logic is active.

### Problem: Plate flipper not detecting ties
**Dashboard clues:**
1. X3 Plate Flipper signal → Always OFF? Flipper isn't sending signal.
2. Flipper Detection (C12) → Never ON? Flipper sees nothing.
3. 1st Tie Found (C34) → Still OFF after moving over ties? Flipper completely dead.
4. **Physical check:** Check the flipper needle moves freely on its bearing. Clear any debris around the flipper. Check the 5-pin connector (blue/white wires). Check cable to PLC terminal X3.

### Problem: System shows "Backup Alarm"
**What happened:** Truck moved backwards. C7 fires.
**Impact:** Plates won't drop in reverse. Encoder count may behave unexpectedly.
**Fix:** Move truck forward. Alarm clears automatically.

### Problem: Encoder shows wrong distance/speed
**Dashboard clues:**
1. Raw Pulse Count jumping wildly → Encoder noise, bad cable shielding, or interference
2. Speed shows value but truck is stopped → Encoder vibration or loose mounting
3. Distance not increasing while moving → Encoder cable disconnected or encoder failure
4. Direction wrong → A/B channels swapped (hardware fix: swap X1/X2 wires)

### Problem: Air Eagle feedback not matching ejects
**Dashboard clues:**
1. Y1 fires (Eject TPS-1 goes ON briefly) but Air Eagle 1 stays OFF → Low air pressure, wireless relay out of range, dead relay battery, or solenoid valve stuck
2. Air Eagle fires but no plate drops → Chute jam, empty hopper, or mechanical issue (not visible on dashboard)

---

## Efficiency Indicators

### Good production run looks like:
- TPS Power Loop: ON
- Operating Mode: TPS-1 Single (or whatever's intended)
- Drop Enable + Drop Latch: both ON
- Flipper Detection: flashing regularly as ties pass
- Plate Rate: steady, matching truck speed
- Speed: consistent (not stop-and-go)
- Both Detector and Encoder ejects firing (detector preferred, encoder as backup)
- Backup Alarm: OFF

### Signs of an efficient run:
- High ratio of Detector Eject to Encoder Eject → plate flipper is working well, plates align with actual ties
- DS13 (last detector spacing) close to 19.5" → ties are evenly spaced, flipper is detecting them accurately
- Low or zero Tie Team Skips (DS15) when not in tie team mode
- Steady plate rate matching truck speed ÷ 19.5"

### Signs of inefficiency:
- All Encoder Ejects, zero Detector Ejects → plate flipper is down, running blind
- Plate Rate varies widely → stop-and-go driving, or detection issues causing drops to cluster
- DS7 (PLC plate count) doesn't match Pi plate count → missed eject pulses or Y1 bounce
- DS2 not set to expected 39 → wrong spacing, wasting plates or leaving gaps

---

## System Diagnostics

The dashboard includes an automated diagnostics engine that evaluates 19 rules across 5 categories every second. The diagnostics panel appears below the PLC detail section.

### Severity Levels

| Severity | Color | Meaning |
|----------|-------|---------|
| **Critical** | Red | Stop and fix now — something is broken or production is at risk |
| **Warning** | Yellow | Monitor closely — something may be degrading or misconfigured |
| **Info** | Blue | FYI — usually normal but worth noting |

### Diagnostic Categories

| Category | What It Covers |
|----------|----------------|
| **Plate Flipper** | Flipper detection rate declining, flipper dead, intermittent connection, no ties present |
| **Encoder** | Encoder stopped, encoder noise excessive, plate spacing drifting from target |
| **Eject** | No eject confirmations from Air Eagle, eject not firing despite being enabled |
| **PLC** | Modbus communication slowing, high error rate |
| **Operation** | Non-standard tie spacing, truck moving backward, drops disabled while TPS is powered |

### Signal Metrics Strip

When available, a metrics strip shows at the top of the diagnostics panel:
- **Flipper Det/min** — How many ties the plate flipper detects per minute (0 = flipper isn't seeing anything)
- **Eject Rate/min** — How many plates are being dropped per minute
- **PLC Latency** — Modbus TCP response time in milliseconds (normal <5ms, warning >5ms)

### What to do when diagnostics fire:
Each diagnostic includes a "What to do" section with step-by-step operator actions. Follow these first. If the issue persists, use the AI Diagnosis feature on the touch screen or contact the technician.

### Warmup Period
Diagnostics are disabled for the first 60 seconds after the sensor module starts. This prevents false alarms during the startup sequence.

---

## Touch Screen (IronSight Touch)

Each truck has a 3.5" touchscreen on the Pi that provides a glove-friendly interface. The touch screen has 6 pages:

| Page | What It Shows |
|------|---------------|
| **HOME** | Live production dashboard — plates dropped, speed, status, alerts |
| **LIVE** | Real-time PLC register data — encoder, plates, speed, spacing |
| **COMMANDS** | Actionable buttons — restart viam-server, test PLC, check WiFi |
| **DIAGNOSE** | AI-powered diagnosis — analyzes all system data and gives plain-English assessment |
| **LOGS** | Recent activity, incidents, state changes |
| **SYSTEM** | System health — disk, CPU, memory, network, services |

### AI Diagnosis (DIAGNOSE page)

When you tap the DIAGNOSE nav button:
1. The system automatically collects data from the PLC (all registers, signal metrics, control bits), Viam internals (capture status, sensor uptime, error rates), network health (eth0, WiFi, Modbus latency), and system health (CPU, memory, disk, battery).
2. This data is sent to Claude AI for analysis.
3. The AI response is color-coded:
   - **Green text** = everything looks fine
   - **Yellow text** = warnings detected, monitor closely
   - **Red text** = critical problems found, needs attention
4. If the AI's suggestion doesn't fix it, tap **TRY AGAIN** — the AI knows the previous fix didn't work and will suggest something different.
5. You can also **double-tap** anywhere on the DIAGNOSE page to ask a voice question about the system.

### Alert Bar

If there are active diagnostics (critical or warning), a persistent alert bar appears at the top of every page showing the most important issue. Critical issues show in red, warnings in yellow.
