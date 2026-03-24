# Click PLC Register Map — TPS (Tie Plate System)

Extracted from Click PLC project file (.ckp) on 2026-03-23.
PLC: Click C0-10DD2E-D, CPU ID 209, Firmware v3.80.
478 named registers decoded from nickname table.

> **⚠️ CRITICAL: DD1 is NOT a cumulative distance counter.**
> The PLC resets DD1 every ~10 counts at 0.1ms scan rate. The Pi cannot
> sample fast enough to track it. Distance MUST come from DS10 (Encoder
> Next Tie countdown). See `docs/encoder-distance.md` for full explanation.

> **Note:** DS register labels below were corrected from the full 478-entry
> nickname table. The original extraction had an off-by-one error.
> Corrected labels: DS1=Encoder Ignore, DS2=Adj Tie Spacing (×0.5"),
> DS3=Tie Spacing (×0.1"), DS10=Encoder Next Tie (THE distance source).

## DS Registers (Signed Int 16-bit, Modbus Holding Registers 0-24)

| Register | Modbus Addr | Nickname | Description |
|----------|-------------|----------|-------------|
| DS1 | 0 | Encoder Ignore | Encoder ignore threshold (value: 1310) |
| DS2 | 1 | Adjustable Tie Spacing | ×0.5" units. 39 = **19.5"** (user-set spacing) |
| DS3 | 2 | Tie Spacing Inches | ×0.1" units. 195 = **19.5"** |
| DS4 | 3 | Tenths of Mile Laying | Distance traveled (0 when idle) |
| DS5 | 4 | Detector Offset Bits | Detector offset in encoder bits (1314) |
| DS6 | 5 | Detector Offset Inches | ×0.1" units. 6070 = **607.0"** (50.6 ft) |
| DS7 | 6 | Plate Count | PLC plate count |
| DS8 | 7 | AVG Plates per Min | PLC-computed plate rate |
| DS9 | 8 | Detector Next Tie | Distance to next detector drop (0.1" units) |
| **DS10** | **9** | **Encoder Next Tie** | **THE distance source. Counts down from DS3 to 0 in 0.1" units. See encoder-distance.md** |
| DS11 | 10 | 1st Detected Tie Distance | First detected tie position |
| DS12 | 11 | Detector Bits | Detector position in bit counts |
| DS13 | 12 | Last Detector Laid Inch | Last detector-triggered spacing |
| DS14 | 13 | 2nd Pass Double Lay | Double lay position |
| DS15 | 14 | Tie Team Skips | Ties skipped in tie team mode |
| DS16 | 15 | Tie Team Lays | Ties laid in tie team mode |
| DS17 | 16 | Skip Plus Lay Less 1 | Tie team calculation |
| DS18 | 17 | (unused) | |
| DS19 | 18 | HMI | HMI screen control |
| DS20-25 | 19-24 | (unused) | |

## DD Registers (Signed Int 32-bit, Double-word)

| Register | Modbus Addr | Nickname | Description |
|----------|-------------|----------|-------------|
| DD1 | 16384-16385 | HighSpeedCount1_Count | **Raw HSC encoder count. NOT usable for distance** — PLC resets every ~10 counts at 0.1ms. See encoder-distance.md |
| DD4 | 16390-16391 | Missed Ties | Missed tie count |
| DD6 | 16394-16395 | Camera | Camera signal tracking |
| DD8 | 16398-16399 | Double Lay Ties | Double lay tie count |
| DD12 | 16406-16407 | HMI HOME | HMI home screen register |

## CT/CTD Registers (Counter Discrete/Data)

| Register | Nickname | Description |
|----------|----------|-------------|
| CT1 / CTD1 | TPS_1 Counter / Center Count | Main TPS counter |
| CT2 / CTD2 | Next Tie Not Located / Rock Only Distance Current | Tie not found flag |
| CT3 / CTD3 | Travel Distance 0.5 / Travel Distance Current | 0.5" travel increment counter |
| CT4 / CTD4 | Detector Error / Detector Error Current | Detector error tracking |
| CT5 / CTD5 | Double Lay / Double Lay Counter | Double lay event counter |
| CT6 / CTD6 | Next Tie Positive Detect / Detector Tie Count | Detector tie count (logged) |
| CT7 | Detector Counter Master | Master counter for detector |
| CT8 / CTD8 | Button Counter Master / Button Tie Count | Button-triggered tie count (logged) |
| CT9 / CTD9 | EncoderDrop Count Master / Encoder Tie Count | Encoder-triggered tie count (logged) |
| CT10 / CTD10 | Detector Error Total / Detector Errors | Total detector errors (logged) |
| CT11 / CTD11 | Double Lay Drop Count / Double Lay Count | Double lay drop total (logged) |
| CT12 / CTD12 | TPS MODE / MODE COUNT | TPS operating mode |
| CT13 / CTD13 | Left Chute Counter / Left Count | Left chute plate count |
| CT14 / CTD14 | Right Chute Counter / Right Count | Right chute plate count |
| CT15 / CTD15 | Positive Rock Detection / Rock Travel Current | Rock detection tracking |
| CT16 / CTD16 | Detector Fail UseEncoder / Encoder Override | Fallback to encoder when detector fails |
| CT17 / CTD17 | EncoderMode Tie Spacing / Encoder Tie Current | Encoder mode spacing tracking |
| CT18 / CTD18 | Skipped Tie Counter / Skipped Tie Count | Skipped tie count |
| CT19 | Ties In BSR | Ties in bit shift register |
| CT20 | Detector Eject Distance | Distance to detector eject point |
| CT21 | Encoder Eject Distance | Distance to encoder eject point |
| CT22 | 1st Tie Detected | First tie detected flag |
| CT23 | Last Detector Drop | Last detector drop position |
| CT24 | Skip Ties | Tie skip command |
| CT25 | Lay Ties | Tie lay command |
| CT26 | _Always_ON | System always-on bit |

## TD Registers (Timer Data)

| Register | Nickname | Description |
|----------|----------|-------------|
| TD5 | Seconds Laying | Timer: seconds spent laying plates |
| TD6 | Tie Travel Current | Timer: current tie travel distance |

## Discrete Inputs (X1-X8)

| Input | Config | Description |
|-------|--------|-------------|
| X1 | 10 (High-speed counter) | Encoder A channel |
| X2 | 10 (High-speed counter) | Encoder B channel |
| X3 | 1 (Standard) | Plate flipper signal (labeled "Camera" in PLC project) — needle on bearing, detects plate orientation via 5-pin connector (blue/white wires) |
| X4 | 1 (Standard) | TPS power loop |
| X5 | 1 (Standard) | Air Eagle 1 feedback |
| X6 | 1 (Standard) | Air Eagle 2 feedback |
| X7 | 1 (Standard) | Air Eagle 3 enable |
| X8 | 1 (Standard) | (available) |

## Output Coils (Y1-Y6)

| Output | Description |
|--------|-------------|
| Y1 | Eject TPS 1 (center chute) |
| Y2 | Eject Left TPS 2 |
| Y3 | Eject Right TPS 2 |
| Y4-Y6 | (available) |

## Analog I/O

| Channel | Register | Config | Description |
|---------|----------|--------|-------------|
| AD1 | DF1 | 0-5V, scale 0.02442 | Analog input 1 |
| AD2 | DF2 | 0-5V, scale 0.02442 | Analog input 2 |
| DA1 | DF3 | 0-5V, scale 40.95 | Analog output 1 |
| DA2 | DF4 | 0-5V, scale 40.95 | Analog output 2 |

## High-Speed Counter Config (HSI0)

- **Mode**: Quadrature (Mode ID 2)
- **DD Address**: 4500 (DD1 at Modbus 16384)
- **Pulse Input Type**: 5 (A/B quadrature on X1/X2)
- **Input Register 1**: 49152 (X1)
- **Input Register 2**: 53253 (X2)
- **Count Mode**: 0 (up/down)
- **Reset Timing**: 0

## System Coils

| Coil | Nickname | Description |
|------|----------|-------------|
| SC1 | _1st_SCAN | First scan flag |
| SC2 | _Always_ON | Always on |
| SC335 | Encoder Ignore | Encoder ignore flag |

## Ladder Logic Rungs (19 rungs)

| Rung | Description |
|------|-------------|
| 0 | **REV 10** — 0.5" travel when DD1>10. DD1 reset when DD1 is negative and forward travel started |
| 1 | **Detector Offset** — DS5 selects which C:bit is used for triggering |
| 2 | **Tie Detection** — 2" of tie detection indicates positive identification |
| 3 | **Rock Detection** — 2" without tie detection indicates positive rock identification |
| 4 | **ENCODER Plate Drop INSTANT!** — Encoder drops plate every 19.5" (DS2 user defined). UNLESS detector tie is within 2" (4 bits) from detector eject MATH on Rung 9 |
| 5 | **Encoder Tie Skipped** — if detector tie is approaching |
| 6 | (math/logic) |
| 7 | **Looking for Ties** — Relay how far until the next plate will eject |
| 8 | (math/logic) |
| 9 | **Detector Tie Distance from Eject** — complex distance calculation |
| 10 | **User Interface Commands** |
| 11 | **Enable Drop** — drop enable logic |
| 12 | **TPS Mode** — CT13 setpoint == mode count variable array |
| 13 | **Triggering Plate Drops** |
| 14 | **Double Lay** — will drop next plate 9" later |
| 15 | **Counters** — plate/tie counting logic |
| 16 | **Data Logging** |
| 17 | **Tie Team Skip Sequence** |
| 18 | **HMI Screen Control** |

## Data Logging Fields

| Log # | Header | Register | Description |
|-------|--------|----------|-------------|
| 1 | Plate Count | DS7 | Total plates dropped |
| 2 | Plate Laying Time Min | TD5 | Minutes spent laying |
| 3 | Plate Laying Seconds | TD6 | Seconds spent laying |
| 4 | Plates Per Min/10 | DS8 | Plates per minute × 10 |
| 5 | Miles Laying/100 | DS4 | Miles traveled × 100 |
| 6 | Detector Errors | CTD11 | Total detector errors |
| 7 | Detector Tie Count | CTD8 | Ties detected by detector |
| 8 | Button Tie Count | CTD9 | Ties triggered by button |
| 9 | Encoder Tie Count | CTD10 | Ties triggered by encoder |
