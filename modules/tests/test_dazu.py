"""Two modules on one tab: config key "dazu" (Audit05, fewer tabs)."""

import json
import os
import time
import unittest

from vibedash_modules.config import board_of, load_modules, owner_of

from .helpers import cleanup, folder


def _write(p, d):
    with open(p, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False)


class TestDazu(unittest.TestCase):
    def setUp(self):
        self.base = folder(cfg_patch={"dazu": ["updates"]})
        now = time.strftime("%Y-%m-%dT%H:%M:%S%z")
        _write(os.path.join(self.base, "updates_stand.json"), {"geprueft": now, "pakete": []})
        _write(os.path.join(self.base, "updates.json"), {"stand": "updates_stand.json"})

    def tearDown(self):
        cleanup(self.base)

    def test_sections_appended_and_key_not_passed_on(self):
        mods = load_modules(self.base)
        self.assertEqual(mods["errors"], {})
        self.assertEqual(mods["dazu"], {"wartung": {"updates": None}})
        own = mods["modules"]["wartung"].board()["sections"]
        both = board_of(mods, "wartung")["sections"]
        extra = mods["modules"]["updates"].board()["sections"]
        self.assertEqual(len(both), len(own) + len(extra))
        self.assertEqual([s["title"] for s in both[len(own) :]], [s["title"] for s in extra])

    def test_buttons_reach_the_added_module(self):
        mods = load_modules(self.base)
        self.assertEqual(owner_of(mods, "wartung", "updates:jetzt"), "updates")
        self.assertEqual(owner_of(mods, "wartung", "plan:dach"), "wartung")
        self.assertEqual(owner_of(mods, "knx", "updates:jetzt"), "knx")  # only for its own "dazu"
        self.assertEqual(owner_of(mods, "wartung", None), "wartung")

    def test_bad_dazu_is_reported_not_fatal(self):
        _write(os.path.join(self.base, "updates.json"), {"stand": "updates_stand.json", "dazu": "wartung"})
        mods = load_modules(self.base)
        self.assertIn("updates", mods["errors"])
        self.assertIn("wartung", mods["modules"])

    def test_unknown_or_self_dropped(self):
        cfg = os.path.join(self.base, "wartung.json")
        with open(cfg, encoding="utf-8") as f:
            c = json.load(f)
        c["dazu"] = ["wartung", "gibtsnicht", "updates"]
        _write(cfg, c)
        self.assertEqual(load_modules(self.base)["dazu"], {"wartung": {"updates": None}})

    def test_only_some_sections(self):
        cfg = os.path.join(self.base, "wartung.json")
        with open(cfg, encoding="utf-8") as f:
            c = json.load(f)
        c["dazu"] = [{"modul": "updates", "nur": ["choice"]}]
        _write(cfg, c)
        mods = load_modules(self.base)
        own = mods["modules"]["wartung"].board()["sections"]
        added = board_of(mods, "wartung")["sections"][len(own) :]
        self.assertEqual([s["type"] for s in added], ["choice"])


if __name__ == "__main__":
    unittest.main()
