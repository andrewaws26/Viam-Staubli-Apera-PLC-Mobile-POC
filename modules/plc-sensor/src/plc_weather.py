"""Location and weather cache for PLC sensor readings.

Fetches location + weather from free APIs every 15 minutes in a background
thread. Never delays sensor readings.
"""

import json
import threading
import time
from urllib.parse import quote

from viam.logging import getLogger

LOGGER = getLogger(__name__)


class _LocationWeatherCache:
    """Fetches location + weather from free APIs every 15 minutes.
    Non-blocking: runs in a background thread, never delays readings."""

    REFRESH_SECONDS = 900  # 15 minutes

    def __init__(self):
        self.city = ""
        self.region = ""
        self.lat = 0.0
        self.lon = 0.0
        self.timezone = ""
        self.weather = ""
        self.temp_f = ""
        self.humidity = ""
        self.wind = ""
        self.local_time = ""
        self._last_fetch = 0.0
        self._lock = threading.Lock()

    def get(self) -> dict[str, str]:
        """Return cached location/weather data. Triggers background refresh if stale."""
        now = time.time()
        if now - self._last_fetch > self.REFRESH_SECONDS:
            self._last_fetch = now  # prevent concurrent fetches
            t = threading.Thread(target=self._fetch, daemon=True)
            t.start()
        with self._lock:
            return {
                "location_city": self.city,
                "location_region": self.region,
                "location_timezone": self.timezone,
                "weather": self.weather,
                "weather_temp": self.temp_f,
                "weather_humidity": self.humidity,
                "weather_wind": self.wind,
                "local_time": time.strftime("%I:%M %p"),
            }

    def _fetch(self):
        import urllib.request
        try:
            # IP geolocation
            with urllib.request.urlopen("http://ip-api.com/json/?fields=city,regionName,lat,lon,timezone", timeout=5) as resp:
                data = json.loads(resp.read())
                city = data.get("city", "")
                with self._lock:
                    self.city = city
                    self.region = data.get("regionName", "")
                    self.lat = data.get("lat", 0)
                    self.lon = data.get("lon", 0)
                    self.timezone = data.get("timezone", "")
            # Weather
            if city:
                url = f"http://wttr.in/{quote(city)}?format=%c+%t+%h+%w&u"
                with urllib.request.urlopen(url, timeout=5) as resp:
                    raw = resp.read().decode("utf-8").strip()
                    with self._lock:
                        self.weather = raw
                        # Parse parts: "☀️  +48°F 56% ↓12mph"
                        parts = raw.split()
                        for p in parts:
                            if "°F" in p or "°C" in p:
                                self.temp_f = p
                            elif "%" in p:
                                self.humidity = p
                            elif "mph" in p or "km/h" in p:
                                self.wind = p
        except Exception as e:
            LOGGER.debug("Weather fetch failed: %s", e)


# Module-level singleton instance
_weather_cache = _LocationWeatherCache()
