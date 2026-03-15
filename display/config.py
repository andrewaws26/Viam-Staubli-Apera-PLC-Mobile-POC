# Matrix Portal S3 — Configuration
#
# Edit these values before deploying to the Matrix Portal S3.

# WiFi credentials
WIFI_SSID = "YOUR_WIFI_SSID"
WIFI_PASSWORD = "YOUR_WIFI_PASSWORD"

# Status API endpoint (running on the Pi 5)
API_HOST = "raiv-pi5.local"
API_PORT = 8080
STATUS_ENDPOINT = f"http://{API_HOST}:{API_PORT}/status"
HEALTH_ENDPOINT = f"http://{API_HOST}:{API_PORT}/health"

# Polling interval (seconds)
POLL_INTERVAL = 1

# Color definitions (RGB tuples for the LED matrix)
COLOR_GREEN = (0, 255, 0)
COLOR_YELLOW = (255, 200, 0)
COLOR_RED = (255, 0, 0)
COLOR_GRAY = (40, 40, 40)
COLOR_WHITE = (255, 255, 255)
COLOR_BLACK = (0, 0, 0)

# Status thresholds (must match plc-simulator config.yaml)
TEMP_WARN_F = 100.0     # Yellow above this
TEMP_FAULT_F = 120.0    # Red above this
PRESSURE_MIN = 100       # Red below this
VIBRATION_MAX = 15.0     # Red above this

# Display brightness (0.0 to 1.0)
BRIGHTNESS = 0.3

# Matrix dimensions
MATRIX_WIDTH = 64
MATRIX_HEIGHT = 32
