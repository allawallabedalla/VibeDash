"""Inputs of the module "garten" – only reading.

Weather per day, either
  influx      the house keeps daily weather in InfluxDB 1.x (measurement with tag art = gemessen | prognose and
              fields tmax, tmin, regen_mm, sonne_h; time = local midnight of the day) – read only, or
  open-meteo  fetched here from Open-Meteo for the location in the config (past days + 4 days ahead), kept
              for an hour.
Tips from a history file [{"date", "tip"}] that a tip writer keeps (optional).
"""

from __future__ import annotations

import json
import threading
import time
import urllib.parse
import urllib.request
from datetime import date, datetime

FIELDS = ("tmax", "tmin", "regen_mm", "sonne_h")
OPEN_METEO = "https://api.open-meteo.com/v1/forecast"


def fetch_json(url: str, timeout: int = 20):
    with urllib.request.urlopen(url, timeout=timeout) as r:  # noqa: S310 – addresses from the local config only
        return json.load(r)


def load_json(p: str):
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def _ident(x: str) -> str:
    return '"' + str(x).replace("\\", "").replace('"', "") + '"'


def influx_days(cfg: dict, tz, fetch=fetch_json) -> dict:
    """-> {"gemessen": {date: {...}}, "prognose": {date: {...}}}; errors give no days."""
    url = (cfg.get("url") or "http://127.0.0.1:8086").rstrip("/")
    m = cfg.get("measurement") or "wetter_tag"
    q = f"SELECT tmax, tmin, regen_mm, sonne_h, art FROM {_ident(m)} WHERE time > now() - 32d"
    out: dict = {"gemessen": {}, "prognose": {}}
    try:
        res = fetch(f"{url}/query?" + urllib.parse.urlencode({"db": cfg.get("db") or "", "q": q, "epoch": "ms"}), 15)
        ser = ((res or {}).get("results") or [{}])[0].get("series") or [{}]
        cols = ser[0].get("columns") or []
        for v in ser[0].get("values") or []:
            r = dict(zip(cols, v, strict=False))
            if r.get("art") in out:
                out[r["art"]][datetime.fromtimestamp(r["time"] / 1000, tz).date()] = r
    except Exception:  # noqa: BLE001
        return {"gemessen": {}, "prognose": {}}
    return out


_CACHE: dict = {}  # key -> (time, days); module objects are made per request, so the cache lives here
_LOCK = threading.Lock()


class OpenMeteo:
    """Daily weather straight from Open-Meteo for the configured location (no key needed). One hour cache."""

    def __init__(self, fetch=fetch_json, clock=time.time, cache=None):
        self.fetch, self.clock = fetch, clock
        self.cache = _CACHE if cache is None else cache

    def days(self, lat: float, lon: float, tzname: str, today: date) -> dict:
        key = (lat, lon, tzname, today)
        with _LOCK:
            hit = self.cache.get(key)
            if hit and self.clock() - hit[0] < 3600:
                return hit[1]
        params = {
            "latitude": lat,
            "longitude": lon,
            "timezone": tzname,
            "past_days": 31,
            "forecast_days": 4,
            "daily": "temperature_2m_max,temperature_2m_min,precipitation_sum,sunshine_duration",
        }
        try:
            d = self.fetch(OPEN_METEO + "?" + urllib.parse.urlencode(params), 30)["daily"]
        except Exception:  # noqa: BLE001
            return {"gemessen": {}, "prognose": {}}
        out: dict = {"gemessen": {}, "prognose": {}}
        for i, t in enumerate(d.get("time") or []):
            day = date.fromisoformat(t)
            sun = d["sunshine_duration"][i]
            out["gemessen" if day < today else "prognose"][day] = {
                "tmax": d["temperature_2m_max"][i],
                "tmin": d["temperature_2m_min"][i],
                "regen_mm": d["precipitation_sum"][i],
                "sonne_h": None if sun is None else sun / 3600,
            }
        with _LOCK:
            self.cache.clear()  # one location per house: keep only the newest entry
            self.cache[key] = (self.clock(), out)
        return out
