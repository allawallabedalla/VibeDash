"""Module "auto": the car's tab – state of charge, when to plug in, sun for the car, driving profile – and a
calculator "plug in at …" (day + time). Only reads and calculates; switches nothing. On a house with a charging
page (mapping.charging.board = this board) the sections are shown there, placed by "slot".

Config (local/modules/auto.json, template modules/templates/auto.json):
  prognose     the car forecast file the house writes (format in board.py), relative to the modules folder or
               absolute
  zeitzone     e.g. "Europe/Berlin" (day start of the calculator)
  rechner      optional {url, tage?} – the house's charge planner answers "what if plugged in at …":
               POST {board, value} (value = day × 1440 + minutes, local), header X-Haus-Rechnung: 1 ->
               {"sections": [...]}; it must not change anything. Without it there is no calculator.
  texte        optional wording overrides (keys of board.TEXT, CALC)
"""

from __future__ import annotations

import json
import math
import time
import urllib.request
from datetime import datetime
from zoneinfo import ZoneInfo

from . import board

STEP_MIN = 15
CALC = {
    "rechner_titel": "Anstecken um",
    "rechner_knopf": "Rechnen",
    "rechner_note": "Nur Rechnung, steuert nichts. Dauert ≈ 15–25 s.",
    "rechner_was": (
        "Tag und Uhrzeit wählen, zu der du das Auto ansteckst, dann Rechnen. Gerechnet wird der normale Ladeplan "
        "des Hauses – nur mit „Auto steckt erst ab dann“, bis zum Ende des Folgetags."
    ),
    "rechner_quelle": "Ladeplaner des Hauses; schreibt nichts.",
}


def _load(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def _post(url: str, body: dict, timeout: int = 45):
    req = urllib.request.Request(  # noqa: S310 – address from the local config only
        url,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "X-Haus-Rechnung": "1"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:  # noqa: S310
        return r.status, json.load(r)


class Module:
    name = "auto"
    feeds: dict = {}

    def __init__(self, cfg: dict, path, post=_post, clock=time.time):
        if not cfg.get("prognose"):
            raise ValueError("prognose missing")
        self.cfg = cfg
        self.path = path
        self.post = post
        self.clock = clock
        self.t = {**board.TEXT, **CALC, **(cfg.get("texte") or {})}
        self.tz = ZoneInfo(cfg.get("zeitzone") or "Europe/Berlin")

    def _calc_section(self, now: float) -> dict | None:
        r = self.cfg.get("rechner") or {}
        if not r.get("url"):
            return None
        d = datetime.fromtimestamp(now, self.tz)
        m = math.ceil((d.hour * 60 + d.minute + d.second / 60) / STEP_MIN) * STEP_MIN
        m = min(m, 1440 - STEP_MIN)
        t = self.t
        return {
            "type": "calc",
            "title": t["rechner_titel"],
            "label": t["rechner_titel"],
            "min": m,
            "max": 1440 - STEP_MIN,
            "step": STEP_MIN,
            "value": m,
            "format": "clock",
            "days": int(r.get("tage") or 7),
            "button": t["rechner_knopf"],
            "note": t["rechner_note"],
            "info": {"what": t["rechner_was"], "source": t["rechner_quelle"]},
        }

    def board(self) -> dict:
        now = self.clock()
        return board.build(_load(self.path(self.cfg["prognose"])), now, self.t, self._calc_section(now))

    def calc(self, d: dict):
        """{value} -> (status, {sections}) from the house's planner; only a calculation."""
        url = (self.cfg.get("rechner") or {}).get("url")
        v = d.get("value")
        if not url:
            return 404, {"error": "no_calc"}
        if not isinstance(v, (int, float)) or isinstance(v, bool) or not -1e6 < v < 1e6:
            return 400, {"error": "bad_value"}
        status, body = self.post(url, {"board": "auto", "value": v})
        if not (200 <= status < 300) or not isinstance(body, dict) or not isinstance(body.get("sections"), list):
            return 502, {"error": "upstream"}
        return 200, {"sections": body["sections"]}
