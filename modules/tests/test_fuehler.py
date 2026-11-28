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


def build(d, fuehler=CFG["fuehler"], now=NOW):
    return board.build(d, fuehler, now, TZ, board.TEXT)


def sec(b, title):
    return next(s for s in b["sections"] if s.get("title") == title)


class FuehlerBoard(unittest.TestCase):
    def test_tiles_now(self):
        b = build(data())
        t1, t2 = sec(b, "Jetzt")["tiles"]
        self.assertEqual((t1["label"], t1["value"], t1["unit"]), ("Keller", "−1,5", "°C"))
        self.assertEqual(t1["sub"], "77 % rF · gerade eben")
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
