import json
import os
import tempfile
import unittest
from datetime import date

from vibedash_modules.auto import zeitstrahl


def _file(days):
    d = tempfile.mkdtemp(prefix="vd-zs-")
    p = os.path.join(d, "zeitstrahl.json")
    row = [0.0] * 96
    data = {
        "stand": "2026-10-20T08:47:00+02:00",
        "tage": [{"tag": t, "ab_stufe": 35, "start_kwh": 4.8, "pv": [row, row], "last": [row, row]} for t in days],
        "akku": {"kwh": 19.2, "reserve_kwh": 3.0, "eta": 0.98, "kw": 12.5},
        "auto_bedarf_kwh": 30.0,
        "wallbox_kw": [4.3, 7.1, 11.4],
    }
    with open(p, "w") as f:
        json.dump(data, f)
    return p


class TestZeitstrahl(unittest.TestCase):
    def test_today_and_tomorrow(self):
        p = _file(["2026-10-20", "2026-10-21"])
        s = zeitstrahl.section(p, date(2026, 10, 20), now=1000, mtime=900)
        self.assertEqual(s["type"], "chargetimeline")
        self.assertEqual([d["label"] for d in s["days"]], ["Heute", "Morgen (Mi)"])
        self.assertEqual([d["startStep"] for d in s["days"]], [35, 0])
        self.assertEqual(s["carNeedKwh"], 30.0)
        self.assertIn("08:47", s["note"])

    def test_old_or_missing_or_other_days(self):
        p = _file(["2026-10-20"])
        self.assertIsNone(zeitstrahl.section(p, date(2026, 10, 20), now=20000, mtime=1))
        self.assertIsNone(zeitstrahl.section(p + "x", date(2026, 10, 20)))
        self.assertIsNone(zeitstrahl.section(p, date(2026, 10, 25), now=1000, mtime=900))


if __name__ == "__main__":
    unittest.main()
