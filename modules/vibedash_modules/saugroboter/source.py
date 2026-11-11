"""Inputs of the module "saugroboter" – only reading InfluxDB 1.x: per robot (tag geraet) the newest battery,
state code and online flag, and the battery as 15-minute means over the last 24 h."""

from __future__ import annotations

import json
import urllib.parse
import urllib.request


def fetch_json(url: str, timeout: int = 20):
    with urllib.request.urlopen(url, timeout=timeout) as r:  # noqa: S310 – address from the local config only
        return json.load(r)


def _ident(x: str) -> str:
    return '"' + str(x).replace("\\", "").replace('"', "") + '"'


def _series(cfg: dict, q: str, fetch) -> list:
    url = (cfg.get("url") or "http://127.0.0.1:8086").rstrip("/")
    res = fetch(f"{url}/query?" + urllib.parse.urlencode({"db": cfg.get("db") or "", "q": q, "epoch": "ms"}), 15)
    return ((res or {}).get("results") or [{}])[0].get("series") or []


def robots(cfg: dict, fetch=fetch_json) -> list:
    """-> [{"name", "time" (ms of the newest point), "batterie", "status", "online", "x": [ms], "akku": [...]}],
    sorted by name; [] on errors."""
    m = _ident(cfg.get("measurement") or "saugroboter")
    out: dict = {}
    try:
        for f in ("batterie", "status", "online"):
            for s in _series(
                cfg, f'SELECT last({_ident(f)}) FROM {m} WHERE time > now() - 7d GROUP BY "geraet"', fetch
            ):
                name = (s.get("tags") or {}).get("geraet")
                v = (s.get("values") or [[None, None]])[0]
                if name:
                    r = out.setdefault(name, {"name": name, "time": 0, "x": [], "akku": []})
                    r[f] = v[1]
                    r["time"] = max(r["time"], int(v[0] or 0))
        q = f'SELECT mean("batterie") FROM {m} WHERE time > now() - 24h GROUP BY time(15m), "geraet" fill(none)'
        for s in _series(cfg, q, fetch):
            name = (s.get("tags") or {}).get("geraet")
            if name in out:
                vals = s.get("values") or []
                out[name]["x"] = [int(v[0]) for v in vals]
                out[name]["akku"] = [v[1] for v in vals]
    except Exception:  # noqa: BLE001
        return []
    return [out[k] for k in sorted(out)]
