"""
Reusable system health collector for Viam sensor modules.
Returns CPU, memory, disk, WiFi, Tailscale, and temperature info
as a flat dict suitable for merging into get_readings() output.
"""

import os
import subprocess


def get_system_health() -> dict:
    """Collect system health metrics. Safe to call frequently (no heavy I/O)."""
    health = {}

    # CPU temperature
    try:
        with open("/sys/class/thermal/thermal_zone0/temp") as f:
            health["cpu_temp_c"] = round(int(f.read().strip()) / 1000.0, 1)
    except Exception:
        health["cpu_temp_c"] = None

    # CPU usage (from /proc/stat — single sample, fast)
    try:
        with open("/proc/loadavg") as f:
            parts = f.read().split()
            health["load_1m"] = float(parts[0])
            health["load_5m"] = float(parts[1])
        # Estimate CPU usage from load average vs CPU count
        cpu_count = os.cpu_count() or 1
        health["cpu_usage_pct"] = round(min(100.0, (health["load_1m"] / cpu_count) * 100), 1)
    except Exception:
        health["cpu_usage_pct"] = None
        health["load_1m"] = None
        health["load_5m"] = None

    # Memory
    try:
        with open("/proc/meminfo") as f:
            meminfo = {}
            for line in f:
                parts = line.split(":")
                if len(parts) == 2:
                    key = parts[0].strip()
                    val = parts[1].strip().split()[0]  # value in kB
                    meminfo[key] = int(val)
            total = meminfo.get("MemTotal", 0)
            available = meminfo.get("MemAvailable", 0)
            used = total - available
            health["memory_total_mb"] = round(total / 1024, 0)
            health["memory_used_mb"] = round(used / 1024, 0)
            health["memory_used_pct"] = round((used / total * 100) if total > 0 else 0, 1)
    except Exception:
        health["memory_total_mb"] = None
        health["memory_used_mb"] = None
        health["memory_used_pct"] = None

    # Disk
    try:
        st = os.statvfs("/")
        total = st.f_blocks * st.f_frsize
        free = st.f_bavail * st.f_frsize
        used = total - free
        health["disk_used_pct"] = round((used / total * 100) if total > 0 else 0, 1)
        health["disk_free_gb"] = round(free / (1024 ** 3), 1)
    except Exception:
        health["disk_used_pct"] = None
        health["disk_free_gb"] = None

    # WiFi
    try:
        result = subprocess.run(
            ["nmcli", "-t", "-f", "ACTIVE,SSID,SIGNAL", "dev", "wifi"],
            capture_output=True, text=True, timeout=5
        )
        for line in result.stdout.strip().split("\n"):
            parts = line.split(":")
            if len(parts) >= 3 and parts[0] == "yes":
                health["wifi_ssid"] = parts[1]
                health["wifi_signal_pct"] = int(parts[2])
                # Rough conversion: signal% to dBm
                health["wifi_signal_dbm"] = int(parts[2]) * -0.5 - 25
                break
        if "wifi_ssid" not in health:
            health["wifi_ssid"] = None
            health["wifi_signal_dbm"] = None
    except Exception:
        health["wifi_ssid"] = None
        health["wifi_signal_dbm"] = None

    # Tailscale
    try:
        result = subprocess.run(
            ["tailscale", "ip", "-4"],
            capture_output=True, text=True, timeout=5
        )
        ip = result.stdout.strip()
        health["tailscale_ip"] = ip if ip else None
        health["tailscale_online"] = bool(ip)
    except Exception:
        health["tailscale_ip"] = None
        health["tailscale_online"] = False

    # Internet connectivity (quick check)
    try:
        result = subprocess.run(
            ["ping", "-c", "1", "-W", "2", "1.1.1.1"],
            capture_output=True, timeout=5
        )
        health["internet"] = result.returncode == 0
    except Exception:
        health["internet"] = False

    # Uptime
    try:
        with open("/proc/uptime") as f:
            health["uptime_seconds"] = round(float(f.read().split()[0]), 0)
    except Exception:
        health["uptime_seconds"] = None

    # Viam data capture sync status
    try:
        import time as _time
        capture_dir = os.path.expanduser("~/.viam/capture")
        failed_dir = os.path.join(capture_dir, "failed")
        pending_count = 0
        pending_bytes = 0
        oldest_ts = None
        now = _time.time()

        if os.path.isdir(capture_dir):
            for root, _dirs, files in os.walk(capture_dir):
                # Skip the failed subdirectory
                if root.startswith(failed_dir):
                    continue
                for f in files:
                    if f.endswith(".prog") or f.endswith(".capture"):
                        pending_count += 1
                        fpath = os.path.join(root, f)
                        try:
                            st = os.stat(fpath)
                            pending_bytes += st.st_size
                            if oldest_ts is None or st.st_mtime < oldest_ts:
                                oldest_ts = st.st_mtime
                        except OSError:
                            pass

        failed_count = 0
        if os.path.isdir(failed_dir):
            for root, _dirs, files in os.walk(failed_dir):
                failed_count += len(files)

        health["sync_pending_files"] = pending_count
        health["sync_pending_mb"] = round(pending_bytes / (1024 * 1024), 2)
        health["sync_oldest_age_min"] = (
            round((now - oldest_ts) / 60, 1) if oldest_ts else 0
        )
        health["sync_failed_files"] = failed_count
        health["sync_ok"] = pending_count < 10 and (
            oldest_ts is None or (now - oldest_ts) < 300
        )
    except Exception:
        health["sync_pending_files"] = None
        health["sync_ok"] = None

    return health
