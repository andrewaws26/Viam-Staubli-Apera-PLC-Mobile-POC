# Status API — Pi 5

Lightweight Flask HTTP server that reads PLC state via Modbus TCP and exposes it as JSON. Runs on the Pi 5 alongside viam-server.

## Endpoints

- `GET /status` — Full system state as JSON (same structure as plc-sensor get_readings)
- `GET /health` — Returns `{"ok": true}` for connectivity checks

## Setup

```bash
cd api
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Run manually
python src/status_api.py --plc-host raiv-plc.local --port 8080

# Install as systemd service
sudo cp systemd/status-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable status-api
sudo systemctl start status-api
```

## Consumers

- **Matrix Portal S3** — polls `/status` every 1 second to render LED matrix
- **CYD touchscreen** — polls `/status` for local display (future)
- **Any HTTP client** — `curl http://raiv-pi5.local:8080/status | jq .`
