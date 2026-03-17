# Click PLC Setup Guide — C0-10DD2E-D to Pi 5 via Modbus TCP

**Hardware:** Click C0-10DD2E-D → Netgear switch → Raspberry Pi 5 (viam-server)
**Goal:** Two physical buttons (servo power toggle + e-stop) readable by the Pi via Modbus TCP,
feeding the same `plc-sensor` module and Viam dashboard already running against the simulator.

> **Design principle:** The ladder logic is written to populate the **exact same Modbus
> holding-register addresses** the `plc-simulator` (Pi Zero W) uses. The `plc-sensor` module
> on the Pi 5 requires **no code changes** — you only update the `host` field in
> `config/viam-server.json` to point at the real PLC's IP.

---

## What each phase unlocks

| Phase | What you can test after completing it |
|-------|--------------------------------------|
| 1 — Power up | PLC LEDs on, heartbeat visible |
| 2 — Programming software | Can read/write the PLC from your Windows PC |
| 3 — Ethernet + Modbus | Pi 5 can query registers with a Python script |
| 4 — Wire buttons | Physical inputs register in the programming software |
| 5 — Ladder logic | Button presses change registers; Modbus reads reflect them |
| 6 — Sensor module update | Viam `plc-monitor` sensor reads the real PLC |
| 7 — Full integration | Dashboard shows live button state |

---

## Phase 1 — Power It Up

### 1.1 What power supply to buy

The C0-10DD2E-D runs on **24 VDC** and draws **120 mA** at the CPU; add ~50 mA per lit
indicator lamp. Budget **at least 500 mA** total for comfortable headroom with two buttons.

| Option | When to use | Cost |
|--------|-------------|------|
| **Lab bench supply set to 24.0 V** | Best for initial bring-up — adjustable, has current display | Free if you already have one |
| **AutomationDirect PSP24-024S** (24 V / 1 A, DIN rail) | Clean permanent installation | ~$18 |
| **Any regulated 24 VDC wall adapter ≥ 500 mA** | Quick bench test without DIN rail | $10–15 on Amazon |

You do **not** need the AutomationDirect C0-00AC/C0-01AC AC power adapters — those are
optional accessories for mounting; the PLC takes DC directly.

### 1.2 Power terminals on the C0-10DD2E-D

Open the physical unit and locate the terminal strip on the **top edge** of the main module.
The leftmost terminals are always the power block. They are silk-screened:

```
  ┌──────┬──────┬──────┬──────┬────────────── ...
  │  +   │  -   │  C1  │  X1  │  X2  ...
  └──────┴──────┴──────┴──────┴────────────── ...
    24V+   24V-   Input
                  Common
```

> Confirm against the label printed on the unit itself — the exact position of `+` and `-`
> may be immediately left of the input commons on your specific firmware revision. The
> terminal labels **+** and **−** are always present; do not rely solely on this diagram.

| Terminal | Wire | Connect to |
|----------|------|-----------|
| `+` | Red | 24 VDC positive from supply |
| `−` | Black | 24 VDC negative (common/GND) from supply |

Torque the terminal screws to ~0.5 N·m (4.4 in·lb) — finger-tight plus a quarter turn.

### 1.3 What you should see at power-on

1. **PWR LED** (green) illuminates immediately.
2. **RUN LED** (green) illuminates within ~3 seconds — the PLC enters RUN mode with whatever
   program is in memory (empty program is fine; it runs with all outputs off).
3. **ERR LED** stays off. If it flashes, the internal battery is low — not a blocker for bench
   testing but note it.
4. The front-panel Ethernet port LED blinks when a cable is plugged in.

If the RUN LED does not come on within 5 seconds, check polarity on the `+`/`−` terminals
with a multimeter. Reverse polarity will not damage most Click units (there is a protection
diode) but the PLC will not start.

---

## Phase 2 — Connect to the Programming Software

### 2.1 Download and install Click Programming Software

1. Go to **automationdirect.com → Downloads → PLC → Click PLCs → C0 Series**.
2. Download **C0-PGMSW** — it is free, no registration required.
   (As of 2025, search "Click PLC programming software" on AutomationDirect's site; the URL
   changes with revisions so it is not hard-coded here.)
3. Run the installer on your Windows PC. Accept defaults. It installs to
   `C:\Program Files (x86)\AutomationDirect\Click PLC`.
4. Launch "Click Programming Software" from the Start menu.

### 2.2 Connecting via Ethernet (recommended — no serial cable needed)

The C0-10DD2E-D has a built-in RJ45 Ethernet port. **You do not need the serial cable.**

#### Default IP and what to set on your PC

The Click PLC ships with a default IP of **192.168.0.1 / 255.255.255.0**.

Your Pi 5 is at `192.168.0.172`. You want the PLC on the same subnet, e.g. `192.168.0.10`.
But before you can set that, your Windows PC must be on the same subnet as the PLC's current
default IP.

**On your Windows PC (temporarily):**

1. Open **Control Panel → Network and Sharing Center → Change adapter settings**.
2. Right-click the Ethernet adapter (the one connected to your switch) → **Properties**.
3. Select **Internet Protocol Version 4 (TCP/IPv4)** → **Properties**.
4. Set:
   - IP address: `192.168.0.50`
   - Subnet mask: `255.255.255.0`
   - Gateway: (leave blank)
5. Click OK. You can revert this after Phase 3.

Connect your PC and the PLC to the **same Netgear switch** (or directly via a patch cable).

### 2.3 Establish comms in the programming software

1. In Click Programming Software, go to **Communication → Setup**.
2. Select **Ethernet** as the comm method.
3. Enter IP: `192.168.0.1` (the PLC's factory default).
4. Port: `502` (default Modbus/programming port — do not change).
5. Click **OK**.
6. Go to **Communication → Connect**.
   - The status bar at the bottom shows "Connected" in green.
   - If it times out, ping `192.168.0.1` from a CMD window to verify network reachability.
7. Go to **Communication → Read from PLC** to confirm — it will download the (empty) program
   into the editor without errors.

You are now talking to the PLC.

---

## Phase 3 — Configure Ethernet and Modbus TCP

### 3.1 Set a static IP on the Click PLC

> Do this in Click Programming Software while connected.

1. Go to **Setup → System Configuration** (or **PLC → System Setup** depending on your
   software version — look for a gear icon or "Setup" menu).
2. Select the **Ethernet** tab.
3. Set:
   - **IP Address:** `192.168.0.10`
     *(Or any address not taken on your network — verify with `arp -a` on the Pi.)*
   - **Subnet Mask:** `255.255.255.0`
   - **Gateway:** `192.168.0.1` (your router, or leave blank if no internet path needed)
   - **Modbus TCP Port:** `502` (leave default)
4. Click **OK / Apply**.
5. Go to **Communication → Write to PLC** to save the new IP.
6. Power-cycle the PLC (unplug and re-plug the 24 V supply). After ~5 seconds, update your
   Windows PC's IP to `192.168.0.50`, reconnect with the new PLC IP (`192.168.0.10`), and
   verify "Connected" status.

### 3.2 Modbus TCP on the Click PLC

**No additional configuration is needed.** The Click PLC's Ethernet port simultaneously
serves the Click programming protocol AND a Modbus TCP server on port 502. The server is
always on when the PLC is powered and has a valid IP.

| Parameter | Value |
|-----------|-------|
| Port | 502 |
| Unit ID (Slave ID) | 1 |
| Byte order | Big-endian (standard Modbus) |
| Register type used | Holding Registers (function code 3 to read) |
| DS1 = Modbus address | 0 (pymodbus `address=0`) |
| DS2 = Modbus address | 1 |
| DS(n) = Modbus address | n − 1 |

### 3.3 Quick Modbus connectivity test from the Pi 5

SSH into your Pi 5 and run `scripts/test_plc_modbus.py` (included in this repo):

```bash
cd ~/Viam-Staubli-Apera-PLC-Mobile-POC
python3 scripts/test_plc_modbus.py --host 192.168.0.10
```

Expected output when PLC has an empty program (all zeros):

```
Connecting to 192.168.0.10:502 (unit_id=1)...
Connected OK

Reading holding registers 0-24 (E-Cat block)...
  reg[0]  servo_power_on     = 0
  reg[1]  servo_disable      = 0
  ...
  reg[23] estop_enable       = 0
  reg[24] estop_off          = 0

Reading holding registers 100-117 (sensor block)...
  reg[112] system_state      = 0
  reg[113] last_fault        = 0
  ...

All reads successful. PLC Modbus TCP is working.
```

If connection refused: verify IP, verify PLC is powered, verify both Pi and PLC are on same
subnet (`192.168.0.x`), verify no firewall on Pi blocking outbound 502.

---

## Phase 4 — Wire the Buttons

### 4.1 What to buy

#### Servo power button (momentary NO pushbutton)

Any standard **22 mm momentary normally-open pushbutton** works. Options:

| Source | Part | Notes |
|--------|------|-------|
| AutomationDirect | PBMT-x-1 series (e.g. PBMT-B-1 blue, PBMT-G-1 green) | ~$6, fits standard 22mm cutout |
| Amazon | "22mm momentary pushbutton NO 24V" | $5–10 for a pack |
| Local hardware | Any doorbell-style button with screw terminals | Free if you have one |

For bench testing, you do not even need a button — see §4.4.

#### E-stop (NC mushroom head)

| Source | Part | Notes |
|--------|------|-------|
| AutomationDirect | GE-AT2T-B | 40mm yellow head, twist-release, 1 NC contact, ~$16 |
| AutomationDirect | GE-601E | Smaller, key-release, ~$20 |
| Amazon | "40mm mushroom head emergency stop NC twist release" | $8–15 |

**Buy NC (Normally Closed), twist-to-release.** This is the safe-fail wiring: the circuit
is closed (X2 sees 24 V) during normal operation; pressing the button opens the circuit
(X2 loses power) — a wiring fault (broken wire) also de-energizes the input, which is the
safe state.

### 4.2 How the C0-10DD2E-D DC inputs work

The inputs are **sink/source** configurable. We use **sink wiring** (most common for NPN/PNP
sensors and simple pushbuttons in a 24 V system):

- Apply **+24 V to the input terminal** through the button.
- The **C (Common) terminal** connects to **24 V−**.
- When the button is closed: 24 V appears at the X terminal → input reads ON (1).
- When the button is open: X terminal floats/pulls low → input reads OFF (0).

**The Click PLC has internal current-limiting on its inputs.** You do not need external
pull-up or pull-down resistors.

### 4.3 ASCII wiring diagrams

#### Servo Power (X1) — Momentary NO pushbutton

```
  24 VDC Supply
  ┌──────────────────────┐
  │ +                  − │
  └──┬───────────────────┤
     │                   │
     │   ┌────────────┐  │
     │   │ NO BUTTON  │  │
     └───┤ (servo pwr)│  │
         └─────┬──────┘  │
               │         │
          [X1 terminal]  │
          [on PLC]       │
                         │
                    [C1 terminal]
                    [on PLC]─────┘
```

When button is pressed: circuit closes → X1 = ON.
When button is released: circuit opens → X1 = OFF.

#### E-Stop (X2) — NC mushroom head

```
  24 VDC Supply
  ┌──────────────────────┐
  │ +                  − │
  └──┬───────────────────┤
     │                   │
     │  ┌─────────────┐  │
     │  │ NC E-STOP   │  │
     └──┤ (mushroom)  │  │
        └──────┬──────┘  │
               │         │
          [X2 terminal]  │
          [on PLC]       │
                         │
                    [C1 terminal]
                    [on PLC]─────┘
```

Normal (e-stop out): circuit is CLOSED → X2 = ON.
E-stop pressed: circuit OPENS → X2 = OFF.

> Both buttons share the same **C1** common terminal (for X1–X4). If your unit has a separate
> C2 for X5–X8, ignore C2 for now.

### 4.4 Bench-testing without real buttons (jumper wire method)

Before you buy or wire any buttons, you can simulate inputs with a short wire:

- **Simulate button press (X1 or X2 ON):** Plug a jumper wire into the **+** power terminal
  and touch the other end to the X1 (or X2) terminal. X1/X2 LEDs light up on the PLC front
  panel when active.
- **Simulate NC e-stop "normal":** Run a permanent jumper from the `+` supply to X2.
  To simulate "e-stop pressed," pull the jumper out.

You can complete Phases 2, 3, and 5 entirely with jumper wires. Buy real buttons when you
are ready for Phase 7.

### 4.5 Verify inputs in the programming software

In Click Programming Software, while connected to the PLC:

1. Go to **Address Picker** or **Data View** (View → Data View).
2. Navigate to **X (Discrete Inputs)**.
3. Touch your jumper to X1 — the row for X1 should flip from `0` to `1` live.
4. Do the same for X2. You should see the PLC's X2 LED illuminate and Data View update.

This confirms wiring is correct before you touch any ladder logic.

---

## Phase 5 — Write the Ladder Logic

### 5.1 Register layout — matches the simulator exactly

The ladder logic writes to **the same Modbus holding-register addresses** the Pi Zero W
simulator uses. The `plc-sensor` module needs zero changes.

| DS Register | Modbus addr (pymodbus) | Signal name in plc-sensor | What it holds |
|-------------|------------------------|--------------------------|---------------|
| DS1 | 0 | `servo_power_on` | 1 = servo power is ON |
| DS2 | 1 | `servo_disable` | 1 = servo power is OFF |
| DS10 | 9 | `lamp_servo_power` | mirrors DS1 (lamp feedback) |
| DS24 | 23 | `estop_enable` | 1 = e-stop is currently active |
| DS25 | 24 | `estop_off` | 1 = e-stop is NOT active (normal) |
| DS113 | 112 | `system_state` | 0=idle, 1=running, 2=fault, 3=e-stopped |
| DS114 | 113 | `last_fault` | 0=none, 4=estop_fault (see note) |
| DS115 | 114 | `servo_power_press_count` | count of servo power toggles |
| DS116 | 115 | `estop_activation_count` | count of e-stop events |

> Registers not listed (accel/gyro/temp/humidity/servo positions) will read 0 from the real
> PLC. The `plc-sensor` module handles this gracefully — those sensor fields show 0.0 on the
> dashboard. They were provided by the Pi Zero W's physical sensors; the Click PLC is a pure
> control device.

### 5.2 Internal memory used by the ladder logic

| Click address | Type | Purpose |
|---------------|------|---------|
| C1 | Internal relay (coil) | Fault/e-stop flag — latches when e-stop fires |
| C100 | Internal relay (coil) | X1 one-shot (rising edge pulse) — self-clearing |
| DS115 | Data Short register | Servo power press counter |
| DS116 | Data Short register | E-stop activation counter |
| Y1 | Output coil | Servo power output (drives physical indicator or relay) |

### 5.3 Creating the program in Click Programming Software

#### Open a new project

1. **File → New** → Select **C0 Series** → your CPU model `C0-10DD2E-D` → OK.
2. You see a blank **Ladder Editor** with Rung 1 ready to edit.

#### How to add rungs and instructions

- **Add a contact:** Click the contact button on the toolbar (or press `C`) → click a spot in
  the rung → the Address dialog opens → type `X1` → choose **Normally Open** → OK.
- **Add a coil:** Click the output coil button (or press `O`) at the right end of the rung →
  type address → OK.
- **Add a function block (MOV, ADD, CTU):** Click the **Function Block** button (or use the
  Insert menu) → scroll to the instruction type → configure it.
- **Add a new rung:** Right-click below the last rung → **Insert Rung After**, or press
  `Ctrl+Enter`.
- **Rising Edge contact:** When adding a contact, in the Type dropdown select
  **Rising Edge (Transition)** instead of Normally Open. This is critical for edge detection.

#### Rung-by-rung guide

---

**RUNG 1 — X1 Rising Edge → One-Shot C100**

Detects a single press of the servo power button without re-triggering while held.

```
──[X1 ↑]──────────────────────────────────( C100 )──
  (X1, Rising Edge)                        (C100 coil)
```

Instructions:
- Contact: Address `X1`, Type = **Rising Edge**
- Output coil: Address `C100`

> C100 will be ON for exactly one PLC scan (~1 ms) each time X1 goes from OFF→ON.

---

**RUNG 2 — Servo Power Toggle ON**

Turns servo power ON when: one-shot fires AND servo is currently OFF AND no fault active.

```
──[C100]──[/Y1]──[/C1]────────────────(SET Y1)──
  (C100)   (Y1 NC)  (C1 NC)           (SET coil)
```

Instructions:
- Contact: `C100` (Normally Open)
- Contact: `Y1` (Normally Closed — `/Y1`)
- Contact: `C1` (Normally Closed — `/C1`)
- Output: **SET** coil at address `Y1`

---

**RUNG 3 — Servo Power Toggle OFF**

Turns servo power OFF when: one-shot fires AND servo is currently ON AND no fault active.

```
──[C100]──[Y1]──[/C1]─────────────────(RST Y1)──
  (C100)  (Y1 NO)  (C1 NC)            (RESET coil)
```

Instructions:
- Contact: `C100` (Normally Open)
- Contact: `Y1` (Normally Open)
- Contact: `C1` (Normally Closed)
- Output: **RST** (Reset) coil at address `Y1`

---

**RUNG 4 — E-Stop Detection: Latch Fault**

When X2 drops OFF (e-stop pressed, NC contact opens), latch the fault flag.

```
──[/X2]───────────────────────────────(SET C1)──
  (X2 NC contact)                     (SET fault flag)
```

Instructions:
- Contact: `X2` (Normally Closed — `/X2`)
- Output: **SET** coil at address `C1`

> This rung is TRUE whenever X2 is OFF — meaning the e-stop is pressed.
> SET holds C1 on even after X2 comes back.

---

**RUNG 5 — E-Stop Kills Servo Power**

While fault is active, keep Y1 off (belt-and-suspenders with the SET/RST logic).

```
──[C1]────────────────────────────────(RST Y1)──
  (fault flag)                        (force servo off)
```

Instructions:
- Contact: `C1` (Normally Open)
- Output: **RST** coil at address `Y1`

---

**RUNG 6 — E-Stop Counter**

Count each e-stop event (rising edge of fault flag going ON).

```
──[C1 ↑]──────────────────┤ INC DS116 ├──
  (C1, Rising Edge)          (Increment DS116)
```

Instructions:
- Contact: `C1`, Type = **Rising Edge**
- Function Block: **INC** (Increment) → Destination: `DS116`

> This maps to `estop_activation_count` (Modbus address 115, `sensor[15]` in plc_sensor.py).

---

**RUNG 7 — Servo Power Press Counter**

Count each rising edge of C100 (i.e., each servo button press).

```
──[C100]──────────────────┤ INC DS115 ├──
  (one-shot)               (Increment DS115)
```

Instructions:
- Contact: `C100` (Normally Open)
- Function Block: **INC** → Destination: `DS115`

> Maps to `servo_power_press_count` (Modbus address 114, `sensor[14]` in plc_sensor.py).

---

**RUNG 8 — Fault Reset**

Allow clearing the fault: press X1 (one-shot fires) while e-stop is released (X2=ON) and
fault is active. This ONLY clears the latch; the next press of X1 then turns servo power on.

```
──[C100]──[X2]──[C1]──────────────────(RST C1)──
  (one-shot) (X2 normal) (fault active) (clear fault)
```

Instructions:
- Contact: `C100` (Normally Open)
- Contact: `X2` (Normally Open — confirms e-stop is not active)
- Contact: `C1` (Normally Open — confirms fault is latched)
- Output: **RST** coil at address `C1`

> **Reset procedure for the operator:**
> 1. Twist/release the mushroom e-stop (X2 returns to ON).
> 2. Press servo power button once — this clears the fault (Rung 8 fires).
> 3. Press servo power button again — servo power turns on (Rung 2 fires).

---

**RUNG 9 — Write servo_power_on to DS1**

```
──[Y1]────────────────────┤ MOV 1 → DS1 ├──
──[/Y1]───────────────────┤ MOV 0 → DS1 ├──
```

In Click, use two rungs with a **MOV** function block:

Rung 9a:
- Contact: `Y1` (Normally Open)
- Function Block: **MOV** → Source: constant `1` → Destination: `DS1`

Rung 9b:
- Contact: `Y1` (Normally Closed)
- Function Block: **MOV** → Source: constant `0` → Destination: `DS1`

---

**RUNG 10 — Write servo_disable to DS2 (inverse of DS1)**

Rung 10a:
- Contact: `Y1` (Normally Open)
- **MOV** `0` → `DS2`

Rung 10b:
- Contact: `Y1` (Normally Closed)
- **MOV** `1` → `DS2`

---

**RUNG 11 — Write lamp_servo_power to DS10 (mirrors DS1)**

Rung 11a:
- Contact: `Y1` (NO) → **MOV** `1` → `DS10`

Rung 11b:
- Contact: `Y1` (NC) → **MOV** `0` → `DS10`

---

**RUNG 12 — Write estop_enable to DS24**

```
──[/X2]───────────────────┤ MOV 1 → DS24 ├──
──[X2]────────────────────┤ MOV 0 → DS24 ├──
```

Rung 12a:
- Contact: `X2` (Normally Closed = e-stop pressed) → **MOV** `1` → `DS24`

Rung 12b:
- Contact: `X2` (Normally Open = e-stop normal) → **MOV** `0` → `DS24`

---

**RUNG 13 — Write estop_off to DS25 (inverse of DS24)**

Rung 13a:
- Contact: `X2` (NO = normal) → **MOV** `1` → `DS25`

Rung 13b:
- Contact: `X2` (NC = e-stop active) → **MOV** `0` → `DS25`

---

**RUNG 14 — Write system_state to DS113**

Four mutually-exclusive conditions map to the four state codes (0=idle, 1=running,
2=fault, 3=e-stopped). Write state 3 (e-stopped) while X2 is OFF and fault is active:

Rung 14a — E-STOPPED (X2 off = e-stop active):
- Contact: `X2` (NC) → **MOV** `3` → `DS113`

Rung 14b — FAULT (C1 on, but X2 is back):
- Contact: `C1` (NO), Contact: `X2` (NO) → **MOV** `2` → `DS113`

Rung 14c — RUNNING (Y1 on, no fault):
- Contact: `Y1` (NO), Contact: `C1` (NC) → **MOV** `1` → `DS113`

Rung 14d — IDLE (Y1 off, no fault):
- Contact: `Y1` (NC), Contact: `C1` (NC) → **MOV** `0` → `DS113`

> Click PLCs scan rungs top to bottom in a single sweep (~1 ms). If multiple rungs write
> to the same register, the **last rung to execute wins**. Order the rungs from lowest
> priority (idle) to highest (e-stopped) so the most urgent state wins.
>
> Practical order for Rung 14: **14d (idle) → 14c (running) → 14b (fault) → 14a (e-stopped)**.

---

**RUNG 15 — Write last_fault to DS114**

Rung 15a — No fault:
- Contact: `C1` (NC) → **MOV** `0` → `DS114`

Rung 15b — E-stop fault (use code 4 to match plc-sensor's `clamp_fail` slot, or 3 for
"pressure" — actually we define a new meaning: 4 = "estop_triggered"):
- Contact: `C1` (NO) → **MOV** `4` → `DS114`

> The `plc-sensor` will display `"clamp_fail"` for code 4. To rename this in the dashboard,
> see Phase 6 — it is a one-line dict change in `plc_sensor.py`.

---

### 5.4 Download the program to the PLC

1. Go to **Communication → Write to PLC**.
2. The dialog asks whether to put the PLC in STOP mode first — choose **Yes**.
3. After the download completes, it asks whether to restart in RUN mode — choose **Yes**.
4. Verify the RUN LED is on.

### 5.5 Verify the logic in the programming software (online mode)

1. Go to **Communication → Monitor** or click the monitor button (eyeglasses icon).
2. You see the ladder rungs with live green highlighting on active contacts.
3. Press your servo power button (or jumper X1):
   - Rung 1 goes green briefly.
   - Y1 coil turns on (green).
   - DS1 in Data View shows `1`.
4. Press X1 again: Y1 turns off, DS1 goes back to `0`.
5. Pull the X2 jumper (simulate e-stop): X2 drops, Rung 4 fires, C1 latches, Rung 5 resets Y1.

---

## Phase 6 — Update the plc-sensor Module

### 6.1 No Python code changes required

The ladder logic is designed to write to the same Modbus register addresses as the
Pi Zero W simulator. The `plc-sensor` module (`modules/plc-sensor/src/plc_sensor.py`)
reads addresses 0–24 and 100–117 — these map exactly to DS1–DS25 and DS101–DS118 on the
Click PLC.

**The only change is a config update.**

### 6.2 Update viam-server.json

In `config/viam-server.json`, find the `plc-monitor` component and change the `host`:

```json
{
  "name": "plc-monitor",
  "api": "rdk:component:sensor",
  "model": "viam-staubli-apera-poc:monitor:plc-sensor",
  "attributes": {
    "host": "192.168.0.10",
    "port": 502
  }
}
```

Replace `"raiv-plc.local"` (the Pi Zero W's hostname) with `"192.168.0.10"` (the Click
PLC's static IP). Alternatively, add a DNS alias for `192.168.0.10` in `/etc/hosts` on the
Pi 5 so you can keep the hostname and swap the IP there.

### 6.3 Optional: rename "clamp_fail" to "estop" in the fault lookup

In `plc_sensor.py` line 38, the `_FAULT_NAMES` dict is:

```python
_FAULT_NAMES = {0: "none", 1: "vibration", 2: "temperature", 3: "pressure", 4: "clamp_fail"}
```

Since code 4 now means "e-stop triggered" (from Rung 15b), you can update it:

```python
_FAULT_NAMES = {0: "none", 1: "vibration", 2: "temperature", 3: "pressure", 4: "estop_triggered"}
```

This is cosmetic — the dashboard will display `"estop_triggered"` instead of `"clamp_fail"`.

### 6.4 Deploy the config to the Pi 5

```bash
# On your Pi 5
sudo systemctl restart viam-server
journalctl -u viam-server -f
```

Watch for: `PlcSensor configured: host=192.168.0.10 port=502` and then
`Connected to PLC at 192.168.0.10:502` in the logs.

---

## Phase 7 — Test End-to-End

### 7.1 Full test sequence

```
Step 1: Power on PLC
  └─ RUN LED on, ERR LED off

Step 2: Verify Modbus comms (from Pi 5)
  └─ python3 scripts/test_plc_modbus.py --host 192.168.0.10
  └─ Expect: all registers = 0, "All reads successful"

Step 3: Test servo power button
  a. Press X1 once
  b. On Pi 5: python3 scripts/test_plc_modbus.py --host 192.168.0.10 --watch
     Expect: reg[0] (servo_power_on) flips to 1
             reg[9] (lamp_servo_power) flips to 1
             reg[112] (system_state) flips to 1
  c. Press X1 again → reg[0] back to 0, reg[112] back to 0

Step 4: Test e-stop
  a. Press servo power (X1) to turn Y1 ON
  b. Press (or pull jumper from) X2
     Expect: reg[23] (estop_enable) = 1
             reg[0] (servo_power_on) = 0 (Y1 forced off)
             reg[112] (system_state) = 3 (e-stopped)
             reg[115] (estop_activation_count) incremented

Step 5: Test fault reset
  a. Release e-stop (restore X2)
  b. Press X1 once — clears fault (C1 RST)
     Expect: reg[112] flips from 2→0 (fault cleared, now idle)
  c. Press X1 again — turns servo back on
     Expect: reg[0] = 1, reg[112] = 1

Step 6: Verify Viam dashboard
  a. Open Viam app or dashboard
  b. Navigate to plc-monitor sensor readings
  c. Confirm servo_power_on, system_state, estop_enable update in real time
  d. Confirm data_manager is capturing at 1 Hz (check /tmp/viam-data on Pi 5)
```

### 7.2 Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| X1/X2 LED never lights on PLC | Wrong wiring; no +24 V reaching the terminal | Check wire from supply `+` through button to X terminal; check C1 terminal connected to supply `−` |
| Modbus times out from Pi | Wrong IP; PLC not in RUN mode; PC firewall | Ping PLC IP from Pi; verify RUN LED; check Pi firewall (`sudo ufw status`) |
| All registers read 0 after button press | Program not downloaded; PLC in STOP mode | In programming software: Communication → Write to PLC, then set to RUN |
| system_state shows `"fault"` on startup | C1 latched from previous run (power-cycle clears it) | Power-cycle PLC; or in Data View manually RST C1 |
| reg[0] toggles back immediately | Button bouncing; using coil instead of SET/RST | Verify Rungs 2 and 3 use SET/RST outputs, not regular coils; check edge detection on X1 |
| plc-sensor logs "connection_failed" | Host in viam-server.json still points to Pi Zero | Update `host` to Click PLC IP and restart viam-server |
| `pymodbus` returns error on coil read (address 0) | Click PLC does not expose physical discrete inputs as Modbus coils | Non-fatal — plc-sensor catches this exception; button_state will always show "released" (coil 0 is internal, use DS registers for state) |
| Byte-order issue (large numbers like 65535 for 0) | Signed vs unsigned int16 misinterpretation | plc_sensor.py already handles this with `_uint16()` and `_int16_to_float()` — no action needed |
| Off-by-one register address | Confusing Modbus 40001-based addressing with 0-based | pymodbus uses 0-based: address=0 reads DS1, address=112 reads DS113. This matches the ladder logic above. |

### 7.3 Bench-test checklist before buying real buttons

- [ ] PLC powers on (RUN LED green)
- [ ] Click Programming Software connects via Ethernet
- [ ] Static IP configured and survives power cycle
- [ ] `scripts/test_plc_modbus.py` returns successfully from Pi 5
- [ ] Jumper on X1 toggles reg[0] and reg[112] correctly
- [ ] Jumper on X2 (then removed) triggers fault and reg[112]=3
- [ ] Fault reset sequence works (press X1 while X2 is normal)
- [ ] viam-server logs show "Connected to PLC at 192.168.0.10:502"
- [ ] Dashboard shows `servo_power_on`, `system_state`, `estop_enable` updating live

---

## Appendix A — Full Register Map (Click PLC → plc-sensor)

| DS Register | Modbus pymodbus addr | `plc-sensor` key | Populated by real PLC? |
|-------------|---------------------|-----------------|----------------------|
| DS1 | 0 | `servo_power_on` | ✅ Rung 9 |
| DS2 | 1 | `servo_disable` | ✅ Rung 10 |
| DS3–DS9 | 2–8 | `plate_cycle` … `belt_reverse` | ❌ Reads 0 |
| DS10 | 9 | `lamp_servo_power` | ✅ Rung 11 |
| DS11–DS18 | 10–17 | lamp registers | ❌ Reads 0 |
| DS19–DS23 | 18–22 | emag, poe registers | ❌ Reads 0 |
| DS24 | 23 | `estop_enable` | ✅ Rung 12 |
| DS25 | 24 | `estop_off` | ✅ Rung 13 |
| DS101–DS109 | 100–108 | accel, gyro, temp, humidity, pressure | ❌ Reads 0 |
| DS110 | 109 | `servo1_position` | ❌ Reads 0 |
| DS111 | 110 | `servo2_position` | ❌ Reads 0 |
| DS112 | 111 | `cycle_count` | ❌ Reads 0 |
| DS113 | 112 | `system_state` | ✅ Rung 14 |
| DS114 | 113 | `last_fault` | ✅ Rung 15 |
| DS115 | 114 | `servo_power_press_count` | ✅ Rung 7 |
| DS116 | 115 | `estop_activation_count` | ✅ Rung 6 |
| DS117 | 116 | `current_uptime_seconds` | ❌ Reads 0 |
| DS118 | 117 | `last_estop_duration_seconds` | ❌ Reads 0 |

Sensor readings that show 0 are handled gracefully by `plc-sensor` — they do not cause
errors or disconnect states.

---

## Appendix B — Network Reference

| Device | IP | Hostname |
|--------|----|---------|
| Raspberry Pi 5 | 192.168.0.172 | raiv-pi5.local |
| Click PLC (new) | 192.168.0.10 | — (use IP directly) |
| Pi Zero W (simulator, to retire) | 192.168.0.173 | raiv-plc.local |

After the real PLC is working, you can stop the simulator service on the Pi Zero W:

```bash
# On Pi Zero W
sudo systemctl stop plc-simulator
sudo systemctl disable plc-simulator
```
