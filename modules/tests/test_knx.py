import json
import os
import shutil
import tempfile
import unittest
from zoneinfo import ZoneInfo

from vibedash_modules.config import load_modules
from vibedash_modules.fmt import level, value_unit
from vibedash_modules.knx import Module as Knx
from vibedash_modules.knxlog import Module as KnxLog
from vibedash_modules.knxlog.board import value

from .helpers import TEMPLATES, at

TZ = ZoneInfo("Europe/Berlin")
NOW = at(2026, 10, 19, 12)
NOW_MS = int(NOW * 1000)
MIN = 60_000
DAY = 86_400_000


def _raw_bit(v):
    return f'<DPTBinary value="{v}" />'


def _raw_bytes(*b):
    return '<DPTArray value="[' + ",".join(hex(x) for x in b) + ']" />'


class TestKnxLog(unittest.TestCase):
    def setUp(self):
        self.base = tempfile.mkdtemp(prefix="vd-knxlog-")
        for f in ("knxlog.json", "knx_inventar.json"):
            shutil.copy(os.path.join(TEMPLATES, f), self.base)
        with open(os.path.join(self.base, "knxlog.json"), encoding="utf-8") as f:
            cfg = json.load(f)
        cfg.update(
            {
                "tuer_prefix": ["7/3/"],
                "bridge": {"adresse": "15.15.99", "name": "Bridge"},
                "raum_namen": {"FLUR": "Flur", "–": ""},
                "gruppen": [
                    {"label": "Heizung", "color": "import", "prefix": ["3/"]},
                    {"label": "Licht und Schalten", "color": "home", "prefix": ["1/"]},
                    {"label": "Präsenz und Türen", "color": "sun", "prefix": ["7/"]},
                ],
                "tueren": [{"enthaelt": "Haus", "name": "Haustür"}],
            }
        )
        with open(os.path.join(self.base, "knxlog.json"), "w", encoding="utf-8") as f:
            json.dump(cfg, f)
        self.data = {
            "telegramme": [  # sorted by time, as the house service sends them
                [NOW_MS - DAY + MIN, "3/2/1", "Heizung", "1.1.3", _raw_bit(1)],
                [NOW_MS - 2 * 3_600_000, "1/0/1", "Helligkeit Flur", "1.1.1", _raw_bytes(0x0C, 0x1A)],
                [NOW_MS - 90 * MIN, "1/1/1", "", "1.1.3", _raw_bit(1)],
                [NOW_MS - 30 * MIN, "1/1/1", "Licht Flur", "15.15.99", _raw_bytes(0x80)],
                [NOW_MS - 20 * MIN, "7/3/0", "Haustür", "1.1.9", _raw_bit(0)],
            ],
            "tueren": [[NOW_MS - 20 * MIN, "Haustür", 1], [NOW_MS - 10 * MIN, "Terrassentür", 0]],
            "protokoll": [
                {"zeit": NOW_MS - 90 * MIN, "raum": "FLUR", "was": "Licht an", "wie": "Taster"},
                {"zeit": NOW_MS - 80 * MIN, "raum": "FLUR", "was": "Präsenz", "wie": ""},
                {"zeit": NOW_MS - 70 * MIN, "raum": "–", "was": "! Flackern", "wie": "Hinweis"},
                {"zeit": NOW_MS - 60 * MIN, "raum": "Bad", "was": "Aktor", "wie": "Defekt"},
            ],
        }
        self.calls = []

    def tearDown(self):
        shutil.rmtree(self.base, ignore_errors=True)

    def cfg(self):
        with open(os.path.join(self.base, "knxlog.json"), encoding="utf-8") as f:
            return json.load(f)

    def fetch(self, url, timeout=30):
        self.calls.append(url)
        return self.data

    def mod(self):
        cfg = self.cfg()
        return KnxLog(cfg, lambda p: os.path.join(self.base, p), self.fetch, lambda: NOW, cache={})

    def test_template_loads(self):
        m = load_modules(self.base)
        self.assertIn("knxlog", m["modules"], m["errors"])

    def test_board(self):
        b = self.mod().board()
        s = {x["title"]: x for x in b["sections"]}
        tiles = {t["label"]: t for t in s["Letzte 24 Stunden"]["tiles"]}
        self.assertEqual(tiles["Bus"]["value"], "5")
        self.assertEqual(sum(tiles["Bus"]["spark"]), 5)
        self.assertEqual(tiles["Geräte"]["value"], "2/3")  # 1.1.2 silent; bridge and 1.1.9 are not in the list
        self.assertEqual(
            (tiles["Licht an"]["value"], tiles["Präsenz"]["value"], tiles["Türen"]["value"]), ("1", "1", "1")
        )
        self.assertEqual((tiles["Defekte"]["value"], tiles["Defekte"]["state"]), ("1", "act"))
        self.assertEqual(tiles["Defekte"]["sub"], "dazu 1 Hinweise")
        lines = {x["label"]: sum(x["values"]) for x in s["Bus-Verkehr je 15 min"]["lines"]}
        self.assertEqual(lines, {"Heizung": 1, "Licht und Schalten": 2, "Präsenz und Türen": 1})
        devs = {r["cells"]["a"]: r for r in s["Geräte"]["rows"]}
        self.assertEqual(devs["1.1.2"]["cells"]["z"], "nichts in 24 h")
        self.assertEqual(devs["1.1.2"].get("state"), "look")  # silent dimmer
        self.assertNotIn("state", devs["1.1.3"])
        self.assertEqual(devs["15.15.99"]["cells"]["g"], "Bridge-Bridge · 15.15.99")
        self.assertNotIn("state", devs["15.15.99"])
        self.assertEqual(devs["1.1.9"].get("state"), "look")  # unknown
        ev = s["Ereignisse"]["rows"]
        self.assertEqual([r["cells"]["r"] for r in ev], ["Tür", "Haustür", "Bad", "", "Flur"])
        self.assertEqual(ev[0]["cells"], {"t": "11:50:00", "r": "Tür", "e": "Tür zu"})
        self.assertEqual(ev[1]["cells"]["r"], "Haustür")
        self.assertEqual(ev[2]["state"], "act")
        self.assertEqual(ev[-1]["cells"], {"t": "10:30:00", "r": "Flur", "e": "Licht an · Taster"})
        tel = s["Telegramme"]["rows"]
        self.assertEqual(len(tel), 4)  # the brightness reading is left out
        self.assertEqual(tel[0]["cells"]["w"], "offen")
        self.assertEqual(tel[1]["cells"]["w"], "50 %")
        self.assertIn("Licht Flur (1/1/1) · Bridge", tel[1]["cells"]["o"])
        self.assertIn("Licht Flur (1/1/1) · Taster Wohnen", tel[2]["cells"]["o"])  # name from the inventory
        self.assertTrue(tel[-1]["cells"]["t"].startswith("gestern "))
        self.assertIn("von=", self.calls[0])

    def test_cached_60s(self):
        cache = {}
        clock = [NOW]
        cfg = self.cfg()
        m = KnxLog(cfg, lambda p: os.path.join(self.base, p), self.fetch, lambda: clock[0], cache=cache)
        m.board()
        clock[0] += 30
        m.board()
        self.assertEqual(len(self.calls), 1)
        clock[0] += 31
        m.board()
        self.assertEqual(len(self.calls), 2)

    def test_values(self):
        cfg = {"tuer_prefix": ["7/3/"], "prozent_prefix": ["1/"]}
        self.assertEqual(value("1/0/1", _raw_bytes(0x0C, 0x1A), cfg), "21,0")
        self.assertEqual(value("1/1/1", _raw_bit(1), cfg), "Ein")
        self.assertEqual(value("7/3/0", _raw_bit(1), cfg), "zu")
        self.assertEqual(value("4/1/1", _raw_bytes(0x80), cfg), "128")
        self.assertEqual(value("4/1/1", "kaputt", cfg), "kaputt")

    def test_house_down(self):
        def broken(url, timeout=30):
            raise OSError("down")

        cfg = self.cfg()
        b = KnxLog(cfg, lambda p: os.path.join(self.base, p), broken, lambda: NOW, cache={}).board()
        self.assertEqual(b["sections"][0]["tiles"][0]["value"], "0")


class TestKnx(unittest.TestCase):
    def setUp(self):
        self.base = tempfile.mkdtemp(prefix="vd-knx-")
        shutil.copy(os.path.join(TEMPLATES, "knx.json"), self.base)
        day = int(at(2026, 10, 18, 0) * 1000)
        self.data = {
            "kopf": [
                {
                    "kennzahl": "Licht an",
                    "kachel_wert": "244,1 × / Tag",
                    "kachel_kurz": "wie üblich",
                    "stufe_neu": "io",
                    "verlauf": "[1, 2, null]",
                },
                {"kennzahl": "Von Hand", "kachel_wert": "12 %", "stufe_neu": "beobachten", "verlauf": "kaputt"},
            ],
            "defekte": [{"name": "Aktor Bad", "objekt": "Kanal 3", "zeit": NOW_MS - DAY, "stufe": "nio"}],
            "arten": [{"art": "Flackern", "anzahl": 3, "vorzeitraum": 1, "haeufigste": "Flur"}],
            "tage": {
                "7d": [{"zeit": day, "Licht an (Automatik)": 10, "Licht an (Taster)": 4, "Präsenz": 30}],
                "30d": [],
                "90d": [{"zeit": day, "Licht an (Automatik)": 10}],
            },
            "alltag": [{"name": "Aufstehen", "kurz_wert": "6:40", "kurz_vgl": "wie sonst", "vergleich": "Median"}],
            "profil": [
                {"Stunde": 0, "Werktage Mo–Fr (n = 3 Tage)": 0.5},
                {"Stunde": 1, "Werktage Mo–Fr (n = 3 Tage)": 0},
            ],
            "nacht": {"7d": [{"zeit": day, "Bewegung": 2, "Licht": 1}], "30d": [], "90d": []},
            "karten": [
                {
                    "raum": "Flur",
                    "idee_kurz": "Nachtlicht",
                    "wirkung_kurz": "−3",
                    "wirkung_pm": "± 1",
                    "sicherheit_text": "sicher",
                }
            ],
            "licht": [{"raum": "Flur", "an_hell_text": "12 %", "hand_trotz_melder_text": None}],
        }

    def tearDown(self):
        shutil.rmtree(self.base, ignore_errors=True)

    def test_template_loads(self):
        self.assertIn("knx", load_modules(self.base)["modules"])

    def test_board(self):
        m = Knx({"einschub_url": "http://haus.invalid/knx"}, lambda p: p, lambda u, t=60: self.data, lambda: NOW)
        b = m.board()
        titles = [s["title"] for s in b["sections"]]
        self.assertEqual(
            titles,
            [
                "Licht und Bedienung · 7 Tage",
                "Defekte",
                "Meldungen je Art",
                "Licht je Tag",
                "Alltag",
                "Aktivität je Stunde · Werktage Mo–Fr (n = 3 Tage)",
                "Aktivität in der Nacht",
                "Beste Licht-Ideen",
                "Licht je Raum · 7 Tage",
            ],
        )
        t = b["sections"][0]["tiles"]
        self.assertEqual((t[0]["value"], t[0]["unit"], t[0]["state"], t[0]["icon"]), ("244,1", "× / Tag", "ok", "bolt"))
        self.assertEqual((t[1]["value"], t[1]["spark"], t[1]["state"]), ("12 %", [], "look"))
        d = b["sections"][1]
        self.assertEqual(d["items"][0], {"text": "Aktor Bad · Kanal 3", "meta": "18.10. 12:00", "state": "act"})
        light = b["sections"][3]
        self.assertEqual([r["id"] for r in light["ranges"]], ["7d", "90d"])  # empty 30 days left out
        self.assertEqual(light["x"], [int(at(2026, 10, 18, 12) * 1000)])
        night = b["sections"][6]
        self.assertEqual([x["dashed"] for x in night["lines"]], [False, True])
        self.assertEqual(b["sections"][7]["items"][0]["text"], "Flur: Nachtlicht (−3 ± 1)")
        self.assertEqual(b["sections"][8]["rows"][0]["cells"]["t"], "–")

    def test_house_down_keeps_defects_section(self):
        def broken(url, timeout=60):
            raise OSError("down")

        b = Knx({"einschub_url": "http://haus.invalid/knx"}, lambda p: p, broken, lambda: NOW).board()
        self.assertEqual([s["title"] for s in b["sections"]], ["Defekte"])
        self.assertEqual(b["sections"][0]["note"], "0 Meldungen in 7 Tagen, neueste zuerst.")

    def test_fmt(self):
        self.assertEqual(value_unit("97 ± 2 %"), ("97 ± 2 %", None))
        self.assertEqual(level("NIO"), "act")


if __name__ == "__main__":
    unittest.main()
