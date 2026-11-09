import json
import os
import shutil
import tempfile
import unittest
from datetime import datetime

from vibedash_modules.updates import Module as Updates

from .helpers import TZ, at


def iso(ts):
    return datetime.fromtimestamp(ts, TZ).isoformat(timespec="seconds")


class TestUpdates(unittest.TestCase):
    def setUp(self):
        self.base = tempfile.mkdtemp(prefix="vd-updates-")
        self.now = at(2026, 11, 9, 20)
        self.stand = {
            "geprueft": iso(self.now - 300),
            "pakete": [
                {"name": "zlib", "von": "1.0", "nach": "1.1", "sicherheit": False},
                {"name": "curl", "von": "8.1", "nach": "8.2", "sicherheit": True},
            ],
            "neustart": {"noetig": True, "laeuft": "6.1.1", "neu": "6.1.2"},
        }
        self.write_stand()

    def tearDown(self):
        shutil.rmtree(self.base, ignore_errors=True)

    def p(self, name):
        return os.path.join(self.base, name)

    def write_stand(self):
        with open(self.p("stand.json"), "w", encoding="utf-8") as f:
            json.dump(self.stand, f)

    def mod(self):
        return Updates({"stand": "stand.json"}, self.p, lambda: self.now)

    def tap(self, value):
        return self.mod().action({"item": "updates:jetzt", "action": "choose", "value": value})

    def test_board_counts_security_first(self):
        choice, tiles, lst = self.mod().board()["sections"]
        self.assertEqual(choice["selected"], "spaeter")
        self.assertEqual(choice["options"][1]["sub"], "2 Pakete")
        self.assertEqual([t["value"] for t in tiles["tiles"][:3]], ["1", "1", "nötig"])
        self.assertEqual(tiles["tiles"][0]["state"], "look")
        self.assertIn("6.1.1 → 6.1.2", tiles["tiles"][2]["sub"])
        self.assertEqual(lst["items"][0]["text"], "curl")
        self.assertNotIn("note", tiles)

    def test_nothing_open_disables_now(self):
        self.stand["pakete"] = []
        self.write_stand()
        choice, _, lst = self.mod().board()["sections"]
        self.assertTrue(choice["options"][1]["disabled"])
        self.assertEqual(lst["type"], "text")

    def test_tap_stores_wish_and_waits(self):
        code, body = self.tap("jetzt")
        self.assertEqual(code, 200)
        with open(self.p("update_wunsch.json"), encoding="utf-8") as f:
            self.assertEqual(json.load(f)["wunsch"], "installieren")
        choice = self.mod().board()["sections"][0]
        self.assertEqual(choice["selected"], "jetzt")
        self.assertIn("Wartet", choice["note"])

    def test_running_then_done(self):
        self.tap("jetzt")
        self.now += 60
        self.stand["lauf"] = {"start": iso(self.now), "ende": None}
        self.write_stand()
        self.assertIn("Installiert seit", self.mod().board()["sections"][0]["note"])
        self.assertEqual(self.tap("spaeter")[0], 409)
        self.now += 120
        self.stand["lauf"] = {"start": iso(self.now - 120), "ende": iso(self.now), "ok": True, "anzahl": 2}
        self.stand["pakete"] = []
        self.write_stand()
        choice, tiles, _ = self.mod().board()["sections"]
        self.assertEqual(choice["selected"], "spaeter")
        self.assertIn("2 Pakete installiert", choice["note"])
        self.assertEqual(tiles["tiles"][3]["value"], "09.11.")

    def test_failed_run_is_red(self):
        self.stand["lauf"] = {"start": iso(self.now - 200), "ende": iso(self.now - 100), "ok": False, "text": "dpkg"}
        self.write_stand()
        choice, tiles, _ = self.mod().board()["sections"]
        self.assertIn("Fehlgeschlagen", choice["note"])
        self.assertEqual(tiles["tiles"][3]["state"], "act")

    def test_lost_wish_and_withdraw(self):
        self.tap("jetzt")
        self.now += 3600
        choice = self.mod().board()["sections"][0]
        self.assertEqual(choice["selected"], "spaeter")
        self.assertIn("nicht übernommen", choice["note"])
        self.tap("jetzt")
        self.tap("spaeter")
        with open(self.p("update_wunsch.json"), encoding="utf-8") as f:
            self.assertNotIn("wunsch", json.load(f))

    def test_stale_stand_and_bad_action(self):
        self.stand["geprueft"] = iso(self.now - 3 * 86400)
        self.write_stand()
        self.assertIn("Stand vom", self.mod().board()["sections"][1]["note"])
        self.assertEqual(self.tap("rm -rf")[0], 400)
        self.assertEqual(self.mod().action({"item": "x:y", "action": "choose"})[0], 404)

    def test_config_needs_stand(self):
        with self.assertRaises(ValueError):
            Updates({}, self.p)


if __name__ == "__main__":
    unittest.main()
