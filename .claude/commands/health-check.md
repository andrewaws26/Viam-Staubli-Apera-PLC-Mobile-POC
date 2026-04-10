Run fleet health diagnostics on the Pi 5 via SSH (Tailscale).

**Requires**: Pi 5 reachable at `100.112.68.52` via Tailscale.

SSH into `andrew@100.112.68.52` and run these checks:

1. `systemctl is-active viam-server` — Is viam-server running?
2. `ip link show can0` — Is CAN bus interface up? Confirm listen-only mode.
3. `ping -c 1 -W 2 169.168.10.21` — Is the PLC reachable on Modbus?
4. `df -h /` — Disk usage (warn if >90%)
5. `free -h` — Memory usage
6. `journalctl -u viam-server --since "5 min ago" --no-pager | tail -20` — Recent viam-server errors

Present results in a structured summary table with status indicators (OK / WARN / FAIL).

If SSH connection fails, report that the Pi is unreachable and suggest:
- Check Tailscale: `tailscale status`
- Check if Pi is powered on
- Try pinging: `ping 100.112.68.52`
