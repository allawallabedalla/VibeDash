import json
import os
import tempfile
import unittest
from unittest import mock
from zoneinfo import ZoneInfo

from vibedash_modules.auto import risiko

from .helpers import at

TZ = ZoneInfo("Europe/Berlin")


class TestRisiko(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="vd-risiko-")
        self.f = os.path.join(self.dir, "auto", "risiko.json")

    def test_default_until_chosen_and_back_after_midnight(self):
        self.assertEqual(risiko.current(self.f, TZ, at(2026, 10, 20, 9)), "sicher")
        d = risiko.store(self.f, "mutig", TZ, at(2026, 10, 20, 9))
        self.assertEqual((d["stufe"], d["alpha"], d["bis"]), ("mutig", 0.25, "2026-10-20"))
        self.assertEqual(risiko.current(self.f, TZ, at(2026, 10, 20, 23)), "mutig")
        self.assertEqual(risiko.current(self.f, TZ, at(2026, 10, 21, 0)), "sicher")

    def test_unknown_or_broken_file_is_safe(self):
        os.makedirs(os.path.dirname(self.f))
        with open(self.f, "w") as fh:
            json.dump({"stufe": "wild", "bis": "2099-01-01"}, fh)
        self.assertEqual(risiko.current(self.f, TZ, at(2026, 10, 20)), "sicher")
        with open(self.f, "w") as fh:
            fh.write("{kaputt")
        self.assertEqual(risiko.current(self.f, TZ, at(2026, 10, 20)), "sicher")

    def test_until_kwh_holds_over_midnight_and_ends_after_max_days(self):
        d = risiko.store(self.f, "mittel", TZ, at(2026, 10, 22, 7), bis_kwh=10)
        self.assertEqual((d["stufe"], d["bis_kwh"]), ("mittel", 10))
        self.assertNotIn("bis", d)
        self.assertEqual(risiko.current(self.f, TZ, at(2026, 10, 23, 9)), "mittel")
        self.assertEqual(risiko.current(self.f, TZ, at(2026, 10, 29, 6)), "mittel")
        self.assertEqual(risiko.current(self.f, TZ, at(2026, 10, 29, 8)), "sicher")
        # the house's planner ended it: file says sicher
        with open(self.f, "w") as fh:
            json.dump({"stufe": "sicher", "vorher": "mittel", "gesetzt": d["gesetzt"]}, fh)
        self.assertEqual(risiko.current(self.f, TZ, at(2026, 10, 22, 9)), "sicher")
        # "sicher" itself is never stored "until x kWh"
        self.assertNotIn("bis_kwh", risiko.store(self.f, "sicher", TZ, at(2026, 10, 22, 9), bis_kwh=10))

    def test_note_names_the_limit_and_progress(self):
        self.assertIn("Mitternacht", risiko.section("mittel", None)["note"])
        plan = {"risiko": {"stufe": "mittel", "geladen_kwh": 3.4, "bis_kwh": 10}}
        n = risiko.section("mittel", plan, 10)["note"]
        self.assertIn("bis das Auto 10 kWh geladen hat (bisher 3,4 kWh)", n)
        self.assertIn("„Mittel“ und „Mutig“ gelten", risiko.section("sicher", plan, 10)["note"])
        self.assertNotIn("bisher", risiko.section("sicher", plan, 10)["note"])
        self.assertNotIn("bisher", risiko.section("mittel", None, 10)["note"])

    def test_section_shows_kwh_per_level_when_the_plan_has_them(self):
        plan = {
            "stufen": {"sicher": {"tage_kwh": [18.1]}, "mittel": {"tage_kwh": [23.4]}, "mutig": {"tage_kwh": [28.4]}}
        }
        s = risiko.section("mittel", plan)
        self.assertEqual((s["type"], s["id"], s["selected"]), ("choice", "laden:risiko", "mittel"))
        self.assertEqual([o["value"] for o in s["options"]], ["sicher", "mittel", "mutig"])
        self.assertIn("23 kWh", s["options"][1]["sub"])
        self.assertTrue(all("von 100" in o["sub"] for o in risiko.section("sicher", None)["options"]))


class TestModuleAction(unittest.TestCase):
    def test_choose_stores_and_board_shows_it(self):
        from vibedash_modules.auto import Module

        base = tempfile.mkdtemp(prefix="vd-auto-")
        with open(os.path.join(base, "prognose.json"), "w") as fh:
            json.dump({}, fh)
        cfg = {"prognose": "prognose.json", "zeitzone": "Europe/Berlin", "risiko": {"datei": "auto/risiko.json"}}
        m = Module(cfg, lambda p: p if os.path.isabs(p) else os.path.join(base, p), clock=lambda: at(2026, 10, 20, 9))
        self.assertEqual(m.action({"item": "laden:risiko", "action": "choose", "value": "mittel"})[0], 200)
        self.assertEqual(m.action({"item": "laden:risiko", "action": "choose", "value": "wild"})[0], 400)
        self.assertEqual(m.action({"item": "plan:x", "action": "choose", "value": "mittel"})[0], 404)
        secs = m.board()["sections"]
        c = next(s for s in secs if s.get("type") == "choice")
        self.assertEqual(c["selected"], "mittel")
        # a control: first on the page, in the top slot
        self.assertIs(secs[0], c)
        self.assertEqual(c["slot"], "top")
        kwh = Module({**cfg, "risiko": {"datei": "auto/risiko.json", "bis_kwh": 10}}, m.path, clock=m.clock)
        st, body = kwh.action({"item": "laden:risiko", "action": "choose", "value": "mutig"})
        self.assertEqual((st, body["text"]), (200, "Laden: Mutig bis 10 kWh geladen"))
        self.assertEqual(
            kwh.action({"item": "laden:risiko", "action": "choose", "value": "sicher"})[1]["text"], "Laden: Sicher"
        )
        no = Module({k: v for k, v in cfg.items() if k != "risiko"}, m.path, clock=m.clock)
        self.assertFalse(any(s.get("type") == "choice" for s in no.board()["sections"]))
        both = Module({**cfg, "steuerung": {"status_url": "http://h/s"}}, m.path, clock=m.clock)
        with mock.patch("vibedash_modules.auto.steuerung.status", return_value={"knoepfe": {"aktiv": "automatik"}}):
            secs = both.board()["sections"]
        self.assertEqual([s.get("id") for s in secs[:2]], ["laden:modus", "laden:risiko"])


if __name__ == "__main__":
    unittest.main()
