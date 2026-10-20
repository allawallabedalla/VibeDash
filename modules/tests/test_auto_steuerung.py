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


if __name__ == "__main__":
    unittest.main()
