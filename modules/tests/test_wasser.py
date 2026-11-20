"""Module "wasser" on a synthetic water meter (no network): use today/per hour/per day, night use, leak hints, state."""

import json
import os
import shutil
import tempfile
import unittest
import urllib.parse

from tests.helpers import TZ, at
from vibedash_modules.config import load_modules
from vibedash_modules.regeln import pruefe
from vibedash_modules.wasser import Module, board, source

NOW = at(2026, 3, 10, 12)  # Tuesday noon
QUELLE = "http://192.0.2.9/text_sensor/werte"


def meter(days=10, night_l=0, steady=False, start=100.0, now=NOW, gap=None):
    """Rows like the collector writes: a point every 15 min, 60 l at 7:15 and 19:15."""
    rows, stand = [], start
    t = now - days * 86400
    while t <= now:
        h = (t - at(2026, 3, 1, 0)) % 86400 / 3600
        if gap and gap[0] <= t < gap[1]:
            t += 900
            continue
        if steady:
            stand += 0.002  # 2 l per quarter hour, never still
        elif 7.25 <= h < 7.5 or 19.25 <= h < 19.5:
            stand += 0.06
        elif night_l and 3.25 <= h < 3.5:
            stand += night_l / 1000
        rows.append(
            {
                "t": t,
                "zaehlerstand_m3": round(stand, 3),
                "stichtag_m3": 40.0,
                "batterie_jahre": 9.9,
                "rssi": -82.0,
                "ausfall": False,
                "status": "OK",
            }
        )
        t += 900
    return rows


LIVE = {
    "alter_s": 12,
    "zaehlerstand_m3": None,
    "stichtag_m3": 40.0,
    "batterie_jahre": 9.9,
    "status": "OK",
    "rssi": -83,
    "ausfall": False,
}


def build(rows, live=None, now=NOW):
    return board.build(rows, live if live is not None else dict(LIVE), now, TZ, board.TEXT)


def sec(b, title):
    return next(s for s in b["sections"] if s.get("title") == title)


class WasserBoard(unittest.TestCase):
    def test_today_from_meter_difference(self):
        b = build(meter())
        tile = b["sections"][0]["tiles"][0]
        self.assertEqual(b["sections"][0]["slot"], "home")
        self.assertEqual(tile["value"], "60")  # 7:00 one 60 l step, 19:00 still to come
        self.assertIn("gestern 120 l", tile["sub"])
        self.assertEqual(tile["state"], "ok")
        self.assertEqual(len(tile["spark"]), 24)

    def test_hours_and_days(self):
        b = build(meter())
        h = sec(b, "Verbrauch je Stunde")
        self.assertEqual(len(h["values"]), 48)
        self.assertEqual(h["values"][-6], 60)  # 7 o'clock today
        self.assertEqual(
            sum(v for v in h["values"] if v), 240
        )  # 19:15 two days ago, yesterday 7:15 + 19:15, today 7:15
        d = sec(b, "Verbrauch je Tag")
        self.assertEqual(len(d["values"]), 30)
        self.assertEqual(d["values"][-2], 120)
        self.assertIsNone(d["values"][0])  # before the data: gap, never 0
        self.assertEqual(d["mean"], 120.0)
        self.assertIn("n 9", sec(b, "Zähler")["tiles"][2]["sub"])

    def test_compare_per_person(self):
        # 120 l a day, 2 people -> 60 l each, next to Germany 121, world ≈ 95, basic need 50
        b = board.build(meter(), dict(LIVE), NOW, TZ, board.TEXT, personen=2)
        c = next(s for s in b["sections"] if s["title"] == "Je Person und Tag im Vergleich")
        self.assertEqual(c["values"], [60, 121, 95, 50])
        self.assertIn("2 Personen", c["note"])
        self.assertNotIn("Je Person und Tag im Vergleich", [s["title"] for s in build(meter())["sections"]])

    def test_compare_waits_for_whole_days(self):
        b = board.build(meter(days=1.5), dict(LIVE), NOW, TZ, board.TEXT, personen=2)
        c = next(s for s in b["sections"] if s["title"] == "Je Person und Tag im Vergleich")
        self.assertIsNone(c["values"][0])
        self.assertIn("sammelt", c["note"])

    def test_since_due_date(self):
        b = build(meter())
        t = sec(b, "Zähler")["tiles"][1]
        self.assertEqual(t["unit"], "m³")
        self.assertTrue(t["value"].startswith("61,"))  # 100 + 10 days × 120 l + 60 l − 40

    def test_quiet_nights_no_hint(self):
        b = build(meter())
        self.assertFalse(any(s.get("title") == "Hinweis" for s in b["sections"]))
        self.assertEqual(sec(b, "Zähler")["tiles"][3]["value"], "kein Hinweis")
        n = sec(b, "Nachtverbrauch 2–5 Uhr")
        self.assertEqual(n["values"][-1], 0)

    def test_three_nights_with_use_give_a_question(self):
        b = build(meter(night_l=4))
        hint = sec(b, "Hinweis")["items"][0]
        self.assertIn("nachts", hint["text"])
        self.assertTrue(hint["text"].endswith("4 l, 4 l, 4 l."))
        self.assertEqual(sec(b, "Zähler")["tiles"][3]["state"], "look")

    def test_two_nights_are_not_enough(self):
        rows = meter(night_l=4)
        # the night before yesterday stays quiet: take the 3 l away again from 3:00 on that day on
        cut = at(2026, 3, 8, 3)
        for r in rows:
            if r["t"] >= cut:
                r["zaehlerstand_m3"] = round(r["zaehlerstand_m3"] - 0.004, 3)
        self.assertIsNone(board.night_hint(board.nights(board.readings(rows), [r["t"] for r in rows], NOW, TZ)))

    def test_steady_use_gives_a_hint(self):
        b = build(meter(steady=True))
        texts = [i["text"] for i in sec(b, "Hinweis")["items"]]
        self.assertTrue(any("dauerhaft" in x for x in texts))

    def test_hole_in_data_is_no_steady_hint(self):
        b = build(meter(steady=True, gap=(NOW - 5 * 3600, NOW - 3 * 3600)))
        texts = (
            [i["text"] for i in sec(b, "Hinweis")["items"]]
            if any(s.get("title") == "Hinweis" for s in b["sections"])
            else []
        )
        self.assertFalse(any("dauerhaft" in x for x in texts))
        h = sec(b, "Verbrauch je Stunde")["values"]
        self.assertIsNone(h[-5])  # 8 o'clock: no point, the hole stays empty
        self.assertIsNone(h[-6])

    def test_first_day_counts_from_first_value(self):
        b = build(meter(days=0.2))
        tile = b["sections"][0]["tiles"][0]
        self.assertIn("seit", tile["sub"])
        self.assertEqual(sec(b, "Zähler")["tiles"][3]["value"], "sammelt")

    def test_outage_and_status_warn(self):
        tile = build(meter(), {**LIVE, "ausfall": True})["sections"][0]["tiles"][0]
        self.assertEqual(tile["state"], "act")
        self.assertIn("sendet nicht", tile["sub"])
        tile = build(meter(), {**LIVE, "status": "LEAK"})["sections"][0]["tiles"][0]
        self.assertEqual(tile["state"], "act")
        self.assertIn("Status LEAK", tile["sub"])

    def test_base_offline_uses_stored_values(self):
        rows = meter()
        b = board.build(rows, None, NOW + 3600, TZ, board.TEXT)
        self.assertIn("antwortet nicht", sec(b, "Zustand")["text"])
        self.assertEqual(b["sections"][0]["tiles"][0]["state"], "act")  # data missing for an hour

    def test_nothing_yet(self):
        b = board.build([], {}, NOW, TZ, board.TEXT)
        self.assertEqual(b["sections"][0]["tiles"][0]["value"], "–")
        self.assertEqual(pruefe(b), [])

    def test_state_line(self):
        txt = sec(build(meter()), "Zustand")["text"]
        self.assertEqual(txt, "Funk −83 dBm · Batterie 9,9 Jahre · Status OK · letztes Telegramm vor 12 s")

    def test_rules(self):
        for b in (build(meter()), build(meter(night_l=4)), build(meter(steady=True))):
            self.assertEqual(pruefe(b), [])


class WasserModule(unittest.TestCase):
    def setUp(self):
        self.base = tempfile.mkdtemp(prefix="vd-wasser-")

    def tearDown(self):
        shutil.rmtree(self.base, ignore_errors=True)

    def fake(self, rows, live=LIVE, down=False):
        calls = []

        def fetch(url, timeout=20):
            calls.append(url)
            if down:
                raise OSError("down")
            if url.startswith(QUELLE):
                return {"id": "text_sensor/werte", "state": json.dumps({"basis": {}, "zaehler": live})}
            q = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)["q"][0]
            assert '"wasser"' in q
            cols = ["time", *source.FIELDS]
            return {
                "results": [
                    {
                        "series": [
                            {
                                "columns": cols,
                                "values": [[int(r["t"] * 1000), *[r.get(c) for c in source.FIELDS]] for r in rows],
                            }
                        ]
                    }
                ]
            }

        return fetch, calls

    def test_board_from_influx_and_live(self):
        fetch, calls = self.fake(meter())
        m = Module({"influx": {"db": "haus"}, "quelle": QUELLE}, lambda p: p, fetch, lambda: NOW)
        b = m.board()
        self.assertEqual(b["sections"][0]["tiles"][0]["value"], "60")
        self.assertIn("vor 12 s", sec(b, "Zustand")["text"])
        self.assertEqual(len(calls), 2)

    def test_everything_down(self):
        fetch, _ = self.fake([], down=True)
        b = Module({"influx": {"db": "haus"}, "quelle": QUELLE}, lambda p: p, fetch, lambda: NOW).board()
        self.assertEqual(sec(b, "Zustand")["text"], board.TEXT["state_none"])

    def test_config(self):
        with open(os.path.join(self.base, "wasser.json"), "w") as f:
            json.dump({"influx": {"db": "haus"}}, f)
        self.assertIn("wasser", load_modules(self.base)["modules"])
        with open(os.path.join(self.base, "wasser.json"), "w") as f:
            json.dump({"influx": {}}, f)
        self.assertIn("wasser", load_modules(self.base)["errors"])


if __name__ == "__main__":
    unittest.main()
