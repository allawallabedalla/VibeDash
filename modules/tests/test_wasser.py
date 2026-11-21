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


def tile(b, label):
    return next(t for t in sec(b, "Jetzt")["tiles"] if t["label"] == label)


class WasserBoard(unittest.TestCase):
    def test_today_from_meter_difference(self):
        b = build(meter())
        t = tile(b, "Heute")
        self.assertEqual(b["sections"][0]["slot"], "home")
        self.assertEqual(t["home"], "Wasser")  # the start page shows this tile under "Wasser"
        self.assertEqual(t["value"], "60")  # 7:00 one 60 l step, 19:00 still to come
        self.assertEqual(t["state"], "ok")
        self.assertEqual(len(t["spark"]), 13)  # the hours of today, 0 to 12 o'clock

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
        self.assertEqual(d["partial"], 29)  # today runs
        self.assertEqual(h["partial"], 47)  # the running hour
        self.assertIn("n = 9", d["note"])
        self.assertTrue(h.get("more") and d.get("more"))  # second level

    def test_compare_per_person(self):
        # 120 l a day, 2 people -> 60 l each, next to Germany 121, world ≈ 95, basic need 50
        b = board.build(meter(), dict(LIVE), NOW, TZ, board.TEXT, personen=2)
        c = next(s for s in b["sections"] if s["title"] == "Je Person und Tag im Vergleich")
        self.assertEqual(c["type"], "series")
        ours, de_, world, need = (ln["values"] for ln in c["lines"])
        self.assertEqual(set(v for v in ours if v is not None), {60})
        self.assertEqual((set(de_), set(world), set(need)), ({121}, {95}, {50}))  # flat reference lines
        self.assertTrue(all(ln["dashed"] for ln in c["lines"][1:]))
        self.assertIn("2 Personen", c["note"])
        self.assertNotIn("Je Person und Tag im Vergleich", [s["title"] for s in build(meter())["sections"]])

    def test_compare_waits_for_whole_days(self):
        b = board.build(meter(days=1.5), dict(LIVE), NOW, TZ, board.TEXT, personen=2)
        c = next(s for s in b["sections"] if s["title"] == "Je Person und Tag im Vergleich")
        self.assertLessEqual(sum(v is not None for v in c["lines"][0]["values"]), 1)
        self.assertIn("ersten ganzen Tagen", c["note"])

    def test_since_due_date(self):
        b = build(meter())
        t = tile(b, "Seit Stichtag")
        self.assertEqual(t["unit"], "m³")
        self.assertTrue(t["value"].startswith("61,"))  # 100 + 10 days × 120 l + 60 l − 40

    def test_quiet_nights_no_hint(self):
        b = build(meter())
        self.assertFalse(any(s.get("title") == "Hinweis" for s in b["sections"]))
        self.assertEqual(tile(b, "Dicht?")["value"], "dicht")
        self.assertEqual(tile(b, "Dicht?")["state"], "ok")
        n = sec(b, "Nachtverbrauch 2–5 Uhr")
        self.assertEqual(n["values"][-1], 0)

    def test_three_nights_with_use_give_a_question(self):
        b = build(meter(night_l=4))
        hint = sec(b, "Hinweis")["items"][0]
        self.assertIn("nachts", hint["text"])
        self.assertTrue(hint["text"].endswith("4 l, 4 l, 4 l."))
        self.assertIn("Haupthahn zu? Zähler beobachten", hint["meta"])
        self.assertEqual(tile(b, "Dicht?")["value"], "Leck-Verdacht")
        self.assertEqual(tile(b, "Dicht?")["state"], "look")
        self.assertIn("Nacht 4 l", tile(b, "Dicht?")["sub"])

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
        self.assertIn("seit", tile(b, "Heute")["sub"])
        self.assertEqual(tile(b, "Dicht?")["value"], "sammelt")
        self.assertEqual(tile(b, "Dicht?")["state"], "open")

    def test_outage_and_status_warn(self):
        t = tile(build(meter(), {**LIVE, "ausfall": True}), "Heute")
        self.assertEqual(t["state"], "act")
        self.assertIn("sendet nicht", t["sub"])
        t = tile(build(meter(), {**LIVE, "status": "LEAK"}), "Heute")
        self.assertEqual(t["state"], "act")
        self.assertIn("Status LEAK", t["sub"])

    def test_base_offline_uses_stored_values(self):
        rows = meter()
        b = board.build(rows, None, NOW + 3600, TZ, board.TEXT)
        self.assertIn("antwortet nicht", sec(b, "Zustand")["text"])
        self.assertEqual(tile(b, "Heute")["state"], "act")  # data missing for an hour

    def test_nothing_yet(self):
        b = board.build([], {}, NOW, TZ, board.TEXT)
        self.assertEqual(tile(b, "Heute")["value"], "–")
        self.assertEqual(sec(b, "Wasserbezüge heute")["items"][0]["text"], "noch keine Werte")
        self.assertEqual(pruefe(b), [])

    def test_state_line(self):
        txt = sec(build(meter()), "Zustand")["text"]
        self.assertEqual(txt, "Funk −83 dBm · Batterie 9,9 Jahre · Status OK · letztes Telegramm vor 12 s")

    def test_rules(self):
        for b in (build(meter()), build(meter(night_l=4)), build(meter(steady=True))):
            self.assertEqual(pruefe(b), [])


def minuten(flows, t0, t1, start=100.0, skip=None):
    """Rows like the collector writes them to the minute: flows {minute time: litres}; a point on every new reading
    (the litres of a minute read 23 s after its end, as the collector does), else every 15 min. skip = (a, b): none."""
    rows, stand, last_w = [], start, None
    t = t0
    while t <= t1:
        lit = flows.get(t, 0)
        stand += lit / 1000
        if not (skip and skip[0] <= t < skip[1]) and (lit or last_w is None or t - last_w >= 900):
            rows.append({"t": t + 83, "zaehlerstand_m3": round(stand, 3), "stichtag_m3": 40.0, "status": "OK"})
            last_w = t
        t += 60
    return rows


def fluss(start, per_min):
    """{minute time: litres} from start on, one entry per minute (0 = a minute without water)."""
    return {start + 60 * i: v for i, v in enumerate(per_min) if v}


def haushalt(day=None, night_l=0):
    """A synthetic day to the minute (no house data): WC, shower, washing machine fillings, hands, hand washing."""
    day = day or at(2026, 3, 10, 0)
    f = {}
    f |= fluss(day + 6 * 3600 + 45 * 60, [3, 3])  # 6:45 WC 6 l
    f |= fluss(day + 7 * 3600, [8] * 6)  # 7:00 shower 48 l
    f |= fluss(day + 7 * 3600 + 20 * 60, [1])  # 7:20 hands
    for m, v in ((0, [7]), (12, [5, 3]), (20, [1]), (30, [8]), (50, [6, 2])):  # 9:00 washing machine
        f |= fluss(day + 9 * 3600 + m * 60, v)
    f |= fluss(day + 11 * 3600, [4, 2])  # 11:00 WC 6 l
    if night_l:
        f |= fluss(day + 3 * 3600, [night_l])
    return f


def tag(night_l=0, days=4, now=NOW):
    """Rows of `days` synthetic days up to now, the same household every day."""
    first = at(2026, 3, 10, 0) - days * 86400
    f = {}
    for k in range(days + 1):
        f |= haushalt(first + k * 86400, night_l)
    return minuten(f, first - 3600, now)


def draws(f, t0=None, t1=None, **kw):
    t0 = t0 if t0 is not None else at(2026, 3, 10, 0)
    rows = minuten(f, t0, t1 if t1 is not None else t0 + 86399, **kw)
    return board.bezuege(board.readings(rows), t0, t0 + 86400)


D0 = at(2026, 3, 10, 0)


class WasserBezuege(unittest.TestCase):
    def test_wc(self):
        (d,) = draws(fluss(D0 + 3600, [3, 3]))
        self.assertEqual((d["liter"], d["art"]), (6, "wc"))
        self.assertEqual(d["text"], "vermutlich WC")
        self.assertAlmostEqual(d["ende"] - d["start"], 120, delta=1)

    def test_short(self):
        (d,) = draws(fluss(D0 + 3600, [2]))
        self.assertEqual(d["art"], "kurz")

    def test_shower(self):
        (d,) = draws(fluss(D0 + 7 * 3600, [8] * 6))
        self.assertEqual((d["liter"], d["art"]), (48, "dusche"))

    def test_garden(self):
        (d,) = draws(fluss(D0 + 18 * 3600, [10] * 30))
        self.assertEqual((d["liter"], d["art"]), (300, "garten"))

    def test_machine_pushes_are_one_draw(self):
        f = {}
        for m, v in ((0, [7]), (12, [5, 3]), (20, [1]), (30, [8]), (50, [6, 2])):
            f |= fluss(D0 + 9 * 3600 + m * 60, v)
        f |= fluss(D0 + 10 * 3600 + 30 * 60, [1])  # hands 40 min later: not part of the machine
        ds = draws(f)
        self.assertEqual([d["art"] for d in ds], ["maschine", "kurz"])
        self.assertEqual((ds[0]["liter"], ds[0]["schuebe"]), (32, 4))  # the 1 l in between belongs to it
        self.assertEqual(ds[0]["text"], "vermutlich Wasch- oder Spülmaschine")

    def test_two_pushes_are_no_machine(self):
        ds = draws(fluss(D0 + 9 * 3600, [7]) | fluss(D0 + 9 * 3600 + 20 * 60, [8]))
        self.assertEqual([d["art"] for d in ds], ["wc", "wc"])  # 7 l and 8 l in a minute: two flushes, no machine

    def test_trickling_tap_is_no_machine(self):
        # hand washing: 2–3 l a minute, three times within half an hour – no minute with 4 l
        f = {}
        for m in (0, 10, 20):
            f |= fluss(D0 + 12 * 3600 + m * 60, [2, 3])
        ds = draws(f)
        self.assertNotIn("maschine", [d["art"] for d in ds])

    def test_pauses_up_to_4_min_belong_together(self):
        (d,) = draws(fluss(D0 + 3600, [2, 0, 0, 0, 0, 2]))  # 4 minutes without water in between
        self.assertEqual(d["liter"], 4)
        ds = draws(fluss(D0 + 3600, [2, 0, 0, 0, 0, 0, 2]))  # 5 minutes: two draws
        self.assertEqual([d["liter"] for d in ds], [2, 2])

    def test_data_gap_is_no_draw_time(self):
        f = fluss(D0 + 14 * 3600, [5])
        ds = draws(f, skip=(D0 + 13 * 3600, D0 + 14 * 3600))
        self.assertEqual([d["art"] for d in ds], ["unklar"])
        self.assertLess(ds[0]["start"], D0 + 13 * 3600 + 1)  # from the last point before the gap

    def test_window(self):
        rows = minuten(haushalt(), D0, D0 + 86399)
        rd = board.readings(rows)
        self.assertEqual([d["art"] for d in board.bezuege(rd, D0 + 8 * 3600, D0 + 12 * 3600)], ["maschine", "wc"])


class WasserAnsicht(unittest.TestCase):
    def test_list_today_newest_first(self):
        b = build(tag())
        items = sec(b, "Wasserbezüge heute")["items"]
        self.assertTrue(items[0]["text"].startswith("11:00–11:02 · 6 l · vermutlich WC"))
        texts = [i["text"] for i in items]
        self.assertEqual(len(texts), 5)
        self.assertTrue(any("48 l · vermutlich Dusche oder Bad" in x for x in texts))
        self.assertTrue(any("vermutlich Wasch- oder Spülmaschine" in x for x in texts))
        self.assertIn("4 Schübe", next(i["meta"] for i in items if "Spülmaschine" in i["text"]))
        self.assertTrue(sec(b, "Wasserbezüge gestern").get("more"))
        self.assertFalse(sec(b, "Wasserbezüge heute").get("more"))

    def test_list_at_most_15(self):
        f = {}
        for k in range(20):
            f |= fluss(D0 + 3600 + k * 600, [2])
        b = build(minuten(f, D0 - 7200, NOW))
        items = sec(b, "Wasserbezüge heute")["items"]
        self.assertEqual(len(items), 16)
        self.assertEqual(items[-1]["text"], "… und 5 weitere")
        self.assertTrue(items[0]["text"].startswith("04:10–04:11"))  # newest first

    def test_quarter_hours_with_gaps(self):
        rows = [r for r in tag() if not (at(2026, 3, 10, 4) <= r["t"] < at(2026, 3, 10, 5))]
        w = sec(build(rows), "Wann lief Wasser?")
        self.assertEqual(len(w["values"]), 96)
        self.assertEqual(w["labels"][28], "07:00")
        self.assertEqual(w["values"][28], 48)  # the shower
        self.assertEqual(w["values"][26:28], [0, 6])  # 6:30 nothing, 6:45 the WC
        self.assertIsNone(w["values"][17])  # 4:15: no data – a gap, never 0
        self.assertIsNone(w["values"][60])  # 15:00 is still to come
        self.assertEqual([r["id"] for r in w["ranges"]], ["heute", "gestern"])
        self.assertEqual(w["ranges"][1]["values"][28], 48)
        self.assertEqual(w["group"], "tag")
        # the running quarter (lighter, "bis jetzt" in the lens): the one NOW lies in; yesterday has none
        q = w["partial"]
        self.assertEqual((q, w["labels"][q]), (48, "12:00"))  # NOW is noon
        self.assertIsNone(w["values"][q + 1])
        self.assertEqual(w["ranges"][0]["partial"], q)
        self.assertNotIn("partial", w["ranges"][1])

    def test_tight(self):
        t = tile(build(tag()), "Dicht?")
        self.assertEqual((t["value"], t["state"]), ("dicht", "ok"))
        self.assertTrue(t["sub"].startswith("Nacht 0 l · längste Pause"))

    def test_leak_suspicion_with_action(self):
        b = build(tag(night_l=3))
        t = tile(b, "Dicht?")
        self.assertEqual((t["value"], t["state"]), ("Leck-Verdacht", "look"))
        self.assertIn("Nacht 3 l", t["sub"])
        self.assertEqual(tile(b, "Heute")["state"], "look")
        self.assertIn("Haupthahn zu? Zähler beobachten", sec(b, "Hinweis")["items"][0]["meta"])

    def test_today_vs_usual(self):
        t = tile(build(tag(days=4)), "Heute")
        self.assertEqual(t["value"], "93")  # 6 + 48 + 1 + 32 + 6 l up to noon
        self.assertIn("üblich ≈ 93 l bis jetzt (93–93 l, n = 4 Tage)", t["sub"])

    def test_usual_only_from_3_days(self):
        t = tile(build(tag(days=2)), "Heute")
        self.assertIn("üblich: sammelt (2 von 3 Tagen)", t["sub"])
        self.assertNotIn("≈", t["sub"])

    def test_usual_is_the_median_with_range(self):
        rows = tag(days=4)
        extra = at(2026, 3, 8, 8)  # two days ago 20 l more in the morning
        for r in rows:
            if r["t"] >= extra:
                r["zaehlerstand_m3"] = round(r["zaehlerstand_m3"] + 0.02, 3)
        rows.append({"t": extra, "zaehlerstand_m3": rows[0]["zaehlerstand_m3"], "status": "OK"})
        self.assertIn("(93–113 l, n = 4 Tage)", tile(build(rows), "Heute")["sub"])

    def test_first_level_is_short(self):
        b = board.build(tag(night_l=3), dict(LIVE), NOW, TZ, board.TEXT, personen=2)
        first = [s["title"] for s in b["sections"] if not s.get("more")]
        self.assertEqual(
            first,
            ["Jetzt", "Hinweis", "Wann lief Wasser?", "Wasserbezüge heute", "Je Person und Tag im Vergleich"],
        )
        more = [s["title"] for s in b["sections"] if s.get("more")]
        self.assertEqual(
            more,
            [
                "Wasserbezüge gestern",
                "Verbrauch je Stunde",
                "Verbrauch je Tag",
                "Nachtverbrauch 2–5 Uhr",
                "Zustand",
                "Zählerstand",
            ],
        )
        self.assertEqual(pruefe(b), [])

    def test_meter_reading_without_long_decimals(self):
        b = build(meter())
        st = sec(b, "Zählerstand")
        self.assertTrue(st["text"].startswith("101 m³ und 200 l"))
        self.assertIn("101,200", st["info"]["what"])

    def test_rules_minute_data(self):
        for b in (build(tag()), build(tag(night_l=3)), build(tag(days=1))):
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
        self.assertEqual(tile(b, "Heute")["value"], "60")
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
