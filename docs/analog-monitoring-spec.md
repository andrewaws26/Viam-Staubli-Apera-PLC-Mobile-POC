# Analog Monitoring Upgrade — Component-Level Diagnostics

Adds voltage and current sensing to the two unused Click PLC analog inputs (AD1, AD2) to enable fuse/wire/component-level fault diagnosis.

## What This Enables

| Without Analog | With Analog |
|----------------|-------------|
| "Camera lost — check power and cable" | "Camera power at 14V (should be 24V) — corroded connection at terminal X3, clean it" |
| "Eject fired but no confirmation" | "Solenoid current is 0A — blown fuse on Y1 output, replace fuse F3" |
| "Camera intermittent" | "Camera voltage dropping from 24V to 19V under load — undersized wire or bad splice, check run from junction box" |

### Fault Signatures With Analog Data

| DF1 (Camera Voltage) | DF2 (Solenoid Current) | Diagnosis |
|----------------------|----------------------|-----------|
| 24V, stable | Normal (0.5-1.5A when firing) | Everything healthy |
| 0V | — | Camera fuse blown or wire broken |
| 14-20V, stable | — | Corroded terminal or bad splice — high resistance in wire run |
| 24V → drops to 15V when camera fires | — | Wire gauge too small for camera, or shared circuit overloaded |
| Fluctuating 0-24V | — | Loose connection — vibration breaking contact |
| 24V, steady | 0A when Y1 fires | Y1 fuse blown, solenoid wire broken, or solenoid coil open |
| — | 0.2A (low) when Y1 fires | Solenoid coil partially shorted — valve will fail soon |
| — | 3A+ (high) when Y1 fires | Solenoid valve stuck mechanically — drawing overcurrent |
| — | Normal current, no Air Eagle | Air pressure low or wireless relay issue (not electrical) |

## Parts List

| Part | Qty | Purpose | Cost |
|------|-----|---------|------|
| Voltage divider resistors (10kΩ + 2kΩ, 1/4W) | 1 set | Scale 24V camera power to 0-4.0V for AD1 | $0.50 |
| ACS712 5A current sensor module | 1 | Measure Y1 solenoid current for AD2 | $5.00 |
| 22 AWG wire (red/black) | 10 ft | Connections | $2.00 |
| Ring terminals / ferrules | 8 | Clean connections to PLC terminals | $2.00 |
| **Total per truck** | | | **~$10** |

### Alternative: Two Voltage Dividers (Simpler)

If you want to monitor two voltage points instead of voltage + current:

| Part | Qty | Purpose | Cost |
|------|-----|---------|------|
| 10kΩ resistor (1/4W) | 2 | Voltage divider top | $0.20 |
| 2kΩ resistor (1/4W) | 2 | Voltage divider bottom | $0.20 |
| **Total per truck** | | | **~$3** |

AD1 = Camera power voltage, AD2 = Solenoid supply voltage. Simpler but no current measurement.

## Wiring — Option A: Voltage + Current (Recommended)

### AD1: Camera Power Voltage Monitor

Measures the 24VDC camera power circuit. Detects blown fuses, corroded connections, and voltage drops under load.

```
Camera 24V supply ──────┬────── To camera
                        │
                      [10kΩ]
                        │
                        ├────── AD1+ (Click PLC analog input 1)
                        │
                      [2kΩ]
                        │
                       GND ──── AD1- (Click PLC analog ground)
```

**Scaling:**
- 24V in → 24 × 2k/(10k+2k) = 4.0V at AD1
- 0V in → 0V at AD1
- Click AD1 configured for 0-5V range
- In software: `camera_voltage = DF1_raw × 6.0` (multiply AD1 reading by 6 to get actual voltage)

**Where to tap:**
- Tap the 24V AFTER the camera fuse (so a blown fuse reads 0V)
- Best location: terminal strip at the camera junction box, or the wire feeding X3's power
- Ground: connect to the PLC's analog ground (AG), NOT chassis ground

### AD2: Solenoid Current Monitor (ACS712)

Measures current flowing through the Y1 (Eject TPS-1) solenoid. Detects blown fuses, broken wires, weak coils, and stuck valves.

```
PLC Y1 output ──── ACS712 IN+ ────── ACS712 OUT+ ──── Solenoid valve
                                                        │
PLC COM ────────── ACS712 IN- ────── ACS712 OUT- ──── Solenoid COM

ACS712 VCC ──── 5V (from Click PLC 5V aux or separate supply)
ACS712 GND ──── GND (common with PLC analog ground)
ACS712 VOUT ──── AD2+ (Click PLC analog input 2)
PLC AG ──────── AD2- (Click PLC analog ground)
```

**ACS712 5A Module Specs:**
- Supply: 5V
- Output: 2.5V at 0A, ±185mV per amp
- At 1A (typical solenoid): 2.5V + 0.185V = 2.685V
- At 0A: 2.5V
- At 5A: 2.5V + 0.925V = 3.425V

**In software:** `solenoid_current_A = (DF2_raw - 2.5) / 0.185`

**Where to wire:**
- In series with the Y1 output to the solenoid valve
- The ACS712 module has screw terminals — insert the Y1 wire through it
- Mount the module in the PLC enclosure near the output terminals

## Click PLC Configuration

The AD1/AD2 channels are already configured in the PLC (from the CKP file):

```
AD1=DF1,5.0,0.0,100.0,0.0,1,0.02442,0
AD2=DF2,5.0,0.0,100.0,0.0,1,0.02442,0
```

This means:
- 0-5V input range
- Scaled 0.0-100.0 (percentage)
- Already reading into DF1 and DF2

**No PLC programming changes needed.** The analog inputs are already configured. Just wire the sensors and read DF1/DF2 via Modbus.

## Modbus Addresses

From the CKP decode:
- DF1: Holding register 32768 (2 registers, 32-bit float)
- DF2: Holding register 32770 (2 registers, 32-bit float)

These are already accessible — we tested HR 32768 during the address scan and got "available" but all zeros (because nothing is wired to AD1/AD2 yet).

## Software Changes (After Wiring)

### 1. plc_sensor.py — Read DF1/DF2

Add to the Modbus reads in `get_readings()`:

```python
# Read DF1/DF2 analog inputs (32-bit float at HR 32768)
camera_voltage = 0.0
solenoid_current = 0.0
try:
    df_result = self.client.read_holding_registers(address=32768, count=4)
    if not df_result.isError():
        import struct
        # DF1: camera voltage (scaled 0-100% of 5V input)
        df1_raw = struct.unpack('>f', struct.pack('>HH', df_result.registers[0], df_result.registers[1]))[0]
        camera_voltage = df1_raw * 6.0 / 100.0 * 5.0  # Convert % back to actual voltage

        # DF2: solenoid current (ACS712: 2.5V = 0A, 185mV/A)
        df2_raw = struct.unpack('>f', struct.pack('>HH', df_result.registers[2], df_result.registers[3]))[0]
        df2_volts = df2_raw / 100.0 * 5.0
        solenoid_current = (df2_volts - 2.5) / 0.185
except Exception:
    pass

# Add to readings dict:
readings["camera_voltage"] = round(camera_voltage, 1)
readings["solenoid_current_a"] = round(max(0, solenoid_current), 2)
```

### 2. diagnostics.py — Add Analog Rules

```python
def _check_analog(readings):
    diags = []
    v = readings.get("camera_voltage", -1)
    if v < 0:
        return diags  # Analog not wired yet

    if v == 0:
        diags.append({
            "rule": "camera_fuse_blown",
            "severity": "critical",
            "title": "Camera fuse blown or wire broken",
            "action": "1. Check the camera fuse — replace if blown. "
                     "2. If fuse is good, check for a broken wire between the fuse and camera. "
                     "3. Use a multimeter to verify 24V at the camera connector.",
            "category": "camera",
            "evidence": f"Camera voltage: {v}V (should be ~24V)",
        })
    elif v < 20:
        diags.append({
            "rule": "camera_voltage_low",
            "severity": "warning",
            "title": f"Camera voltage low ({v:.0f}V) — corroded connection",
            "action": "1. Clean the terminal connections at the camera junction box. "
                     "2. Check for corroded or green-colored wire ends — cut back and re-strip. "
                     "3. Check the wire splice if there is one in the run.",
            "category": "camera",
            "evidence": f"Camera voltage: {v:.1f}V (normal: 23-25V)",
        })

    amps = readings.get("solenoid_current_a", -1)
    if amps < 0:
        return diags  # Current sensor not wired

    y1 = readings.get("eject_tps_1", False)
    if y1 and amps < 0.1:
        diags.append({
            "rule": "solenoid_fuse_blown",
            "severity": "critical",
            "title": "Solenoid fuse blown or wire broken",
            "action": "1. Check the Y1 output fuse — replace if blown. "
                     "2. Check the wire from Y1 to the solenoid valve. "
                     "3. If wires and fuse are good, the solenoid coil may be open — "
                     "measure resistance across coil (should be 10-50 ohms).",
            "category": "eject",
            "evidence": f"Y1 is ON but solenoid current is {amps:.2f}A (should be 0.5-1.5A)",
        })
    elif y1 and amps < 0.3:
        diags.append({
            "rule": "solenoid_weak",
            "severity": "warning",
            "title": f"Solenoid current low ({amps:.1f}A) — coil degrading",
            "action": "1. The solenoid valve may be failing — plan to replace it soon. "
                     "2. Check wire connections for corrosion. "
                     "3. Measure coil resistance (should be 10-50 ohms, high = degraded).",
            "category": "eject",
            "evidence": f"Current: {amps:.2f}A (normal: 0.5-1.5A)",
        })
    elif y1 and amps > 3.0:
        diags.append({
            "rule": "solenoid_stuck",
            "severity": "warning",
            "title": f"Solenoid overcurrent ({amps:.1f}A) — valve may be stuck",
            "action": "1. Check the solenoid valve for mechanical binding. "
                     "2. Check for debris in the valve. "
                     "3. If overcurrent persists, the valve needs replacement.",
            "category": "eject",
            "evidence": f"Current: {amps:.2f}A (normal: 0.5-1.5A, high = mechanical resistance)",
        })

    return diags
```

### 3. Dashboard — Add to PlcDetailPanel

Add camera voltage and solenoid current to the display:

```typescript
{ key: "camera_voltage", label: "Camera Voltage", unit: "V" },
{ key: "solenoid_current_a", label: "Solenoid Current", unit: "A" },
```

## Installation Procedure

### Time: ~30 minutes per truck

1. **Power off the PLC** (main breaker)

2. **AD1 — Camera Voltage:**
   - Locate the 24V wire feeding the camera (after the camera fuse)
   - Solder or crimp a 10kΩ resistor to a short wire, connect to the 24V tap point
   - Connect a 2kΩ resistor from the other end of the 10kΩ to the PLC's AG (analog ground)
   - Connect the junction of the two resistors to AD1+ terminal on the PLC
   - Connect AG to AD1- terminal

3. **AD2 — Solenoid Current:**
   - Mount the ACS712 module inside the PLC enclosure (double-sided tape or standoff)
   - Break the Y1 output wire to the solenoid valve
   - Route through the ACS712 screw terminals (IN+ from Y1, OUT+ to solenoid)
   - Connect ACS712 VCC to 5V (Click PLC has a 5V aux output on the power terminal)
   - Connect ACS712 GND to PLC AG
   - Connect ACS712 VOUT to AD2+
   - Connect PLC AG to AD2-

4. **Power on and verify:**
   - AD1 should read ~4.0V (showing as ~80% in DF1) with camera powered
   - AD2 should read ~2.5V (showing as ~50% in DF2) at idle (0 amps)
   - Fire a test eject — AD2 should spike briefly

5. **Update plc_sensor.py** with the DF1/DF2 reads (code above)

## Future Expansion

With Y4-Y6 unused and AD1/AD2 now taken, further monitoring would need:
- Click expansion module (C0-08AD) for 8 more analog inputs ($150)
- Could then monitor: individual Air Eagle battery voltages, air pressure (add pressure transducer), camera signal quality (analog instead of digital), ambient temperature

But the two analog inputs cover the two highest-value failure points. Start here.
