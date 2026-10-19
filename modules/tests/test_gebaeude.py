import json
import os
import shutil
import tempfile
import unittest

from vibedash_modules.config import load_modules
from vibedash_modules.gebaeude import Module
from vibedash_modules.gebaeude.board import blocks, de

from .helpers import TEMPLATES

RESULT = {
    "stand": "2026-10-19T05:40+02:00",
    "auskuehlen": {
        "status": "ok",
        "tau_h": 200,
        "tau_lo": 180,
        "tau_hi": 240,
        "c_kwh_k": 30.0,
        "c_lo": 27.2,
        "c_hi": 36.6,
        "nacht_k": -0.5,
        "n_naechte": 20,
        "text": "Methode A",
    },
    "sonne": {
        "status": "ok",
        "haus": {"aequiv_k": 1.04, "lo": 0.5, "hi": 1.6, "n_tage": 30},
        "raeume": [
            {"raum": "Wohnen", "klarer_tag_k": 0.7, "se": 0.1, "messbar": True},
            {"raum": "Bad", "klarer_tag_k": -0.04, "se": 0.2, "messbar": False},
        ],
        "text": "Methode S",
    },
    "wp_tageszeit": {
        "status": "ok",
        "cop_je_k": 0.25,
        "cop_je_k_se": 0.08,
        "cop_n": 6,
        "wp_kwh_je_stunde": [0.1] * 24,
        "wp_kwh_tag": 2.4,
        "anteil_mittag": 0.17,
        "netz_rest": 0.4,
        "netz_mittag": 0.05,
        "szenario_kwh_tag": 1.0,
        "strom_weniger_kwh_woche": 0.8,
        "cop_gewinn_pct": 12.4,
        "ta_mittag": 13.0,
        "ta_rest": 8.5,
        "netz_weniger_kwh_woche": 1.5,
        "text": "Methode W",
    },
    "warmwasser": {
        "status": "ok",
        "laeufe": 10,
        "anteil_pv_zeit": 0.1,
        "kwh_lauf": 1.0,
        "je_stunde": [0] * 7 + [4] + [0] * 10 + [3] + [0] * 5,
        "duschen": 1,
        "dusch_status": "sammelt",
        "feuchte_tage": 3,
        "text": "Methode WW",
    },
    "pv_prognose": {
        "status": "ok",
        "stundenmodell": {"status": "sammelt", "n": 6},
        "alt": {
            "status": "ok",
            "von": "2026-03-18",
            "bis": "2026-10-18",
            "lagen": [
                {"lage": "klar", "n": 60, "bias": -20.0, "bias_se": 2.0},
                {"lage": "bedeckt", "n": 50, "bias": 0.9, "bias_se": 2.4},
            ],
        },
        "text": "Methode PV",
    },
    "kippfenster": {
        "status": "ok",
        "mehr_pct": 90.4,
        "mehr_se_pct": 30.0,
        "kwh_nacht": 2.0,
        "kwh_lo": 0.4,
        "kwh_hi": 4.1,
        "text": "Methode K",
    },
    "haustuer": {"status": "ok", "effekt_k": -0.05, "se_k": 0.04, "n": 70, "text": "Methode T"},
}


class TestGebaeude(unittest.TestCase):
    def setUp(self):
        self.base = tempfile.mkdtemp(prefix="vd-gebaeude-")
        shutil.copy(os.path.join(TEMPLATES, "gebaeude.json"), self.base)
        self.file = os.path.join(self.base, "gebaeude_ergebnis.json")

    def tearDown(self):
        shutil.rmtree(self.base, ignore_errors=True)

    def write(self, result):
        with open(self.file, "w", encoding="utf-8") as f:
            json.dump(result, f)

    def board(self):
        m = load_modules(self.base)
        self.assertIn("gebaeude", m["modules"], m["errors"])
        return m["modules"]["gebaeude"].board()

    def test_no_result_yet(self):
        b = self.board()
        self.assertEqual(b["sections"][0]["title"], "Noch kein Ergebnis")

    def test_full_board(self):
        self.write(RESULT)
        b = self.board()
        self.assertEqual(b["updated"], int(os.path.getmtime(self.file) * 1000))
        titles = [s["title"] for s in b["sections"]]
        self.assertEqual(
            titles,
            [
                "Gebäude in Zahlen",
                "Was das heißt",
                "Wärmepumpe je Tageszeit",
                "Warmwasser-Läufe je Tageszeit",
                "Sonne je Raum",
                "PV-Prognose je Wetterlage",
            ],
        )
        tiles = {t["label"]: t for t in b["sections"][0]["tiles"]}
        self.assertEqual(tiles["Auskühlen"]["sub"], "τ (180–240) · 0,50 K je Nacht ohne Heizung")
        self.assertEqual(tiles["Speicher"]["value"], "30")
        self.assertEqual(tiles["WP-COP"]["value"], "+0,25")
        self.assertEqual((tiles["Wasser"]["value"], tiles["Wasser"]["state"]), ("10", "look"))
        self.assertEqual(tiles["Kippfenster"]["value"], "≈ 2,0")
        self.assertEqual(tiles["Auskühlen"]["info"]["what"], "Methode A")
        levers = b["sections"][1]["items"]
        self.assertTrue(levers[0]["text"].startswith("Warmwasser mittags laden: 90 % der Läufe"))
        self.assertIn("meist 7 und 18 Uhr", levers[0]["text"])
        self.assertEqual(
            [x["meta"] for x in levers], ["Hebel", "Abschätzung", "Befund", "Befund", "Befund", "Prognose"]
        )
        self.assertTrue(levers[-1]["text"].endswith("sammelt (6 von 20 Tagen)."))
        self.assertTrue(all(len(x["text"]) <= 200 for x in levers))
        ww = b["sections"][3]
        self.assertEqual(ww["values"], [0, 0, 4, 0, 0, 0, 3, 0])
        self.assertEqual(ww["note"], "Duschen (Bad-Feuchte): sammelt (1 erkannt, Feuchte seit 3 Tagen)")
        sun = b["sections"][4]["rows"]
        self.assertEqual(sun[1]["cells"], {"r": "Bad", "k": "−0,0 ± 0,6", "m": "nein"})
        pv = b["sections"][5]
        self.assertEqual(pv["rows"][0]["state"], "look")
        self.assertNotIn("state", pv["rows"][1])
        self.assertEqual(pv["note"], "Alte Tagesprognose 2026-03–2026-10; − = zu niedrig.")

    def test_collecting(self):
        self.write(
            {"auskuehlen": {"status": "sammelt", "text": "erst 3 Nächte (ab 10)"}, "sonne": {"status": "fehler"}}
        )
        b = self.board()
        tiles = b["sections"][0]["tiles"]
        self.assertEqual([t["label"] for t in tiles], ["Auskühlen", "Sonne"])
        self.assertEqual(tiles[0]["sub"], "erst 3 Nächte (ab 10)")
        self.assertEqual(b["sections"][1]["items"], [])

    def test_texts_override(self):
        self.write(RESULT)
        m = Module({"ergebnis": self.file, "texte": {"sun_note": "Eigener Hinweis."}}, lambda p: p)
        self.assertEqual(m.board()["sections"][4]["note"], "Eigener Hinweis.")

    def test_broken_file(self):
        with open(self.file, "w") as f:
            f.write("[1, 2")
        self.assertEqual(self.board()["sections"][0]["type"], "text")

    def test_missing_config_key(self):
        with open(os.path.join(self.base, "gebaeude.json"), "w") as f:
            json.dump({}, f)
        self.assertIn("gebaeude", load_modules(self.base)["errors"])

    def test_helpers(self):
        self.assertEqual(de(-1.25, 1, plus=True), "−1,2")
        self.assertEqual(blocks([1] * 24)[1], [3] * 8)


if __name__ == "__main__":
    unittest.main()
