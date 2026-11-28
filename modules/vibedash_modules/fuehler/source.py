"""Inputs of the module "fuehler" – only reading.

The course from InfluxDB 1.x: measurement (default "rs485_klima") with tag fuehler (the sensor's bus address, "1" …
"247") and fields temp_c, feuchte_pct – written by the house's collector, which asks every sensor once a minute (an
RS485 bus behind a Modbus TCP gateway; sensors like the XY-MD02). A sensor that does not answer writes nothing: a gap.
"""

from __future__ import annotations

import json
import urllib.parse
import urllib.request

# time spans of the course: id -> (span in seconds, step in seconds); the board shows one switch for all
SPANS = {"tag": (86400, 900), "woche": (7 * 86400, 3600), "monat": (30 * 86400, 3 * 3600)}


def fetch_json(url: str, timeout: int = 20):
    with urllib.request.urlopen(url, timeout=timeout) as r:  # noqa: S310 – addresses from the local config only
        return json.load(r)


def _ident(x: str) -> str:
    return '"' + str(x).replace("\\", "").replace('"', "") + '"'


def _series(cfg: dict, fetch, q: str) -> list[dict]:
    url = (cfg.get("url") or "http://127.0.0.1:8086").rstrip("/")
    res = fetch(f"{url}/query?" + urllib.parse.urlencode({"db": cfg.get("db") or "", "q": q, "epoch": "ms"}), 15)
    return ((res or {}).get("results") or [{}])[0].get("series") or []


def _by_sensor(series: list[dict]):
    """-> (sensor, [row dict]) per series grouped by the tag fuehler."""
    for s in series:
        nr = str(((s.get("tags") or {}).get("fuehler")) or "")
        cols = s.get("columns") or []
        if nr:
            yield nr, [dict(zip(cols, v, strict=False)) for v in s.get("values") or []]


def read(cfg: dict, fetch=fetch_json) -> dict | None:
    """-> {"last": {nr: {t, temp, feuchte}}, "stats": {nr: {tmin, tmax, tmean, hmin, hmax, hmean, n}} (24 h),
    "course": {span id: {nr: {bucket start ms: (temp, feuchte)}}}}; None when the database does not answer."""
    m = _ident(cfg.get("measurement") or "rs485_klima")
    out: dict = {"last": {}, "stats": {}, "course": {}}
    try:
        q = f"SELECT temp_c, feuchte_pct FROM {m} WHERE time > now() - 30d GROUP BY fuehler ORDER BY time DESC LIMIT 1"
        for nr, rows in _by_sensor(_series(cfg, fetch, q)):
            r = rows[0] if rows else {}
            if isinstance(r.get("time"), (int, float)):
                out["last"][nr] = {"t": r["time"] / 1000, "temp": r.get("temp_c"), "feuchte": r.get("feuchte_pct")}
        q = (
            "SELECT min(temp_c) AS tmin, max(temp_c) AS tmax, mean(temp_c) AS tmean, min(feuchte_pct) AS hmin, "
            f"max(feuchte_pct) AS hmax, mean(feuchte_pct) AS hmean, count(temp_c) AS n FROM {m} "
            "WHERE time > now() - 24h GROUP BY fuehler"
        )
        for nr, rows in _by_sensor(_series(cfg, fetch, q)):
            if rows:
                out["stats"][nr] = {k: v for k, v in rows[0].items() if k != "time"}
        for sid, (span, step) in SPANS.items():
            q = (
                f"SELECT mean(temp_c) AS t, mean(feuchte_pct) AS h FROM {m} WHERE time > now() - {span}s "
                f"GROUP BY time({step}s), fuehler fill(none)"
            )
            c = out["course"][sid] = {}
            for nr, rows in _by_sensor(_series(cfg, fetch, q)):
                c[nr] = {
                    int(r["time"]): (r.get("t"), r.get("h")) for r in rows if isinstance(r.get("time"), (int, float))
                }
    except Exception:  # noqa: BLE001
        return None
    return out
