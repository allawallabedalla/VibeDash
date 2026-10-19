"""Module "knx": light and operation, defects, reports per kind, light per day, daily rhythm, night activity,
light ideas and light per room – the KNX results of the house program, shown as a tab. Only reads.

Config (local/modules/knx.json, template modules/templates/knx.json):
  einschub_url   house service with the KNX results (format in board.py)
  zeitzone       default "Europe/Berlin"
"""

from __future__ import annotations

import json
import time
import urllib.parse
import urllib.request
from zoneinfo import ZoneInfo

from . import board


def fetch_json(url: str, timeout: int = 60):
    with urllib.request.urlopen(url, timeout=timeout) as r:  # noqa: S310 – address from the local config only
        return json.load(r)


class Module:
    name = "knx"
    feeds: dict = {}

    def __init__(self, cfg: dict, path, fetch=fetch_json, clock=time.time):
        if not cfg.get("einschub_url"):
            raise ValueError("einschub_url missing")
        self.cfg, self.fetch, self.clock = cfg, fetch, clock
        self.tz = ZoneInfo(cfg.get("zeitzone") or "Europe/Berlin")

    def board(self) -> dict:
        now_ms = int(self.clock() * 1000)
        u = self.cfg["einschub_url"]
        try:
            data = self.fetch(u + ("&" if "?" in u else "?") + urllib.parse.urlencode({"bis": now_ms})) or {}
        except Exception:  # noqa: BLE001 – an empty board instead of an error page
            data = {}
        return board.build(data if isinstance(data, dict) else {}, now_ms, self.tz)
