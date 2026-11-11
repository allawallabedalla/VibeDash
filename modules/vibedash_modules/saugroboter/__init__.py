"""Module "saugroboter": robot vacuums – what each one does right now, its battery and the battery over the
last 24 h, and predefined cleaning actions (aktionen.py) that leave a wish for the house – nothing on the robots is
switched here.

Config (local/modules/saugroboter.json, template modules/templates/saugroboter.json):
  influx      {url, db, measurement?} – a collector writes one point per robot (measurement default saugroboter,
              tag geraet = name, fields batterie %, status = state code of the Dreame/MOVA cloud, online 0/1)
  aktionen, wunsch, stand   optional cleaning actions, see aktionen.py
  zeitzone    default "Europe/Berlin"
  texte       optional wording overrides (keys of board.TEXT)
"""

from __future__ import annotations

import time
from zoneinfo import ZoneInfo

from . import aktionen, board, source


class Module:
    name = "saugroboter"
    feeds: dict = {}

    def __init__(self, cfg: dict, path, fetch=source.fetch_json, clock=time.time):
        if not (cfg.get("influx") or {}).get("db"):
            raise ValueError("influx.db missing")
        self.cfg, self.path, self.fetch, self.clock = cfg, path, fetch, clock
        self.tz = ZoneInfo(cfg.get("zeitzone") or "Europe/Berlin")
        self.t = {**board.TEXT, **(cfg.get("texte") or {})}

    def board(self) -> dict:
        now_ms = int(self.clock() * 1000)
        robots = source.robots(self.cfg["influx"], self.fetch)
        out = board.build(robots, now_ms, self.t, self.tz)
        out["sections"] += aktionen.sections(self.cfg, self.path, self.tz, now_ms)
        return out

    def action(self, d: dict):
        """{item: "saug:<robot>", action: "choose", value: action id} -> wish for the house."""
        if d.get("action") != "choose":
            return 404, {"ok": False, "text": "keine Aktion"}
        return aktionen.choose(self.cfg, self.path, d.get("item"), d.get("value"), int(self.clock() * 1000))
