"""Ansage im Modul auto: Sonne morgen -> heute anstecken (Audit04 EM-04)."""

import unittest
from datetime import date

from vibedash_modules.auto import prognose as P

HEUTE = date(2026, 10, 20)


class Ansage(unittest.TestCase):
    def test_sonne_morgen_heisst_heute_anstecken(self):
        vh = {"tage_bis_reserve": {"frueh": 1, "mitte": 2}}
        a = P.entscheide(40, vh, [{"tag": "2026-10-21", "k": 1, "kwh": 12, "start": "10:00"}], HEUTE)
        self.assertEqual(a["wort"], "Heute anstecken")
        self.assertIn("von selbst", a["text"])
        self.assertLessEqual(len(a["kurz"]), 110)

    def test_sonne_spaeter_bleibt_beim_tag(self):
        vh = {"tage_bis_reserve": {"frueh": 2, "mitte": 3}}
        sonne = [{"tag": f"2026-10-2{k}", "k": k, "kwh": 12 if k == 2 else 0, "start": "10:00"} for k in range(3)]
        a = P.entscheide(40, vh, sonne, HEUTE)
        self.assertEqual(a["wort"], "Übermorgen anstecken")


if __name__ == "__main__":
    unittest.main()
