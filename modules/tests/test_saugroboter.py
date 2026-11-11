import json
import os
import shutil
import unittest
import urllib.parse

from vibedash_modules.config import load_modules
from vibedash_modules.saugroboter import Module

from .helpers import TEMPLATES, at

NOW = at(2026, 11, 11, 14)
MS = int(NOW * 1000)


class TestSaugroboter(unittest.TestCase):
    def setUp(self):
        self.last = {
            "V50 Ultra complete": {"batterie": 65.0, "status": 3, "online": 1.0, "t": MS - 120_000},
            "MOVA E20": {"batterie": 100.0, "status": 13, "online": 1.0, "t": MS - 120_000},
        }
        self.fail = False

    def fetch(self, url, timeout=20):
        if self.fail:
            raise OSError("influx down")
        q = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)["q"][0]
        if q.startswith("SELECT last("):
            f = q.split('last("')[1].split('"')[0]
            return {
                "results": [
                    {
                        "series": [
                            {
                                "name": "saugroboter",
                                "tags": {"geraet": n},
                                "columns": ["time", "last"],
                                "values": [[v["t"], v[f]]],
                            }
                            for n, v in self.last.items()
                        ]
                    }
                ]
            }
        x = [MS - 3_600_000, MS - 2_700_000, MS - 1_800_000]
        return {
            "results": [
                {
                    "series": [
                        {
                            "name": "saugroboter",
                            "tags": {"geraet": "V50 Ultra complete"},
                            "columns": ["time", "mean"],
                            "values": [[x[0], 80.0], [x[1], 72.0], [x[2], 65.0]],
                        }
                    ]
                }
            ]
        }

    def board(self, cfg=None):
        cfg = cfg or {"influx": {"db": "haus"}}
        return Module(cfg, lambda p: p, self.fetch, lambda: NOW).board()

    def tiles(self):
        return {t["label"]: t for t in self.board()["sections"][0]["tiles"]}

    def test_template_loads(self):
        base = os.path.join(os.path.dirname(__file__), "_saug_tmp")
        os.makedirs(base, exist_ok=True)
        try:
            with open(os.path.join(TEMPLATES, "saugroboter.json"), encoding="utf-8") as f:
                cfg = json.load(f)
            cfg["influx"]["db"] = "haus"
            with open(os.path.join(base, "saugroboter.json"), "w", encoding="utf-8") as f:
                json.dump(cfg, f)
            m = load_modules(base)
            self.assertIn("saugroboter", m["modules"], m["errors"])
        finally:
            shutil.rmtree(base, ignore_errors=True)

    def test_state_and_battery(self):
        t = self.tiles()
        self.assertEqual(t["V50 Ultra complete"]["value"], "pausiert")
        self.assertEqual(t["V50 Ultra complete"]["sub"], "seit 13:58 · Akku 65 %")
        self.assertEqual(t["MOVA E20"]["value"], "voll geladen")
        self.assertEqual((t["Akku V50 Ultra complete"]["value"], t["Akku V50 Ultra complete"]["unit"]), ("65", "%"))
        self.assertEqual(t["Akku V50 Ultra complete"]["spark"], [80.0, 72.0, 65.0])
        self.assertNotIn("spark", t["Akku MOVA E20"])  # no course yet
        self.assertEqual(t["V50 Ultra complete"]["icon"], "robot")
        self.assertNotIn("state", t["MOVA E20"])

    def test_error_offline_stale(self):
        self.last["V50 Ultra complete"]["status"] = 4
        self.last["MOVA E20"]["online"] = 0.0
        t = self.tiles()
        self.assertEqual((t["V50 Ultra complete"]["value"], t["V50 Ultra complete"]["state"]), ("Fehler", "act"))
        self.assertEqual((t["MOVA E20"]["value"], t["MOVA E20"]["state"]), ("offline", "look"))
        self.last["MOVA E20"]["t"] = MS - 3_600_000
        t = self.tiles()
        self.assertEqual((t["MOVA E20"]["value"], t["MOVA E20"]["sub"]), ("kein Stand", "letzter Wert 13:00"))

    def test_unknown_code_and_no_data(self):
        self.last["MOVA E20"]["status"] = 77
        self.assertEqual(self.tiles()["MOVA E20"]["value"], "Code 77")
        self.fail = True
        self.assertEqual(self.board()["sections"][0]["title"], "Noch keine Daten")

    def test_needs_db(self):
        with self.assertRaises(ValueError):
            Module({"influx": {}}, lambda p: p, self.fetch, lambda: NOW)
