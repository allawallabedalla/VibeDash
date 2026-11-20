"""Rule checker (regeln.py, G-27 … G-34): the boards of all modules pass it; each rule finds its counter-example."""

import json
import threading
import unittest
import urllib.request
from unittest import mock

from vibedash_modules.app import serve
from vibedash_modules.regeln import MAX_ERSTE_EBENE, pruefe, pruefe_text

from .boards import all_boards
from .helpers import cleanup, folder

# Known violations of today's boards, each with its audit ID: module -> {beginning of the violation: ID}.
# Fix the cause, then delete the line – a stale exception fails as well (G-34). Nothing new goes here without an ID.
AUSNAHMEN = {
    # "Nur zum Ausprobieren – schaltet nichts …" under the charge timeline, above it the charging buttons
    "auto": {"Abschnitt 4 „Ladefenster ausprobieren“ note: „schaltet nichts“": "P4-08"},
    # the learning-progress table is to go (Audit05 proposal 5: "Lernstand-Tabelle streichen")
    "ml": {"Abschnitt 2 „Lernstand aller Modelle“: Tabelle ohne Grafik-Spalte": "DE4-06"},
}


def _tiles(*tiles):
    return {"sections": [{"type": "tiles", "title": "T", "tiles": list(tiles)}]}


class TestBoardsOfAllModules(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.boards = all_boards()

    def test_every_module_has_a_board(self):
        from vibedash_modules import KNOWN

        self.assertEqual(sorted(self.boards), sorted(KNOWN))

    def test_no_violations_but_the_known_ones(self):
        for name, b in self.boards.items():
            known = AUSNAHMEN.get(name, {})
            found = pruefe(b)
            with self.subTest(modul=name):
                self.assertEqual([v for v in found if not any(v.startswith(k) for k in known)], [])
                stale = [k for k in known if not any(v.startswith(k) for v in found)]
                self.assertEqual(stale, [], "fixed – delete the exception")


class TestRules(unittest.TestCase):
    def test_clean_board(self):
        b = {
            "sections": [
                {"type": "tiles", "title": "Jetzt", "tiles": [{"label": "Akku", "value": "−3,2", "unit": "kW"}]},
                {"type": "text", "title": "Hinweis", "text": "Mo–Fr 6–8 Uhr, 2026-10-19, Wert 0,0 · n = 3"},
            ]
        }
        self.assertEqual(pruefe(b), [])

    def test_a_placeholders(self):
        for bad in ("Lernstand None %", "NaN kWh", "null", "undefined", "[object Object]"):
            with self.subTest(bad=bad):
                self.assertTrue(any("Platzhalter" in v for v in pruefe_text(bad)))
        self.assertEqual(pruefe_text("Nonetheless nullable"), [])

    def test_b_minus_zero(self):
        for bad in ("−0,0 kW", "-0,0", "-0 %", "(−0)"):
            with self.subTest(bad=bad):
                self.assertTrue(any("Minus vor null" in v for v in pruefe_text(bad)))
        self.assertEqual(pruefe_text("−0,5 kW"), [])

    def test_c_hyphen_minus(self):
        self.assertTrue(any("Bindestrich" in v for v in pruefe_text("Netz -1,1 kW")))
        for ok in ("−1,1 kW", "2026-10-19", "1-2 Wörter", "Mo-Fr", "PLA-1"):
            with self.subTest(ok=ok):
                self.assertEqual(pruefe_text(ok), [])

    def test_d_emoji(self):
        self.assertTrue(any("Emoji" in v for v in pruefe_text("Tipp 🌱")))
        self.assertTrue(any("Emoji" in v for v in pruefe_text("☀ Sonne")))
        self.assertEqual(pruefe_text("✓ ≈ ± ▲ ▼ ° · –"), [])

    def test_g_claim_only_without_switches(self):
        note = {"type": "text", "title": "Info", "text": "Nur lesen – gesteuert wird nichts."}
        choice = {"type": "choice", "title": "Laden", "id": "laden:x", "selected": "a", "options": []}
        self.assertEqual(pruefe({"sections": [note]}), [])
        self.assertTrue(any("G-29" in v for v in pruefe({"sections": [choice, note]})))
        # an option may describe itself
        own = {**choice, "options": [{"value": "aus", "label": "Aus", "sub": "VibeDash schaltet nichts"}]}
        self.assertEqual(pruefe({"sections": [own]}), [])

    def test_i_table_needs_a_chart(self):
        rows = [{"cells": {"a": "1"}}]
        t = {"type": "table", "title": "Werte", "columns": [{"key": "a", "label": "A"}], "rows": rows}
        self.assertTrue(any("G-31" in v for v in pruefe({"sections": [t]})))
        chart = {"kind": "bar", "label": "A"}
        self.assertEqual(pruefe({"sections": [{**t, "chart": chart}]}), [])
        self.assertEqual(pruefe({"sections": [{**t, "title": "Ereignisse"}]}), [])  # a log
        self.assertEqual(pruefe({"sections": [{**t, "rows": []}]}), [])  # nothing shown

    def test_first_level_short(self):
        sec = {"type": "text", "title": "x", "text": "x"}
        self.assertEqual(pruefe({"sections": [sec] * MAX_ERSTE_EBENE}), [])
        self.assertTrue(any("G-27" in v for v in pruefe({"sections": [sec] * (MAX_ERSTE_EBENE + 1)})))
        more = [sec] * MAX_ERSTE_EBENE + [{**sec, "more": True}] * 5
        self.assertEqual(pruefe({"sections": more}), [])

    def test_percent_spark_0_to_100(self):
        self.assertEqual(pruefe(_tiles({"label": "Akku", "value": "50", "unit": "%", "spark": [0, None, 100]})), [])
        self.assertTrue(
            any("G-30" in v for v in pruefe(_tiles({"label": "Akku", "value": "5", "unit": "%", "spark": [120]})))
        )
        self.assertEqual(pruefe(_tiles({"label": "Leistung", "value": "5", "unit": "kW", "spark": [120]})), [])

    def test_ids_and_colours_are_no_text(self):
        b = {"sections": [{"type": "choice", "title": "Wahl", "id": "x:null", "selected": "null", "options": []}]}
        self.assertEqual(pruefe(b), [])

    def test_not_a_board(self):
        self.assertEqual(pruefe([]), ["Board ist kein Objekt"])


class TestGesund(unittest.TestCase):
    """/gesund names the violations of the last board answer; ok stays untouched (a hint only)."""

    def setUp(self):
        self.base = folder()
        self.srv = serve("127.0.0.1", 0, self.base)
        self.url = f"http://127.0.0.1:{self.srv.server_address[1]}"
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()

    def tearDown(self):
        self.srv.shutdown()
        self.srv.server_close()
        cleanup(self.base)

    def get(self, path):
        with urllib.request.urlopen(self.url + path, timeout=5) as r:
            return json.loads(r.read())

    def test_hint_after_a_board(self):
        from vibedash_modules import app

        with mock.patch.object(app, "pruefe", return_value=["Platzhalter „None“ (G-28)"]):
            self.get("/board/wartung")
        g = self.get("/gesund")
        self.assertEqual((g["ok"], g["regeln"]["wartung"]), (True, ["Platzhalter „None“ (G-28)"]))
        self.get("/board/wartung")  # the real board is clean
        self.assertEqual(self.get("/gesund")["regeln"]["wartung"], [])


if __name__ == "__main__":
    unittest.main()
