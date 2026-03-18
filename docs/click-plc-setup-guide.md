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

### 1.1 Understanding the power requirement

The C0-10DD2E-D needs **24 VDC (direct current), regulated**. Two words to understand:

- **24 VDC** — not 24 VAC (alternating current like your wall outlet). If you use AC, the
  PLC will not work and may be damaged. You need DC.
- **Regulated** — the voltage stays at 24 V regardless of how much current the load draws.
  A cheap unregulated "wall wart" transformer can spike well above 24 V under light load.
  A *regulated* supply (or a bench supply with feedback control) clamps the output at exactly
  24.0 V. That is what you need.

Current draw: the PLC CPU draws **120 mA**. Each illuminated indicator lamp adds ~20–50 mA.
For bench testing with two buttons and no lamps, **250–500 mA** is plenty. For a permanent
installation with pilot lights, use **1 A**.

### 1.2 What to buy (or use)

#### Option A — Lab bench supply (best for bring-up)

If you have a bench supply (e.g., a Korad KA3005P, RD6006, or any similar adjustable supply),
use it. Advantages:

- You set the exact voltage (dial it to 24.0 V)
- The current display shows you exactly what the PLC is drawing — useful for verifying it is
  alive and detecting wiring shorts before they damage anything
- You can set a **current limit** (set it to 0.5 A for the first power-on — if something is
  wired wrong, the supply will fold back instead of letting smoke out)

**How to set up a bench supply for the first time:**

1. With the supply OFF and nothing connected, turn the voltage knob until the voltage display
   reads **24.0 V**. (Some supplies show the set-point even when off; others only show it when
   the output is enabled — either way, dial to 24.0.)
2. Set the current limit knob to **0.3–0.5 A** (300–500 mA). This is your safety net.
3. Do not turn the output on yet — wire it first (§1.4), then power on.

#### Option B — 24 VDC wall adapter (quick bench test)

Any **switching power adapter** rated 24 VDC / 500 mA or higher works. Examples on Amazon:
search "24V DC power supply adapter 1A" — look for one with a barrel jack or bare wire leads
and a label that says "switching" or "regulated." Do not use a 24 V transformer-style brick
(these are unregulated and usually labeled "24 VAC").

You can verify a wall adapter with your multimeter: set the meter to DC Volts, measure the
output — it should read 24 V ±5% (22.8–25.2 V) with no load.

#### Option C — AutomationDirect PSP24-024S (~$18)

A DIN-rail-mount 24 V / 1 A regulated switching supply. Use this when you build a real panel.
Not necessary for bench testing.

### 1.3 Tools and wire you need for this phase

| Item | Spec | Why |
|------|------|-----|
| Small flathead screwdriver | 2.5 mm or 3 mm blade (sometimes called a "terminal screwdriver") | Click PLC terminal screws are slotted flathead |
| Wire | 22–24 AWG stranded or solid | At 120 mA, even 28 AWG is fine electrically, but 22 AWG is easier to handle in screw terminals |
| Wire stripper | For 22–24 AWG | — |
| Multimeter | DC Volts range | Verify polarity before powering on |

**How much to strip:** 6–7 mm (about ¼ inch). Too little and the wire won't make contact.
Too much and the bare conductor extends past the terminal and could touch an adjacent terminal.

**Screwdriver fit matters:** If the screwdriver blade is too wide it will bridge two terminals;
too narrow and it will cam out and strip the screw. A 2.5 mm terminal screwdriver is the
right tool. Most electronics starter kits include one.

### 1.4 Identifying the power terminals

The C0-10DD2E-D has a single terminal strip that runs across the **top face** of the unit.
On the physical hardware, each terminal is labeled with a small white silk-screen legend on
the green terminal block. The power terminals are at the **left end** of the strip.

```
  LEFT SIDE of terminal strip (power end)
  ──────────────────────────────────────────────────────────── ...
  │  +   │  -   │  C1  │  X1  │  X2  │  X3  │  X4  │  X5  │  ...
  ──────────────────────────────────────────────────────────── ...
   24V+   24V-   Input   Input terminals (X1–X8)
                Common  (one per input point)
```

- **`+`** — 24 VDC positive. This is where your red wire goes.
- **`−`** — 24 VDC negative / common / ground reference. Red wire goes here.
- **`C1`** — the input common for X1–X4 (and possibly X5–X8 as well, depending on revision).
  Do not connect anything here yet — that is Phase 4.

> Always physically verify the labels on your specific unit before connecting anything.
> The above matches standard Click C0-series layout; if the labels on your unit show something
> different, trust the unit's labels over this guide. The terminal numbers are also printed on
> a label under the terminal cover.

**Locating the terminal cover:** Some C0 units ship with a clear plastic snap-on guard over
the terminal strip. Pinch and lift the guard to access the screw terminals. You do not need
to remove it permanently — just fold it back while wiring.

### 1.5 Wiring the power supply to the PLC (step by step)

Do this with the power supply **off and unplugged**.

1. **Cut two wires**, each about 15–20 cm (6–8 inches): one red, one black.
2. **Strip 6–7 mm** from one end of each wire.
3. **Verify your supply output with the multimeter** (if using a wall adapter with barrel jack):
   - Set meter to DC Volts
   - Probe the barrel jack: center pin = positive (+), outer ring = negative (−)
   - Confirm ≈24 V and correct polarity before continuing
4. **Loosen the `+` terminal screw** on the PLC (counterclockwise, 2–3 turns — the screw
   does not need to come all the way out, just loosen enough that the wire slides in).
5. **Insert the red wire** into the `+` terminal opening. Push it in straight until the
   stripped portion is fully inside the terminal body.
6. **Tighten the screw** firmly — finger-tight plus about a quarter turn. The wire should
   not pull out when you tug it. Do not overtighten (you can crack the terminal block).
7. Repeat steps 4–6 for the black wire in the **`−`** terminal.
8. Connect the other ends to your supply: red → supply positive, black → supply negative.
   - Bench supply: connect to the binding posts (red = +, black = −)
   - Wall adapter: if it has bare wire leads, use the same color convention; if it has a
     barrel jack, use a barrel-jack-to-screw-terminal adapter, or clip leads

```
  Power Supply                     PLC Terminal Strip
  ┌──────────────┐                 ┌─────┬─────┬─────┬─────
  │  + (red)     ├────red wire─────┤  +  │     │     │
  │  - (black)   ├───black wire────┤  -  │ C1  │ X1  │ ...
  └──────────────┘                 └─────┴─────┴─────┴─────
```

9. **Before turning on power**, do a final polarity check with the multimeter:
   - Set to DC Volts
   - Probe the `+` terminal on the PLC (red probe) and the `−` terminal (black probe)
   - You should read close to 0 V with the supply off (just parasitic voltage)
   - If you read a significant negative voltage, the wires are swapped — fix it now

### 1.6 Applying power for the first time

1. If using a bench supply: enable the output. Watch the current display — it should read
   roughly 0.1–0.15 A (100–150 mA) within a second of the RUN LED coming on.
2. If using a wall adapter: plug it in.

### 1.7 What you should see — LED reference

The LED indicators are on the **front face** of the PLC, typically a column of 4–5 LEDs
on the left side of the face plate. Here is what each means:

| LED | Color | Normal state | What it means if abnormal |
|-----|-------|-------------|--------------------------|
| **PWR** | Green | ON immediately | If off: check voltage at `+`/`−` terminals with multimeter; check wire connections |
| **RUN** | Green | ON within 3 s | If off after 5 s: PLC is in STOP mode (need programming software to put it in RUN) |
| **ERR** | Red | OFF | Blinking slowly = low battery (non-critical for bench testing); solid = program error |
| **COM** or **NET** | Yellow/Green | Blinks when Ethernet traffic present | No blink with cable plugged in = cable issue or no network activity |

The RUN LED coming on with an empty program is normal — the PLC runs an empty program
continuously with all outputs off and all inputs being scanned.

**If PWR is on but RUN is not on after 10 seconds:**
- The PLC may be in STOP mode from a previous session. This is not a wiring problem —
  you will put it back in RUN from the programming software in Phase 2.
- It may also indicate a program error from leftover code. Again, not a wiring problem.

**If PWR does not come on at all:**
1. Measure voltage at the `+`/`−` PLC terminals with the multimeter (not at the supply —
   at the PLC itself). You should read +24 V.
2. If 0 V at the PLC: wire is broken or disconnected — re-check your terminal connections.
3. If −24 V at the PLC: wires are swapped — the `+` terminal has your black wire. Fix it.
4. If +24 V at the PLC but PWR is still off: try a power-cycle (disconnect, wait 5 seconds,
   reconnect). If still off, the PLC may need service.

**Current draw at startup (bench supply):**
- 0.0–0.05 A: supply not reaching PLC (check wiring)
- 0.1–0.2 A: normal operating range
- 0.5+ A: possible short circuit — turn supply off, check wiring

---

## Phase 2 — Connect to the Programming Software

### 2.1 Understanding what the programming software does

The Click Programming Software (free, Windows-only) is how you:
- Write and download ladder logic programs to the PLC
- Set the PLC's IP address and other system parameters
- Monitor live register values and coil states while the PLC runs
- Force inputs/outputs on or off for testing

It communicates with the PLC over Ethernet using a proprietary AutomationDirect protocol
on port 502 — the same port as Modbus TCP. The PLC handles both protocols simultaneously.

### 2.2 Download and install

1. On your Windows PC, open a browser and go to **www.automationdirect.com**.
2. Click the **Support** tab at the top → **Downloads**.
3. In the Downloads page, under **Software**, look for **Click PLC Programming Software**
   or use the search box and type **C0-PGMSW**.
4. Click the download link — you will get a `.exe` or `.zip` installer. No account required.
5. Run the installer:
   - Click **Next** through the welcome screens
   - Accept the license agreement
   - Leave the install directory at the default (`C:\Program Files (x86)\AutomationDirect\Click PLC`)
   - Click **Install**
   - If Windows asks "Do you want to allow this app to make changes?" — click **Yes**
   - The installer may also install a **Microsoft Visual C++ Redistributable** — let it
6. When the installer finishes, do **not** check "Launch now" — close it. You have a
   network step to do first (§2.3) or the software will time out immediately trying to
   connect to an IP your PC can't reach yet.

### 2.3 Configure your Windows PC's network adapter

**Why this step is necessary:** Your Pi 5 is on `192.168.0.x`. The Click PLC ships from
the factory with IP `192.168.0.1`. Those are on the same subnet — good. But your Windows
PC's Ethernet adapter may be set to a different subnet (or set to DHCP, getting an address
from your router like `192.168.1.x`), which cannot reach `192.168.0.1` directly.

You need to temporarily assign your Windows PC's Ethernet adapter a **static IP in the
`192.168.0.x` range** so it can talk to the PLC.

> **Which adapter?** You want the adapter connected to the Netgear switch (the one with a
> cable going to the switch). If your PC has both Ethernet and Wi-Fi, ignore Wi-Fi for this
> step — you are configuring the wired Ethernet adapter only.

#### On Windows 10:

1. Press **Windows + R**, type `ncpa.cpl`, press Enter. This opens **Network Connections**
   directly (faster than going through Control Panel).
2. You will see icons for each network adapter. Find your wired Ethernet adapter — it is
   usually labeled "Ethernet" or "Local Area Connection". It should show a cable icon (not
   wireless waves). If it says "Network cable unplugged", the physical cable is not connected
   — plug your Ethernet cable into the PC and the switch first.
3. Right-click the Ethernet adapter icon → **Properties**.
4. In the list, find and double-click **"Internet Protocol Version 4 (TCP/IPv4)"**.
5. The dialog currently shows either "Obtain an IP address automatically (DHCP)" or a
   static address. Either way, select **"Use the following IP address"** and fill in:

   ```
   IP address:    192.168.0.50
   Subnet mask:   255.255.255.0
   Default gateway:  (leave completely blank)
   ```

   Leave DNS servers blank as well.

6. Click **OK** → **OK** → close the Properties window.

#### On Windows 11:

1. Press **Windows + I** to open Settings.
2. Go to **Network & internet** → **Ethernet** (click on the Ethernet entry, not just the toggle).
3. Scroll down and click **Edit** next to "IP assignment".
4. In the dropdown, change "Automatic (DHCP)" to **Manual**.
5. Toggle **IPv4** to On and fill in:

   ```
   IP address:   192.168.0.50
   Subnet mask:  255.255.255.0   (or enter prefix length 24)
   Gateway:      (leave blank)
   ```

6. Click **Save**.

#### Verify the PC can reach the PLC (ping test)

Before opening the programming software, verify the network path is working:

1. Press **Windows + R**, type `cmd`, press Enter — this opens the Command Prompt.
2. Type: `ping 192.168.0.1` and press Enter.
3. You should see replies like:

   ```
   Reply from 192.168.0.1: bytes=32 time<1ms TTL=64
   Reply from 192.168.0.1: bytes=32 time<1ms TTL=64
   ```

4. If you see **"Request timed out"** or **"Destination host unreachable"**:
   - Check that the Ethernet cable is plugged into both the PC and the switch
   - Check that the PLC is powered on (PWR LED green)
   - Check that the PLC's Ethernet port has a link LED (small LED next to the RJ45 jack on
     the PLC front panel — should glow or blink)
   - Re-verify your PC adapter IP is set to `192.168.0.50` (not something else)
   - Try plugging the PC directly into the PLC with a single patch cable, bypassing the switch

5. Press `Ctrl+C` to stop pinging once you see replies.

### 2.4 Launch Click Programming Software and connect

1. Open Click Programming Software from the Start menu.
2. You will see the main window: a menu bar at the top, a toolbar with icons, a blank
   ladder editor in the center, and a status bar at the bottom. The status bar currently
   shows **"Offline"** in the lower-right corner.
3. Go to the menu: **Communication → Setup**.
4. A dialog opens. Set the following:
   - **Communication method:** Ethernet (select from the dropdown — not Serial)
   - **IP Address:** `192.168.0.1`
   - **Port:** `502`
   - **Timeout:** leave at default (3–5 seconds is fine)
5. Click **OK** to close the Setup dialog.
6. Go to: **Communication → Connect** (or click the green **Connect** button in the toolbar
   if there is one — it looks like a plug icon).
7. The software attempts to connect. Within 2–3 seconds you should see:
   - Status bar changes from **"Offline"** to **"Online"** (usually shown in green text)
   - A dialog may appear saying "Connection established" or the toolbar changes to show
     online-mode buttons (like Read from PLC, Write to PLC, Monitor mode)
8. If you get a timeout or "Cannot connect" error — see §2.6 troubleshooting below.

### 2.5 Read from PLC — confirm two-way communication

With the status bar showing "Online":

1. Go to **Communication → Read from PLC** (or look for a **Read** button in the toolbar —
   it may look like a down-arrow with a PLC chip icon).
2. A dialog may ask: "Overwrite the current program with the PLC program?" — click **Yes**.
3. The software downloads the current program from the PLC into the editor. If the PLC is
   brand new or freshly cleared, you will see a completely empty ladder diagram (possibly
   just one rung labeled "End").
4. No error dialog = success. You are confirmed online and two-way communication is working.

**What you are looking at in the editor:**

```
  ┌─────────────────────────────────────────────────────────┐
  │ Rung 1: ──────────────────────────────────────────[END] │
  └─────────────────────────────────────────────────────────┘
```

An empty program is just an END instruction. This is normal. The PLC runs this empty program
and does nothing — no outputs energized, no registers written. That is the correct state
before you add ladder logic in Phase 5.

### 2.6 Troubleshooting connection failures

| What you see | Most likely cause | Fix |
|---|---|---|
| Ping times out | PC not on same subnet as PLC | Re-check PC adapter IP is `192.168.0.50 / 255.255.255.0` |
| Ping times out | No link between PC and PLC | Check cable, check switch, check PLC Ethernet port LED |
| Ping works but software times out | Windows Firewall blocking the programming software | Open **Windows Defender Firewall → Allow an app through firewall** → find Click PLC software → check both Private and Public boxes |
| Ping works but software times out | PLC IP was previously changed from `192.168.0.1` | Try pinging other addresses in the subnet (`ping 192.168.0.10`); or hold the PLC's reset button while powering on to restore factory defaults (check the Click manual for your model's reset procedure) |
| "Read from PLC" downloads but ERR LED on | Old program has an error | In Phase 5 you will overwrite the program; ignore for now |
| Software connects but immediately drops | PC power management turning off the Ethernet adapter | In Windows Device Manager → Network Adapters → right-click Ethernet → Properties → Power Management → uncheck "Allow the computer to turn off this device to save power" |

### 2.7 Understanding online vs. offline mode in the software

Click Programming Software has two modes — you will use both:

- **Offline mode:** You write and edit the ladder logic program on your PC. The PLC is not
  involved. Think of it as writing code in a text editor before compiling.
- **Online mode:** You are connected to the PLC. You can see live values on the ladder
  (contacts show green when active), monitor data registers, force outputs, and
  download/upload programs.

To return to offline mode at any time: **Communication → Disconnect**.

> You do **not** need to be in online mode to write the ladder logic program in Phase 5.
> Write the program offline first, then connect and download it.

### 2.8 Revert your Windows PC's IP address after Phase 3

Once you have set the PLC's static IP to `192.168.0.10` (Phase 3) and power-cycled the
PLC, you can restore your PC's Ethernet adapter back to DHCP (or whatever it was before):

1. Re-open the adapter's IPv4 Properties (same path as §2.3).
2. Select **"Obtain an IP address automatically"**.
3. Click OK.

If your router hands out addresses in the `192.168.0.x` range, your PC will get a DHCP
address on that subnet and can continue to reach both the PLC at `192.168.0.10` and the
Pi at `192.168.0.172` without any manual IP configuration.

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

### 4.1 Hardware on the bench (confirmed working)

| Component | Model | Purpose |
|-----------|-------|---------|
| Power supply | **Rhino PSR-24-480** | 24 VDC supply powering PLC, buttons, and output lamps |
| Breakout board | **ZipLink ZL-RTB20-1** | Ribbon cable breakout — clean terminal access to all PLC I/O |
| Servo power button | **Fuji AR22F0L** | 22 mm momentary NO pushbutton, illuminated (24 V LED lamp) |
| E-stop button | Illuminated NC mushroom head, twist-release | Emergency stop with built-in 24 V lamp |

### 4.2 Input wiring (via ZipLink breakout board)

The ZipLink ZL-RTB20-1 breakout board connects to the PLC via a ribbon cable, giving you
screw terminals for every PLC I/O point. The terminal labels on the ZipLink mirror the PLC
labels (X1, X2, C1, Y1, Y2, etc.).

**Common wiring (do this first):**

| From | To | Purpose |
|------|----|---------|
| Rhino 0V (−) | ZipLink **C1** | Input common for X1–X4 |
| Rhino +24V (+) | ZipLink **V1** | Output power supply for Y1–Y6 |
| Rhino 0V (−) | ZipLink **CO** | Output common |

**Servo power button (Fuji AR22F0L → X1):**

| Button terminal | Connects to | Purpose |
|-----------------|-------------|---------|
| Terminal 3 (NO common) | Rhino **+24V** | Power source for input circuit |
| Terminal 4 (NO contact) | ZipLink **X1** | Signal to PLC input X1 |
| Terminal 23 (lamp +) | ZipLink **Y1** | Lamp powered by PLC output Y1 |
| Terminal 24 (lamp −) | ZipLink **CO** | Lamp return to output common |

When button is pressed: circuit closes → X1 = ON.
When button is released: circuit opens → X1 = OFF.
Lamp lights when Y1 is ON (servo power active).

**E-stop button → X2:**

| Button terminal | Connects to | Purpose |
|-----------------|-------------|---------|
| Terminal 1 (NC common) | Rhino **+24V** | Power source for input circuit |
| Terminal 2 (NC contact) | ZipLink **X2** | Signal to PLC input X2 |
| Lamp terminal X1 (+) | ZipLink **Y2** | Lamp powered by PLC output Y2 |
| Lamp terminal X2 (−) | ZipLink **CO** | Lamp return to output common |

Normal (e-stop out): NC contact is CLOSED → X2 = ON.
E-stop pressed: NC contact OPENS → X2 = OFF.
Lamp lights when Y2 is ON (system okay, no fault).

### 4.3 ASCII wiring diagram

```
  Rhino PSR-24-480                    ZipLink ZL-RTB20-1 (ribbon cable to PLC)
  ┌──────────────┐                    ┌──────────────────────────────────────┐
  │ +24V         ├──┬────────────────►│ V1 (output power)                   │
  │              │  │                 │                                      │
  │              │  ├──[Fuji NO]────►│ X1 (servo power input)              │
  │              │  │   btn t3→t4     │                                      │
  │              │  ├──[E-Stop NC]──►│ X2 (e-stop input)                   │
  │              │  │   btn t1→t2     │                                      │
  │              │  │                 │ Y1 ──► Fuji lamp t23                │
  │              │  │                 │ Y2 ──► E-stop lamp                  │
  │              │  │                 │                                      │
  │  0V          ├──┼────────────────►│ C1 (input common)                   │
  │              │  └────────────────►│ CO (output common) ◄── lamp returns │
  └──────────────┘                    └──────────────────────────────────────┘
```

### 4.4 Output wiring summary

| PLC Output | ZipLink terminal | Drives | Behavior |
|------------|-----------------|--------|----------|
| **Y1** | Y1 | Fuji servo button lamp (t23/t24) | ON when servo power is active |
| **Y2** | Y2 | E-stop button lamp | ON when system is okay (no fault, e-stop released) |

The outputs are **sourcing DC** — Y1/Y2 supply +24 V from V1 through the lamp to CO (0 V).

### 4.5 Verify inputs in the programming software

In Click Programming Software, while connected to the PLC:

1. Go to **Address Picker** or **Data View** (View → Data View).
2. Navigate to **X (Discrete Inputs)**.
3. Press the servo power button — X1 should flip from `0` to `1` and back when released.
4. X2 should already show `1` (NC contact closed). Slam the e-stop — X2 drops to `0`.
   Twist-release the e-stop — X2 returns to `1`.

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

### 5.2 Internal memory and outputs used by the ladder logic

| Click address | Type | Purpose |
|---------------|------|---------|
| C1 | Internal relay (coil) | Fault/e-stop flag — latches when e-stop fires |
| C100 | Internal relay (coil) | X1 one-shot (rising edge pulse) — self-clearing |
| DS115 | Data Short register | Servo power press counter |
| DS116 | Data Short register | E-stop activation counter |
| Y1 | Physical output | Servo power state — also drives Fuji button lamp |
| Y2 | Physical output | System-OK indicator — drives e-stop button lamp |

### 5.3 All 26 rungs — quick-entry reference

This table is everything you need to enter the full program without reading the verbose
descriptions below. Work top to bottom; each row = one rung.

**Contact abbreviations:** NO = Normally Open, NC = Normally Closed, RE = Rising Edge (Transition)
**Output abbreviations:** OUT = standard coil, SET = latching set, RST = latching reset, MOV = move/copy function block, Math = Math function block (Formula + Result fields)

| # | Label | Col A | Col B | Col C | Col AF |
|---|-------|-------|-------|-------|--------|
| 1 | X1 one-shot | RE X001 | — | — | OUT C100 |
| 2 | Toggle servo ON | NO C100 | NC Y001 | NC C001 | SET Y001 |
| 3 | Toggle servo OFF | NO C100 | NO Y001 | NC C001 | RST Y001 |
| 4 | Latch fault | NC X002 | — | — | SET C001 |
| 5 | E-stop kills servo | NO C001 | — | — | RST Y001 |
| 6 | E-stop counter | RE C001 | — | — | Math: Formula=`DS116+1`, Result=`DS116` |
| 7 | Servo press counter | NO C100 | — | — | Math: Formula=`DS115+1`, Result=`DS115` |
| 8 | Fault reset | NO C100 | NO X002 | NO C001 | RST C001 |
| 9 | System-OK lamp | NO X002 | NC C001 | — | OUT Y002 |
| 10a | servo_power_on = 1 | NO Y001 | — | — | MOV 1 → DS1 |
| 10b | servo_power_on = 0 | NC Y001 | — | — | MOV 0 → DS1 |
| 11a | servo_disable = 0 | NO Y001 | — | — | MOV 0 → DS2 |
| 11b | servo_disable = 1 | NC Y001 | — | — | MOV 1 → DS2 |
| 12a | lamp_servo_power = 1 | NO Y001 | — | — | MOV 1 → DS10 |
| 12b | lamp_servo_power = 0 | NC Y001 | — | — | MOV 0 → DS10 |
| 13a | estop_enable = 1 | NC X002 | — | — | MOV 1 → DS24 |
| 13b | estop_enable = 0 | NO X002 | — | — | MOV 0 → DS24 |
| 14a | estop_off = 1 | NO X002 | — | — | MOV 1 → DS25 |
| 14b | estop_off = 0 | NC X002 | — | — | MOV 0 → DS25 |
| 15d | state: IDLE | NC Y001 | NC C001 | — | MOV 0 → DS113 |
| 15c | state: RUNNING | NO Y001 | NC C001 | — | MOV 1 → DS113 |
| 15b | state: FAULT | NO C001 | NO X002 | — | MOV 2 → DS113 |
| 15a | state: E-STOPPED | NC X002 | — | — | MOV 3 → DS113 |
| 16a | last_fault = 0 | NC C001 | — | — | MOV 0 → DS114 |
| 16b | last_fault = 4 | NO C001 | — | — | MOV 4 → DS114 |

> **Rung 15 order matters.** The Click PLC runs rungs top to bottom; the last write wins. Enter
> 15d first (lowest priority) through 15a last (highest priority) so E-STOPPED always beats IDLE.

---

### 5.3a Faster entry tips — copy/paste similar rungs

Most time is spent on rungs 10–16, which all follow the same pattern: one contact → one MOV.
Use copy/paste to avoid re-configuring the MOV dialog from scratch every time.

**Duplicate-and-edit workflow:**

1. Finish rung 10a (NO Y001 → MOV 1 → DS1).
2. Right-click rung 10a → **Copy Rung**.
3. Right-click below it → **Paste Rung** (or **Insert Rung After**).
4. Double-click the contact to flip it NC (for 10b), or change the MOV source/destination.

**Groups of rungs you can copy from each other:**

| Source | Copy to | Only change |
|--------|---------|-------------|
| Rung 10a | 11a, 12a | Destination register (DS2, DS10) and source value |
| Rung 10b | 11b, 12b | Destination register and source value |
| Rung 13a | 14b | Source value (0→0 is same; just flip contact NO↔NC) |
| Rung 13b | 14a | Source value and contact type |
| Rung 15d | 15c, 15b, 15a | Contacts and source value |

**Keyboard shortcuts in Click Programming Software:**

| Action | Shortcut |
|--------|----------|
| Add new rung below | `Ctrl+Enter` |
| Add contact | `C` (with rung selected) |
| Add coil | `O` |
| Copy rung | `Ctrl+C` (right-click works too) |
| Paste rung | `Ctrl+V` |
| Undo | `Ctrl+Z` |

---

### 5.4 Creating the program in Click Programming Software

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

#### Rung-by-rung guide (verbose reference)

Use this section if the quick-entry table above doesn't have enough context, or for
troubleshooting. Each rung below includes the ladder diagram and intent.

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
- Function Block: **Math** → placed in column AF → the dialog has a **Formula** field and a **Result** field, each with a `...` button:
  - **Formula** `...` → type `DS116+1` → OK
  - **Result** `...` → type `DS116` → OK
  - Leave **Type** as Decimal, leave **One Shot** unchecked

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
- Function Block: **Math** → placed in column AF:
  - **Formula** `...` → type `DS115+1` → OK
  - **Result** `...` → type `DS115` → OK
  - Leave **Type** as Decimal, leave **One Shot** unchecked

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

**RUNG 9 — Y2 System-OK Lamp**

Drives the e-stop button lamp: ON when e-stop is released AND no fault is latched.

```
──[X2]──[/C1]─────────────────────────────( Y2 )──
  (X2 normal)  (no fault)                 (e-stop lamp ON)
```

Instructions:
- Contact: `X2` (Normally Open — e-stop released, NC contact closed)
- Contact: `C1` (Normally Closed — no fault latched)
- Output: standard coil at address `Y2`

> Y2 is a regular coil, not SET/RST — it is re-evaluated every scan. When either X2 drops
> (e-stop pressed) or C1 latches (fault), Y2 turns OFF and the e-stop lamp goes dark.
> Y1 does not need its own rung — it is already driven by Rungs 2/3/5 (SET/RST Y1) and
> the Fuji button lamp is wired directly to the Y1 output terminal.

---

**RUNG 10 — Write servo_power_on to DS1**

```
──[Y1]────────────────────┤ MOV 1 → DS1 ├──
──[/Y1]───────────────────┤ MOV 0 → DS1 ├──
```

In Click, use two rungs with a **MOV** function block:

Rung 10a:
- Contact: `Y1` (Normally Open)
- Function Block: **MOV** → Source: constant `1` → Destination: `DS1`

Rung 10b:
- Contact: `Y1` (Normally Closed)
- Function Block: **MOV** → Source: constant `0` → Destination: `DS1`

---

**RUNG 11 — Write servo_disable to DS2 (inverse of DS1)**

Rung 11a:
- Contact: `Y1` (Normally Open)
- **MOV** `0` → `DS2`

Rung 11b:
- Contact: `Y1` (Normally Closed)
- **MOV** `1` → `DS2`

---

**RUNG 12 — Write lamp_servo_power to DS10 (mirrors DS1)**

Rung 12a:
- Contact: `Y1` (NO) → **MOV** `1` → `DS10`

Rung 12b:
- Contact: `Y1` (NC) → **MOV** `0` → `DS10`

---

**RUNG 13 — Write estop_enable to DS24**

```
──[/X2]───────────────────┤ MOV 1 → DS24 ├──
──[X2]────────────────────┤ MOV 0 → DS24 ├──
```

Rung 13a:
- Contact: `X2` (Normally Closed = e-stop pressed) → **MOV** `1` → `DS24`

Rung 13b:
- Contact: `X2` (Normally Open = e-stop normal) → **MOV** `0` → `DS24`

---

**RUNG 14 — Write estop_off to DS25 (inverse of DS24)**

Rung 14a:
- Contact: `X2` (NO = normal) → **MOV** `1` → `DS25`

Rung 14b:
- Contact: `X2` (NC = e-stop active) → **MOV** `0` → `DS25`

---

**RUNG 15 — Write system_state to DS113**

Four mutually-exclusive conditions map to the four state codes (0=idle, 1=running,
2=fault, 3=e-stopped). Write state 3 (e-stopped) while X2 is OFF and fault is active:

Rung 15a — E-STOPPED (X2 off = e-stop active):
- Contact: `X2` (NC) → **MOV** `3` → `DS113`

Rung 15b — FAULT (C1 on, but X2 is back):
- Contact: `C1` (NO), Contact: `X2` (NO) → **MOV** `2` → `DS113`

Rung 15c — RUNNING (Y1 on, no fault):
- Contact: `Y1` (NO), Contact: `C1` (NC) → **MOV** `1` → `DS113`

Rung 15d — IDLE (Y1 off, no fault):
- Contact: `Y1` (NC), Contact: `C1` (NC) → **MOV** `0` → `DS113`

> Click PLCs scan rungs top to bottom in a single sweep (~1 ms). If multiple rungs write
> to the same register, the **last rung to execute wins**. Order the rungs from lowest
> priority (idle) to highest (e-stopped) so the most urgent state wins.
>
> Practical order for Rung 15: **15d (idle) → 15c (running) → 15b (fault) → 15a (e-stopped)**.

---

**RUNG 16 — Write last_fault to DS114**

Rung 16a — No fault:
- Contact: `C1` (NC) → **MOV** `0` → `DS114`

Rung 16b — E-stop fault (code 4 = `"estop_triggered"` in plc-sensor):
- Contact: `C1` (NO) → **MOV** `4` → `DS114`

---

### 5.5 Download the program to the PLC

1. Go to **Communication → Write to PLC**.
2. The dialog asks whether to put the PLC in STOP mode first — choose **Yes**.
3. After the download completes, it asks whether to restart in RUN mode — choose **Yes**.
4. Verify the RUN LED is on.

### 5.6 Verify the logic in the programming software (online mode)

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

### 6.1 Changes already made in this commit

The ladder logic writes to the same Modbus register addresses as the Pi Zero W simulator,
so only minimal changes were needed:

| File | Change | Why |
|------|--------|-----|
| `config/viam-server.json` | `host` changed from `"raiv-plc.local"` to `"192.168.0.10"` | Point at real PLC instead of Pi Zero W simulator |
| `modules/plc-sensor/src/plc_sensor.py` | `_FAULT_NAMES[4]` renamed from `"clamp_fail"` to `"estop_triggered"` | Fault code 4 now means e-stop, not clamp failure |
| `modules/plc-sensor/src/plc_sensor.py` | Default host fallback changed from `"raiv-plc.local"` to `"192.168.0.10"` | Match new primary target |
| `modules/plc-sensor/src/plc_sensor.py` | Docstring updated to reference Click PLC C0-10DD2E-D | Accuracy |
| `scripts/test_plc_modbus.py` | Default `--host` changed to `192.168.0.10`; removed `slave=` parameter | Match real PLC; pymodbus 3.12+ API compatibility |

No changes to the register read logic, data conversion, or Viam component interface.

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
| DS1 | 0 | `servo_power_on` | ✅ Rung 10 |
| DS2 | 1 | `servo_disable` | ✅ Rung 11 |
| DS3–DS9 | 2–8 | `plate_cycle` … `belt_reverse` | ❌ Reads 0 |
| DS10 | 9 | `lamp_servo_power` | ✅ Rung 12 |
| DS11–DS18 | 10–17 | lamp registers | ❌ Reads 0 |
| DS19–DS23 | 18–22 | emag, poe registers | ❌ Reads 0 |
| DS24 | 23 | `estop_enable` | ✅ Rung 13 |
| DS25 | 24 | `estop_off` | ✅ Rung 14 |
| DS101–DS109 | 100–108 | accel, gyro, temp, humidity, pressure | ❌ Reads 0 |
| DS110 | 109 | `servo1_position` | ❌ Reads 0 |
| DS111 | 110 | `servo2_position` | ❌ Reads 0 |
| DS112 | 111 | `cycle_count` | ❌ Reads 0 |
| DS113 | 112 | `system_state` | ✅ Rung 15 |
| DS114 | 113 | `last_fault` | ✅ Rung 16 |
| DS115 | 114 | `servo_power_press_count` | ✅ Rung 7 |
| DS116 | 115 | `estop_activation_count` | ✅ Rung 6 |
| DS117 | 116 | `current_uptime_seconds` | ❌ Reads 0 |
| DS118 | 117 | `last_estop_duration_seconds` | ❌ Reads 0 |

Sensor readings that show 0 are handled gracefully by `plc-sensor` — they do not cause
errors or disconnect states.

---

## Appendix B — Network Reference

| Device | IP | Connection | Notes |
|--------|----|-----------|-------|
| Raspberry Pi 5 | 192.168.0.176 | WiFi | Runs viam-server with plc-sensor module |
| Click PLC C0-10DD2E-D | 192.168.0.10 | Ethernet (via Netgear switch) | Modbus TCP on port 502 |
| Pi Zero W (simulator) | 192.168.0.173 | Ethernet | Development tool — retired for production |

## Appendix C — Bill of Materials

| Item | Model | Qty | Purpose |
|------|-------|-----|---------|
| PLC | Click C0-10DD2E-D | 1 | Ethernet Basic, 8 DC inputs, 6 DC outputs |
| Power supply | Rhino PSR-24-480 | 1 | 24 VDC for PLC, buttons, and lamps |
| Breakout board | ZipLink ZL-RTB20-1 | 1 | Ribbon cable terminal breakout for PLC I/O |
| Servo power button | Fuji AR22F0L | 1 | 22 mm momentary NO, illuminated 24 V LED |
| E-stop button | Illuminated NC mushroom | 1 | Twist-release, NC contact, 24 V lamp |
| Ethernet switch | Netgear (existing) | 1 | Connects PLC and Pi on same subnet |
