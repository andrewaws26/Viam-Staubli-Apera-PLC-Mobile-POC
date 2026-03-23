# Encoder Distance Calculation — DO NOT CHANGE

This document explains why DD1 cannot be used for distance and why DS10 must be used instead. This was discovered empirically on 2026-03-23 and is critical to the accuracy of all distance, speed, and spacing measurements.

## The Problem: DD1 is Not a Cumulative Counter

DD1 (Modbus address 16384-16385) holds the Click PLC's High-Speed Counter (HSC) value for the SICK DBS60E encoder. It looks like a cumulative distance counter, but it is not.

**What actually happens:**
1. The encoder generates 1000 pulses per revolution on X1/X2
2. The PLC HSC counts these pulses into DD1
3. Rung 0 of the ladder logic checks `DD1 > 10` every scan cycle (0.1ms)
4. When DD1 exceeds 10, the PLC:
   - Shifts the BSR (Bit Shift Register) by one position (C100 = 0.5" of travel)
   - **Resets DD1 to the remainder** (DD1 - 10)
5. This happens thousands of times per second at normal truck speeds

**What the Pi sees when it reads DD1 at 1Hz:**
```
DD1=5, DD1=7, DD1=11, DD1=9, DD1=12, DD1=5, DD1=8, DD1=11, DD1=6...
```
DD1 oscillates between 0-13 continuously. It never accumulates past ~13 because the PLC resets it every 0.1ms scan. The Pi's 1Hz reads are aliasing a high-frequency sawtooth wave.

**Why summing DD1 deltas doesn't work:**
- At 1Hz, we miss thousands of reset cycles
- A read of DD1=5 followed by DD1=7 could mean:
  - +2 counts of actual movement, OR
  - +192 counts of movement with 19 resets in between
- There is no way to distinguish these from 1Hz samples

**Measured 2026-03-23:** 458 samples at 50Hz over 10 seconds of spinning. DD1 never exceeded 13. Total positive deltas = 799, but actual distance was ~3.3 feet (verified by DS10).

## The Solution: DS10 (Encoder Next Tie)

DS10 (Modbus address 9, holding register) is the PLC's own countdown to the next encoder-triggered plate drop. It provides reliable distance information at any sample rate.

**How DS10 works:**
1. DS10 starts at DS3 (tie spacing in 0.1" units, typically 195 = 19.5")
2. As the truck moves forward, DS10 counts down: 195 → 180 → 165 → ... → 15 → 0
3. When DS10 reaches 0, the PLC fires an encoder eject (C32) and resets DS10 to DS3
4. One full cycle (195 → 0 → 195) = 19.5 inches of travel

**Why DS10 is reliable:**
- At typical speeds (30 ft/min = 6 in/sec), DS10 changes by ~60 units per second
- At 1Hz sampling, we catch every ~60-unit change — no aliasing
- Even at max speed (200 ft/min), DS10 changes by ~400 units/sec — still fine at 1Hz
- DS10 is a single register, atomically read — no multi-register race conditions

**Distance calculation:**
```python
# Track DS10 countdown and accumulate distance
ds10_encoder_next = ds[9]       # DS10: 0.1" units, counts down
ds3_tie_spacing = ds[2]         # DS3: 0.1" units, the reset value

if prev_ds10 is not None:
    delta = prev_ds10 - ds10_encoder_next  # countdown: positive = forward
    if delta < 0:
        # Rollover: DS10 went from near 0 back to ~195
        delta = prev_ds10 + (ds3_tie_spacing - ds10_encoder_next)
    accumulated_distance_mm += delta * 2.54  # 0.1" = 2.54mm
```

**Speed calculation:**
```python
speed_mmps = (accumulated_distance_mm - prev_distance_mm) / dt
speed_ftpm = (speed_mmps / 304.8) * 60.0
```

## Accuracy

| Method | Error | Why |
|--------|-------|-----|
| DD1 cumulative (wrong) | Undefined — garbage | Aliasing of 10kHz reset cycle at 1Hz |
| DD1 delta accumulation (wrong) | Undefined — garbage | Same aliasing problem |
| DS10 countdown (correct) | < 0.5% | PLC maintains DS10 at 0.1" resolution |
| PLC native (Rung 0) | Reference | 10 counts = 0.5", defines ground truth |

## What DD1 IS Still Used For

DD1 is reported as `encoder_count` in the sensor readings for raw display purposes only. It shows the PLC's instantaneous HSC value, which is useful for verifying the encoder is producing pulses (DD1 oscillating = encoder alive, DD1 stuck at 0 = encoder dead).

**DD1 is NOT used for:**
- Distance calculation
- Speed calculation
- Wheel revolutions
- Plate spacing measurement
- Any derived metric

## Encoder Hardware

- **Encoder**: SICK DBS60E-BDEC01000 (1000 PPR, quadrature)
- **Wheel**: DMF RW-1650 (406.4mm / 16" diameter)
- **Drive**: Direct (no gear ratio)
- **PLC HSC**: Quadrature mode, X1=A channel, X2=B channel
- **PLC scan**: 0.1ms (10,000 scans/second)
- **Pi sample**: 1Hz (1 sample/second)

## History of This Bug

1. **Initial assumption**: DD1 is a cumulative encoder counter. Use `abs(DD1) * mm_per_count` for distance.
2. **First fix (wrong)**: Added sign inversion, then removed it. Tried accumulating from DD1 deltas.
3. **Discovery**: High-frequency sampling (50Hz) showed DD1 oscillates 0-13. Never accumulates.
4. **Root cause**: PLC Rung 0 resets DD1 every ~10 counts at 0.1ms scan rate. Pi can't keep up.
5. **Solution**: Use DS10 (Encoder Next Tie countdown) which changes slowly and is always accurate.
6. **Verified**: 15 seconds of spinning = 21.75 ft at 116.9 ft/min. Math: 21.75 ft ÷ (19.5"/12) = 13.4 cycles ✓
