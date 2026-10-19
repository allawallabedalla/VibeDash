import json
import os
import shutil
import tempfile
import unittest

from vibedash_modules.auto import Module
from vibedash_modules.config import load_modules

from .helpers import TEMPLATES, at

NOW = at(2026, 10, 19, 16)  # 16:00 local


def _prognose():
    """Synthetic car forecast (no real car)."""
    return {
        "jetzt": NOW,
        "meldung": "2026-10-19T13:00:00Z",
        "soc_jetzt": 40.0,
        "soc_meldung": 40.0,
        "kap_kwh": 50.0,
        "geladen_seit_meldung_kwh": 0.0,
        "wirkungsgrad": {"wert": 0.9, "n": 1, "quelle": "angenommen", "werte": [0.9]},
        "status": {
            "reichweite_km": 120,
            "lade_status": "Disconnected",
            "angesteckt": False,
            "km_stand": 1000,
            "vorklima_programme": [{"start_min": 420, "tage": ["Mon", "Tue"], "an": True}],
        },
        "vorhersage": {
            "reserve_pct": 20.0,
            "tage_bis_reserve": {"frueh": 2, "mitte": 4, "spaet": 5},
            "tage": ["2026-10-19", "2026-10-20"],
            "soc_p10": [38, 30],
            "soc_p50": [39, 34],
            "soc_p90": [40, 38],
            "szenarien": 100,
        },
        "entscheidung": {"wort": "Hat Zeit", "kurz": "reicht bis übermorgen", "text": "…", "stufe": "ok"},
        "profil": {
            "tage_n": 30,
            "je_wt": [{"wt": "Mo", "n": 4, "mittel": 3.0, "p10": 1.0, "p90": 5.0}],
            "wochen": [],
            "kwh_100km": 16.0,
            "km_tag": 15.0,
            "erster_tag": "2026-09-01",
            "fahrten_n": 50,
        },
        "sonne": [{"k": 0, "tag": "2026-10-19", "kwh": 2.0, "kwh_p90": 4.0, "start": "16:00"}],
        "ladungen": [],
        "rueckblick": {},
    }


class TestAuto(unittest.TestCase):
    def setUp(self):
        self.base = tempfile.mkdtemp(prefix="vd-auto-")
        with open(os.path.join(self.base, "prognose.json"), "w", encoding="utf-8") as f:
            json.dump(_prognose(), f)
        with open(os.path.join(TEMPLATES, "auto.json"), encoding="utf-8") as f:
            self.cfg = json.load(f)
        self.cfg["prognose"] = "prognose.json"
        self.cfg["rechner"]["url"] = "http://haus.invalid/rechne"
        self.sent = []

        def post(url, body):
            self.sent.append((url, body))
            return 200, {"sections": [{"type": "text", "title": "Ergebnis", "text": "ok"}]}

        self.mod = Module(self.cfg, lambda p: os.path.join(self.base, p), post=post, clock=lambda: NOW)

    def tearDown(self):
        shutil.rmtree(self.base, ignore_errors=True)

    def test_board_slots_and_calculator(self):
        b = self.mod.board()
        types = [(s["type"], s.get("slot")) for s in b["sections"]]
        self.assertEqual(types[0], ("tiles", "top"))
        self.assertEqual(types[1], ("calc", "plan"))
        calc = b["sections"][1]
        self.assertEqual((calc["min"], calc["max"], calc["step"], calc["days"]), (960, 1425, 15, 7))
        self.assertIn(("series", "plan"), types)
        # no maker's name in the product: wording comes from texte
        self.assertNotIn("Citro", json.dumps(b, ensure_ascii=False))
        self.assertIn("Hersteller-App", json.dumps(b, ensure_ascii=False))

    def test_no_calculator_without_url(self):
        self.cfg["rechner"]["url"] = ""
        m = Module(self.cfg, lambda p: os.path.join(self.base, p), clock=lambda: NOW)
        self.assertNotIn("calc", [s["type"] for s in m.board()["sections"]])
        self.assertEqual(m.calc({"value": 1000})[0], 404)

    def test_calc_passes_value_on_and_checks_it(self):
        self.assertEqual(
            self.mod.calc({"value": 4380}), (200, {"sections": [{"type": "text", "title": "Ergebnis", "text": "ok"}]})
        )
        self.assertEqual(self.sent, [("http://haus.invalid/rechne", {"board": "auto", "value": 4380})])
        self.assertEqual(self.mod.calc({"value": "x"})[0], 400)
        self.assertEqual(self.mod.calc({"value": True})[0], 400)
        self.assertEqual(len(self.sent), 1)

    def test_missing_forecast_file_says_so(self):
        os.remove(os.path.join(self.base, "prognose.json"))
        b = self.mod.board()
        self.assertEqual(b["sections"][0]["type"], "text")

    def test_loaded_from_config(self):
        with open(os.path.join(self.base, "auto.json"), "w", encoding="utf-8") as f:
            json.dump(self.cfg, f)
        m = load_modules(self.base)
        self.assertIn("auto", m["modules"], m["errors"])
