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


class TestAktionen(unittest.TestCase):
    def setUp(self):
        self.base = os.path.join(os.path.dirname(__file__), "_saug_akt")
        os.makedirs(self.base, exist_ok=True)
        self.cfg = {
            "influx": {"db": "haus"},
            "aktionen": [
                {"id": "kochen", "name": "Nach dem Kochen", "sub": "Küche + Essen", "geraet": "V50", "raeume": [5, 8]},
                {"id": "bad", "name": "Bad OG", "geraet": "E20", "raeume": [2]},
                {"id": "kz", "name": "Nur Küche", "geraet": "V50", "zonen": ["kueche", "x"]},
            ],
            "zonen": {"kueche": {"name": "Küche", "geschoss": "EG", "rechteck_m": [3, 5, 5, 9]}},
        }

    def tearDown(self):
        shutil.rmtree(self.base, ignore_errors=True)

    def mod(self, now=NOW):
        return Module(self.cfg, lambda p: os.path.join(self.base, p), lambda u, t=20: {"results": [{}]}, lambda: now)

    def choices(self, now=NOW):
        return {s["title"]: s for s in self.mod(now).board()["sections"] if s["type"] == "choice"}

    def test_one_choice_per_robot(self):
        c = self.choices()
        self.assertEqual(list(c), ["Aktionen V50", "Aktionen E20"])
        self.assertEqual([o["value"] for o in c["Aktionen V50"]["options"]], ["kochen", "kz", "pause", "heim"])
        self.assertEqual(c["Aktionen V50"]["id"], "saug:v50")
        self.assertIsNone(c["Aktionen V50"]["selected"])

    def test_zone_action_shows_area(self):
        opts = {o["value"]: o for o in self.choices()["Aktionen V50"]["options"]}
        self.assertEqual(opts["kz"]["sub"], "Bereich: Küche, x")
        self.assertEqual(opts["kochen"]["sub"], "Küche + Essen")
        status, _ = self.mod().action({"item": "saug:v50", "action": "choose", "value": "kz"})
        self.assertEqual(status, 200)

    def test_wish_and_result(self):
        m = self.mod()
        status, body = m.action({"item": "saug:v50", "action": "choose", "value": "kochen"})
        self.assertEqual(status, 200, body)
        with open(os.path.join(self.base, "saugroboter_wunsch.json"), encoding="utf-8") as f:
            wish = json.load(f)
        self.assertEqual((wish["nr"], wish["id"], wish["geraet"]), (1, "kochen", "V50"))
        c = self.choices()
        self.assertEqual((c["Aktionen V50"]["selected"], c["Aktionen V50"]["note"]), ("kochen", "Wird gesendet …"))
        with open(os.path.join(self.base, "saugroboter_stand.json"), "w", encoding="utf-8") as f:
            json.dump({"nr": 1, "id": "kochen", "ok": True, "text": "gestartet", "zeit": MS}, f)
        c = self.choices()
        self.assertEqual((c["Aktionen V50"]["selected"], c["Aktionen V50"]["note"]), (None, "14:00: gestartet"))
        # a wish the house never took over is named after 5 min
        m.action({"item": "saug:e20", "action": "choose", "value": "heim"})
        late = self.choices(NOW + 600)["Aktionen E20"]
        self.assertTrue(late["note"].startswith("Nicht gesendet"))

    def test_rejects_unknown(self):
        m = self.mod()
        self.assertEqual(m.action({"item": "saug:v50", "action": "choose", "value": "bad"})[0], 400)
        self.assertEqual(m.action({"item": "saug:xyz", "action": "choose", "value": "pause"})[0], 404)
        self.assertEqual(m.action({"item": "saug:v50", "action": "done", "value": "pause"})[0], 404)
        self.assertFalse(os.path.exists(os.path.join(self.base, "saugroboter_wunsch.json")))
