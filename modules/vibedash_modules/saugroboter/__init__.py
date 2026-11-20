"""Module "saugroboter": robot vacuums – what each one does right now, its battery and the battery over the
last 24 h, and predefined cleaning actions (aktionen.py) that leave a wish for the house – nothing on the robots is
switched here.

Config (local/modules/saugroboter.json, template modules/templates/saugroboter.json):
  influx      {url, db, measurement?} – a collector writes one point per robot (measurement default saugroboter,
              tag geraet = name, fields batterie %, status = state code of the Dreame/MOVA cloud, online 0/1)
  aktionen, zonen, karten, grundriss, bereiche, wunsch, stand   optional cleaning actions and areas, see
              aktionen.py
  zeitzone    default "Europe/Berlin"
  texte       optional wording overrides (keys of board.TEXT)
  anzeige     optional short names shown instead of the robot's own name, e.g. {"MOVA E20": "Sauger OG"} (only in
              titles and texts; ids and stored wishes keep the robot's name)
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
        return self._names(out)

    def _names(self, x):
        """Robot names -> short names (config "anzeige") in what people read, never in ids or values."""
        names = {k: v for k, v in (self.cfg.get("anzeige") or {}).items() if isinstance(v, str) and v}
        if not names:
            return x

        def walk(v, key=None):
            if isinstance(v, dict):
                return {k: walk(w, k) for k, w in v.items()}
            if isinstance(v, list):
                return [walk(w, key) for w in v]
            if isinstance(v, str) and key in ("title", "label", "text", "note", "sub"):
                for long, short in names.items():
                    v = v.replace(long, short)
            return v

        return walk(x)

    def action(self, d: dict):
        """{item: "saug:<robot>[.<row>]", action: "choose", value: action id} -> wish for the house;
        {item: "zone:<robot>", action: "zone", zone: {name, rect, mode} | {remove: id}} -> a drawn area."""
        now_ms = int(self.clock() * 1000)
        if d.get("action") == "zone":
            status, body = aktionen.zone(self.cfg, self.path, d.get("item"), d.get("zone"), now_ms)
        elif d.get("action") != "choose":
            return 404, {"ok": False, "text": "keine Aktion"}
        else:
            status, body = aktionen.choose(self.cfg, self.path, d.get("item"), d.get("value"), now_ms)
        return status, self._names(body)
