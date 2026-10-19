"""Module "gebaeude": what the measurements say about the building (cooling down, heat storage, sun gain, heat pump
per degree and time of day, hot water in the PV time, tilted window, front door, PV forecast per weather). Only reads.

The numbers come from a daily analysis that writes one result file (format in README, "Module gebaeude"); this
module turns it into the tab.

Config (local/modules/gebaeude.json, template modules/templates/gebaeude.json):
  ergebnis    path of the result file (relative to the modules folder or absolute)
  kennwerte   building data the daily analysis uses (heat loss in W/K, room areas, rooms per heating circuit …)
  texte       optional wording overrides (keys of board.TEXT)
"""

from __future__ import annotations

import json
import os
import time

from . import board


class Module:
    name = "gebaeude"
    feeds: dict = {}

    def __init__(self, cfg: dict, path, clock=time.time):
        if not cfg.get("ergebnis"):
            raise ValueError("ergebnis missing")
        self.file = path(cfg["ergebnis"])
        self.clock = clock
        self.t = {**board.TEXT, **(cfg.get("texte") or {})}

    def board(self) -> dict:
        try:
            with open(self.file, encoding="utf-8") as f:
                result = json.load(f)
            stand_ms = int(os.path.getmtime(self.file) * 1000)
        except (OSError, ValueError):
            return board.empty(self.t, int(self.clock() * 1000))
        if not isinstance(result, dict):
            return board.empty(self.t, int(self.clock() * 1000))
        return board.build(result, stand_ms, self.t)
