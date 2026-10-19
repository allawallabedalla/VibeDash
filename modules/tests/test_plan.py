import unittest
from datetime import date

from vibedash_modules.wartung.plan import choose, state

IV = {"monatl.": 30, "jährl.": 365, "½-jährl.": 182}


class TestState(unittest.TestCase):
    def test_due_soon_ok_never(self):
        d = date(2026, 10, 19)
        self.assertEqual(state({"intervall": "monatl.", "zuletzt": "2026-08-01"}, IV, d)["zustand"], "faellig")
        self.assertEqual(state({"intervall": "monatl.", "zuletzt": "2026-09-25"}, IV, d)["zustand"], "bald")
        self.assertEqual(state({"intervall": "monatl.", "zuletzt": "2026-10-15"}, IV, d)["zustand"], "ok")
        self.assertEqual(state({"intervall": "monatl."}, IV, d)["zustand"], "nie")

    def test_move_in_counts_as_last_done(self):
        z = state({"intervall": "monatl."}, IV, date(2026, 10, 19), date(2026, 1, 1))
        self.assertEqual(z["zustand"], "faellig")
        self.assertIn("ab Einzug", z["stand"])

    def test_season_and_month(self):
        self.assertEqual(state({"intervall": "jährl.", "saison": "Winter"}, IV, date(2026, 7, 1))["zustand"], "ruht")
        z = state({"intervall": "jährl.", "monat": 10}, IV, date(2026, 10, 19), date(2026, 1, 1))
        self.assertEqual((z["zustand"], z["faellig"]), ("faellig", date(2026, 10, 1)))
        done = state({"intervall": "jährl.", "monat": 10, "zuletzt": "2026-10-05"}, IV, date(2026, 10, 19))
        self.assertEqual((done["zustand"], done["faellig"]), ("ok", date(2027, 10, 1)))

    def test_budget_takes_most_urgent_and_at_least_one(self):
        a = [
            {"id": "a", "zustand": "bald", "rest_tage": 3, "minuten": 30},
            {"id": "b", "zustand": "faellig", "rest_tage": -50, "minuten": 30},
            {"id": "c", "zustand": "faellig", "rest_tage": -5, "minuten": 30},
        ]
        chosen, total = choose(a, 60)
        self.assertEqual([x["id"] for x in chosen], ["b", "c"])
        self.assertEqual(total, 60)
        big, _ = choose([{"id": "x", "zustand": "faellig", "minuten": 500}], 60)
        self.assertEqual(len(big), 1)


if __name__ == "__main__":
    unittest.main()
