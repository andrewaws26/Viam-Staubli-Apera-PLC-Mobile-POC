#!/usr/bin/env python3
"""
TPS Pi Health Check — lightweight HTTP health endpoint for fleet monitoring.

Runs on each Pi alongside viam-server.  Returns a JSON report of:
  - viam-server process status
  - PLC Modbus TCP connectivity
  - Disk usage (capture + offline buffer directories)
  - Module uptime and system info

Usage:
    python3 scripts/health-check.py                    # default port 8081
    python3 scripts/health-check.py --port 8081        # custom port
    python3 scripts/health-check.py --plc-host 192.168.0.10

Endpoints:
    GET /health      — full health report (200 if all OK, 503 if any check fails)
    GET /health/plc  — PLC connectivity only
    GET /health/disk — disk usage only

Install as systemd service:
    sudo cp config/tps-health-check.service /etc/systemd/system/
    sudo systemctl enable --now tps-health-check
"""

import argparse
import json
import os
import shutil
import subprocess
import time
from http.server import HTTPServer, BaseHTTPRequestHandler
from typing import Any, Dict


def check_viam_server() -> Dict[str, Any]:
    """Check if viam-server process is running."""
    try:
        result = subprocess.run(
            ["systemctl", "is-active", "viam-server"],
            capture_output=True, text=True, timeout=5,
        )
        active = result.stdout.strip() == "active"
        return {"ok": active, "status": result.stdout.strip()}
    except Exception as e:
        return {"ok": False, "status": "check_failed", "error": str(e)}


def check_plc(host: str, port: int) -> Dict[str, Any]:
    """Check PLC Modbus TCP connectivity with a register read."""
    try:
        from pymodbus.client import ModbusTcpClient
        client = ModbusTcpClient(host, port=port, timeout=3)
        if not client.connect():
            return {"ok": False, "host": host, "port": port, "error": "connection_refused"}
        # Try reading a single register to verify Modbus is responsive
        result = client.read_holding_registers(address=0, count=1)
        client.close()
        if result.isError():
            return {"ok": False, "host": host, "port": port, "error": "read_error"}
        return {"ok": True, "host": host, "port": port, "register_0": result.registers[0]}
    except ImportError:
        return {"ok": False, "error": "pymodbus not installed"}
    except Exception as e:
        return {"ok": False, "host": host, "port": port, "error": str(e)}


def check_disk() -> Dict[str, Any]:
    """Check disk usage for capture and buffer directories."""
    checks = {}
    for label, path in [
        ("root", "/"),
        ("capture", "/home/pi/.viam/capture"),
        ("offline_buffer", "/home/pi/.viam/offline-buffer"),
    ]:
        try:
            usage = shutil.disk_usage(path if os.path.exists(path) else "/")
            pct = round((usage.used / usage.total) * 100, 1)
            checks[label] = {
                "ok": pct < 90.0,
                "used_pct": pct,
                "free_gb": round(usage.free / (1024**3), 2),
                "total_gb": round(usage.total / (1024**3), 2),
            }
        except Exception as e:
            checks[label] = {"ok": False, "error": str(e)}

    # Count offline buffer files
    buf_dir = "/home/pi/.viam/offline-buffer"
    if os.path.isdir(buf_dir):
        files = [f for f in os.listdir(buf_dir) if f.endswith(".jsonl")]
        total_bytes = sum(os.path.getsize(os.path.join(buf_dir, f)) for f in files)
        checks["buffer_files"] = len(files)
        checks["buffer_size_mb"] = round(total_bytes / (1024 * 1024), 2)

    all_ok = all(v.get("ok", True) for v in checks.values() if isinstance(v, dict))
    return {"ok": all_ok, **checks}


def check_system() -> Dict[str, Any]:
    """Basic system info for fleet identification."""
    info: Dict[str, Any] = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "uptime_seconds": 0,
    }
    try:
        with open("/proc/uptime") as f:
            info["uptime_seconds"] = int(float(f.read().split()[0]))
    except Exception:
        pass
    try:
        info["hostname"] = os.uname().nodename
    except Exception:
        pass
    return info


class HealthHandler(BaseHTTPRequestHandler):
    plc_host = "192.168.0.10"
    plc_port = 502

    def do_GET(self):
        if self.path == "/health":
            report = self._full_report()
            all_ok = report["viam_server"]["ok"] and report["plc"]["ok"] and report["disk"]["ok"]
            self._respond(200 if all_ok else 503, report)
        elif self.path == "/health/plc":
            self._respond(200, check_plc(self.plc_host, self.plc_port))
        elif self.path == "/health/disk":
            self._respond(200, check_disk())
        else:
            self._respond(404, {"error": "not_found", "endpoints": ["/health", "/health/plc", "/health/disk"]})

    def _full_report(self) -> Dict[str, Any]:
        return {
            "system": check_system(),
            "viam_server": check_viam_server(),
            "plc": check_plc(self.plc_host, self.plc_port),
            "disk": check_disk(),
        }

    def _respond(self, code: int, data: Dict[str, Any]):
        body = json.dumps(data, indent=2).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        # Suppress per-request logs — only log errors
        pass


def main():
    parser = argparse.ArgumentParser(description="TPS Pi Health Check Server")
    parser.add_argument("--port", type=int, default=8081, help="HTTP port (default: 8081)")
    parser.add_argument("--plc-host", default="192.168.0.10", help="PLC IP for connectivity check")
    parser.add_argument("--plc-port", type=int, default=502, help="PLC Modbus port")
    args = parser.parse_args()

    HealthHandler.plc_host = args.plc_host
    HealthHandler.plc_port = args.plc_port

    server = HTTPServer(("0.0.0.0", args.port), HealthHandler)
    print(f"[health-check] Listening on 0.0.0.0:{args.port} — PLC target {args.plc_host}:{args.plc_port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[health-check] Stopped.")
        server.server_close()


if __name__ == "__main__":
    main()
