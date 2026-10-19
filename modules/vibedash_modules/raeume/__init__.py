"""Module "raeume": floor plan with live values per room (temperature, humidity, valve, light, motion) and a
timeline of today's light and motion. Only reads; switches nothing.

Config (local/modules/raeume.json, template modules/templates/raeume.json):
  grundriss       {haus, waende, modell3d?} – plan files (relative to the modules folder or absolute); format in
                  templates/raeume_haus.json (rooms, polygons in metres) and README
  influx          {url, db, klima?, feld?, tag_typ?, tag_raum?, helligkeit?, helligkeit_feld?} – where the room
                  readings are (InfluxDB 1.x, read only); empty db = no readings
  namen           {room_id: [series names]} – extra names a room has in the series (besides "knx" in the plan)
  gleicher_raum   {room_id: room_id} – rooms without own readings that share another room's climate
  zeitzone        day start of the timeline, default "Europe/Berlin"
  einschub_url    optional house service with light/motion events of today (format in board.py)
  texte           optional wording overrides (keys of board.TEXT; floor names as floor_<id>)
"""

from __future__ import annotations

import time
import urllib.parse
from datetime import datetime
from zoneinfo import ZoneInfo

from . import board, source


class Module:
    name = "raeume"
    feeds: dict = {}

    def __init__(self, cfg: dict, path, fetch=source.fetch_json, clock=time.time):
        self.cfg = cfg
        self.path = path
        self.fetch = fetch
        self.clock = clock
        g = cfg.get("grundriss") or {}
        if not g.get("haus"):
            raise ValueError("grundriss.haus missing")
        self.t = {**board.TEXT, **(cfg.get("texte") or {})}

    def _plan(self):
        g = self.cfg["grundriss"]
        geo = source.load_json(self.path(g["haus"]))
        walls = source.load_json(self.path(g["waende"])) if g.get("waende") else {}
        model = source.load_json(self.path(g["modell3d"])) if g.get("modell3d") else None
        return board.plan(geo, walls, model, self.t)

    def board(self) -> dict:
        floors, rooms, model = self._plan()
        now = self.clock()
        tz = ZoneInfo(self.cfg.get("zeitzone") or "Europe/Berlin")
        start = datetime.fromtimestamp(now, tz).replace(hour=0, minute=0, second=0, microsecond=0).timestamp()
        start_ms, now_ms = int(start * 1000), int(now * 1000)
        ic = self.cfg.get("influx") or {}
        readings = source.Influx(ic, self.fetch).readings() if ic.get("db") else {}
        events = {}
        if self.cfg.get("einschub_url"):
            u = self.cfg["einschub_url"]
            try:
                events = self.fetch(u + ("&" if "?" in u else "?") + urllib.parse.urlencode({"seit": start_ms})) or {}
            except Exception:  # noqa: BLE001 – light/motion are optional; the plan works without them
                events = {}
        return board.build(floors, rooms, model, readings, events, self.cfg, start_ms, now_ms, self.t)
