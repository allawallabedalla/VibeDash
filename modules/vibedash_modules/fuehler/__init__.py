"""Module "fuehler": temperature and humidity sensors on a bus (e.g. XY-MD02 on RS485 behind a Modbus TCP gateway)
as answers – what does each sensor read now, does every sensor still answer, how did it go (24 h / 7 days / 30 days),
and per sensor the lowest, highest and mean value of the last 24 hours. Only reads.

Config (local/modules/fuehler.json, template modules/templates/fuehler.json):
  influx    {url, db, measurement?} – the course the house's collector writes (default measurement "rs485_klima",
            tag fuehler = bus address, fields temp_c, feuchte_pct; see source.py)
  fuehler   optional [{"nr": 6, "name": "…"}] – the sensors to show, in this order, with their names; without it
            every sensor seen in the last 30 days, as "Fühler <nr>"
  aussen    optional {measurement, feld?, temp: {tag: value}, feuchte: {tag: value}, name?} – an outdoor sensor
            (one series for temperature, one for humidity, picked by tags) to compare the absolute humidity with:
            does airing dry or wet the room? Without it, no comparison.
  zeitzone  default "Europe/Berlin"
  texte     optional wording overrides (keys of board.TEXT)

Mapping: { "id": "fuehler", "title": "Fühler", "icon": "thermometer", "module": "fuehler" } – or "dazu" of another
tab's module config to show it below that tab.
"""

from __future__ import annotations

import time
from zoneinfo import ZoneInfo

from . import board, source


class Module:
    name = "fuehler"
    feeds: dict = {}

    def __init__(self, cfg: dict, path, fetch=source.fetch_json, clock=time.time):
        self.cfg, self.path, self.fetch, self.clock = cfg, path, fetch, clock
        self.tz = ZoneInfo(cfg.get("zeitzone") or "Europe/Berlin")
        self.t = {**board.TEXT, **(cfg.get("texte") or {})}
        if not (cfg.get("influx") or {}).get("db"):
            raise ValueError("influx.db missing")
        f = cfg.get("fuehler")
        if f is not None and not (
            isinstance(f, list) and all(isinstance(x, dict) and isinstance(x.get("nr"), int) for x in f)
        ):
            raise ValueError('fuehler: a list of {"nr": <bus address>, "name": "…"}')

    def board(self) -> dict:
        data = source.read(self.cfg["influx"], self.fetch)
        a = self.cfg.get("aussen") or {}
        if data is not None and a.get("measurement") and a.get("temp") and a.get("feuchte"):
            data["aussen"] = source.read_outdoor(self.cfg["influx"], a, self.fetch)
            data["aussen_name"] = a.get("name") or self.t["outdoor"]
        return board.build(data, self.cfg.get("fuehler"), self.clock(), self.tz, self.t)
