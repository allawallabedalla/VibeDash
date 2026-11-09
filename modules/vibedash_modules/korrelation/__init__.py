"""Module "korrelation": the weekly correlation atlas of the house as a tab. Only reads.

Config (local/modules/korrelation.json, template modules/templates/korrelation.json):
  einschub_url   house service with this week's and last week's result (format in board.py)
  paar_url       optional: house service that compares two values (GET ?a=&b=&ebene=h|d, format in pair.py);
                 default: einschub_url with its last part "haus" replaced by "paar"
  zeitzone       default "Europe/Berlin"
  texte          optional wording overrides (keys of board.TEXT)
"""

from __future__ import annotations

import json
import re
import time
import urllib.parse
import urllib.request
from zoneinfo import ZoneInfo

from . import board, pair

PAIR_VALUE = re.compile(r"[^\x00-\x1f\x7f]{1,200}")


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

    def _paar_url(self) -> str:
        if self.cfg.get("paar_url"):
            return self.cfg["paar_url"]
        base = self.cfg["einschub_url"].rstrip("/")
        return (base[: -len("/haus")] if base.endswith("/haus") else base) + "/paar"

    def calc(self, d: dict):
        """{pair: {a, b, level}} -> (status, {sections}) from the house; only a calculation."""
        p = d.get("pair")
        if not isinstance(p, dict):
            return 400, {"error": "bad_value"}
        a, b, lv = p.get("a"), p.get("b"), p.get("level")
        if not (isinstance(a, str) and isinstance(b, str) and PAIR_VALUE.fullmatch(a) and PAIR_VALUE.fullmatch(b)):
            return 400, {"error": "bad_value"}
        if lv not in ("h", "d"):
            return 400, {"error": "bad_value"}
        q = urllib.parse.urlencode({"a": a, "b": b, "ebene": lv})
        try:
            res = self.fetch(f"{self._paar_url()}?{q}")
        except Exception:  # noqa: BLE001 – a short sentence instead of an error page
            res = {"ok": False, "grund": "haus"}
        if not isinstance(res, dict):
            res = {"ok": False, "grund": "haus"}
        res.setdefault("ebene", lv)
        return 200, {"sections": pair.sections(res, self.t)}
