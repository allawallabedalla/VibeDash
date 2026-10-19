import json
import os
import shutil
import tempfile
import unittest
import urllib.parse
from datetime import date, timedelta

from vibedash_modules.config import load_modules
from vibedash_modules.garten import Module
from vibedash_modules.garten.board import no_emoji

from .helpers import TEMPLATES, TZ, at

NOW = at(2026, 10, 19, 12)
TODAY = date(2026, 10, 19)


def _ms(d):
    return int(at(d.year, d.month, d.day, 0) * 1000)


def _influx(rows):
    cols = ["time", "tmax", "tmin", "regen_mm", "sonne_h", "art"]
    return {"results": [{"series": [{"columns": cols, "values": rows}]}]}


class TestGarten(unittest.TestCase):
    def setUp(self):
        self.base = tempfile.mkdtemp(prefix="vd-garten-")
        with open(os.path.join(TEMPLATES, "garten.json"), encoding="utf-8") as f:
            self.cfg = json.load(f)
        rows = []
        for k in range(1, 31):  # looking back: 1 mm a day, 3 mm a week ago
            d = TODAY - timedelta(days=k)
            rows.append([_ms(d), 12.0, 4.0, 3.0 if k == 7 else 1.0, 2.0, "gemessen"])
        for k in range(4):  # forecast: frost on day 2
            d = TODAY + timedelta(days=k)
            rows.append([_ms(d), 10.4 + k, -1.2 if k == 2 else 3.0, 0.5 * k, 3.6, "prognose"])
        rows.append([_ms(TODAY), 99, 99, 99, 99, "prognose_v1"])  # other kinds are ignored
        self.rows = rows
        self.urls = []
        history = [
            {"date": (TODAY - timedelta(days=k)).isoformat(), "tip": f"- Tipp {k}a – mehr\n- Tipp {k}b: Details 🌱"}
            for k in range(12, -1, -1)
        ]
        with open(os.path.join(self.base, "garden_history.json"), "w", encoding="utf-8") as f:
            json.dump(history, f, ensure_ascii=False)

    def tearDown(self):
        shutil.rmtree(self.base, ignore_errors=True)

    def fetch(self, url, timeout=20):
        self.urls.append(url)
        if "open-meteo" in url:
            q = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)
            days = [TODAY + timedelta(days=k) for k in range(-int(q["past_days"][0]), int(q["forecast_days"][0]))]
            return {
                "daily": {
                    "time": [d.isoformat() for d in days],
                    "temperature_2m_max": [15.0] * len(days),
                    "temperature_2m_min": [5.0] * len(days),
                    "precipitation_sum": [2.0] * len(days),
                    "sunshine_duration": [7200.0] * len(days),
                }
            }
        return _influx(self.rows)

    def mod(self, cfg):
        return Module(cfg, lambda p: p if os.path.isabs(p) else os.path.join(self.base, p), self.fetch, lambda: NOW)

    def influx_cfg(self):
        return {**self.cfg, "wetter": "influx", "influx": {"db": "haus"}}

    def test_template_loads(self):
        shutil.copy(os.path.join(TEMPLATES, "garten.json"), self.base)
        m = load_modules(self.base)
        self.assertIn("garten", m["modules"], m["errors"])

    def test_weather_tiles_from_influx(self):
        b = self.mod(self.influx_cfg()).board()
        s = {x["title"]: x for x in b["sections"]}
        tiles = {t["label"]: t for t in s["Gartenwetter"]["tiles"]}
        self.assertEqual(tiles["Heute"]["value"], "10°")
        self.assertEqual(tiles["Heute"]["unit"], "/ 3°")
        self.assertEqual(tiles["Morgen"]["sub"], "0,5 mm Regen · ≈ 4 h Sonne")
        self.assertEqual((tiles["Frost"]["value"], tiles["Frost"]["state"]), ("-1°", "look"))
        self.assertEqual(tiles["Regen Woche"]["value"], "9,0")  # 6 × 1 mm + 3 mm
        self.assertEqual(tiles["Regen Woche"]["sub"], "an 7 Tagen · Wettermodell")
        bars = s["Regen je Tag"]
        self.assertEqual(len(bars["labels"]), 11)
        self.assertEqual(bars["labels"][7], "heute")
        self.assertEqual(len(bars["ranges"][1]["values"]), 34)
        self.assertEqual(bars["values"][7:], [0.0, 0.5, 1.0, 1.5])

    def test_no_frost(self):
        self.rows = [r for r in self.rows if r[5] != "prognose"] + [
            [_ms(TODAY + timedelta(days=k)), 12, 5, 0, 1, "prognose"] for k in range(4)
        ]
        tiles = {t["label"]: t for t in self.mod(self.influx_cfg()).board()["sections"][0]["tiles"]}
        self.assertNotIn("state", tiles["Frost"])
        self.assertEqual(tiles["Frost"]["sub"], "tiefster Wert · kein Frost in 3 Tagen")

    def test_tips(self):
        s = self.mod(self.influx_cfg()).board()["sections"]
        self.assertEqual(s[2]["title"], "Tipps vom 19.10.")
        self.assertEqual([i["text"] for i in s[2]["items"]], ["Tipp 0a – mehr", "Tipp 0b: Details"])
        self.assertEqual(s[3]["title"], "Frühere Tipps")
        self.assertEqual(len(s[3]["items"]), 7)  # days 1–7 (a week back)
        self.assertEqual(s[3]["items"][0], {"text": "Tipp 1a · Tipp 1b", "meta": "18.10."})

    def test_open_meteo_cached(self):
        cfg = {"standort": {"lat": 1.5, "lon": 2.5}, "tipps": "garden_history.json"}
        cache = {}
        from vibedash_modules.garten import source

        m = self.mod(cfg)
        m.om = source.OpenMeteo(self.fetch, lambda: NOW, cache)
        b = m.board()
        m.board()
        self.assertEqual(sum("open-meteo" in u for u in self.urls), 1)
        tiles = {t["label"]: t for t in b["sections"][0]["tiles"]}
        self.assertEqual(tiles["Heute"]["value"], "15°")
        self.assertEqual(tiles["Regen Woche"]["value"], "14,0")
        self.assertEqual(b["sections"][2]["title"], "Tipps vom 19.10.")  # template path, file in the folder

    def test_no_location_is_reported(self):
        with open(os.path.join(self.base, "garten.json"), "w", encoding="utf-8") as f:
            json.dump({"wetter": "open-meteo"}, f)
        self.assertIn("garten", load_modules(self.base)["errors"])

    def test_broken_sources(self):
        def broken(url, timeout=20):
            raise OSError("down")

        m = Module(
            {**self.influx_cfg(), "tipps": "fehlt.json"}, lambda p: os.path.join(self.base, p), broken, lambda: NOW
        )
        s = m.board()["sections"]
        self.assertEqual([x["title"] for x in s], ["Gartenwetter", "Regen je Tag"])
        self.assertEqual(s[0]["tiles"], [])

    def test_no_emoji(self):
        self.assertEqual(no_emoji("Gießen ☀️  heute 🌱"), "Gießen heute")
        self.assertEqual(TZ.key, "Europe/Berlin")


if __name__ == "__main__":
    unittest.main()
