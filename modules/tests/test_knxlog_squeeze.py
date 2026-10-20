"""KNX-Log: Wiederholungen binnen 15 min werden eine Zeile (Audit04 UX-07)."""

import unittest

from vibedash_modules.knxlog.board import squeeze

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


if __name__ == "__main__":
    unittest.main()
