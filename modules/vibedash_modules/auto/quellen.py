"""InfluxDB 1.x for the module "auto" (HTTP, stdlib): read the wallbox meter, optionally write the history
(car reports, trips, forecast) so the house keeps its series. Addresses only from the local config."""

from __future__ import annotations

import json
import urllib.parse
import urllib.request


def _ident(x: str) -> str:
    return '"' + str(x).replace("\\", "").replace('"', "") + '"'


def _tag(x) -> str:
    return str(x).replace("\\", "\\\\").replace(",", "\\,").replace(" ", "\\ ").replace("=", "\\=")


def _feld(v) -> str:
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return repr(float(v))
    return '"' + str(v).replace("\\", "\\\\").replace('"', '\\"') + '"'


def zeile(measurement: str, felder: dict, ts_s: int) -> str | None:
    """One point in line protocol (seconds); None without fields."""
    f = ",".join(f"{_tag(k)}={_feld(v)}" for k, v in felder.items() if v is not None)
    return f"{_tag(measurement)} {f} {int(ts_s)}" if f else None


class Influx:
    """cfg: {url, db, wallbox?: {measurement, feld}} – wallbox defaults: measurement "wallbox", field "energie_wh"."""

    def __init__(self, cfg: dict, timeout: int = 20, opener=urllib.request.urlopen):
        self.url = str(cfg.get("url") or "http://127.0.0.1:8086").rstrip("/")
        self.db = str(cfg["db"])
        w = cfg.get("wallbox") or {}
        self.wb_m = w.get("measurement") or "wallbox"
        self.wb_f = w.get("feld") or "energie_wh"
        self.timeout = timeout
        self.open = opener

    def query(self, q: str) -> list[dict]:
        u = f"{self.url}/query?" + urllib.parse.urlencode({"db": self.db, "q": q, "epoch": "s"})
        with self.open(u, timeout=self.timeout) as r:  # noqa: S310 – local config
            res = (json.load(r).get("results") or [{}])[0]
        out = []
        for s in res.get("series") or []:
            cols = s.get("columns") or []
            out += [dict(zip(cols, v, strict=False)) for v in s.get("values") or []]
        return out

    def wallbox_zaehler(self, ts) -> float | None:
        """Last meter reading (Wh) at or before ts, looking back 60 days."""
        q = (
            f"SELECT last({_ident(self.wb_f)}) FROM {_ident(self.wb_m)} "
            f"WHERE time <= {int(ts)}s AND time > {int(ts) - 60 * 86400}s"
        )
        pts = self.query(q)
        return pts[0]["last"] if pts and pts[0].get("last") is not None else None

    def schreibe(self, zeilen: list[str]) -> None:
        zeilen = [z for z in zeilen if z]
        if not zeilen:
            return
        u = f"{self.url}/write?" + urllib.parse.urlencode({"db": self.db, "precision": "s"})
        req = urllib.request.Request(u, data="\n".join(zeilen).encode(), method="POST")  # noqa: S310
        with self.open(req, timeout=self.timeout) as r:  # noqa: S310
            r.read()
