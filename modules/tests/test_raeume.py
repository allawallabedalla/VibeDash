import json
import os
import shutil
import tempfile
import unittest
import urllib.parse

from vibedash_modules.config import load_modules
from vibedash_modules.raeume import Module
from vibedash_modules.raeume.board import norm

from .helpers import TEMPLATES, at

NOW = at(2026, 10, 19, 12)  # 12:00 local -> 48 steps of 15 min
START_MS = int(at(2026, 10, 19, 0) * 1000)
MIN = 60_000


def _influx(klima: dict, lux: dict):
    """Fake InfluxDB: klima {typ: {raum: wert}}, lux {raum: wert}."""

    def answer(q):
        if "helligkeit" in q:
            rows = lux
        else:
            typ = q.split("= '", 1)[1].split("'", 1)[0]
            rows = klima.get(typ, {})
        return {"results": [{"series": [{"tags": {"raum": r}, "values": [[0, v]]} for r, v in rows.items()]}]}

    return answer


class TestRaeume(unittest.TestCase):
    def setUp(self):
        self.base = tempfile.mkdtemp(prefix="vd-raeume-")
        shutil.copy(os.path.join(TEMPLATES, "raeume_haus.json"), self.base)
        with open(os.path.join(TEMPLATES, "raeume.json"), encoding="utf-8") as f:
            self.cfg = json.load(f)
        self.cfg["influx"]["db"] = "test"
        self.cfg["einschub_url"] = "http://haus.invalid/raeume"
        self.cfg["gleicher_raum"] = {"kueche": "wohnen"}
        self.cfg["namen"] = {"wohnen": ["Wohnzimmer"]}
        self.events = {
            "licht": {
                "vorher": [["Wohnen", "1/1/1", 1], ["Küche", "1/1/2", 0]],
                "wechsel": [
                    [START_MS + 30 * MIN, "Wohnen", "1/1/1", 0],  # off at 00:30
                    [START_MS + 7 * 60 * MIN + 5 * MIN, "Küche", "1/1/2", 1],  # on 07:05 …
                    [START_MS + 7 * 60 * MIN + 10 * MIN, "Küche", "1/1/2", 0],  # … off 07:10
                ],
            },
            "bewegung": [[START_MS + 8 * 60 * MIN, "Wohnzimmer"], [START_MS - MIN, "Wohnen"]],
            "letzte_bewegung": {"wohnen": int(NOW * 1000) - 5 * MIN, "kueche": int(NOW * 1000) - 90 * MIN},
        }
        self.urls = []
        influx = _influx(
            {
                "ist": {"Wohnen": 21.04},
                "feuchte": {"Wohnen": 48.6},
                "stellgroesse": {"Wohnen": 12, "Wohnzimmer": 30},
                "aussen_temp": {"Aussen": 9.25},
                "soll": {"Wohnen": 21},
            },
            {"Küche": 120.4, "Aussen": 5000},
        )

        def fetch(url, timeout=20):
            self.urls.append(url)
            if url.startswith("http://haus.invalid"):
                return self.events
            return influx(urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)["q"][0])

        self.fetch = fetch

    def tearDown(self):
        shutil.rmtree(self.base, ignore_errors=True)

    def mod(self, cfg=None):
        return Module(
            cfg or self.cfg, lambda p: p if os.path.isabs(p) else os.path.join(self.base, p), self.fetch, lambda: NOW
        )

    def test_loaded_with_config(self):
        with open(os.path.join(self.base, "raeume.json"), "w", encoding="utf-8") as f:
            json.dump(self.cfg, f)
        m = load_modules(self.base)
        self.assertIn("raeume", m["modules"], m["errors"])

    def test_plan_and_views(self):
        b = self.mod().board()
        (s,) = b["sections"]
        self.assertEqual(s["type"], "plan")
        self.assertEqual(s["floors"][0]["name"], "Erdgeschoss")
        self.assertEqual([r["kind"] for r in s["floors"][0]["rooms"]], ["room", "room", "outside"])
        v = {x["id"]: x for x in s["views"]}
        self.assertEqual(v["temp"]["texts"], {"wohnen": "21,0°", "kueche": "21,0°", "terrasse": "9,2°"})
        self.assertEqual(v["heizung"]["values"]["wohnen"], 30)  # highest valve of the room's names
        self.assertEqual(v["feuchte"]["texts"]["kueche"], "49 %")  # shares the living room's climate
        self.assertEqual(v["praesenz"]["values"], {"wohnen": 5, "kueche": None})
        self.assertNotIn("model3d", s)
        self.assertTrue(any("seit=" + str(START_MS) in u for u in self.urls))

    def test_timeline(self):
        s = self.mod().board()["sections"][0]
        tl = s["timeline"]
        self.assertEqual((tl["start"], tl["stepMs"], tl["steps"]), (START_MS, 15 * MIN, 48))
        self.assertEqual(tl["light"]["wohnen"][:4], [1, 1, 1, 0])
        self.assertEqual(tl["light"]["kueche"][28], 1)  # 07:00–07:15: briefly on
        self.assertEqual(sum(tl["light"]["kueche"]), 1)
        self.assertEqual(tl["presence"], {"wohnen": [1 if k == 32 else 0 for k in range(48)]})
        v = {x["id"]: x for x in s["views"]}
        self.assertEqual(v["licht"]["values"], {"wohnen": 0, "kueche": 0, "terrasse": None})

    def test_details(self):
        d = self.mod().board()["sections"][0]["details"]
        self.assertEqual(
            [x["label"] for x in d["wohnen"]],
            ["Temperatur (Regler)", "Soll", "Heizventil", "Luftfeuchte", "Licht", "Letzte Bewegung", "Fläche"],
        )
        self.assertEqual(
            d["kueche"][-2:], [{"label": "Letzte Bewegung", "value": "–"}, {"label": "Fläche", "value": "20 m²"}]
        )
        self.assertIn({"label": "Helligkeit", "value": "5000 lx"}, d["terrasse"])

    def test_no_sources(self):
        cfg = {"grundriss": {"haus": "raeume_haus.json"}}
        s = self.mod(cfg).board()["sections"][0]
        self.assertTrue(all(not any(v["values"].values()) for v in s["views"]))
        self.assertEqual(self.urls, [])

    def test_broken_house_service(self):
        def broken(url, timeout=20):
            raise OSError("down")

        m = Module(self.cfg, lambda p: os.path.join(self.base, p), broken, lambda: NOW)
        s = m.board()["sections"][0]
        self.assertEqual(s["timeline"]["light"], {})

    def test_config_without_plan_is_reported(self):
        with open(os.path.join(self.base, "raeume.json"), "w", encoding="utf-8") as f:
            json.dump({}, f)
        self.assertIn("raeume", load_modules(self.base)["errors"])

    def test_norm(self):
        self.assertEqual(norm("Gäste-WC"), norm("gaeste wc"))


if __name__ == "__main__":
    unittest.main()
