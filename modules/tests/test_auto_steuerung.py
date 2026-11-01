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

    def test_force_current_only_from_the_config(self):
        st = {"plan_kurz": "{x} heute"}
        plain = steuerung.section(st)
        self.assertEqual(plain["options"][1]["sub"], "sofort, auch Netzstrom, bis voll")
        self.assertNotIn(" A,", plain["info"]["what"])
        self.assertEqual(plain["options"][0]["sub"], "Plan: {x} heute")
        s = steuerung.section(st, {**CFG, "ampere": 16})
        self.assertEqual(s["options"][1]["sub"], "sofort 16 A, auch Netzstrom, bis voll")
        self.assertIn("sofort mit 16 A, auch", s["info"]["what"])
        for bad in (2, 100, "16", True):
            self.assertEqual(steuerung.section(st, {"ampere": bad})["options"][1]["sub"], plain["options"][1]["sub"])

    def test_choose_forwards_to_the_right_address(self):
        asked = []

        def post(url, is_post):
            asked.append((url, is_post))
            return 200, {"ok": True, "text": "lädt jetzt"}

        none = lambda url, is_post: (200, None)  # noqa: E731
        self.assertEqual(steuerung.choose(CFG, "jetzt", post, get=none), (200, {"ok": True, "text": "lädt jetzt"}))
        self.assertEqual(steuerung.choose(CFG, "automatik", post)[0], 200)
        self.assertEqual(asked, [("http://h/j", True), ("http://h/a", True)])
        self.assertEqual(steuerung.choose(CFG, "wild", post)[0], 400)
        self.assertEqual(len(asked), 2)

    def test_slow_refused_or_unreachable_house(self):
        def slow(url, is_post):
            raise TimeoutError

        self.assertEqual(steuerung.choose(CFG, "jetzt", slow, get=slow)[0], 200)

        def refused(url, is_post):
            raise urllib.error.HTTPError(url, 429, "x", {}, io.BytesIO(json.dumps({"fehler": "gerade erst"}).encode()))

        self.assertEqual(
            steuerung.choose(CFG, "jetzt", refused, get=refused), (502, {"ok": False, "text": "gerade erst"})
        )

        def down(url, is_post):
            raise urllib.error.URLError("refused")

        self.assertEqual(steuerung.choose(CFG, "jetzt", down, get=down)[0], 502)
        self.assertIsNone(steuerung.status(CFG, down))


STUFEN = {**CFG, "ampere_stufen": [6, 10, 13, 16], "ziel_stufen": [60, 80, 100]}


class TestStaerkeUndZiel(unittest.TestCase):
    def test_extra_choices_only_when_configured(self):
        self.assertEqual([s["id"] for s in steuerung.sections({}, CFG)], ["laden:modus"])
        ids = [s["id"] for s in steuerung.sections({}, STUFEN)]
        self.assertEqual(ids, ["laden:modus", "laden:ampere", "laden:ziel"])

    def test_current_and_target_follow_the_house(self):
        st = {"knoepfe": {"aktiv": "jetzt", "a": 10, "bis_pct": 80}, "auto_soc": 55.4}
        _, amp, ziel = steuerung.sections(st, STUFEN)
        self.assertEqual(amp["selected"], "a10")
        self.assertEqual(amp["options"][0], {"value": "a6", "label": "6 A", "sub": "≈ 4,1 kW"})
        self.assertEqual(ziel["selected"], "p80")
        self.assertEqual([o["label"] for o in ziel["options"]], ["60 %", "80 %", "Voll"])
        self.assertIn("55 %", ziel["note"])
        auto = steuerung.sections({"knoepfe": {"aktiv": "automatik"}, "auto_soc": 70}, STUFEN)
        self.assertEqual((auto[1]["selected"], auto[2]["selected"]), (None, None))
        self.assertEqual(auto[2]["options"][0]["sub"], "erreicht")
        voll = steuerung.sections({"knoepfe": {"aktiv": "jetzt", "a": 16}, "auto_soc": 40}, STUFEN)
        self.assertEqual(voll[2]["selected"], "p100")

    def test_without_charge_level_the_target_is_in_kwh(self):
        ziel = steuerung.sections({"knoepfe": {"aktiv": "automatik"}}, STUFEN)[2]
        self.assertEqual([o["value"] for o in ziel["options"]], ["k10", "k20", "k30", "k40", "voll"])
        self.assertIn("unbekannt", ziel["note"])

    def test_a_tap_keeps_the_other_value(self):
        sent = []

        def post(url, is_post, body=None):
            sent.append((url, body))
            return 200, {"ok": True, "text": "ok"}

        st = {"knoepfe": {"aktiv": "jetzt", "a": 10, "bis_pct": 80}, "auto_soc": 50}
        get = lambda url, is_post: (200, st)  # noqa: E731
        steuerung.choose(STUFEN, "a6", post, item="laden:ampere", get=get)
        steuerung.choose(STUFEN, "p60", post, item="laden:ziel", get=get)
        steuerung.choose(STUFEN, "p100", post, item="laden:ziel", get=get)
        steuerung.choose(STUFEN, "jetzt", post, get=get)
        self.assertEqual(
            [b for _, b in sent],
            [{"a": 6, "bis_pct": 80}, {"a": 10, "bis_pct": 60}, {"a": 10, "bis_pct": 100}, {"a": 10, "bis_pct": 80}],
        )
        self.assertTrue(all(u == "http://h/j" for u, _ in sent))
        nosoc = lambda url, is_post: (200, {"knoepfe": {"aktiv": "automatik"}})  # noqa: E731
        steuerung.choose(STUFEN, "k20", post, item="laden:ziel", get=nosoc)
        self.assertEqual(sent[-1][1], {"bis_kwh": 20})
        n = len(sent)
        for item, v in (("laden:ampere", "a7"), ("laden:ampere", "x"), ("laden:ziel", "p55"), ("laden:ziel", "k20")):
            self.assertEqual(steuerung.choose(STUFEN, v, post, item=item, get=get)[0], 400)
        self.assertEqual(len(sent), n)


class TestKabelAusSteuerung(unittest.TestCase):
    def test_module_hands_the_house_state_to_the_cable_tile_and_asks_once(self):
        import json
        import os
        import tempfile
        from unittest import mock

        from vibedash_modules.auto import Module

        from .helpers import at

        now = at(2026, 10, 22, 10)
        base = tempfile.mkdtemp(prefix="vd-kabel-")
        with open(os.path.join(base, "prognose.json"), "w") as fh:
            json.dump({"jetzt": now, "status": {"lade_status": "Failure", "angesteckt": True}}, fh)
        cfg = {"prognose": "prognose.json", "zeitzone": "Europe/Berlin", "steuerung": {"status_url": "http://h/s"}}
        m = Module(cfg, lambda p: os.path.join(base, p), clock=lambda: now)
        lage = {
            "knoepfe": {"aktiv": "automatik"},
            "text": "wartet",
            "laeuft": False,
            "erzwungen": False,
            "stand_ms": int((now - 30) * 1000),
        }

        def kabel(st):
            with mock.patch("vibedash_modules.auto.steuerung.status", return_value=st) as get:
                secs = m.board()["sections"]
            self.assertEqual(get.call_count, 1)
            tiles = next(s for s in secs if s.get("type") == "tiles")["tiles"]
            return next(x for x in tiles if x["label"] == "Ladekabel")["sub"]

        self.assertEqual(kabel(lage), "wartet auf Automatik")
        self.assertEqual(kabel({**lage, "erzwungen": True}), "Fehler")
        self.assertEqual(kabel({k: v for k, v in lage.items() if k != "laeuft"}), "Fehler")  # older house
        self.assertEqual(kabel(None), "Fehler")  # house unreachable


if __name__ == "__main__":
    unittest.main()
