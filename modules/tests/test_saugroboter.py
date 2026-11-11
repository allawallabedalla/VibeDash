import json
import os
import shutil
import unittest
import urllib.parse

from vibedash_modules.config import load_modules
from vibedash_modules.saugroboter import Module

from .helpers import TEMPLATES, at

NOW = at(2026, 11, 11, 14)
MS = int(NOW * 1000)


class TestSaugroboter(unittest.TestCase):
    def setUp(self):
        self.last = {
            "V50 Ultra complete": {"batterie": 65.0, "status": 3, "online": 1.0, "t": MS - 120_000},
            "MOVA E20": {"batterie": 100.0, "status": 13, "online": 1.0, "t": MS - 120_000},
        }
        self.fail = False

    def fetch(self, url, timeout=20):
        if self.fail:
            raise OSError("influx down")
        q = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)["q"][0]
        if q.startswith("SELECT last("):
            f = q.split('last("')[1].split('"')[0]
            return {
                "results": [
                    {
                        "series": [
                            {
                                "name": "saugroboter",
                                "tags": {"geraet": n},
                                "columns": ["time", "last"],
                                "values": [[v["t"], v[f]]],
                            }
                            for n, v in self.last.items()
                        ]
                    }
                ]
            }
        x = [MS - 3_600_000, MS - 2_700_000, MS - 1_800_000]
        return {
            "results": [
                {
                    "series": [
                        {
                            "name": "saugroboter",
                            "tags": {"geraet": "V50 Ultra complete"},
                            "columns": ["time", "mean"],
                            "values": [[x[0], 80.0], [x[1], 72.0], [x[2], 65.0]],
                        }
                    ]
                }
            ]
        }

    def board(self, cfg=None):
        cfg = cfg or {"influx": {"db": "haus"}}
        return Module(cfg, lambda p: p, self.fetch, lambda: NOW).board()

    def tiles(self):
        return {t["label"]: t for t in self.board()["sections"][0]["tiles"]}

    def test_template_loads(self):
        base = os.path.join(os.path.dirname(__file__), "_saug_tmp")
        os.makedirs(base, exist_ok=True)
        try:
            with open(os.path.join(TEMPLATES, "saugroboter.json"), encoding="utf-8") as f:
                cfg = json.load(f)
            cfg["influx"]["db"] = "haus"
            with open(os.path.join(base, "saugroboter.json"), "w", encoding="utf-8") as f:
                json.dump(cfg, f)
            m = load_modules(base)
            self.assertIn("saugroboter", m["modules"], m["errors"])
        finally:
            shutil.rmtree(base, ignore_errors=True)

    def test_state_and_battery(self):
        t = self.tiles()
        self.assertEqual(t["V50 Ultra complete"]["value"], "pausiert")
        self.assertEqual(t["V50 Ultra complete"]["sub"], "seit 13:58 · Akku 65 %")
        self.assertEqual(t["MOVA E20"]["value"], "voll geladen")
        self.assertEqual((t["Akku V50 Ultra complete"]["value"], t["Akku V50 Ultra complete"]["unit"]), ("65", "%"))
        self.assertEqual(t["Akku V50 Ultra complete"]["spark"], [80.0, 72.0, 65.0])
        self.assertNotIn("spark", t["Akku MOVA E20"])  # no course yet
        self.assertEqual(t["V50 Ultra complete"]["icon"], "robot")
        self.assertNotIn("state", t["MOVA E20"])

    def test_error_offline_stale(self):
        self.last["V50 Ultra complete"]["status"] = 4
        self.last["MOVA E20"]["online"] = 0.0
        t = self.tiles()
        self.assertEqual((t["V50 Ultra complete"]["value"], t["V50 Ultra complete"]["state"]), ("Fehler", "act"))
        self.assertEqual((t["MOVA E20"]["value"], t["MOVA E20"]["state"]), ("offline", "look"))
        self.last["MOVA E20"]["t"] = MS - 3_600_000
        t = self.tiles()
        self.assertEqual((t["MOVA E20"]["value"], t["MOVA E20"]["sub"]), ("kein Stand", "letzter Wert 13:00"))

    def test_unknown_code_and_no_data(self):
        self.last["MOVA E20"]["status"] = 77
        self.assertEqual(self.tiles()["MOVA E20"]["value"], "Code 77")
        self.fail = True
        self.assertEqual(self.board()["sections"][0]["title"], "Noch keine Daten")

    def test_needs_db(self):
        with self.assertRaises(ValueError):
            Module({"influx": {}}, lambda p: p, self.fetch, lambda: NOW)


class TestAktionen(unittest.TestCase):
    def setUp(self):
        self.base = os.path.join(os.path.dirname(__file__), "_saug_akt")
        os.makedirs(self.base, exist_ok=True)
        self.cfg = {
            "influx": {"db": "haus"},
            "aktionen": [
                {"id": "kochen", "name": "Nach dem Kochen", "sub": "Küche + Essen", "geraet": "V50", "raeume": [5, 8]},
                {"id": "bad", "name": "Bad OG", "geraet": "E20", "raeume": [2]},
                {"id": "kz", "name": "Nur Küche", "geraet": "V50", "zonen": ["kueche", "x"]},
            ],
            "zonen": {"kueche": {"name": "Küche", "geschoss": "EG", "rechteck_m": [3, 5, 5, 9]}},
        }

    def tearDown(self):
        shutil.rmtree(self.base, ignore_errors=True)

    def mod(self, now=NOW):
        return Module(self.cfg, lambda p: os.path.join(self.base, p), lambda u, t=20: {"results": [{}]}, lambda: now)

    def choices(self, now=NOW):
        return {s["title"]: s for s in self.mod(now).board()["sections"] if s["type"] == "choice"}

    def test_rows_per_robot(self):
        c = self.choices()
        self.assertEqual(
            list(c),
            ["Räume V50", "Bereiche V50", "Steuern V50", "Räume E20", "Steuern E20"],
        )
        self.assertEqual([o["value"] for o in c["Räume V50"]["options"]], ["kochen", "pause"])
        self.assertEqual([o["value"] for o in c["Steuern V50"]["options"]], ["pause", "heim"])
        self.assertEqual(c["Räume V50"]["id"], "saug:v50")
        self.assertEqual(c["Bereiche V50"]["id"], "saug:v50.bereiche")
        self.assertIsNone(c["Räume V50"]["selected"])

    def test_more_than_five_split(self):
        self.cfg["aktionen"] += [
            {"id": f"r{i}", "name": f"Raum {i}", "geraet": "V50", "raeume": [i]} for i in range(1, 7)
        ]
        c = self.choices()
        self.assertEqual(len(c["Räume V50"]["options"]), 5)
        self.assertEqual([o["value"] for o in c["Räume V50 (2)"]["options"]], ["r5", "r6"])
        self.assertEqual(c["Räume V50 (2)"]["id"], "saug:v50.raeume2")
        self.assertEqual(self.mod().action({"item": "saug:v50.raeume2", "action": "choose", "value": "r6"})[0], 200)

    def test_zone_action_shows_area(self):
        opts = {o["value"]: o for o in self.choices()["Bereiche V50"]["options"]}
        self.assertEqual(opts["kz"]["sub"], "Bereich: Küche, x")
        status, _ = self.mod().action({"item": "saug:v50.bereiche", "action": "choose", "value": "kz"})
        self.assertEqual(status, 200)

    def test_wish_and_result(self):
        m = self.mod()
        status, body = m.action({"item": "saug:v50", "action": "choose", "value": "kochen"})
        self.assertEqual(status, 200, body)
        with open(os.path.join(self.base, "saugroboter_wunsch.json"), encoding="utf-8") as f:
            wish = json.load(f)
        self.assertEqual((wish["nr"], wish["id"], wish["geraet"]), (1, "kochen", "V50"))
        c = self.choices()
        self.assertEqual((c["Räume V50"]["selected"], c["Räume V50"]["note"]), ("kochen", "Wird gesendet …"))
        self.assertEqual(c["Bereiche V50"]["note"], "Antippen startet die Aktion.")
        with open(os.path.join(self.base, "saugroboter_stand.json"), "w", encoding="utf-8") as f:
            json.dump({"nr": 1, "id": "kochen", "ok": True, "text": "gestartet", "zeit": MS}, f)
        c = self.choices()
        self.assertEqual((c["Räume V50"]["selected"], c["Räume V50"]["note"]), (None, "14:00: gestartet"))
        # a wish the house never took over is named after 5 min
        m.action({"item": "saug:e20.steuern", "action": "choose", "value": "heim"})
        late = self.choices(NOW + 600)["Steuern E20"]
        self.assertTrue(late["note"].startswith("Nicht gesendet"))

    def test_rejects_unknown(self):
        m = self.mod()
        self.assertEqual(m.action({"item": "saug:v50", "action": "choose", "value": "bad"})[0], 400)
        self.assertEqual(m.action({"item": "saug:v50", "action": "choose", "value": "heim"})[0], 400)
        self.assertEqual(m.action({"item": "saug:xyz", "action": "choose", "value": "pause"})[0], 404)
        self.assertEqual(m.action({"item": "saug:v50.foo", "action": "choose", "value": "pause"})[0], 404)
        self.assertEqual(m.action({"item": "saug:v50", "action": "done", "value": "pause"})[0], 404)
        self.assertFalse(os.path.exists(os.path.join(self.base, "saugroboter_wunsch.json")))


class TestBereiche(unittest.TestCase):
    """Areas drawn on the (made-up) template floor plan."""

    def setUp(self):
        self.base = os.path.join(os.path.dirname(__file__), "_saug_ber")
        os.makedirs(self.base, exist_ok=True)
        self.cfg = {
            "influx": {"db": "haus"},
            "grundriss": {"haus": os.path.join(TEMPLATES, "raeume_haus.json")},
            "karten": {"V50": {"geschoss": "EG", "sperr_m": [[6, 5, 10, 8]], "rand_m": 0.2}},
            "zonen": {"tisch": {"name": "Tisch", "geschoss": "EG", "rechteck_m": [1, 1, 2, 2]}},
            "aktionen": [{"id": "alles", "name": "Alles", "geraet": "V50", "raeume": "alle"}],
        }

    def tearDown(self):
        shutil.rmtree(self.base, ignore_errors=True)

    def mod(self):
        return Module(self.cfg, lambda p: os.path.join(self.base, p), lambda u, t=20: {"results": [{}]}, lambda: NOW)

    def secs(self):
        return self.mod().board()["sections"]

    def add(self, **z):
        return self.mod().action({"item": "zone:v50", "action": "zone", "zone": z})

    def test_draw_section(self):
        z = [s for s in self.secs() if s["type"] == "zones"]
        self.assertEqual(len(z), 1)
        z = z[0]
        self.assertEqual((z["id"], z["floor"]["id"]), ("zone:v50", "EG"))
        self.assertEqual(z["blocked"], [[6.0, 5.0, 10.0, 8.0]])
        self.assertEqual([x["id"] for x in z["zones"]], ["tisch"])
        self.assertFalse(z["zones"][0].get("own"))
        self.assertTrue(z["floor"]["rooms"])

    def test_add_becomes_button_and_wish(self):
        st, body = self.add(name="Unter dem Sofa", rect=[3.5, 3.0, 1.0, 1.5], mode="wischen")
        self.assertEqual(st, 200, body)
        with open(os.path.join(self.base, "saugroboter_bereiche.json"), encoding="utf-8") as f:
            b = json.load(f)["bereiche"][0]
        self.assertEqual(
            (b["id"], b["rechtecke_m"], b["modus"], b["geschoss"]),
            ("unter-dem-sofa", [[1, 1.5, 3.5, 3]], "wischen", "EG"),
        )
        c = {s["title"]: s for s in self.secs() if s["type"] == "choice"}
        opt = c["Bereiche V50"]["options"]
        self.assertEqual(
            [(o["value"], o["sub"]) for o in opt], [("b-unter-dem-sofa", "Bereich wischen"), ("pause", "anhalten")]
        )
        zs = next(s for s in self.secs() if s["type"] == "zones")["zones"]
        self.assertEqual([(x["id"], x.get("own")) for x in zs], [("tisch", None), ("unter-dem-sofa", True)])
        st, _ = self.mod().action({"item": "saug:v50.bereiche", "action": "choose", "value": "b-unter-dem-sofa"})
        self.assertEqual(st, 200)
        # same name again gets its own id
        self.assertEqual(self.add(name="Unter dem Sofa", rect=[1, 1, 2, 2])[0], 200)
        with open(os.path.join(self.base, "saugroboter_bereiche.json"), encoding="utf-8") as f:
            self.assertEqual([x["id"] for x in json.load(f)["bereiche"]], ["unter-dem-sofa", "unter-dem-sofa-2"])

    def test_rejects(self):
        for z, text in (
            ({"name": "", "rect": [1, 1, 2, 2]}, "Name"),
            ({"name": "x" * 25, "rect": [1, 1, 2, 2]}, "Name"),
            ({"name": "a", "rect": [1, 1, 1.1, 2]}, "zu klein"),
            ({"name": "a", "rect": [1, 1, "2", 2]}, "kein Rechteck"),
            ({"name": "a", "rect": [5.9, 1, 7, 4.9]}, "gesperrte"),  # within the margin of the blocked part
            ({"name": "a", "rect": [-50, -50, 50, 50]}, "zu groß"),  # clipped to the plan (10 × 8 m = 80 m²)
            ({"name": "a", "rects": [[0, 0, 6, 5], [0, 0, 8, 5]]}, "zu groß"),  # 30 + 40 m²
            ({"name": "a", "rects": [[1, 1, 2, 2]] * 6}, "höchstens 5"),
            ({"name": "a", "rects": [[1, 1, 2, 2], [5.9, 1, 7, 4.9]]}, "gesperrte"),
            ({"name": "a", "rects": []}, "kein Rechteck"),
        ):
            st, body = self.add(**z)
            self.assertEqual(st, 400, z)
            self.assertIn(text, body["text"], z)
        self.assertEqual(self.mod().action({"item": "zone:e20", "action": "zone", "zone": {"name": "a"}})[0], 404)
        self.assertFalse(os.path.exists(os.path.join(self.base, "saugroboter_bereiche.json")))

    def test_remove_only_own(self):
        self.add(name="Ecke", rect=[1, 1, 2, 2])
        self.assertEqual(self.add(remove="tisch")[0], 404)
        self.assertEqual(self.add(remove="ecke")[0], 200)
        self.assertEqual(next(s for s in self.secs() if s["type"] == "zones")["zones"][1:], [])

    def test_edit_keeps_id(self):
        self.add(name="Ecke", rect=[1, 1, 2, 2])
        st, body = self.add(name="Große Ecke", rect=[1, 1, 3, 3], mode="wischen", replace="ecke")
        self.assertEqual(st, 200, body)
        self.assertIn("geändert", body["text"])
        zs = next(s for s in self.secs() if s["type"] == "zones")["zones"]
        self.assertEqual(
            zs[1], {"id": "ecke", "name": "Große Ecke", "rects": [[1, 1, 3, 3]], "own": True, "mode": "wischen"}
        )
        c = {s["title"]: s for s in self.secs() if s["type"] == "choice"}
        self.assertEqual(c["Bereiche V50"]["options"][0]["value"], "b-ecke")
        self.assertEqual(self.add(name="x", rect=[1, 1, 2, 2], replace="tisch")[0], 404)
        self.assertEqual(self.add(name="x", rect=[5.9, 1, 7, 4.9], replace="ecke")[0], 400)  # same checks as new

    def test_several_rectangles_one_button(self):
        st, body = self.add(name="Zwei Ecken", rects=[[1, 1, 2, 2], [3, 3, 4, 4.5]], mode="saugen")
        self.assertEqual(st, 200, body)
        zs = next(s for s in self.secs() if s["type"] == "zones")["zones"]
        self.assertEqual(zs[1]["rects"], [[1, 1, 2, 2], [3, 3, 4, 4.5]])
        opts = next(s for s in self.secs() if s["title"] == "Bereiche V50")["options"]
        self.assertEqual(opts[0]["value"], "b-zwei-ecken")
        cfg = __import__("vibedash_modules.saugroboter.aktionen", fromlist=["merged"]).merged(
            self.cfg, lambda p: os.path.join(self.base, p)
        )
        act = next(a for a in cfg["aktionen"] if a["id"] == "b-zwei-ecken")
        self.assertEqual(act["zonen"], ["b-zwei-ecken", "b-zwei-ecken#2"])
        self.assertEqual(cfg["zonen"]["b-zwei-ecken#2"]["rechteck_m"], [3, 3, 4, 4.5])

    def test_old_single_rectangle_still_read(self):
        with open(os.path.join(self.base, "saugroboter_bereiche.json"), "w", encoding="utf-8") as f:
            json.dump(
                {
                    "bereiche": [
                        {"id": "alt", "name": "Alt", "geraet": "V50", "geschoss": "EG", "rechteck_m": [1, 1, 2, 2]}
                    ]
                },
                f,
            )
        zs = next(s for s in self.secs() if s["type"] == "zones")["zones"]
        self.assertEqual(zs[1]["rects"], [[1, 1, 2, 2]])
        self.assertEqual(self.add(name="Alt neu", rects=[[1, 1, 3, 3]], replace="alt")[0], 200)
        with open(os.path.join(self.base, "saugroboter_bereiche.json"), encoding="utf-8") as f:
            b = json.load(f)["bereiche"][0]
        self.assertEqual((b.get("rechteck_m"), b["rechtecke_m"]), (None, [[1, 1, 3, 3]]))

    def test_no_plan_no_drawing(self):
        del self.cfg["grundriss"]
        self.assertFalse([s for s in self.secs() if s["type"] == "zones"])
