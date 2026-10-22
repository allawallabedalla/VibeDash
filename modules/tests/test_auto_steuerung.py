import io
import json
import unittest
import urllib.error

from vibedash_modules.auto import steuerung

CFG = {"status_url": "http://h/s", "jetzt_url": "http://h/j", "automatik_url": "http://h/a"}


class TestSteuerung(unittest.TestCase):
    def test_section_shows_the_house_state(self):
        st = {"knoepfe": {"aktiv": "jetzt"}, "text": "lädt", "plan_kurz": "heute 10–15 Uhr"}
        s = steuerung.section(st)
        self.assertEqual((s["type"], s["id"], s["selected"], s["slot"]), ("choice", "laden:modus", "jetzt", "top"))
        self.assertEqual([o["value"] for o in s["options"]], ["automatik", "jetzt"])
        self.assertIn("heute 10–15 Uhr", s["options"][0]["sub"])
        self.assertTrue(s["note"].startswith("Jetzt: lädt."))
        off = steuerung.section(None)
        self.assertIsNone(off["selected"])
        self.assertTrue(off["note"].startswith("Steuerung nicht erreichbar"))

    def test_choose_forwards_to_the_right_address(self):
        asked = []

        def post(url, is_post):
            asked.append((url, is_post))
            return 200, {"ok": True, "text": "lädt jetzt"}

        self.assertEqual(steuerung.choose(CFG, "jetzt", post), (200, {"ok": True, "text": "lädt jetzt"}))
        self.assertEqual(steuerung.choose(CFG, "automatik", post)[0], 200)
        self.assertEqual(asked, [("http://h/j", True), ("http://h/a", True)])
        self.assertEqual(steuerung.choose(CFG, "wild", post)[0], 400)
        self.assertEqual(len(asked), 2)

    def test_slow_refused_or_unreachable_house(self):
        def slow(url, is_post):
            raise TimeoutError

        self.assertEqual(steuerung.choose(CFG, "jetzt", slow)[0], 200)

        def refused(url, is_post):
            raise urllib.error.HTTPError(url, 429, "x", {}, io.BytesIO(json.dumps({"fehler": "gerade erst"}).encode()))

        self.assertEqual(steuerung.choose(CFG, "jetzt", refused), (502, {"ok": False, "text": "gerade erst"}))

        def down(url, is_post):
            raise urllib.error.URLError("refused")

        self.assertEqual(steuerung.choose(CFG, "jetzt", down)[0], 502)
        self.assertIsNone(steuerung.status(CFG, down))


class TestKabelAusSteuerung(unittest.TestCase):
    def test_module_hands_the_house_state_to_the_cable_tile_and_asks_once(self):
        import json
        import os
        import tempfile
        from unittest import mock

        from vibedash_modules.auto import Module

        from .helpers import at

        now = at(2026, 10, 22, 10)
        base = tempfile.mkdtemp(prefix="vd-kabel-")
        with open(os.path.join(base, "prognose.json"), "w") as fh:
            json.dump({"jetzt": now, "status": {"lade_status": "Failure", "angesteckt": True}}, fh)
        cfg = {"prognose": "prognose.json", "zeitzone": "Europe/Berlin", "steuerung": {"status_url": "http://h/s"}}
        m = Module(cfg, lambda p: os.path.join(base, p), clock=lambda: now)
        lage = {
            "knoepfe": {"aktiv": "automatik"},
            "text": "wartet",
            "laeuft": False,
            "erzwungen": False,
            "stand_ms": int((now - 30) * 1000),
        }

        def kabel(st):
            with mock.patch("vibedash_modules.auto.steuerung.status", return_value=st) as get:
                secs = m.board()["sections"]
            self.assertEqual(get.call_count, 1)
            tiles = next(s for s in secs if s.get("type") == "tiles")["tiles"]
            return next(x for x in tiles if x["label"] == "Ladekabel")["sub"]

        self.assertEqual(kabel(lage), "wartet auf Automatik")
        self.assertEqual(kabel({**lage, "erzwungen": True}), "Fehler")
        self.assertEqual(kabel({k: v for k, v in lage.items() if k != "laeuft"}), "Fehler")  # older house
        self.assertEqual(kabel(None), "Fehler")  # house unreachable


if __name__ == "__main__":
    unittest.main()
