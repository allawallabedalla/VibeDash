"""Module "wasser": the house's water meter as answers – tight (no leak)? today compared with a usual day up to now
(also a tile on the start page), since the meter's due date, when water ran (quarter hours, today/yesterday) and the
draws of water with a careful guess what they were (board.bezuege, also for the weekly report); behind "Details" per
hour (48 h), per day (30 days), night use 2–5 o'clock, the meter's state and its reading. Only reads.

Config (local/modules/wasser.json, template modules/templates/wasser.json):
  influx    {url, db, measurement?} – the course the house's collector writes (default measurement "wasser", fields
            zaehlerstand_m3, stichtag_m3, batterie_jahre, rssi, ausfall, status; see source.py)
  quelle    optional address of the radio base station (ESPHome text sensor, values JSON in "state") for the live
            state: last telegram, radio level, battery
  zeitzone  default "Europe/Berlin"
  personen  optional number of people in the house: shows litres per person and day next to Germany, a rough world
            middle and the basic need (only from 3 whole days of readings)
  texte     optional wording overrides (keys of board.TEXT)

Mapping: { "id": "wasser", "title": "Wasser", "icon": "droplet", "module": "wasser", "home": true } – "home" puts
the board's tile (section with slot "home") on the start page; a tap there opens this tab.
"""

from __future__ import annotations

import time
from zoneinfo import ZoneInfo

from . import board, source


class Module:
    name = "wasser"
    feeds: dict = {}

    def __init__(self, cfg: dict, path, fetch=source.fetch_json, clock=time.time):
        self.cfg, self.path, self.fetch, self.clock = cfg, path, fetch, clock
        self.tz = ZoneInfo(cfg.get("zeitzone") or "Europe/Berlin")
        self.t = {**board.TEXT, **(cfg.get("texte") or {})}
        if not (cfg.get("influx") or {}).get("db"):
            raise ValueError("influx.db missing")

    def board(self) -> dict:
        rows = source.influx_rows(self.cfg["influx"], self.fetch) or []
        q = self.cfg.get("quelle")
        live = source.live(q, self.fetch) if q else None
        p = self.cfg.get("personen")
        personen = p if isinstance(p, int) and 0 < p < 50 else None
        return board.build(rows, live, self.clock(), self.tz, self.t, personen)
