"""Module "korrelation": the weekly correlation atlas of the house as a tab. Only reads.

Config (local/modules/korrelation.json, template modules/templates/korrelation.json):
  einschub_url   house service with this week's and last week's result (format in board.py)
  zeitzone       default "Europe/Berlin"
  texte          optional wording overrides (keys of board.TEXT)
"""

from __future__ import annotations

import json
import time
import urllib.request
from zoneinfo import ZoneInfo

from . import board


def fetch_json(url: str, timeout: int = 60):
    with urllib.request.urlopen(url, timeout=timeout) as r:  # noqa: S310 – address from the local config only
        return json.load(r)


class Module:
    name = "korrelation"
    feeds: dict = {}

    def __init__(self, cfg: dict, path, fetch=fetch_json, clock=time.time):
        if not cfg.get("einschub_url"):
            raise ValueError("einschub_url missing")
        self.cfg, self.fetch, self.clock = cfg, fetch, clock
        self.tz = ZoneInfo(cfg.get("zeitzone") or "Europe/Berlin")
        self.t = {**board.TEXT, **(cfg.get("texte") or {})}

    def board(self) -> dict:
        try:
            data = self.fetch(self.cfg["einschub_url"]) or {}
        except Exception:  # noqa: BLE001 – shows "no result yet" instead of an error page
            data = {}
        return board.build(data if isinstance(data, dict) else {}, int(self.clock() * 1000), self.t, self.tz)
