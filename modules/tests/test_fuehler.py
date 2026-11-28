"""Module "fuehler" on synthetic sensors (no network): tiles, silent sensor hint, course with gaps, 24 h table."""

import unittest
import urllib.parse

from tests.helpers import TZ, at
from vibedash_modules.fuehler import Module, board, source
from vibedash_modules.regeln import pruefe

NOW = at(2026, 3, 10, 12)
CFG = {"influx": {"db": "haus"}, "fuehler": [{"nr": 1, "name": "Keller"}, {"nr": 2}]}


def data(silent_since=None, gap=None):
    """Sensor 1 answers every minute (−1,5 … 3,5 °C over the day), sensor 2 the same 2 K warmer; sensor 2 falls silent
    at silent_since; gap = (from, to) without readings of sensor 1."""
    last = {"1": {"t": NOW - 30, "temp": -1.5, "feuchte": 76.8}}
    last["2"] = {"t": silent_since if silent_since else NOW - 40, "temp": 0.5, "feuchte": 70.2}
    course = {}
    for sid in source.SPANS:
        c = course[sid] = {"1": {}, "2": {}}
        for x in board._grid(NOW, sid):
            ts = x / 1000
            v = -1.5 + 5 * ((ts % 86400) / 86400)
            if not (gap and gap[0] <= ts < gap[1]):
                c["1"][x] = (v, 76.0)
            if not silent_since or ts < silent_since:
                c["2"][x] = (v + 2, 70.0)
    stats = {
        "1": {"tmin": -1.5, "tmax": 3.5, "tmean": 1.0, "hmin": 70, "hmax": 80, "hmean": 76.0, "n": 1440},
        "2": {"tmin": 0.5, "tmax": 5.5, "tmean": 3.0, "hmin": 65, "hmax": 75, "hmean": 70.0, "n": 1200},
    }
    return {"last": last, "stats": stats, "course": course}


# synthetic demo: a shed 8 m wide with a pitched roof and a loft, sensor 1 below, sensor 2 under the ridge
SKIZZE = {
    "links": "Ost",
    "rechts": "West",
    "gebaeude": [
        {
            "name": "Schuppen",
            "breite": 8,
            "traufe": 3,
            "first": 6,
            "ueberstand": 0.4,
            "boeden": [{"h": 3.2, "name": "Boden"}],
            "raeume": [{"name": "Werkstatt", "x": 5, "y": 0, "b": 3, "h": 2.4}],
        }
    ],
    "orte": [
        {"nr": 1, "gebaeude": "Schuppen", "x": 6.5, "y": 1.2, "seite": "l"},
        {"nr": 2, "gebaeude": "Schuppen", "x": 4, "y": 5.2, "name": "First"},
        {"nr": 3, "gebaeude": "fehlt", "x": 1, "y": 1},
    ],
}


def build(d, fuehler=CFG["fuehler"], now=NOW, skizze=None):
    return board.build(d, fuehler, now, TZ, board.TEXT, skizze)


def sec(b, title):
    return next(s for s in b["sections"] if s.get("title") == title)


class Feuchte(unittest.TestCase):
    def test_dew_point_and_absolute_humidity(self):
        # reference values (Magnus over water): 20 °C / 50 % -> 9,3 °C, 8,6 g/m³; 0 °C / 100 % -> 0 °C, 4,8 g/m³
        self.assertAlmostEqual(board.dew_point(20, 50), 9.26, places=1)
        self.assertAlmostEqual(board.abs_humidity(20, 50), 8.63, places=1)
        self.assertAlmostEqual(board.dew_point(0, 100), 0.0, places=6)
        self.assertAlmostEqual(board.abs_humidity(0, 100), 4.85, places=1)
        self.assertIsNone(board.dew_point(5, 0))
        self.assertIsNone(board.abs_humidity(None, 50))

    def test_airing(self):
        t = board.TEXT
        self.assertEqual(board._air(5.0, 4.4, t), "trocknet")
        self.assertEqual(board._air(5.0, 5.6, t), "feuchtet")
        self.assertEqual(board._air(5.0, 5.3, t), "egal")
        self.assertEqual(board._air(5.0, None, t), "–")


class FuehlerBoard(unittest.TestCase):
    def test_sketch(self):
        b = build(data(silent_since=NOW - 3600), skizze=SKIZZE)
        s = sec(b, "Wo die Fühler sitzen")
        self.assertEqual(s["type"], "sketch")
        self.assertEqual((s["left"], s["right"]), ("Ost", "West"))
        (p,) = s["panels"]
        self.assertEqual(p["box"], [-1.5, -0.8, 9.5, 6.8])
        kinds = [ln["kind"] for ln in p["lines"]]
        self.assertEqual(kinds, ["ground", "wall", "wall", "floor", "room"])
        roof = p["lines"][2]["points"]
        self.assertEqual(roof[1], [4.0, 6.0])
        floor = p["lines"][3]["points"]  # 0,2 m above the eaves: 0,27 m in from each wall
        self.assertAlmostEqual(floor[0][0], 0.2667, places=3)
        self.assertEqual([lb["text"] for lb in p["labels"]], ["Boden", "Werkstatt"])
        p1, p2 = p["pins"]
        self.assertEqual((p1["label"], p1["value"], p1["sub"], p1["side"]), ("Keller", "−1,5 °C", "77 %", "l"))
        self.assertEqual((p2["label"], p2["value"], p2["state"]), ("First", "–", "look"))
        self.assertNotIn("sub", p2)  # silent sensor: hollow, no value
        self.assertEqual(pruefe(b), [])

    def test_sketch_ignores_broken_config(self):
        bad = {"gebaeude": [{"name": "x"}, "kaputt", {"name": "y", "breite": 5, "traufe": 3}], "orte": [{"nr": 1}]}
        s = sec(build(data(), skizze=bad), "Wo die Fühler sitzen")
        self.assertEqual(len(s["panels"]), 1)  # flat roof, no pins
        self.assertEqual(s["panels"][0]["pins"], [])
        self.assertFalse(any(x["type"] == "sketch" for x in build(data(), skizze={"gebaeude": []})["sections"]))

    def test_condensation_hint(self):
        d = data()
        d["last"]["1"].update(temp=2.0, feuchte=95.0)
        b = build(d)
        t1 = sec(b, "Jetzt")["tiles"][0]
        self.assertEqual(t1["state"], "look")
        self.assertIn("Keller: Luft nur 0,7 K über dem Taupunkt", sec(b, "Hinweise")["items"][0]["text"])
        self.assertEqual(pruefe(b), [])

    def test_absolute_humidity_with_outdoor(self):
        d = data()
        o_course = {sid: {x: (-3.0, 90.0) for x in board._grid(NOW, sid)} for sid in source.SPANS}
        d["aussen"] = {"last": {"t": NOW - 60, "temp": -8.0, "feuchte": 60.0}, "course": o_course}  # 1,5 g/m³
        d["aussen_name"] = "Hof"
        b = build(d)
        s = sec(b, "Absolute Feuchte")
        self.assertEqual([ln["label"] for ln in s["lines"]], ["Fühler 1 · Keller", "Fühler 2", "Hof"])
        self.assertEqual(s["lines"][2]["values"][0], 3.5)
        rows = sec(b, "Letzte 24 Stunden")["rows"]
        self.assertEqual(rows[0]["cells"]["abs"], "3,4")  # −1,5 °C / 76,8 %
        self.assertEqual(rows[0]["cells"]["air"], "trocknet")
        self.assertEqual(pruefe(b), [])

    def test_absolute_humidity_without_outdoor(self):
        b = build(data())
        s = sec(b, "Absolute Feuchte")
        self.assertEqual(len(s["lines"]), 2)
        self.assertEqual(sec(b, "Letzte 24 Stunden")["rows"][0]["cells"]["air"], "–")

    def test_tiles_now(self):
        b = build(data())
        t1, t2 = sec(b, "Jetzt")["tiles"]
        self.assertEqual((t1["label"], t1["value"], t1["unit"]), ("Keller", "−1,5", "°C"))
        self.assertEqual(t1["sub"], "77 % rF · Taupunkt −5,0 °C")
        self.assertEqual(t2["label"], "Fühler 2")
        self.assertEqual(len(t1["spark"]), 96)
        self.assertEqual(pruefe(b), [])
        self.assertFalse(any(s["title"] == "Hinweise" for s in b["sections"]))

    def test_silent_sensor_is_a_question(self):
        b = build(data(silent_since=NOW - 2 * 3600))
        t2 = sec(b, "Jetzt")["tiles"][1]
        self.assertEqual((t2["state"], t2["sub"]), ("look", "keine Antwort seit 10:00"))
        item = sec(b, "Hinweise")["items"][0]
        self.assertIn("Fühler 2 antwortet seit 10:00 nicht", item["text"])
        self.assertEqual(item["meta"], "seit 2 h")

    def test_gap_stays_empty(self):
        b = build(data(gap=(NOW - 3 * 3600, NOW - 2 * 3600)))
        vals = sec(b, "Temperatur")["ranges"][0]["lines"][0]["values"]
        self.assertEqual(sum(v is None for v in vals), 4)  # four quarter hours without a reading
        self.assertEqual([r["id"] for r in sec(b, "Luftfeuchte")["ranges"]], ["tag", "woche", "monat"])

    def test_table_second_level_with_n(self):
        b = build(data())
        tab = sec(b, "Letzte 24 Stunden")
        self.assertTrue(tab["more"])
        r = tab["rows"][0]
        self.assertEqual(r["cells"]["min"], "−1,5 °C")
        self.assertEqual(r["cells"]["n"], "1440")
        self.assertEqual(r["chart"], {"value": 1.0, "err": 2.5})
        self.assertEqual((tab["chart"]["min"], tab["chart"]["max"]), (-5.0, 10.0))

    def test_without_config_every_seen_sensor(self):
        b = build(data(), fuehler=None)
        self.assertEqual([t["label"] for t in sec(b, "Jetzt")["tiles"]], ["Fühler 1", "Fühler 2"])

    def test_no_database(self):
        b = build(None)
        self.assertTrue(all(t["state"] == "open" for t in sec(b, "Jetzt")["tiles"]))
        self.assertEqual(build(None, fuehler=None)["sections"][0]["type"], "text")
        self.assertEqual(build({"last": {}, "stats": {}, "course": {}}, fuehler=None)["sections"][0]["type"], "text")


class FuehlerSource(unittest.TestCase):
    def test_queries_and_parse(self):
        asked = []

        def fetch(url, timeout):
            q = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)["q"][0]
            asked.append(q)
            if "LIMIT 1" in q:
                vals = [[1000, 2.2, 76.8]]
                cols = ["time", "temp_c", "feuchte_pct"]
            elif "count(" in q:
                vals = [[0, 1.0, 3.0, 2.0, 70, 80, 75, 10]]
                cols = ["time", "tmin", "tmax", "tmean", "hmin", "hmax", "hmean", "n"]
            else:
                vals = [[900000, 2.0, 70.0]]
                cols = ["time", "t", "h"]
            return {"results": [{"series": [{"name": "m", "tags": {"fuehler": "6"}, "columns": cols, "values": vals}]}]}

        d = source.read({"db": "haus"}, fetch)
        self.assertEqual(d["last"]["6"], {"t": 1.0, "temp": 2.2, "feuchte": 76.8})
        self.assertEqual(d["stats"]["6"]["n"], 10)
        self.assertEqual(d["course"]["woche"]["6"], {900000: (2.0, 70.0)})
        self.assertEqual(len(asked), 5)
        self.assertTrue(all('"rs485_klima"' in q for q in asked))

    def test_database_down(self):
        def fetch(url, timeout):
            raise OSError("down")

        self.assertIsNone(source.read({"db": "haus"}, fetch))

    def test_module_config(self):
        with self.assertRaises(ValueError):
            Module({"influx": {}}, None)
        with self.assertRaises(ValueError):
            Module({"influx": {"db": "x"}, "fuehler": [{"nr": "6"}]}, None)
        m = Module(CFG, None, fetch=lambda u, t: {"results": [{}]}, clock=lambda: NOW)
        self.assertEqual(sec(m.board(), "Jetzt")["tiles"][0]["sub"], "noch keine Messung")


if __name__ == "__main__":
    unittest.main()
