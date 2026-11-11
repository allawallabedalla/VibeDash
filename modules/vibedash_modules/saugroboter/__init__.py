"""Module "saugroboter": robot vacuums – what each one does right now, its battery and the battery over the
last 24 h. Only reads; nothing on the robots is switched.

Config (local/modules/saugroboter.json, template modules/templates/saugroboter.json):
  influx      {url, db, measurement?} – a collector writes one point per robot (measurement default saugroboter,
              tag geraet = name, fields batterie %, status = state code of the Dreame/MOVA cloud, online 0/1)
  zeitzone    default "Europe/Berlin"
  texte       optional wording overrides (keys of board.TEXT)
"""

from __future__ import annotations

import time
from zoneinfo import ZoneInfo

from . import board, source


class Module:
    name = "saugroboter"
    feeds: dict = {}

    def __init__(self, cfg: dict, path, fetch=source.fetch_json, clock=time.time):
        if not (cfg.get("influx") or {}).get("db"):
            raise ValueError("influx.db missing")
        self.cfg, self.fetch, self.clock = cfg, fetch, clock
        self.tz = ZoneInfo(cfg.get("zeitzone") or "Europe/Berlin")
        self.t = {**board.TEXT, **(cfg.get("texte") or {})}

    def board(self) -> dict:
        robots = source.robots(self.cfg["influx"], self.fetch)
        return board.build(robots, int(self.clock() * 1000), self.t, self.tz)
