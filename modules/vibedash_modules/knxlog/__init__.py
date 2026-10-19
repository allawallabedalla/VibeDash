"""Module "knxlog": the last 24 hours on the KNX bus – telegrams, devices with their last sign of life, light,
presence, doors, defects, traffic per 15 min. Only reads.

Config (local/modules/knxlog.json, template modules/templates/knxlog.json):
  einschub_url   house service with the raw data of the last 24 h (format in board.py)
  inventar       device list + group address names, default "knx_inventar.json" (format in board.py)
  zeitzone       default "Europe/Berlin"
  gruppen, messwerte, stellgroessen, tuer_prefix, prozent_prefix, bridge, ohne_anlass, ohne_anlass_name, arten,
  raum_namen, tueren, tuer_sonst   house rules (README "Module knxlog")
The board is kept for 60 s (reading a day of telegrams is not free).
"""

from __future__ import annotations

import json
import threading
import time
import urllib.parse
import urllib.request
from zoneinfo import ZoneInfo

from . import board

_CACHE: dict = {}
_LOCK = threading.Lock()


def fetch_json(url: str, timeout: int = 30):
    with urllib.request.urlopen(url, timeout=timeout) as r:  # noqa: S310 – address from the local config only
        return json.load(r)


class Module:
    name = "knxlog"
    feeds: dict = {}

    def __init__(self, cfg: dict, path, fetch=fetch_json, clock=time.time, cache=None):
        if not cfg.get("einschub_url"):
            raise ValueError("einschub_url missing")
        self.cfg, self.path, self.fetch, self.clock = cfg, path, fetch, clock
        self.cache = _CACHE if cache is None else cache
        self.tz = ZoneInfo(cfg.get("zeitzone") or "Europe/Berlin")

    def inventory(self) -> dict:
        try:
            with open(self.path(self.cfg.get("inventar") or "knx_inventar.json"), encoding="utf-8") as f:
                d = json.load(f)
            return d if isinstance(d, dict) else {}
        except (OSError, ValueError):
            return {}

    def board(self) -> dict:
        now = self.clock()
        with _LOCK:
            hit = self.cache.get("board")
            if hit and 0 <= now - hit[0] < 60:
                return hit[1]
        now_ms = int(now * 1000)
        u = self.cfg["einschub_url"]
        q = urllib.parse.urlencode({"von": now_ms - 86_400_000, "bis": now_ms})
        try:
            data = self.fetch(u + ("&" if "?" in u else "?") + q) or {}
        except Exception:  # noqa: BLE001 – the board shows empty counts instead of failing
            data = {}
        out = board.build(data, self.inventory(), self.cfg, now_ms, self.tz)
        if data:
            with _LOCK:
                self.cache["board"] = (now, out)
        return out
