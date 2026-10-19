"""Inputs of the module "raeume" – only reading: floor plan files, InfluxDB (1.x HTTP), optional house service."""

from __future__ import annotations

import json
import urllib.parse
import urllib.request

# typ -> how old the last value may be (InfluxQL duration)
KLIMA = (
    ("ist", "3h"),
    ("ist_matter", "6h"),
    ("feuchte", "6h"),
    ("aussen_temp", "3h"),
    ("aussen_feuchte", "3h"),
    ("soll", "7d"),
    ("stellgroesse", "6h"),
    ("ist_decke", "3h"),
)


def load_json(p: str):
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def fetch_json(url: str, timeout: int = 20):
    with urllib.request.urlopen(url, timeout=timeout) as r:  # noqa: S310 – address from the local config only
        return json.load(r)


def _ident(x: str) -> str:
    """Measurement/field/tag names from the config, quoted for InfluxQL."""
    return '"' + str(x).replace("\\", "").replace('"', "") + '"'


def _lit(x: str) -> str:
    return "'" + str(x).replace("\\", "").replace("'", "") + "'"


class Influx:
    """Last value per room (GROUP BY the room tag). Errors give no values – the plan still shows."""

    def __init__(self, cfg: dict, fetch=fetch_json):
        self.url = (cfg.get("url") or "http://127.0.0.1:8086").rstrip("/")
        self.db = cfg.get("db") or ""
        self.klima = cfg.get("klima") or "raumklima"
        self.feld = cfg.get("feld") or "wert"
        self.typ = cfg.get("tag_typ") or "typ"
        self.raum = cfg.get("tag_raum") or "raum"
        self.hell = cfg.get("helligkeit") or "helligkeit"
        self.hell_feld = cfg.get("helligkeit_feld") or "lux"
        self.fetch = fetch

    def groups(self, q: str) -> list:
        u = f"{self.url}/query?" + urllib.parse.urlencode({"db": self.db, "q": q, "epoch": "ms"})
        try:
            res = (self.fetch(u, 15) or {}).get("results") or [{}]
            out = []
            for ser in res[0].get("series") or []:
                v = (ser.get("values") or [[None, None]])[0][1]
                if v is not None:
                    out.append(((ser.get("tags") or {}).get(self.raum), float(v)))
            return out
        except Exception:  # noqa: BLE001
            return []

    def readings(self) -> dict:
        klima = []
        for typ, age in KLIMA:
            q = (
                f"SELECT last({_ident(self.feld)}) FROM {_ident(self.klima)} WHERE {_ident(self.typ)} = {_lit(typ)} "
                f"AND time > now() - {age} GROUP BY {_ident(self.raum)}"
            )
            klima += [(typ, raum, v) for raum, v in self.groups(q)]
        lux = self.groups(
            f"SELECT last({_ident(self.hell_feld)}) FROM {_ident(self.hell)} WHERE time > now() - 1h "
            f"GROUP BY {_ident(self.raum)}"
        )
        return {"klima": klima, "lux": lux}
