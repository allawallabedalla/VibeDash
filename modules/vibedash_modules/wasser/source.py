"""Inputs of the module "wasser" – only reading.

The course from InfluxDB 1.x: measurement (default "wasser") with fields zaehlerstand_m3, stichtag_m3, batterie_jahre,
rssi, ausfall (bool), status (text) – written by the house's collector when the meter reading changed, else at least
every 15 min. The live state straight from the radio base station (optional, "quelle"): an ESPHome text sensor whose
answer carries the values JSON as text in "state":
  {"basis": {laufzeit_s, uhr, wlan_rssi}, "zaehler": {alter_s, zaehlerstand_m3, stichtag_m3, batterie_jahre, status,
   rssi, ausfall, …}}  (null = nothing received yet)
"""

from __future__ import annotations

import json
import urllib.parse
import urllib.request

FIELDS = ("zaehlerstand_m3", "stichtag_m3", "batterie_jahre", "rssi", "ausfall", "status")


def fetch_json(url: str, timeout: int = 20):
    with urllib.request.urlopen(url, timeout=timeout) as r:  # noqa: S310 – addresses from the local config only
        return json.load(r)


def _ident(x: str) -> str:
    return '"' + str(x).replace("\\", "").replace('"', "") + '"'


def influx_rows(cfg: dict, fetch=fetch_json, days: int = 32) -> list[dict] | None:
    """-> [{"t": seconds, field: value, …}] oldest first; None when the database does not answer."""
    url = (cfg.get("url") or "http://127.0.0.1:8086").rstrip("/")
    m = cfg.get("measurement") or "wasser"
    q = f"SELECT {', '.join(FIELDS)} FROM {_ident(m)} WHERE time > now() - {int(days)}d"
    try:
        res = fetch(f"{url}/query?" + urllib.parse.urlencode({"db": cfg.get("db") or "", "q": q, "epoch": "ms"}), 15)
        ser = ((res or {}).get("results") or [{}])[0].get("series") or []
    except Exception:  # noqa: BLE001
        return None
    if not ser:
        return []
    cols = ser[0].get("columns") or []
    out = []
    for v in ser[0].get("values") or []:
        r = dict(zip(cols, v, strict=False))
        if isinstance(r.get("time"), (int, float)):
            out.append({**{k: r.get(k) for k in FIELDS}, "t": r["time"] / 1000})
    out.sort(key=lambda r: r["t"])
    return out


def live(url: str, fetch=fetch_json) -> dict | None:
    """-> the meter object of the base station ({} when it has none yet), None when it does not answer."""
    try:
        res = fetch(url, 5) or {}
        s = res.get("state")
        w = json.loads(s) if isinstance(s, str) else res
        z = (w or {}).get("zaehler")
        return z if isinstance(z, dict) else {}
    except Exception:  # noqa: BLE001
        return None
