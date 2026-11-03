"""Module "druck": the 3D printer (Prusa with PrusaLink) – state, progress, time left, nozzle and bed, the file
being printed, temperatures and print time back in time, links to the house's own printer tools. Only reads;
nothing on the printer is switched.

Config (local/modules/druck.json, template modules/templates/druck.json):
  prusalink   {url, benutzer, passwort} (Digest login of PrusaLink) or {url, api_key}
  verlauf     history file (relative to the modules folder or absolute), default "druck_verlauf.jsonl"
  tage        days kept in the history, default 30
  links       optional [{label, url, text?}] – e.g. a pen plotter service that prints through the same printer
  zeitzone    default "Europe/Berlin"
  texte       optional wording overrides (keys of board.TEXT)

The module's period asks the printer once a minute and keeps a line while it works or heats (else every
10 minutes and on every change of state). The board asks the printer itself when the last reading is older
than 20 s.
"""

from __future__ import annotations

import threading
import time
from zoneinfo import ZoneInfo

from . import board, source

ACTIVE = {"PRINTING", "PAUSED", "BUSY", "ATTENTION"}
QUIET_MS = 600_000
FRESH_MS = 20_000

_NAMES: dict = {}  # job id -> file name; module objects are made per request, so the caches live here
_LIVE: dict = {}  # url -> newest reading
_LOCK = threading.Lock()


class Module:
    name = "druck"
    feeds: dict = {}

    def __init__(self, cfg: dict, path, get=None, clock=time.time):
        self.cfg, self.path, self.clock = cfg, path, clock
        self.printer = source.Printer(cfg.get("prusalink") or {}, get)
        self.tz = ZoneInfo(cfg.get("zeitzone") or "Europe/Berlin")
        self.t = {**board.TEXT, **(cfg.get("texte") or {})}
        self.file = path(cfg.get("verlauf") or "druck_verlauf.jsonl")
        self.keep_ms = int(float(cfg.get("tage") or 30) * 86_400_000)
        self.links = [
            {"label": str(x.get("label"))[:30], "url": str(x.get("url")), "text": str(x.get("text") or "")[:300]}
            for x in cfg.get("links") or []
            if isinstance(x, dict) and x.get("label") and str(x.get("url") or "").startswith(("http://", "https://"))
        ]

    def _read(self, now_ms: int) -> dict:
        r = self.printer.reading(now_ms, _NAMES)
        with _LOCK:
            _LIVE[self.printer.url] = r
            if len(_NAMES) > 50:  # only the newest jobs matter
                for k in sorted(_NAMES)[:-20]:
                    _NAMES.pop(k, None)
        return r

    def takt(self) -> tuple[int, int]:
        return 60, 0

    def lauf(self, now: float | None = None) -> str:
        now_ms = int((now or self.clock()) * 1000)
        r = self._read(now_ms)
        last = source.last_line(self.file)
        warm = any((r.get(k) or 0) > 0 for k in ("dz", "bz")) or (r.get("d") or 0) > 45
        if (
            r["s"] in ACTIVE
            or warm
            or not last
            or last.get("s") != r["s"]
            or last.get("j") != r.get("j")
            or now_ms - last["t"] >= QUIET_MS
        ):
            source.append(self.file, r, self.keep_ms)
            return f"{r['s']} kept"
        return f"{r['s']} unchanged"

    def board(self) -> dict:
        now_ms = int(self.clock() * 1000)
        with _LOCK:
            live = _LIVE.get(self.printer.url)
        if not live or now_ms - live["t"] > FRESH_MS:
            live = self._read(now_ms)
        hist = source.read_history(self.file, now_ms - self.keep_ms)
        return board.build(live, hist, self.links, now_ms, self.tz, self.t)
