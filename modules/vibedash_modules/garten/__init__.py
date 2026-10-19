"""Module "garten": garden weather (today, tomorrow, frost in the next 3 days, rain of the week), rain per day
(7/30 days back, 3 ahead) and the garden tips with their history. Only reads.

Config (local/modules/garten.json, template modules/templates/garten.json):
  wetter      "influx" (the house's daily weather in InfluxDB) or "open-meteo" (fetched here), default: influx when
              influx.db is set, else open-meteo
  influx      {url, db, measurement?} – daily weather (measurement default wetter_tag, see source.py)
  standort    {lat, lon} – location for open-meteo
  tipps       optional path of the tip history [{"date", "tip"}] (relative to the modules folder or absolute)
  zeitzone    default "Europe/Berlin"
  texte       optional wording overrides (keys of board.TEXT)
"""

from __future__ import annotations

import os
import time
from datetime import datetime
from zoneinfo import ZoneInfo

from . import board, source


class Module:
    name = "garten"
    feeds: dict = {}

    def __init__(self, cfg: dict, path, fetch=source.fetch_json, clock=time.time):
        self.cfg, self.path, self.fetch, self.clock = cfg, path, fetch, clock
        self.tzname = cfg.get("zeitzone") or "Europe/Berlin"
        self.tz = ZoneInfo(self.tzname)
        self.t = {**board.TEXT, **(cfg.get("texte") or {})}
        ic = cfg.get("influx") or {}
        self.kind = cfg.get("wetter") or ("influx" if ic.get("db") else "open-meteo")
        if self.kind not in ("influx", "open-meteo"):
            raise ValueError("wetter must be influx or open-meteo")
        loc = cfg.get("standort") or {}
        if self.kind == "open-meteo" and not (_num(loc.get("lat")) and _num(loc.get("lon"))):
            raise ValueError("standort {lat, lon} missing for open-meteo")
        self.om = source.OpenMeteo(fetch, clock)

    def board(self) -> dict:
        now = self.clock()
        today = datetime.fromtimestamp(now, self.tz).date()
        if self.kind == "influx":
            days = source.influx_days(self.cfg.get("influx") or {}, self.tz, self.fetch)
        else:
            loc = self.cfg["standort"]
            days = self.om.days(float(loc["lat"]), float(loc["lon"]), self.tzname, today)
        tips = []
        p = self.cfg.get("tipps")
        if p and os.path.exists(self.path(p)):
            try:
                tips = board.recent_tips(source.load_json(self.path(p)), today)
            except (OSError, ValueError):
                tips = []
        return board.build(days, tips, today, int(now * 1000), self.t)


def _num(x) -> bool:
    return isinstance(x, (int, float)) and not isinstance(x, bool)
