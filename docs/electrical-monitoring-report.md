# IronSight Electrical Monitoring System — RAIV 3 Technical Report

**Date:** April 10, 2026
**Prepared by:** Andrew Sieg, B&B Metals / IronSight
**System:** RAIV 3 Mobile Robotic Cell (Staubli TX2-140, Apera Vue, Click PLC)
**Truck:** Mack Granite (VIN ...9830)

---

## Executive Summary

The RAIV 3 has **two completely independent power systems** with no cross-connection:
1. **Truck electrical** (battery + alternator) — powers the Pi 5, CAN bus, cab systems
2. **Winco W6010DE diesel generator** — powers the ENTIRE robot cell (Staubli CS9, Apera vision, Click PLC, pneumatics, servos)

**The generator has ZERO telemetry.** There is no monitoring of generator voltage, frequency, fuel, or load. A frequency drift could be slowly killing the Apera PC's power supply and you'd never know until it dies. The J1939 alternator/battery readings from the CAN bus tell us about the truck's system only — NOT the robot's power.

This report documents what we've built, what we can already monitor, and what $45 in hardware will add to make this the most instrumented mobile robot cell in the industry. **The ADS1115 voltage monitoring hardware is especially critical because it provides the FIRST visibility into generator output quality.**

**What's already done (software — deployed April 10, 2026):**
- 33 robot temperatures (every motor, encoder, drive, winding, junction, CPU, safety board)
- 6 joint torques (load monitoring per axis)
- EtherCAT bus health + individual I/O point states (31 signals with human-readable labels)
- FTP log scraping for URPS thermal shutdowns, EtherCAT errors, safety events
- J1939 electrical PGNs: alternator voltage/current, battery voltage, charging health scoring
- Electrical section in dashboard with auto-diagnosis watchdog rules
- Live mockup at `/electrical-mockup` showing the full hardware-enabled vision

**What's planned (hardware — ~$45, ~1 day install):**
- Blown fuse detection on 7 circuits
- Voltage monitoring on 8 power rails
- Current measurement on 2 critical circuits
- Junction temperature monitoring at 5 locations

---

## Part 1: What We Monitor Today (Software Only)

### 1.1 Truck Electrical System (J1939 CAN Bus)

The Pi 5 passively listens to the truck's J1939 CAN bus at 250kbps. Every ECU on the Mack broadcasts data continuously — we just decode it.

**PGN 65271 — Vehicle Electrical Power (5 signals):**

| Signal | Key | What It Tells You |
|--------|-----|-------------------|
| Net Battery Current | `net_battery_current_a` | Current flowing in/out of battery (-125A to +125A) |
| Alternator Current | `alternator_current_a` | How hard the alternator is working (0-250A) |
| Alternator Voltage | `alternator_voltage_v` | Charging system output (should be 13.8-14.4V at 12V, 27-28V at 24V) |
| Battery Voltage | `battery_voltage_v` | Main battery potential |
| Battery Switched | `battery_voltage_switched_v` | Voltage after main disconnect — difference reveals relay/wiring resistance |

**Derived Electrical Health Metrics:**

| Metric | Key | Logic |
|--------|-----|-------|
| Charging Spread | `charging_spread_v` | alternator_voltage - battery_voltage (should be 1-3V while running) |
| Electrical Health | `electrical_health` | OK / LOW / NOT_CHARGING / OVERCHARGE based on voltage and current thresholds |
| Battery Health | `battery_health` | OK / LOW / CRITICAL / OVERCHARGE based on resting vs running voltage |

**Additional J1939 Data (already captured):**

| Category | Signals | Electrical Relevance |
|----------|---------|---------------------|
| Engine | RPM, torque, load % | Correlate with alternator output — does voltage sag under load? |
| PTO | Engaged, RPM, switches | Hydraulic pump load on alternator |
| Fuel | Rate, economy, level | Generator fuel monitoring |
| Emissions | DEF level, SCR temp, DPF status | Aftertreatment heater circuits draw significant current |
| Vehicle | Speed, GPS, gear | Context for when electrical events occur |
| DTCs | Active codes, lamps | Electrical-specific SPNs (158, 167-171, 623-625) |

**Code location:** `modules/j1939-sensor/src/models/pgn_decoder.py` (PGN 65271, lines 151-166)
**Code location:** `modules/j1939-sensor/src/models/j1939_fleet_metrics.py` (electrical_health scoring)
**Tests:** `modules/j1939-sensor/tests/test_pgn_decoder.py` (9 VEP tests, 131 total)

### 1.2 Robot Controller Temperatures (Staubli CS9 REST API)

The Pi 5 polls the CS9 REST API every 2 seconds. We now read **33 temperature sensors** across every thermal zone in the controller:

| Category | Sensors | What They Detect |
|----------|---------|-----------------|
| Motor Probes J1-J6 | 6 | Physical motor temperature — bearing wear, overwork |
| Encoder Temps J1-J6 | 6 | Bearing heat near encoders — early wear detection |
| Drive Case Temps J1-J6 | 6 | Amplifier thermal load — ambient heat buildup |
| Motor Winding Temps J1-J6 | 6 | Insulation stress — predicts motor burnout |
| Drive Junction Temps J1-J6 | 6 | Power transistor heat — **direct proxy for motor current draw** |
| DSI (Drive Safety Interface) | 1 | Drive module health — correlated with URPS shutdowns |
| CPU + CPU Board | 2 | Controller computational health |
| RSI (Safety Interface) | 1 | Safety system thermal state |
| STARC Board | 1 | Safety controller health |

**Why junction temps matter for electrical monitoring:** The drive junction temperature is proportional to the current flowing through the power transistors. If `temp_junction_j3` is rising while `temp_j3` (motor probe) is stable, the transistor is degrading — predicting drive failure before it happens.

**Code location:** `modules/cell-sensor/src/staubli_client.py` (StaubliState dataclass + parsers)
**Dashboard:** `dashboard/components/Cell/StaubliPanel.tsx` (TempGauge components)

### 1.3 Joint Torques (Staubli REST API)

6 static torque values from `/api/arm/model/staticjnttorque`, polled every 2 seconds.

| Signal | What It Tells You |
|--------|-------------------|
| Torque trending up at same position | Mechanical resistance increasing (bearing, gearbox wear) |
| Torque × velocity = power | Estimate electrical power draw per axis |
| Torque spike during pick | Part heavier than expected, or gripper misaligned |
| Torque mismatch between cycles | Mechanical inconsistency developing |

### 1.4 EtherCAT Bus Health

**Bus-level monitoring** via `/api/ios/ioboard/status`:
- `ioboard_connected` — all 3 terminals communicating
- `ioboard_bus_state` — OP / SAFE-OP / PRE-OP / INIT
- `ioboard_slave_count` — should be 3 (alerts if fewer)
- `ioboard_op_state` — all slaves in operational state

### 1.5 EtherCAT I/O Point States (31 Named Signals)

Every physical input and output on the 3 EtherCAT terminals, read from VAL3 variable collections:

**Digital Inputs (15 mapped) — What's connected to the robot:**

| Terminal | I/O Key | Human Label | Physical Connection |
|----------|---------|-------------|---------------------|
| T1 %I0 | `servo_enable` | Servo Enable Button | Blue pushbutton on SERVOS panel |
| T1 %I1 | `servo_disable1` | E-Stop 1 (Cell) | Red mushroom button on cell frame |
| T1 %I2 | `servo_disable2` | E-Stop 2 (Panel) | Red mushroom button on operator panel |
| T1 %I3 | `servo_doorswitch` | Safety Gate Interlock | Guard door magnetic switch |
| T1 %I4 | `servo_disable_remote` | PLC Remote Disable | Click PLC safety output Y507 |
| T2 %I2 | `btn_abort` | Abort / Stow Button | Yellow button on Operation Controls panel |
| T2 %I3 | `btn_tps_cycle` | Start / Cycle Button | Green button on Operation Controls panel |
| T2 %I4 | `opt_speed` | Hi/Low Speed Toggle | White button on SERVOS panel |
| T2 %I5 | `opt_belt_fwd` | Belt Jog Forward | Operator panel belt control |
| T2 %I6 | `opt_belt_rev` | Belt Jog Reverse | Operator panel belt control |
| T2 %I7 | `btn_clearpose` | Clear Position Button | Operator panel |
| T3 %I0 | `opt_gripper_lock` | Gripper Lock Toggle | Operator panel |
| T3 %I1 | `gripper_on` | Gripper Magnetized | Schunk EGM-50 feedback |
| T3 %I2 | `gripper_alarm` | Gripper Alarm | Schunk EGM-50 error signal |
| T3 %I3 | `gripper_busy` | Gripper Cycling | Schunk EGM-50 busy flag |

**Digital Outputs (16 mapped) — What the robot commands:**

| Terminal | I/O Key | Human Label | Physical Connection |
|----------|---------|-------------|---------------------|
| T1 %Q0 | `lamp_ispowered` | Power On Lamp | Green indicator on operator panel |
| T1 %Q1 | `lamp_servoenabled` | Servo Enabled Lamp | Indicator lamp |
| T1 %Q2 | `lamp_servodisabled1` | E-Stop 1 Lamp | E-stop indicator |
| T1 %Q3 | `lamp_servodisabled2` | E-Stop 2 Lamp | E-stop indicator |
| T2 %Q2 | `lamp_abort` | Abort Lamp | Yellow indicator |
| T2 %Q3 | `lamp_cycle` | Cycle Active Lamp | Green indicator |
| T2 %Q4 | `lamp_slowspeed` | Slow Speed Lamp | Speed indicator |
| T2 %Q5 | `belt_fwd` | Belt Conveyor Forward | Solenoid relay |
| T2 %Q6 | `belt_rev` | Belt Conveyor Reverse | Solenoid relay |
| T3 %Q0 | `safety_none` | Safety OK (Green) | Safety status lamp |
| T3 %Q1 | `safety_waiting` | Safety Restart Needed | Safety status lamp |
| T3 %Q2 | `safety_ss1` | Safety Stop 1 Active | Safety status lamp |
| T3 %Q3 | `safety_ss2` | Safety Stop 2 Active | Safety status lamp |
| T3 %Q4 | `lamp_gripperlocked` | Gripper Locked Lamp | Indicator |
| T3 %Q5 | `gripper_enable` | Gripper Controller Enable | Schunk EGM-50 enable |
| T3 %Q6 | `gripper_mag` | Magnetize Command | Schunk EGM-50 activate |

**Spare I/O (available for future electrical monitoring):**
- Terminal 1: 2 spare DI (%I5, %I6), 4 spare DO (%Q4-Q7)
- Terminal 2: 2 spare DI (%I0, %I1), 1 spare DO (%Q0)
- Terminal 3: 3 spare DI (%I5-I7)
- **Total: 7 spare digital inputs, 5 spare digital outputs**

**Code location:** `modules/cell-sensor/src/staubli_client.py` (I/O parsing block)
**Dashboard:** `dashboard/components/Cell/StaubliPanel.tsx` (I/O Points section with label maps)

### 1.6 FTP System Log Scraping

The Pi 5 connects to the CS9 via FTP every 60 seconds (credentials: `maintenance:spec_cal`) and downloads system logs. Parses JSON-lines for:

| Event Type | What It Catches | Why It Matters |
|------------|----------------|----------------|
| URPS Thermal Shutdowns | Error code 0x168D, count + timestamps | THE #1 known issue — power supply overheating |
| EtherCAT Frame Loss | Bus communication drops | Often caused by thermal events |
| Safety Stops | Category, cause, timestamp | Track how often production is interrupted |
| Servo Enable/Disable | Toggle count per 24h | Excessive toggling = operator issue or intermittent fault |
| App Crashes/Restarts | Error messages, timestamps | Software reliability tracking |
| Arm Cycle Count | Cumulative from arm.json | Maintenance scheduling by actual usage |
| Controller CPU Load | Thread usage percentages | Motion interpolator at 81.7% — approaching limit |

**Code location:** `modules/cell-sensor/src/staubli_log_scraper.py` (348 lines, 33 tests)

### 1.7 Watchdog Rules (Cross-System Correlation)

The dashboard runs client-side watchdog rules correlating all data sources. Electrical-relevant rules:

| Rule | Condition | Alert |
|------|-----------|-------|
| URPS Events | `urps_errors_24h > 0` | Warning/Critical: Power supply thermal protection fired |
| EtherCAT Errors | `ethercat_errors_24h > 0` | Warning: Fieldbus degradation |
| Thermal Shutdown Chain | URPS + EtherCAT errors together | Critical: Cabinet overheats → bus degrades → power cuts |
| Motor Winding Overtemp | `temp_winding_j{N} >= 100°C` | Warning/Critical: Insulation degradation risk |
| Drive Junction Overtemp | `temp_junction_j{N} >= 90°C` | Warning/Critical: High current draw |
| CS9 CPU Overtemp | `temp_cpu >= 75°C` | Warning/Critical: Controller thermal stress |
| EtherCAT Slave Missing | `ioboard_slave_count < 3` | Critical: Terminal offline |
| Pi Undervoltage | `pi_undervoltage_now` | Critical: Pi 5V supply sagging |

**Code location:** `dashboard/components/Cell/CellWatchdog.tsx`

---

## Part 2: What Hardware Adds ($45 Total)

### 2.1 Fuse Status Monitoring — $15

**Problem:** When a device stops working, you don't know if the fuse blew or if it's a software/network issue. You have to physically check the fuse panel.

**Solution:** Optoisolator on the load side of each fuse. Fuse intact = signal high. Blown = signal low.

**Parts (scaled for 48 fuses — 3x MCP23017):**

| Part | Qty | Unit Cost | Total | Source |
|------|-----|-----------|-------|--------|
| MCP23017 I2C GPIO Expander | 3 | $3.00 | $9.00 | Amazon/DigiKey |
| PC817 Optoisolator (packs of 10) | 5 packs | $1.50 | $7.50 | Amazon |
| 10kΩ Resistors (voltage divider) | 48 | — | $1.00 | Resistor kit |
| 1kΩ Resistors (current limit) | 48 | — | $1.00 | Resistor kit |
| Protoboard + headers + terminals | 2 | $4.00 | $8.00 | Amazon |
| **Subtotal** | | | **$26.50** | |

**Scaling:** Each MCP23017 monitors 16 fuses. 3 chips = 48 fuses. Add a 4th chip ($3) for 64 if needed. All share the same 2 I2C wires — addresses 0x20, 0x21, 0x22.

**Wiring diagram (per fuse):**
```
24V Bus ──[FUSE]──┬── Load (robot, vision, etc.)
                  │
                  ├── 10kΩ ──┬── 1kΩ ── GND    (voltage divider: 24V → ~2.2V)
                  │          │
                  │          └── PC817 LED anode (optoisolator input)
                  │               │
                  │          PC817 LED cathode ── GND
                  │
                  └── (continues to load)

PC817 collector ── MCP23017 input pin (with 10kΩ pull-up to 3.3V)
PC817 emitter ── GND
```

**Known fuses (from junction box labels — need full panel mapping on truck):**

| Fuse | Circuit | Rating | Location | Wire Color |
|------|---------|--------|----------|------------|
| F1 | SERVO (Robot Power) | 30A | Left panel, row 1 | Red blade |
| F2 | SERVO 2 | 30A | Left panel, row 1 | Red blade |
| F3 | BELT (Conveyor) | 15A | Left panel, row 2 | Blue blade |
| F4 | MAIN STATION | 20A | Left panel, row 2 | Yellow blade |
| F5 | OP STATION | 15A | Left panel, row 3 | Blue blade |
| F6 | VISION (Apera) | 15A | Right panel, row 1 | Blue blade |
| F7 | PLC (Click PLC) | 10A | Right panel, row 1 | Red blade |
| F8-F48 | **TO BE MAPPED** — photograph every fuse position on the truck, label circuit, note rating | — | — | — |

**Full panel mapping TODO:** Walk the truck with a camera. For every fuse (custom panel + OEM truck fuse box), record: position, circuit name, amp rating, blade color, what device it feeds. This map becomes `circuit_map.py` in the software.

**Connection to Pi 5:**
- 3x MCP23017 → I2C bus (GPIO 2 SDA, GPIO 3 SCL)
- I2C addresses: 0x20 (fuses 1-16), 0x21 (fuses 17-32), 0x22 (fuses 33-48)
- 48 inputs total, expandable to 64 with a 4th chip ($3)

### 2.2 Voltage Monitoring — $12

**Problem:** You know a fuse is OK, but is the voltage actually correct? Sagging voltage causes intermittent failures that are hard to diagnose.

**Solution:** 2x ADS1115 16-bit ADCs on I2C, each with 4 channels. Voltage dividers scale 24V/12V/5V rails to the 0-4.096V ADC input range.

**Parts:**

| Part | Qty | Unit Cost | Total | Source |
|------|-----|-----------|-------|--------|
| ADS1115 16-bit ADC breakout | 2 | $6.00 | $12.00 | Amazon/Adafruit |

Resistors for voltage dividers come from the same kit as fuse monitoring.

**8 monitoring channels:**

| ADS1115 | Channel | Tap Point | Nominal | Divider | What It Tells You |
|---------|---------|-----------|---------|---------|-------------------|
| #1 (0x48) | A0 | Main 24V bus (after RHINO PSU) | 24V | 10:1 | System bus health |
| #1 (0x48) | A1 | Robot supply (after F1) | 24V | 10:1 | Robot has power at spec? |
| #1 (0x48) | A2 | Vision supply (after F6) | 24V | 10:1 | Vision powered at spec? |
| #1 (0x48) | A3 | PLC supply (after F7) | 24V | 10:1 | PLC powered at spec? |
| #2 (0x49) | A0 | Pneumatic solenoid supply | 24V | 10:1 | Solenoids have juice? |
| #2 (0x49) | A1 | 12V from truck battery | 12V | 5:1 | Truck charging system |
| #2 (0x49) | A2 | 5V Pi supply rail | 5V | direct | Pi power quality |
| #2 (0x49) | A3 | Generator output (via transformer) | 120V | 50:1 | Generator health |

**Voltage divider (24V → 2.18V):**
```
24V Rail ──[10kΩ]──┬──[1kΩ]── GND
                   │
                   └── ADS1115 Analog Input (reads ~2.18V)
```

Software scales back: `actual_voltage = adc_reading × 11.0`

**Connection to Pi 5:**
- ADS1115 #1 → I2C address 0x48 (ADDR to GND)
- ADS1115 #2 → I2C address 0x49 (ADDR to VDD)
- Same I2C bus as MCP23017 (GPIO 2/3)

### 2.3 Current Monitoring — $8

**Problem:** You know voltage is OK, but how much current is each circuit drawing? A circuit at 90% of fuse capacity is about to blow.

**Solution:** 2x INA219 current/voltage sensors inline on the robot and vision power circuits.

**Parts:**

| Part | Qty | Unit Cost | Total | Source |
|------|-----|-----------|-------|--------|
| INA219 Current/Voltage Sensor | 2 | $4.00 | $8.00 | Amazon/Adafruit |

**Installation:** Wire inline (in series) with the power cable. The INA219 has a 0.1Ω shunt resistor that measures voltage drop proportional to current.

| Sensor | Circuit | Location | Fuse Rating | Expected Range |
|--------|---------|----------|-------------|----------------|
| INA219 #1 (0x40) | Robot power | Between F1 and CS9 controller | 30A | 5-20A normal, >25A warning |
| INA219 #2 (0x41) | Vision power | Between F6 and Apera PC | 15A | 2-5A normal, >12A warning |

**What current monitoring reveals:**

| Reading | Meaning |
|---------|---------|
| 28A on a 30A fuse (93%) | Fuse about to blow — reduce load or upsize fuse |
| 0A but voltage present | Device powered but not drawing current — internal PSU failure or software crash |
| Current spiking during J3 moves | Motor binding, mechanical issue causing overcurrent |
| 2A at 3AM when everything is off | Parasitic draw — relay stuck or wiring fault |

**Connection to Pi 5:**
- INA219 #1 → I2C address 0x40
- INA219 #2 → I2C address 0x41
- Same I2C bus (GPIO 2/3)

### 2.4 Junction Temperature Monitoring — $10

**Problem:** The URPS thermal shutdowns are the #1 known issue. You can't tell if the cabinet is overheating until the robot stops.

**Solution:** 5x DS18B20 digital temperature sensors on a 1-Wire bus. All chain on a single GPIO pin.

**Parts:**

| Part | Qty | Unit Cost | Total | Source |
|------|-----|-----------|-------|--------|
| DS18B20 Waterproof Temp Sensor | 5 | $2.00 | $10.00 | Amazon |

**Sensor placement:**

| Sensor | Location | What It Catches | Warn | Crit |
|--------|----------|-----------------|------|------|
| #1 | Command center cabinet (inside) | URPS thermal issue before it happens | 45°C | 55°C |
| #2 | Main junction box (floor-mounted) | Connection resistance heating | 50°C | 65°C |
| #3 | Cable run near exhaust manifold | Insulation degradation from heat | 55°C | 70°C |
| #4 | Generator compartment (Winco bay) | Generator thermal stress | 50°C | 65°C |
| #5 | Ambient (outside truck bed) | Reference baseline for all other temps | 40°C | 50°C |

**Connection to Pi 5:**
- All 5 sensors chain on GPIO 4 (1-Wire bus)
- Each sensor has a unique 64-bit serial number — software auto-discovers them
- 4.7kΩ pull-up resistor between data line and 3.3V
- Total wiring: 1 GPIO pin, 3 wires (data, 3.3V, GND)

### 2.5 Complete Wiring Summary

```
Pi 5 GPIO Header
  │
  ├── I2C Bus (GPIO 2 SDA, GPIO 3 SCL) ── shared by all I2C devices
  │     ├── MCP23017 #1 (0x20) ── 16 optoisolators ── fuses 1-16
  │     ├── MCP23017 #2 (0x21) ── 16 optoisolators ── fuses 17-32
  │     ├── MCP23017 #3 (0x22) ── 16 optoisolators ── fuses 33-48
  │     ├── ADS1115 #1 (0x48) ── 4 voltage dividers ── 4 power rails
  │     ├── ADS1115 #2 (0x49) ── 4 voltage dividers ── 4 power rails
  │     ├── INA219 #1 (0x40) ── inline on robot power cable
  │     └── INA219 #2 (0x41) ── inline on vision power cable
  │
  └── 1-Wire Bus (GPIO 4) ── 4.7kΩ pull-up
        ├── DS18B20 #1 ── Command center cabinet
        ├── DS18B20 #2 ── Main junction box
        ├── DS18B20 #3 ── Cable run (exhaust area)
        ├── DS18B20 #4 ── Generator compartment
        └── DS18B20 #5 ── Ambient outside

Total GPIO pins used: 3 (SDA, SCL, 1-Wire)
Total I2C devices: 7 (3x MCP23017 + 2x ADS1115 + 2x INA219, all different addresses)
Total fuse capacity: 48 (expandable to 64 with $3 4th chip)
```

### 2.6 Bill of Materials

| Item | Qty | Cost | Source |
|------|-----|------|--------|
| MCP23017 I2C GPIO Expander | 3 | $9.00 | Amazon |
| PC817 Optoisolator (packs of 10) | 5 | $7.50 | Amazon |
| ADS1115 16-bit ADC Breakout | 2 | $12.00 | Amazon/Adafruit |
| INA219 Current/Voltage Sensor | 2 | $8.00 | Amazon/Adafruit |
| DS18B20 Waterproof Temp Probe | 5 | $10.00 | Amazon |
| Resistor assortment (1kΩ, 4.7kΩ, 10kΩ) | 1 kit | $3.00 | Amazon |
| Protoboard + pin headers + terminal blocks | 2 | $8.00 | Amazon |
| **TOTAL (48-fuse capacity)** | | **$57.50** | |

---

## Part 3: Software Architecture

### 3.1 Current Module Layout (Deployed)

```
modules/
├── plc-sensor/          ← Click PLC Modbus TCP (1Hz, 95+ fields)
├── j1939-sensor/        ← J1939 CAN bus (1Hz, 100+ fields, 15 PGNs)
│   ├── pgn_decoder.py   ← PGN 65271 now has 5 electrical SPNs
│   └── j1939_fleet_metrics.py ← electrical_health + charging_spread_v
└── cell-sensor/         ← Robot cell (0.5Hz, 80+ fields)
    ├── staubli_client.py       ← 33 temps, 6 torques, I/O board, 31 I/O points
    ├── staubli_log_scraper.py  ← FTP log parsing (URPS, EtherCAT, safety)
    ├── apera_client.py         ← Vision pipeline status
    └── network_monitor.py      ← Device ping reachability
```

### 3.2 Planned Module (After Hardware Install)

```
modules/
└── electrical-monitor/  ← NEW (to be built)
    ├── electrical_sensor.py   ← Main Viam sensor, 1Hz capture
    ├── fuse_monitor.py        ← MCP23017 GPIO expander reader
    ├── voltage_monitor.py     ← ADS1115 ADC with voltage scaling
    ├── current_monitor.py     ← INA219 current/voltage reader
    ├── temp_monitor.py        ← DS18B20 1-Wire chain reader
    ├── circuit_map.py         ← THIS TRUCK's wiring encoded as data
    └── fault_engine.py        ← Diagnostic rules (blown fuse, overcurrent, etc.)
```

### 3.3 Data Flow

```
Hardware Sensors → Pi 5 I2C/1-Wire → electrical-monitor module (1Hz)
                                         ↓
                                    Viam Cloud (sync every 6s)
                                         ↓
                                    Dashboard API routes
                                         ↓
                                    Electrical Panel + Watchdog Rules
                                         ↓
                                    AI Diagnosis (Claude sees all fields)
```

### 3.4 Dashboard Pages

| Page | URL | Status |
|------|-----|--------|
| Truck Dashboard (cell section) | `/?truck_id=XX` | Deployed — shows temps, torques, I/O, logs |
| Electrical Mockup | `/electrical-mockup` | Deployed — preview of hardware-enabled dash |
| Electrical Systems (production) | `/electrical` | Planned — after hardware install |

---

## Part 4: Diagnostic Capabilities

### 4.1 Fault Isolation Matrix

With all layers active, here's how every common failure is diagnosed:

| Symptom | Fuse | Voltage | Current | Temp | I/O | J1939 | Diagnosis |
|---------|------|---------|---------|------|-----|-------|-----------|
| Robot stops | F1 BLOWN | Robot = 0V | — | — | servo_enable=true | batt OK | **Blown fuse F1 — overcurrent** |
| Robot stops | F1 OK | Robot = 24V | 0A | — | servo_disable1=true | — | **E-Stop 1 pressed — not electrical** |
| Robot stops | F1 OK | Robot = 21V | 28A | J3 junction hot | — | batt sagging | **Overload — voltage sag + thermal** |
| Vision offline | F6 OK | Vision = 24V | 0A | — | — | — | **Software crash — power cycle** |
| Vision offline | F6 BLOWN | Vision = 0V | — | — | — | — | **Blown fuse — replace F6** |
| Belt won't move | All OK | All OK | — | — | belt_fwd=true | — | **Output fired but motor dead — relay or motor** |
| Belt won't move | All OK | All OK | — | — | btn_tps_cycle=false | — | **Start button not pressed or broken** |
| Everything stops | — | All rails low | — | Cabinet=55°C | — | batt=11V | **Alternator failed — truck problem** |
| Everything stops | — | Main bus=0V | — | — | — | batt OK | **Inverter failed — 3000W unit** |
| Gripper won't release | All OK | All OK | Normal | — | gripper_demag=true, gripper_off=false | — | **Schunk EGM-50 internal fault** |
| Intermittent EtherCAT | All OK | All OK | — | Cabinet=52°C | slave_count flapping | — | **Cabinet overheating → URPS chain** |

### 4.2 Auto-Diagnosis Examples

The dashboard generates plain-English diagnosis cards:

**Example 1 — Blown fuse detected:**
```
VISION SYSTEM OFFLINE

Power:    F6 (VISION, 15A) = BLOWN
Voltage:  Vision rail = 0.0V (was 24.1V)
Current:  Vision circuit = 0.0A (was 3.2A)
Upstream: Main 24V bus = 24.1V ✓
Cabinet:  48.3°C ⚠ (approaching URPS threshold)

Diagnosis: Fuse F6 blew due to overcurrent.
Action:    Replace F6 (blue 15A, right panel row 1).
           Investigate why current exceeded 15A.
```

**Example 2 — Software crash (not electrical):**
```
APERA VISION NOT RESPONDING

Power:    F6 (VISION, 15A) = OK
Voltage:  Vision rail = 24.1V ✓
Current:  Vision circuit = 0.0A (was 3.2A) ⚠
Network:  192.168.3.151 ping = timeout
Cabinet:  34°C ✓

Diagnosis: Power is good but vision PC not drawing current.
           Internal PSU failure or software crash.
Action:    Power cycle vision PC via relay R2.
```

### 4.3 Predictive Capabilities

| Prediction | Data Source | Method |
|------------|------------|--------|
| Fuse about to blow | INA219 current trending | Current > 80% of fuse rating for sustained period |
| Alternator failing | J1939 alternator voltage trending | Declining charge spread over days/weeks |
| Battery dying | J1939 cranking voltage | Capture voltage dip at startup — declining = battery degrading |
| Motor bearing wear | Staubli torque + temp trending | Torque increasing at same position over weeks |
| Cabinet shutdown | DS18B20 cabinet temp trending | Temperature climbing toward URPS threshold |
| Connection degrading | DS18B20 junction temp trending | Hot spot developing at terminal block |
| Cable insulation risk | DS18B20 exhaust area temp | Cable run temp approaching insulation limit |
| Parasitic battery drain | J1939 battery voltage overnight | >0.3V/hr drop when everything is off |

---

## Part 5: Network Architecture

### 5.1 IP Address Map

| IP | Device | Network | Purpose |
|----|--------|---------|---------|
| 192.168.0.1 | StrideLinx VPN Router | Cell | Remote access gateway |
| 192.168.0.10 | JTEKT TOYOPUC PLC | Cell | Modbus TCP :502 |
| 192.168.0.20 | HMI CM5-T10W | Cell | Touch panel |
| 192.168.0.22 | Seedsware Panel | Cell | Serial bridge |
| 192.168.0.224 | Pi 5 (IronSight) | Cell | All monitoring |
| 192.168.0.254 | Staubli CS9 (J204) | Cell | Robot controller — dual-homed |
| 192.168.3.0 | Staubli CS9 (J205) | Vision | Bridge to Apera subnet |
| 192.168.3.151 | Apera Vue PC | Vision | Vision system |
| 172.22.{10-13}.x | Apera Cameras | Isolated | PoE camera subnets |

### 5.2 Staubli CS9 Access Points

| Port | Protocol | Credentials | Status |
|------|----------|-------------|--------|
| 21 | FTP | maintenance:spec_cal | **Working** — log scraping active |
| 80/443 | REST API | Not yet set | **Needs password set on pendant** |
| 5653 | SOAP | Session-based | Functional but session returns 0 |
| 5900 | VNC | None | Working — pendant screen |
| 14040 | Apera TCP | None (on Apera PC) | Working — vision pipeline |

### 5.3 Data Dumps (on Mac)

| Path | Size | Contents |
|------|------|----------|
| `/Users/andrewsieg/staubli_dump/` | 193 MB | Full FTP dump — 1297 files, configs, programs, logs |
| `/Users/andrewsieg/apera_dump/` | 14.1 GB | Full system dump — 1186 files, Docker, models, calibration |
| `/Users/andrewsieg/staubli-captures/` | 92 KB | Wireshark PCAP network captures |

---

## Part 6: Known Issues & Priorities

### Critical (Fix Now)

1. **REST API password not set** — CS9 HTTPS returns 401 on all REST endpoints. Set password on pendant (Settings > Network > Web Server). This unlocks real-time joint positions, velocities, torques, and I/O board status.

2. **URPS thermal shutdowns** — 10 events logged, worsening frequency. Root cause: command center cabinet has insufficient ventilation for all the equipment inside (2x Dell PCs, CS9 controller, inverter, power supplies). Add fans or ventilation before production.

### Important (This Month)

3. **Buy and install $45 hardware** — fuse monitors, voltage rails, current sensors, junction temps. One day of installation, then full electrical visibility.

4. **Set up unencrypted user page** — Enable `unencryptedAccess=true` in CS9 network.cfx for HTTP port 10101. Avoids TLS/auth complexity for Pi 5 polling.

### Maintenance Notes (from Photo Review)

5. **Corrosion on frame-to-bed terminal junction** (photos IMG_3093/3094) — road grime, needs cleaning and re-termination
6. **Bare/frayed wire end at terminal block** (IMG_3094) — unidentified wire, needs tracing
7. **Safety speed limits at maximum** — All set to 10,000 mm/s (no application tuning)
8. **Temperature monitoring bug in VAL3** — Hot threshold check unreachable due to condition ordering in tkMonitor_Temp

---

## Part 7: Implementation Timeline

| Phase | Scope | Time | Dependency |
|-------|-------|------|------------|
| **Done** | Software monitoring (33 temps, torques, I/O, logs, J1939 electrical) | Complete | — |
| **Week 1** | Set REST API password on pendant + enable user page | 30 min | Physical access to pendant |
| **Week 1** | Order hardware ($45 from Amazon) | 5 min | — |
| **Week 1** | Add cabinet ventilation fans | 2 hours | Physical access |
| **Week 2** | Install fuse optoisolators + MCP23017 | 2 hours | Parts arrived |
| **Week 2** | Install ADS1115 voltage dividers | 2 hours | Parts arrived |
| **Week 2** | Install INA219 inline current sensors | 1 hour | Parts arrived |
| **Week 2** | Install DS18B20 temperature chain | 30 min | Parts arrived |
| **Week 2** | Write electrical-monitor Viam module | 1 day | Hardware wired |
| **Week 2** | Build electrical dashboard panel | 1 day | Module working |
| **Week 3** | Add starter analysis + parasitic draw detection | Half day | J1939 data flowing |
| **Week 3** | Add predictive maintenance trending | 1 day | 1+ week of data history |

---

## Part 8: Repository & Code References

| File | Purpose |
|------|---------|
| `modules/j1939-sensor/src/models/pgn_decoder.py:151-166` | PGN 65271 — 5 electrical SPNs |
| `modules/j1939-sensor/src/models/j1939_fleet_metrics.py:234-260` | electrical_health scoring |
| `modules/j1939-sensor/tests/test_pgn_decoder.py:322-395` | 9 VEP decoder tests |
| `modules/cell-sensor/src/staubli_client.py:63-187` | StaubliState — 33 temps, torques, I/O board, I/O points |
| `modules/cell-sensor/src/staubli_client.py:480-539` | I/O point parsing from VAL3 collections |
| `modules/cell-sensor/src/staubli_log_scraper.py` | FTP log scraper (348 lines) |
| `modules/cell-sensor/tests/test_staubli_log_scraper.py` | 33 log scraper tests |
| `modules/cell-sensor/src/cell_sensor.py` | Cell sensor orchestrator with FTP integration |
| `dashboard/components/Cell/StaubliPanel.tsx` | Robot panel with temps, torques, I/O board, I/O points |
| `dashboard/components/Cell/CellWatchdog.tsx` | 25+ cross-system watchdog rules |
| `dashboard/components/Cell/CellTypes.ts` | TypeScript interfaces + temp thresholds |
| `dashboard/components/GaugeGrid.tsx` | J1939 electrical gauges section |
| `dashboard/app/api/cell-readings/route.ts` | Flat-to-nested transformer + sim data |
| `dashboard/app/electrical-mockup/page.tsx` | Hardware-enabled dashboard preview |
| `packages/shared/src/gauge-thresholds.ts` | Alternator voltage/current thresholds |
| `docs/electrical-monitoring-report.md` | This document |

---

## Part 9: Patents & Prior Art

B&B Metals holds 9 US patents (6 by William R. Coots, 3 by Coty T. Coots) covering tie plate distribution, sorting, orientation, and auxiliary drive systems. The RAIV 3 robotic cell with IronSight monitoring represents the next generation — adding AI-guided vision sorting and real-time fleet telemetry to the patent portfolio's mechanical innovation.

| Patent | Title | Relevance to Electrical Monitoring |
|--------|-------|------------------------------------|
| US9016208B2 | Tie Plate Separator | Electromagnetic gripper — monitored via Schunk EGM-50 I/O |
| US8166883B1 | Slide Rail for High-Rail Vehicle | Gravity feed + sensors — sensor power monitored via fuse/voltage |
| US8443733B2 | Sensor and Apparatus for Positioning | Detection sensors — camera signal monitored via PLC I/O |
| US9446662B2 | Auxiliary Drive System | Hydraulic PTO — monitored via J1939 PTO signals |

---

*This document is maintained alongside the codebase at `docs/electrical-monitoring-report.md` and should be updated as hardware is installed and new monitoring capabilities are added.*
