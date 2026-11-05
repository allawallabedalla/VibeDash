import json
import os
import shutil
import tempfile
import unittest

from vibedash_modules.knx import Module as Knx

from .helpers import at


class TestWecker(unittest.TestCase):
    def setUp(self):
        self.base = tempfile.mkdtemp(prefix="vd-wecker-")
        self.now = at(2026, 11, 5, 21)  # Thursday evening
        self.cfg = {
            "einschub_url": "http://haus.invalid/knx",
            "wecker": {"datei": "pause.json", "stand": "stand.json"},
        }

    def tearDown(self):
        shutil.rmtree(self.base, ignore_errors=True)

    def mod(self):
        return Knx(self.cfg, lambda p: os.path.join(self.base, p), lambda u, t=60: {}, lambda: self.now)

    def sec(self):
        s = self.mod().board()["sections"][0]
        self.assertEqual(s["id"], "wecker:pause")
        return s

    def test_normal_by_default(self):
        s = self.sec()
        self.assertEqual(s["selected"], "normal")
        self.assertEqual(s["options"][1]["label"], "Fr aus")

    def test_evening_tap_skips_tomorrow_until_ten(self):
        code, body = self.mod().action({"item": "wecker:pause", "action": "choose", "value": "aus"})
        self.assertEqual(code, 200)
        self.assertIn("Fr 06.11.", body["text"])
        with open(os.path.join(self.base, "pause.json"), encoding="utf-8") as f:
            d = json.load(f)
        self.assertEqual(d["aus_am"], "2026-11-06")
        self.assertEqual(d["bis"], "2026-11-06T10:00:00+01:00")
        self.assertEqual(self.sec()["selected"], "aus")
        self.assertIn("Wartet auf das Haus", self.sec()["note"])
        self.now = at(2026, 11, 6, 10) + 1
        self.assertEqual(self.sec()["selected"], "normal")

    def test_early_morning_tap_is_for_today(self):
        self.now = at(2026, 11, 6, 3)
        _, body = self.mod().action({"item": "wecker:pause", "action": "choose", "value": "aus"})
        self.assertIn("Fr 06.11.", body["text"])

    def test_back_to_normal_and_house_stand(self):
        m = self.mod()
        m.action({"item": "wecker:pause", "action": "choose", "value": "aus"})
        with open(os.path.join(self.base, "stand.json"), "w", encoding="utf-8") as f:
            json.dump({"wert": 1, "gesendet": "2026-11-05T21:01:00+01:00", "ok": True}, f)
        self.assertIn("Vom Haus übernommen (21:01)", self.sec()["note"])
        m.action({"item": "wecker:pause", "action": "choose", "value": "normal"})
        self.assertEqual(self.sec()["selected"], "normal")

    def test_bad_value_and_no_config(self):
        code, _ = self.mod().action({"item": "wecker:pause", "action": "choose", "value": "x"})
        self.assertEqual(code, 400)
        del self.cfg["wecker"]
        code, _ = self.mod().action({"item": "wecker:pause", "action": "choose", "value": "aus"})
        self.assertEqual(code, 404)
        self.assertNotEqual((self.mod().board()["sections"] or [{}])[0].get("id"), "wecker:pause")


if __name__ == "__main__":
    unittest.main()
