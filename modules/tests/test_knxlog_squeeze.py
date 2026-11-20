"""KNX-Log: Wiederholungen binnen 15 min werden eine Zeile (Audit04 UX-07)."""

import unittest
from datetime import UTC

from vibedash_modules.knxlog.board import build, squeeze

M = 60_000


class Squeeze(unittest.TestCase):
    def test_repeats_join_within_15_min_of_the_oldest(self):
        ev = [
            (100 * M, "Bad", "Präsenz ohne Licht", None),
            (95 * M, "Bad", "Präsenz ohne Licht", "look"),
            (86 * M, "Bad", "Präsenz ohne Licht", None),
            (70 * M, "Bad", "Präsenz ohne Licht", None),
            (69 * M, "WC", "Licht an", None),
        ]
        self.assertEqual(
            squeeze(ev),
            [
                (100 * M, "Bad", "Präsenz ohne Licht", "look", 3),
                (70 * M, "Bad", "Präsenz ohne Licht", None, 1),
                (69 * M, "WC", "Licht an", None, 1),
            ],
        )


class Devices(unittest.TestCase):
    def test_device_table_has_a_bar_per_device(self):
        # Audit05 I-8: telegrams per device as a bar; a quiet device is 0, not a gap
        now = 1_800_000_000_000
        tel = [[now - k * M, "0/0/1", 1, "1.1.1", ""] for k in range(3)]
        inv = {"geraete": {"1.1.1": ["Melder Flur", "Flur", "x"], "1.1.2": ["Dimmer", "Flur", "y"]}}
        b = build({"telegramme": tel}, inv, {}, now, UTC)
        dev = next(s for s in b["sections"] if s.get("title") == "Geräte")
        self.assertEqual(dev["chart"], {"kind": "bar", "label": "Telegramme"})
        self.assertEqual([r["chart"]["value"] for r in dev["rows"]], [3, 0])


if __name__ == "__main__":
    unittest.main()
