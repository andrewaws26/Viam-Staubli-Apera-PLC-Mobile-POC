Test PLC Modbus TCP connection via the Pi 5 over SSH (Tailscale).

**Requires**: Pi 5 reachable at `100.112.68.52` via Tailscale.

SSH into `andrew@100.112.68.52` and:

1. Check if `scripts/test_plc_modbus.py` exists in the repo at `~/Viam-Staubli-Apera-PLC-Mobile-POC/`
2. If it exists, run it: `python3 ~/Viam-Staubli-Apera-PLC-Mobile-POC/scripts/test_plc_modbus.py`
3. If it doesn't exist, test manually with a Python snippet:
   - Connect to `169.168.10.21:502` via pymodbus
   - Read holding registers DS1–DS10 (addresses 0–9)
   - Report each register value with its label from the register map

Key registers to watch:
- DS3: Tie Spacing (x0.1", expect ~195 = 19.5")
- DS7: Plate Count
- DS8: AVG Plates per Min
- DS10: Encoder Next Tie (THE distance source)

If SSH fails, report Pi unreachable. If Modbus connection fails, report PLC unreachable at 169.168.10.21:502.
