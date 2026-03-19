# Encoder Setup Guide — SICK DBS60E-BDEC01000 on Click PLC

**Encoder:** SICK DBS60E-BDEC01000 (1000 PPR, HTL push-pull, M12 8-pin)
**PLC:** Click C0-10DD2E-D
**Path:** Encoder → M12 cable → ZipLink ZL-RTB20-1 → Click PLC → Modbus TCP → Pi 5

> **Why this encoder?** The DBS60E measures distance traveled along the track.
> The Pi 5 converts raw pulse counts into distance and uses it to trigger
> tie plate placement at the correct intervals.

---

## 1 — Encoder specs (from datasheet)

| Parameter | Value |
|-----------|-------|
| Pulses per revolution | 1,000 |
| Signal channels | 6 (A, A-, B, B-, Z, Z-) |
| Output type | HTL / Push-pull |
| Supply voltage | 10 … 27 V DC |
| Output frequency | 300 kHz (450 kHz on request) |
| Load current | ≤ 30 mA per channel |
| Power consumption | ≤ 1 W (no load) |
| Operating speed | 6,000 RPM max |
| Shaft | Blind hollow, 10 mm |
| Enclosure | IP67 housing / IP65 shaft side |
| Operating temp | -20°C … +85°C |

---

## 2 — M12 8-pin connector pinout (confirmed from datasheet)

View from the **male device connector** on the encoder:

**SICK datasheet wire colors (SICK-branded cables):**

| Pin | SICK Color | Signal | Description |
|-----|-----------|--------|-------------|
| 1 | Brown | A- | Inverted channel A (differential — not used) |
| 2 | White | **A** | Channel A — primary counting signal |
| 3 | Black | B- | Inverted channel B (differential — not used) |
| 4 | Pink | **B** | Channel B — quadrature / direction |
| 5 | Yellow | Z- | Inverted index (differential — not used) |
| 6 | Purple | **Z** | Index pulse — 1 per revolution |
| 7 | Blue | **GND** | Ground (0V) |
| 8 | Red | **+Us** | Supply voltage (24V) |

**Our actual cable — confirmed working (4 wires used):**

| Wire Color | Signal | Connect to |
|-----------|--------|------------|
| **Yellow** | **A** (Channel A) | **ZipLink X1** (HSC1 Phase A) |
| **Brown** | **B** (Channel B) | **ZipLink X2** (HSC1 Phase B) |
| **Red** | **+Us** (24V supply) | **Battery +24V** |
| **Blue** | **GND** (0V) | **Battery 0V** |
| White | Not used | Tape/heat-shrink end |
| Pink | Not used | Tape/heat-shrink end |
| Green | Not used | Tape/heat-shrink end |
| Gray | Not used | Tape/heat-shrink end |

> Wire colors confirmed against a production encoder installation.
> No Z (index) pulse is used — distance is tracked from cumulative A/B counts.
> No inverted signals needed — Click PLC uses single-ended 24V DC inputs.

---

## 3 — Input reassignment (required for high-speed counting)

The Click C0-10DD2E-D's high-speed counter (HSC) uses inputs **X1** and
**X2**. These are currently wired to the servo power button and e-stop.

**Before (current wiring):**

| Input | Connected to |
|-------|-------------|
| X1 | Servo power button (Fuji AR22F0L NO contact) |
| X2 | E-stop button (NC contact) |
| X3–X6 | Available |

**After (production wiring):**

| Input | Connected to | Purpose |
|-------|-------------|---------|
| **X1** | Encoder Channel A (Yellow wire) | HSC1 Phase A — pulse counting |
| **X2** | Encoder Channel B (Brown wire) | HSC1 Phase B — direction |
| **X3** | Available for future use | — |
| X4 | Available for future use | — |
| **X5** | Servo power button (moved from X1) | Same function, new input |
| **X6** | E-stop button (moved from X2) | Same function, new input |

### 3.1 Physical rewiring on the ZipLink

On the ZipLink ZL-RTB20-1 terminal block:

1. **Move** the servo button wire from terminal **X1** to terminal **X5**
2. **Move** the e-stop button wire from terminal **X2** to terminal **X6**
3. **Wire C2** (input common for X5/X6) to **battery 0V** — required for X5/X6 to work
4. **Connect** encoder **Yellow** wire (A) to terminal **X1**
5. **Connect** encoder **Brown** wire (B) to terminal **X2**
6. **Connect** encoder **Red** wire (+Us) to **battery +24V**
7. **Connect** encoder **Blue** wire (GND) to **battery 0V**
8. **Leave disconnected:** White, Pink, Green, Gray — tape/heat-shrink the ends

### 3.2 Ladder logic changes for button reassignment

Every rung that references X1 or X2 in the existing ladder logic must be
updated to X5 or X6 respectively. The affected rungs from the original
program (see click-plc-setup-guide.md §5.3):

| Rung | Old reference | New reference |
|------|--------------|---------------|
| 1 | RE X001 | RE X005 |
| 4 | NC X002 | NC X006 |
| 8 | NO X002 | NO X006 |
| 9 | NO X002 | NO X006 |
| 13a | NC X002 | NC X006 |
| 13b | NO X002 | NO X006 |
| 14a | NO X002 | NO X006 |
| 14b | NC X002 | NC X006 |
| 15b | NO X002 | NO X006 |
| 15a | NC X002 | NC X006 |

> All other rungs reference Y1, C1, C100, or DS registers — no changes needed.

---

## 4 — Wiring diagram

```
  SICK DBS60E-BDEC01000        M12 8-pin cable        ZipLink ZL-RTB20-1
  ┌──────────────────┐       (confirmed colors)       ┌──────────────────────────┐
  │                  │                                │                          │
  │  Red             ├──── +Us (24V) ───────────────►│ Battery +24V             │
  │  Blue            ├──── GND ─────────────────────►│ Battery 0V               │
  │                  │                                │                          │
  │  Yellow          ├──── A signal ────────────────►│ X1 (HSC1 Phase A)        │
  │  Brown           ├──── B signal ────────────────►│ X2 (HSC1 Phase B)        │
  │                  │                                │                          │
  │  White           ├──── (not used)                │ X5 ◄── Servo button      │
  │  Pink            ├──── (not used)                │ X6 ◄── E-stop button     │
  │  Green           ├──── (not used)                │ C2 ◄── Battery 0V        │
  │  Gray            ├──── (not used)                │                          │
  └──────────────────┘                                └──────────────────────────┘
                                                            │ ribbon cable
                                                            ▼
                                                      Click PLC C0-10DD2E-D
                                                      ┌──────────────────────────┐
                                                      │ X1 = HSC1-A (encoder A)  │
                                                      │ X2 = HSC1-B (encoder B)  │
                                                      │ X3 = index pulse (Z)     │
                                                      │ X5 = servo power button  │
                                                      │ X6 = e-stop button       │
                                                      │                          │
                                                      │ Modbus TCP (Ethernet)    │
                                                      │        │                 │
                                                      └────────┼─────────────────┘
                                                               │
                                                        Netgear switch
                                                               │
                                                        Pi 5 (Viam)
```

---

## 5 — PLC high-speed counter configuration

### 5.1 HSC1 setup in Click Programming Software

1. Open your existing project in Click Programming Software
2. Go to **Setup → High Speed Counter** (or **Counter Setup** in the menu)
3. Configure HSC1:
   - **Mode:** Quadrature (A/B phase)
   - **Phase A input:** X1
   - **Phase B input:** X2
   - **Count direction:** A leads B = forward (CW viewed from encoder shaft)
   - **Counter register:** CT1 (32-bit, automatically assigned)
   - **Counting mode:** Continuous (no preset/reset — the Pi handles distance logic)
4. Click **OK** to save the HSC configuration

### 5.2 New ladder logic rungs for encoder

Add these rungs **after** the existing program (after rung 16b):

| # | Label | Contacts | Output |
|---|-------|----------|--------|
| 17 | Copy HSC low word | (always true) | MOV CT1.LO → DS201 |
| 18 | Copy HSC high word | (always true) | MOV CT1.HI → DS202 |
| 19 | Copy direction | (always true) | MOV SC1.DIR → DS203 |

> **Note on Click PLC CT registers:** CT1 is a 32-bit counter. To make it
> accessible via Modbus, we copy the low and high 16-bit words into DS201
> and DS202 respectively. The exact Copy/MOV syntax may vary by Click
> software version — consult the Click PLC instruction help for "Copy 32-bit"
> or "DWORD to WORD" operations.
>
> **No Z (index) pulse is used.** Distance is tracked from cumulative A/B
> quadrature counts. DS204 is unused.

### 5.3 Encoder register map

| DS Register | Modbus addr | Key in plc-sensor | Description |
|-------------|-------------|-------------------|-------------|
| DS201 | 200 | encoder_count_lo | Low 16 bits of 32-bit pulse count |
| DS202 | 201 | encoder_count_hi | High 16 bits (signed for bidirectional) |
| DS203 | 202 | encoder_direction | 0 = forward, 1 = reverse |
| DS204 | 203 | encoder_index_count | Number of Z (index) pulses seen |

> The Pi-side `plc_sensor.py` module combines the two 16-bit registers into
> a 32-bit signed count, then computes distance and speed in software using
> the configured wheel diameter.

---

## 6 — Distance calculation

The encoder mounts on a wheel that rolls along the track. The distance
per encoder count depends on the wheel diameter:

```
distance_per_count = (pi * wheel_diameter_mm) / (PPR * 4)
```

- **PPR** = 1000 (pulses per revolution)
- **× 4** = quadrature decoding (counts all edges of A and B)
- **4000 counts per revolution** in quadrature mode

Example with a 6-inch (152.4 mm) measuring wheel:

```
circumference = pi * 152.4 = 478.8 mm
distance_per_count = 478.8 / 4000 = 0.1197 mm per count
```

At 4000 counts/rev, one revolution = 478.8 mm ≈ 18.85 inches.

The wheel diameter is configured in the Viam component attributes
(`wheel_diameter_mm` in `viam-server.json`). Change it to match your
actual measuring wheel.

---

## 7 — Cable selection

The encoder has a male M12 8-pin connector. You need a **female M12 8-pin
to flying leads** cable. Recommended SICK cables:

| Part Number | Length | Type |
|-------------|--------|------|
| DOL-1208-G02MAC1 (6032866) | 2 m | Straight, PUR, shielded |
| DOL-1208-G05MAC1 (6032867) | 5 m | Straight, PUR, shielded |
| DOL-1208-G10MAC1 (6032868) | 10 m | Straight, PUR, shielded |
| DOL-1208-W02MAC1 (6037724) | 2 m | Angled, PUR, shielded |

> For the railroad environment, use a **shielded PUR** cable. PUR is oil/UV
> resistant and rated for drag chain operation. The shield connects to the
> encoder housing and should be grounded at one end only (at the PLC/cabinet
> side) to avoid ground loops.

---

## 8 — Verification checklist

After wiring is complete:

- [ ] Multimeter: 24V between encoder Red and Blue wires at the ZipLink
- [ ] Click Programming Software: X1 LED toggles when encoder shaft is rotated slowly by hand
- [ ] Click Programming Software: X2 LED toggles (90° offset from X1)
- [ ] Click Programming Software: X3 LED pulses once per revolution
- [ ] HSC1 counter value in CT1 increases when shaft rotates clockwise
- [ ] HSC1 counter value decreases when shaft rotates counter-clockwise
- [ ] DS201/DS202 update in Data View (Modbus registers 200/201)
- [ ] Servo button still works on X5 (test toggle in Data View)
- [ ] E-stop still works on X6 (test activation in Data View)
- [ ] Pi 5 Modbus read of registers 200-203 returns non-zero values when encoder moves
- [ ] Dashboard shows encoder distance updating in real time
- [ ] Viam Data tab shows encoder readings being captured
