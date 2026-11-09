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
                    _pair("s13", "s14", 0.9, "erwartet"),
                    _pair("s15", "s16", -0.6, "prüfen"),
                    {**_pair("s5", "s6", 0.8, "erwartet"), "gruppe": "erklaert"},
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
                "Sensor auffällig",
                "Selbstverständlich",
                "Neu diese Woche",
                "Weggefallen",
                "Alle nach Art",
            ],
        )
        tiles = {t["label"]: t for t in s["Zusammenhänge diese Woche"]["tiles"]}
        self.assertEqual((tiles["Gefunden"]["unit"], tiles["Gefunden"]["sub"]), ("Paare", "von 1.234 geprüften"))
        self.assertEqual(
            (tiles["Unklar"]["value"], tiles["Neu"]["value"], tiles["Sensor auffällig"]["value"]), ("1", "0", "1")
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
        # the obvious ones are one line; a strong obvious pair that is gone points to a sensor (s5/s6 only moved
        # from hours to days, s11/s12 was weak)
        self.assertTrue(s["Selbstverständlich"]["text"].startswith("1 Paare mit naheliegendem Grund"))
        self.assertEqual([i["text"] for i in s["Sensor auffällig"]["items"]], ["S13 und s14 steigen gemeinsam"])
        self.assertIn("0,90", s["Sensor auffällig"]["items"][0]["info"])
        self.assertNotIn('"look"', json.dumps(b))
        # news are only unclear pairs
        self.assertEqual(s["Neu diese Woche"]["items"], [])
        self.assertEqual([i["text"] for i in s["Weggefallen"]["items"]], ["S15 sinkt, wenn s16 steigt"])
        rows = s["Alle nach Art"]["rows"]
        # the kind as a muted line under the pair; one column per figure, named in the heading, n with its unit
        self.assertEqual([r["note"] for r in rows], ["unklar", "erklärt", "Sonne/Zeit"])
        cols = s["Alle nach Art"]["columns"]
        self.assertEqual([c["label"] for c in cols], ["Zusammenhang", "Stärke", "ohne Tagesgang", "Daten"])
        self.assertTrue(cols[3]["phone"])
        self.assertEqual(rows[0]["cells"], {"p": rows[0]["cells"]["p"], "r": "−0,71", "rb": "−0,55", "n": "95 Std."})
        self.assertEqual(rows[1]["cells"]["n"], "Tage")
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


def _week():
    k = TestKorrelation()
    k.setUp()
    return k.data


class TestPair(unittest.TestCase):
    """Compare two values: the picker on the board and the answer from the house as sections."""

    signale = [
        {"id": "s1", "name": "Strom", "bereich": "Energie", "ebenen": "hd"},
        {"id": "s2", "name": "Sonne", "bereich": "Wetter", "ebenen": "h"},
        {"id": "s3", "name": "Raum", "bereich": "Klima", "ebenen": "hd"},
    ]
    res = {
        "ok": True,
        "ebene": "h",
        "name_a": "Sonne",
        "name_b": "Strom",
        "einheit_a": "W/m²",
        "einheit_b": "W",
        "n": 600,
        "neff": 80.4,
        "r": 0.9,
        "r_lo": 0.85,
        "r_hi": 0.94,
        "p": 1e-9,
        "rs": 0.88,
        "rb": 0.8,
        "rb_lo": 0.7,
        "rb_hi": 0.86,
        "haelften": [0.88, 0.93],
        "versatz_h": -1,
        "r_versatz": 0.82,
        "min_ueberlappung": 336,
        "warum": "Mehr Sonne, mehr Solarstrom.",
        "verlauf": {"x": [1, 2, 3], "a": [0.1, None, -0.2], "b": [0.3, 0.1, -0.4]},
        "stufen": [{"von": 0, "bis": 40, "b": 78.2, "n": 400}, {"von": 41, "bis": 500, "b": 3000.4, "n": 200}],
    }

    def module(self, fetch):
        return Korr(URL, lambda p: p, fetch, lambda: NOW)

    def test_picker_on_board(self):
        data = {**_week(), "signale": self.signale}
        b = self.module(lambda u, t=60: data).board()
        ps = [s for s in b["sections"] if s["type"] == "pair"]
        self.assertEqual(len(ps), 1)
        p = ps[0]
        self.assertEqual([o["value"] for o in p["options"]], ["s1", "s2", "s3"])
        self.assertEqual(p["options"][1], {"value": "s2", "label": "Sonne", "group": "Wetter", "levels": ["h"]})
        self.assertNotEqual(p["a"], p["b"])
        self.assertIn(p["level"], ("h", "d"))
        # no list from the house: no picker, the rest as before
        b = self.module(lambda u, t=60: _week()).board()
        self.assertFalse([s for s in b["sections"] if s["type"] == "pair"])

    def test_calc(self):
        asked = []

        def fetch(u, t=60):
            asked.append(u)
            return self.res

        st, body = self.module(fetch).calc({"pair": {"a": "wetter.x/ä b", "b": "s1", "level": "h"}})
        self.assertEqual(st, 200)
        self.assertEqual(asked, ["http://haus.invalid/x/paar?a=wetter.x%2F%C3%A4+b&b=s1&ebene=h"])
        kinds = [s["type"] for s in body["sections"]]
        self.assertEqual(kinds, ["tiles", "text", "bars", "series"])
        tiles = {x["label"]: x for x in body["sections"][0]["tiles"]}
        self.assertEqual(tiles["Stärke"]["value"], "0,90")
        self.assertEqual(tiles["Stärke"]["sub"], "95 %: 0,85 bis 0,94")
        self.assertEqual(tiles["Stabil"]["value"], "ja")
        self.assertNotIn("Versatz", tiles)  # one hour later is not clearly stronger
        text = body["sections"][1]["text"]
        self.assertIn("Starker Gleichlauf", text)
        self.assertIn("kaum Zufall", text)
        self.assertIn("keine Ursache", text)
        bars = body["sections"][2]
        self.assertEqual(bars["labels"], ["0,00–40,0", "41,0–500"])
        self.assertEqual(bars["values"], [78, 3000])

    def test_calc_refuses_and_explains(self):
        m = self.module(lambda u, t=60: {"ok": False, "grund": "zu_selten", "namen": ["Raum"]})
        for bad in (
            {},
            {"pair": {"a": "s1", "b": 2, "level": "h"}},
            {"pair": {"a": "s1", "b": "s2", "level": "x"}},
            {"pair": {"a": "s1\n", "b": "s2", "level": "h"}},
        ):
            self.assertEqual(m.calc(bad)[0], 400)
        st, body = m.calc({"pair": {"a": "s1", "b": "s3", "level": "d"}})
        self.assertEqual(st, 200)
        self.assertEqual(body["sections"][0]["type"], "text")
        self.assertIn("Raum ändert sich zu selten", body["sections"][0]["text"])
        st, body = self.module(_broken).calc({"pair": {"a": "s1", "b": "s3", "level": "d"}})
        self.assertEqual(st, 200)
        self.assertIn("gescheitert", body["sections"][0]["text"])

    def test_weak_and_lag(self):
        from vibedash_modules.korrelation import pair

        weak = {**self.res, "r": -0.12, "p": 0.3, "rb": -0.05, "haelften": [-0.18, 0.03], "n": 100}
        secs = pair.sections(weak, {"source": "Atlas"})
        text = secs[1]["text"]
        self.assertIn("Schwacher Gleichlauf", text)
        self.assertIn("sinkt meist Strom", text)
        self.assertIn("Zufall sein", text)
        self.assertIn("unsicher", text)  # fewer than two weeks together
        self.assertNotIn("Mehr Sonne", text)  # no reason for a weak pair
        lag = {**self.res, "versatz_h": 2, "r_versatz": 0.9, "rb": 0.6}
        tiles = {x["label"]: x for x in pair.sections(lag, {"source": "Atlas"})[0]["tiles"]}
        self.assertEqual(tiles["Versatz"]["value"], "2")
        self.assertIn("Sonne folgt Strom", tiles["Versatz"]["sub"])


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
