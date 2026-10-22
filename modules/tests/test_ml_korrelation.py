import json
import os
import shutil
import tempfile
import unittest

from vibedash_modules.config import load_modules
from vibedash_modules.korrelation import Module as Korr
from vibedash_modules.ml import Module as Ml

from .helpers import TEMPLATES, at

NOW = at(2026, 10, 19, 12)
URL = {"einschub_url": "http://haus.invalid/x"}


def _broken(url, timeout=60):
    raise OSError("down")


class TestMl(unittest.TestCase):
    data = {
        "treffer": [
            {
                "id": "pv",
                "name": "PV-Tag",
                "korrekt_pct": 81.5,
                "zeige_pct": True,
                "n": 30,
                "art": "live",
                "zeitraum": "seit 18.09.",
                "frage": "Lag die Tagesprognose im Band?",
                "verlauf": [{"treffer_pct": 70}, {"treffer_pct": None}, {"treffer_pct": 80}],
            },
            {
                "id": "heiz",
                "name": "Heizung",
                "korrekt_pct": 90,
                "zeige_pct": True,
                "n": 9,
                "art": "nachgerechnet",
                "stufe_wort": "gut",
                "verlauf": [{"treffer_pct": 90}],
            },
            {"id": "neu", "name": "Neu", "zeige_pct": False, "n": 0, "grund": "zu wenig Daten", "ab_text": "Januar"},
            {"id": "x", "name": "Gleich", "zeige_pct": False, "grund": "ab Januar", "ab_text": "Januar"},
        ],
        "fortschritt": [
            {"id": "pv", "name": "PV-Tag", "prozent": 100, "stand_text": "fertig"},
            {"id": "heiz", "name": "Heizung", "prozent": 40, "stand_text": "40 von 100 Tagen", "eta_text": "Feb."},
        ],
    }

    def board(self, fetch=None):
        return Ml(URL, lambda p: p, fetch or (lambda u, t=60: self.data), lambda: NOW).board()

    def test_accuracy(self):
        b = self.board()
        acc, table = b["sections"]
        self.assertEqual(acc["type"], "accuracy")
        m = {x["label"]: x for x in acc["models"]}
        self.assertEqual((m["PV-Tag"]["pct"], m["PV-Tag"]["n"], m["PV-Tag"]["history"]), (81.5, 30, [70, None, 80]))
        self.assertEqual(m["PV-Tag"]["note"], "Lag die Tagesprognose im Band?")
        self.assertEqual([d["label"] for d in m["PV-Tag"]["details"]], ["Lernstand", "Stand", "Bewertet", "Seit"])
        self.assertEqual(m["PV-Tag"]["details"][-1]["value"], "18.09.")
        self.assertEqual(m["Heizung"]["history"], [])  # one point is no history
        self.assertTrue(m["Heizung"]["note"].startswith("Urteil ab 14 bewerteten Tagen – noch 5"))
        self.assertIsNone(m["Neu"]["pct"])  # open, no fake percent
        self.assertEqual(m["Neu"]["note"], "ab Januar · zu wenig Daten")
        self.assertEqual(m["Gleich"]["note"], "ab Januar")
        self.assertEqual(table["rows"][0]["state"], "ok")
        self.assertNotIn("state", table["rows"][1])
        self.assertEqual(table["rows"][1]["cells"]["e"], "Feb.")

    def test_house_down(self):
        b = self.board(_broken)
        self.assertEqual([s["type"] for s in b["sections"]], ["accuracy"])
        self.assertEqual(b["sections"][0]["models"], [])


def _pair(a, b, r, kind, level="Stunden", rb=None, daily=False):
    return {"ebene": level, "a": a, "b": b, "r": r, "rb": rb, "einordnung": kind, "nur_tagesgang": daily}


class TestKorrelation(unittest.TestCase):
    def setUp(self):
        stat = [
            {"ebene": "h", "signale": 10, "paare_getestet": 1200, "zeitraum": ["w2"]},
            {"ebene": "d", "signale": 5, "paare_getestet": 34, "zeitraum": ["w2"]},
        ]
        self.data = {
            "stand_ms": int(at(2026, 10, 19, 5) * 1000) + 20 * 60_000,
            "aktuell": {
                "statistik": stat,
                "paare": [
                    _pair("s1", "s2", 0.98, "technisch gekoppelt"),
                    {**_pair("s3", "s4", -0.71, "prüfen", rb=-0.55), "n": 95},
                    {
                        **_pair("s5", "s6", 0.6, "erwartet", level="Tage"),
                        "gruppe": "erklaert",
                        "warum": "Heizung wärmt den Raum.",
                    },
                    _pair("s7", "s8", 0.52, "prüfen", daily=True),
                    _pair("s9", "s10", 0.9, "gleicher Sensor"),
                ],
            },
            "vorwoche": {
                "statistik": [{**s, "zeitraum": ["w1"]} for s in stat],
                "paare": [
                    _pair("s2", "s1", 0.97, "technisch gekoppelt"),
                    _pair("s4", "s3", -0.7, "prüfen"),
                    _pair("s11", "s12", 0.5, "erwartet"),
                ],
            },
            "namen": {"s3": "Temperatur Bad", "s4": "Feuchte Bad"},
        }

    def board(self, fetch=None):
        return Korr(URL, lambda p: p, fetch or (lambda u, t=60: self.data), lambda: NOW).board()

    def test_board(self):
        b = self.board()
        s = {x["title"]: x for x in b["sections"]}
        self.assertEqual(
            list(s),
            [
                "Zusammenhänge diese Woche",
                "Was steckt dahinter",
                "Unklar",
                "Erklärt",
                "Neu diese Woche",
                "Weggefallen",
                "Alle nach Art",
            ],
        )
        tiles = {t["label"]: t for t in s["Zusammenhänge diese Woche"]["tiles"]}
        self.assertEqual((tiles["Gefunden"]["unit"], tiles["Gefunden"]["sub"]), ("Paare", "von 1.234 geprüften"))
        self.assertEqual(
            (tiles["Unklar"]["value"], tiles["Neu"]["value"], tiles["Entfallen"]["value"]), ("1", "2", "1")
        )
        self.assertEqual((tiles["Stand"]["value"], tiles["Stand"]["sub"]), ("19.10.", "Lauf 05:20 Uhr"))
        # unclear · explained · sun/time · technical (both technical pairs at the end)
        self.assertEqual(s["Was steckt dahinter"]["labels"], ["unklar", "erklärt", "Sonne/Zeit", "Technik"])
        self.assertEqual(s["Was steckt dahinter"]["values"], [1, 1, 1, 2])
        # direction as a word, the reason behind the ⓘ of the line; without "warum" a general sentence
        self.assertEqual(
            s["Unklar"]["items"][0],
            {
                "text": "Temperatur Bad sinkt, wenn Feuchte Bad steigt",
                "meta": "Stärke −0,71 · ohne Tagesgang −0,55 · 95 Std.",
                "info": "Kein naheliegender Grund bekannt – ein Blick lohnt.",
            },
        )
        self.assertEqual(s["Erklärt"]["items"][0]["text"], "S5 und s6 steigen gemeinsam")
        self.assertEqual(s["Erklärt"]["items"][0]["info"], "Heizung wärmt den Raum.")
        self.assertNotIn('"look"', json.dumps(b))
        # news without technical pairs, unclear first; the group is named in the line
        new = s["Neu diese Woche"]["items"]
        self.assertEqual([i["text"] for i in new], ["S5 und s6 steigen gemeinsam", "S7 und s8 steigen gemeinsam"])
        self.assertTrue(new[1]["meta"].startswith("Sonne/Zeit · "))
        self.assertEqual(s["Weggefallen"]["items"][0]["text"], "S11 und s12 steigen gemeinsam")
        rows = s["Alle nach Art"]["rows"]
        self.assertEqual([r["cells"]["k"] for r in rows], ["unklar", "erklärt", "Sonne/Zeit"])
        # every figure named, n with its unit
        self.assertEqual(rows[0]["cells"]["r"], "Stärke −0,71 · ohne Tagesgang −0,55 · 95 Std.")
        self.assertEqual(s["Was steckt dahinter"]["unit"], "Paare")
        self.assertEqual(b["updated"], self.data["stand_ms"])

    def test_plural_names(self):
        self.data["namen"] = {"s3": "Busmeldungen Dimmer", "s4": "Licht Flur"}
        s = {x["title"]: x for x in self.board()["sections"]}
        self.assertEqual(s["Unklar"]["items"][0]["text"], "Licht Flur sinkt, wenn Busmeldungen Dimmer steigen")

    def test_hour_and_day_once(self):
        self.data["aktuell"]["paare"].append(_pair("s4", "s3", -0.6, "prüfen", level="Tage", rb=-0.52))
        s = {x["title"]: x for x in self.board()["sections"]}
        self.assertEqual(len(s["Unklar"]["items"]), 1)
        self.assertEqual(len(s["Alle nach Art"]["rows"]), 4)

    def test_same_week_no_compare(self):
        self.data["vorwoche"]["statistik"] = self.data["aktuell"]["statistik"]
        b = self.board()
        titles = [x["title"] for x in b["sections"]]
        self.assertNotIn("Neu diese Woche", titles)
        tiles = {t["label"]: t for t in b["sections"][0]["tiles"]}
        self.assertEqual(tiles["Neu"]["sub"], "Vergleich ab nächster Woche")

    def test_no_result(self):
        for fetch in (_broken, lambda u, t=60: {"aktuell": None}):
            b = self.board(fetch)
            self.assertEqual(b["sections"][0]["title"], "Noch kein Ergebnis")


class TestTemplates(unittest.TestCase):
    def test_load(self):
        base = tempfile.mkdtemp(prefix="vd-ml-")
        try:
            for f in ("ml.json", "korrelation.json"):
                shutil.copy(os.path.join(TEMPLATES, f), base)
            m = load_modules(base)
            self.assertEqual(sorted(m["modules"]), ["korrelation", "ml"], m["errors"])
        finally:
            shutil.rmtree(base, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
