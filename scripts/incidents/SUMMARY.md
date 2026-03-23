# IronSight Incident Knowledge Base

Consolidated from 483 individual incident files (2026-03-20 to 2026-03-22).
This file replaces reading all individual incidents — it contains everything learned.

---

## Problem 1: eth0 NO-CARRIER (Physical Link Down)
**Occurrences**: ~450 alerts (but really ONE event: PLC powered off at end of day)
**Root cause**: Ethernet cable disconnected or PLC powered off. Kernel shows NO-CARRIER on eth0. No IP assigned, no route to 169.168.10.0/24.
**Symptoms**: PLC unreachable, no capture data, high error rate in viam-server logs (plc_sensor retrying every 2s)
**Fix**: NONE — physical layer, requires human intervention. plc_sensor auto-reconnects when link returns.
**What NOT to do**: Do NOT restart viam-server. It doesn't help and causes startup transient errors that trigger more watchdog alerts.
**Prevention**: Auto-discovery (plc-autodiscover.py) now handles reconnection when link returns. Watchdog suppresses alerts after 2 consecutive identical failures.
**Lesson**: Need alert deduplication — 450 alerts for one event is useless noise.

---

## Problem 2: viam-server Cloud Connection Stuck
**Occurrences**: 5 times on 2026-03-20
**Root cause**: Go's gRPC client caches DNS/connection state. When Verizon WiFi DNS (192.168.0.1) returns "server misbehaving" or has extreme latency (1-3s RTT), the gRPC session enters exponential backoff and never recovers — even after DNS starts working again.
**Symptoms**: Local capture continues fine, PLC connected, internet working (ping succeeds), but cloud sync stuck. Errors: "error reading server preface: EOF", "authentication handshake failed: not connected", "DeadlineExceeded"
**Fix**: `sudo systemctl restart viam-server` — always works, recovers in <5 seconds
**What works**: Restart resolves it every time. Cloud reconnects within 4 seconds.
**Prevention ideas**:
  - Monitor for "DeadlineExceeded: not connected" sustained >2min → auto-restart
  - Use 8.8.8.8 as DNS instead of Verizon router
  - Add a secondary DNS in resolv.conf
**Lesson**: Verizon WiFi at this location has terrible latency (66% packet loss, 1-3s RTT). B&B Shop WiFi is much more reliable. The WiFi priority system (B&B=30, Verizon=20) should prevent this when B&B is available.

---

## Problem 3: Startup Transient False Alarms
**Occurrences**: ~10 times
**Root cause**: After viam-server restarts, the first 60-90 seconds have harmless errors: WebRTC signaling not ready, NetAppender not connected, data_manager race condition. The watchdog's 5-minute window catches these if viam-server restarted within that window.
**Symptoms**: 20-50 errors in logs, but all from the first 90 seconds. System is healthy by alert time.
**Fix**: None needed — these are false alarms.
**Prevention**: 3-minute grace period already in watchdog.sh (GRACE_PERIOD=180). Could increase to 5 minutes.
**Lesson**: Always check viam-server uptime before acting. If uptime <3min, ignore errors.

---

## Problem 4: viam-server Panic/Crash
**Occurrences**: 1 time (2026-03-20 ~12:17)
**Root cause**: Go panic in PanicCapturingGoWithCallback (goroutine 773), likely during data capture. Rare, possibly a race condition in viam-server internals.
**Symptoms**: systemd auto-restarted viam-server. New PID connected to PLC within 3 seconds.
**Fix**: None needed — systemd auto-recovery worked perfectly.
**Lesson**: systemd restart-on-failure is critical. The system self-healed.

---

## Problem 5: OverflowError in plc_sensor Backoff
**Occurrences**: Discovered during the 18-hour eth0 outage
**Root cause**: In plc_sensor.py `_on_connection_failure()`, the backoff calculation `2 ** (failures - 1)` overflows Python's float when failures reaches ~1024. `int too large to convert to float` error.
**Symptoms**: OverflowError logged every 2 seconds. Data manager can't get readings.
**Fix**: Pushed to branch `watchdog/fix-backoff-overflow` — caps the exponent at 5 (max 32s backoff). Awaiting review.
**Lesson**: Any exponential backoff needs a cap on the exponent, not just the result.

---

## System Behavior Patterns

### Normal Startup Sequence (after restart)
1. viam-server starts, robot constructed in 300-500ms
2. PLC module connects within 1-3 seconds
3. Cloud connection established in 3-5 seconds
4. WebRTC peer connection in 30-90 seconds
5. First capture data flows at 1Hz
6. Errors in first 60-90 seconds are NORMAL

### Network Priority (what works)
1. B&B Shop WiFi (priority 30) — most reliable, low latency
2. Verizon_X6JPH6 (priority 20) — high latency, packet loss, DNS issues
3. iPhone USB tethering (priority 25) — reliable backup
4. Andrew hotspot (priority 10) — last resort

### PLC Connection Characteristics
- PLC IP: 169.168.10.21 (static)
- Modbus TCP port 502
- Latency: 0.17ms when connected
- plc_sensor reconnects automatically on disconnect
- Backoff: 1s → 2s → 4s → ... → 30s max

### Data Pipeline Health Indicators
- `.prog` file growing = capture is working
- `.prog` file >100 bytes = real data (not just header)
- Plate drop logs ("📍") = PLC reads working AND production active
- Cloud sync happens every 6 seconds when connected

---

## What Has Never Been a Problem
- Disk space (consistently <10%)
- Memory usage (~14%)
- CPU temperature (~53°C)
- Tailscale connectivity
- plc_sensor module crashes (never happened)
- Offline buffer system (works perfectly)
- PLC register reads (zero Modbus errors when connected)

---

## Pending Items
- OverflowError fix on `watchdog/fix-backoff-overflow` — needs review
- PLC auto-discovery on `feature/plc-autodiscover` — needs review
- DS register labels still generic (need Click ladder logic)
- Encoder calibration from 3 hand revolutions only (need field measurement)
