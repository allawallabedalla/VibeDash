import json
import os
import shutil
import tempfile
import unittest
import urllib.parse
from datetime import date, timedelta

from vibedash_modules.config import load_modules
from vibedash_modules.garten import Module, source
from vibedash_modules.garten.board import no_emoji

from .helpers import TEMPLATES, TZ, at

NOW = at(2026, 10, 19, 12)
BASE = "http://192.0.2.7/werte.json"
LIVE = {
    "id": 1,
    "name": "beet",
    "alter_s": 300,
    "bodenfeuchte": 37.4,
    "boden_freq": 812,
    "lufttemp": 8.36,
    "luftfeuchte": 91.2,
    "batterie_v": 2.85,
    "rssi": -57,
    "snr": 11.0,
    "zaehler": 1281,
    "ausfall": False,
    "empfangsquote": 95.0,
    "verloren": 1,
    "nachgereicht": 3,
}
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
        self.base_live = dict(LIVE)
        self.basis = {"laufzeit_s": 7834, "uhr": NOW + 20, "wlan_rssi": -74, "verlauf": 6}
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
        if url.startswith(BASE):
            if self.base_live is None:
                raise OSError("offline")
            return {"basis": dict(self.basis), "geraete": [self.base_live]}
        if "bodenklima" in urllib.parse.unquote(url):
            x = [int((NOW - 3600 * (3 - k)) * 1000) for k in range(3)]
            return {
                "results": [
                    {
                        "series": [
                            {
                                "columns": ["time", "bodenfeuchte", "lufttemp", "luftfeuchte", "batterie_v"],
                                "values": [
                                    [x[0], 40.0, 8.0, 90.0, 3.1],
                                    [x[1], 41.0, None, 91.0, None],
                                    [x[2], 42.0, 9.5, 92.0, None],
                                ],
                            }
                        ]
                    }
                ]
            }
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
        self.assertEqual(
            (tiles["Frost"]["value"], tiles["Frost"]["state"]), ("−1°", "look")
        )  # a real minus (Audit05 G5-14)
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


class TestGartenSensor(TestGarten):
    def area_cfg(self):
        return {**self.influx_cfg(), "bereiche": [{"name": "Obstwiese", "geraet": "beet", "basis": BASE}]}

    def sections(self):
        return {s["title"]: s for s in self.mod(self.area_cfg()).board()["sections"]}

    def test_tiles_and_course(self):
        s = self.sections()
        tiles = {t["label"]: t for t in s["Obstwiese"]["tiles"]}
        self.assertEqual((tiles["Boden"]["value"], tiles["Boden"]["unit"]), ("37", "%"))
        self.assertEqual(tiles["Luft"]["value"], "8,4°")
        self.assertEqual(tiles["Feuchte"]["value"], "91")
        # 2.85 V: below 2.9 → yellow
        self.assertEqual((tiles["Batterie"]["value"], tiles["Batterie"]["state"]), ("2,85", "look"))
        self.assertEqual((tiles["Funk"]["value"], tiles["Funk"]["sub"]), ("vor 5 min", "letztes Paket"))
        self.assertNotIn("state", tiles["Funk"])
        self.assertEqual(s["Bodenfeuchte 7 Tage"]["lines"][0]["values"], [40.0, 41.0, 42.0])
        # a tap on the tile shows its course; too few values (battery) give no curve
        self.assertEqual(tiles["Boden"]["spark"], [40.0, 41.0, 42.0])
        self.assertEqual(tiles["Feuchte"]["spark"], [90.0, 91.0, 92.0])
        self.assertEqual(tiles["Boden"]["sparkTo"] - tiles["Boden"]["sparkFrom"], 2 * 3_600_000)
        self.assertNotIn("spark", tiles["Batterie"])
        self.assertNotIn("spark", tiles["Funk"])
        self.assertEqual(s["Lufttemperatur 7 Tage"]["unit"], "°C")
        # the sensor block comes right after the weather
        titles = list(s)
        self.assertEqual(titles.index("Obstwiese"), titles.index("Gartenwetter") + 1)

    def test_warnings(self):
        self.base_live.update(batterie_v=2.6, alter_s=2800, bodenfeuchte=None)
        tiles = {t["label"]: t for t in self.sections()["Obstwiese"]["tiles"]}
        self.assertEqual(tiles["Batterie"]["state"], "act")
        self.assertEqual((tiles["Funk"]["state"], tiles["Funk"]["sub"]), ("act", "Sensor still"))
        self.assertEqual((tiles["Boden"]["value"], tiles["Boden"]["sub"]), ("–", "Sonde liefert nichts"))
        self.base_live.update(alter_s=60, ausfall=True)
        tiles = {t["label"]: t for t in self.sections()["Obstwiese"]["tiles"]}
        self.assertEqual(tiles["Funk"]["state"], "act")

    def test_base_offline(self):
        self.base_live = None
        s = self.sections()
        self.assertTrue(s["Obstwiese"]["text"].startswith("Basis offline"))
        self.assertIn("Bodenfeuchte 7 Tage", s)  # the course stays visible

    def test_base_station(self):
        s = self.sections()
        tiles = {t["label"]: t for t in s["Basis-Station"]["tiles"]}
        self.assertEqual((tiles["Basis"]["value"], tiles["Basis"]["sub"]), ("online", "erreicht 12:00"))
        # newest packet at the base: 300 s ago
        self.assertEqual((tiles["Letzte Daten"]["value"], tiles["Letzte Daten"]["sub"]), ("11:55", "vor 5 min"))
        self.assertEqual(tiles["Laufzeit"]["value"], "2 h")
        self.assertEqual((tiles["WLAN"]["value"], tiles["WLAN"]["sub"]), ("−74", "Signal gut"))
        self.assertEqual((tiles["Empfang"]["value"], tiles["Empfang"]["sub"]), ("95", "1 verloren · 3 nachgereicht"))
        self.assertEqual((tiles["LoRa"]["value"], tiles["LoRa"]["sub"]), ("−57", "SNR 11,0 dB"))
        for t in tiles.values():
            self.assertNotIn("state", t)
        titles = list(s)
        self.assertEqual(titles.index("Basis-Station"), titles.index("Regen je Tag") - 1)  # after the sensor block
        self.assertEqual(sum(u.startswith(BASE) for u in self.urls), 1)  # one request per station

    def test_base_station_warnings(self):
        self.basis.update(wlan_rssi=-85, uhr=NOW - 900)
        self.base_live.update(empfangsquote=66.7, rssi=-135, snr=-13.5)
        tiles = {t["label"]: t for t in self.sections()["Basis-Station"]["tiles"]}
        self.assertEqual((tiles["Basis"]["state"], tiles["Basis"]["sub"]), ("look", "Uhr geht 15 min falsch"))
        self.assertEqual(tiles["WLAN"]["state"], "look")
        self.assertEqual(tiles["Empfang"]["state"], "look")
        self.assertEqual((tiles["LoRa"]["state"], tiles["LoRa"]["sub"]), ("look", "SNR −13,5 dB"))
        self.base_live.update(empfangsquote=40.0)
        tiles = {t["label"]: t for t in self.sections()["Basis-Station"]["tiles"]}
        self.assertEqual(tiles["Empfang"]["state"], "act")

    def test_base_station_offline(self):
        source._SEEN.clear()
        self.base_live = None
        tiles = self.sections()["Basis-Station"]["tiles"]
        self.assertEqual([(t["value"], t["state"]) for t in tiles], [("offline", "act")])
        self.assertEqual(tiles[0]["sub"], "seit Dienststart nicht erreicht")

    def test_base_station_last_seen(self):
        source._SEEN.clear()
        self.sections()  # answers at 12:00
        self.base_live = None
        later = NOW + 12 * 60
        cfg = self.area_cfg()
        m = Module(cfg, lambda p: p, self.fetch, lambda: later)
        s = {x["title"]: x for x in m.board()["sections"]}
        self.assertEqual(s["Basis-Station"]["tiles"][0]["sub"], "zuletzt 12:00 · vor 12 min")

    def test_base_station_quiet_sensor(self):
        self.base_live.update(alter_s=3042)
        tiles = {t["label"]: t for t in self.sections()["Basis-Station"]["tiles"]}
        self.assertEqual(
            (tiles["Letzte Daten"]["value"], tiles["Letzte Daten"]["sub"], tiles["Letzte Daten"]["state"]),
            ("11:09", "vor 50 min", "act"),
        )

    def test_without_areas_unchanged(self):
        titles = [s["title"] for s in self.mod(self.influx_cfg()).board()["sections"]]
        self.assertNotIn("Obstwiese", titles)
        self.assertNotIn("Basis-Station", titles)
