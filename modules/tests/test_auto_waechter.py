import os
import shutil
import tempfile
import unittest
from datetime import UTC, datetime, timedelta

from vibedash_modules.auto import waechter as W

T0 = datetime(2026, 6, 1, 10, 30, tzinfo=UTC).timestamp()
HOUR = datetime(2026, 6, 1, 10, tzinfo=UTC)


class FakeEvcc:
    """A wallbox behind evcc: the mode is what was set; charging power follows the mode unless 'stuck'."""

    def __init__(self, connected=True, kw=7.0, mode="pv", stuck=False):
        self.connected, self.kw, self.mode, self.stuck = connected, kw, mode, stuck
        self.writes = []

    def state(self):
        kw = self.kw if self.mode != "off" or self.stuck else 0.0
        return {"connected": self.connected, "charging": kw > 0, "kw": kw, "mode": self.mode, "soc": 50}

    def set_mode(self, mode):
        self.writes.append(mode)
        if not self.stuck:
            self.mode = mode


def plan(kw):
    """the same wish for every hour of ten days (the ticks run over several days)"""
    hours = [HOUR + timedelta(hours=h) for h in range(-12, 24 * 10)]
    return {"zustand": "bereit", "stunden": [h.isoformat() for h in hours], "auto_kw": [kw] * len(hours)}


class TestWaechter(unittest.TestCase):
    def setUp(self):
        self.base = tempfile.mkdtemp(prefix="vd-waechter-")
        self.guete = {"n": 20, "korrekt_pct": 100.0, "zustand": "bewertbar"}
        self.plan = plan(3.0)
        self.ev = FakeEvcc()

    def tearDown(self):
        shutil.rmtree(self.base, ignore_errors=True)

    def w(self):
        def get(url):
            return self.guete if url.endswith("guete") else self.plan

        cfg = {"evcc_url": "http://evcc", "plan_url": "http://f/plan/1", "guete_url": "http://f/plan/1/guete"}
        return W.Waechter(cfg, lambda p: os.path.join(self.base, p), evcc=self.ev, get=get)

    def open_lock(self):
        """seven reading days, then the pause test with the person's yes"""
        w = self.w()
        for d in range(7):
            w.tick(T0 + d * 86400)
        self.assertEqual(w.choose(W.TEST_ITEM, "erlauben")[0], 200)
        self.assertEqual(w.tick(T0 + 7 * 86400), "Pausetest gestartet")
        self.assertEqual(self.ev.mode, "off")
        self.assertEqual(w.tick(T0 + 7 * 86400 + 60), "Pausetest bestanden")
        self.assertEqual(self.ev.mode, "pv")  # back as before
        return w

    def test_wilson_is_honest_for_small_n(self):
        self.assertLess(W.wilson_low(7, 7), 0.75)  # 7 of 7 is not yet enough
        self.assertGreaterEqual(W.wilson_low(14, 14), 0.75)
        self.assertLess(W.wilson_low(13, 14), 0.75)

    def test_off_never_writes_and_automatic_stays_locked(self):
        w = self.w()
        for d in range(10):
            w.tick(T0 + d * 86400)
        self.assertEqual(self.ev.writes, [])
        self.assertEqual(w.choose(W.ITEM, "automatik")[0], 409)
        s = w.sections()
        auto = next(o for o in s[0]["options"] if o["value"] == "automatik")
        self.assertTrue(auto["disabled"])
        self.assertEqual(s[1]["title"], "Automatik gesperrt")
        self.assertEqual([i.get("state") for i in s[1]["items"]], ["ok", "ok", None])  # pause test missing

    def test_lock_opens_by_itself_then_follows_the_plan(self):
        w = self.open_lock()
        self.assertEqual(w.choose(W.ITEM, "automatik")[0], 200)
        self.plan = plan(0.0)
        self.assertEqual(w.tick(T0 + 7 * 86400 + 120), "umgeschaltet auf off")
        self.plan = plan(3.0)
        self.assertEqual(w.tick(T0 + 7 * 86400 + 240), "umgeschaltet auf pv")
        self.assertEqual(len(w.sections()), 1)  # open: only the switch

    def test_closes_when_the_plan_misses_and_hands_back_to_sun_charging(self):
        w = self.open_lock()
        w.choose(W.ITEM, "automatik")
        self.plan = plan(0.0)
        w.tick(T0 + 7 * 86400 + 120)
        self.assertEqual(self.ev.mode, "off")
        self.guete = {"n": 20, "korrekt_pct": 70.0}
        self.assertIn("gesperrt", w.tick(T0 + 7 * 86400 + 240))
        self.assertEqual(self.ev.mode, "pv")
        n = len(self.ev.writes)
        w.tick(T0 + 7 * 86400 + 360)
        self.assertEqual(len(self.ev.writes), n)  # hands off after that
        self.assertIn("Plan trifft schlechter", w.sections()[1]["title"])

    def test_dead_man_stops_without_a_plan_and_logs_why(self):
        w = self.open_lock()
        w.choose(W.ITEM, "automatik")
        self.plan = None
        self.assertEqual(w.tick(T0 + 7 * 86400 + 120), "umgeschaltet auf off")
        last = w.state()["log"][-1]
        self.assertEqual((last["mode"], last["grund"], last["ok"]), ("off", "kein Plan (Totmann)", True))

    def test_a_change_in_the_app_wins_until_unplugged(self):
        w = self.open_lock()
        w.choose(W.ITEM, "automatik")
        self.plan = plan(0.0)
        w.tick(T0 + 7 * 86400 + 120)
        w.tick(T0 + 7 * 86400 + 240)  # confirmed
        self.ev.mode = "now"  # the person in the evcc app
        self.assertIn("von Hand", w.tick(T0 + 7 * 86400 + 400))
        self.assertEqual(self.ev.mode, "now")
        self.ev.connected = False
        w.tick(T0 + 7 * 86400 + 500)
        self.ev.connected = True
        self.assertEqual(w.tick(T0 + 7 * 86400 + 600), "umgeschaltet auf off")

    def test_no_feedback_closes_the_lock(self):
        w = self.open_lock()
        w.choose(W.ITEM, "automatik")
        self.ev.stuck = True
        self.plan = plan(0.0)
        t = T0 + 7 * 86400 + 120
        texts = [w.tick(t + k * 100) for k in range(6)]
        self.assertTrue(any("bestätigt" in x for x in texts), texts)
        st = w.state()
        self.assertEqual(st["schalter"], "aus")
        self.assertEqual(st["pausetest"]["ergebnis"], "keine Rückmeldung")

    def test_now_until_unplugged_also_while_locked(self):
        w = self.w()
        w.tick(T0)
        self.assertEqual(w.choose(W.ITEM, "jetzt")[0], 200)
        self.assertEqual(w.tick(T0 + 60), "umgeschaltet auf now")
        self.ev.connected = False
        w.tick(T0 + 120)
        self.assertEqual(w.state()["schalter"], "aus")

    def test_pause_test_fails_when_power_does_not_drop(self):
        w = self.w()
        self.ev.stuck = True
        w.choose(W.TEST_ITEM, "erlauben")
        w.tick(T0)
        self.assertIn("fiel nicht", w.tick(T0 + W.PAUSE_S + 10))
        self.assertEqual(w.state()["pausetest"]["ergebnis"], "keine Pause")
        self.assertIn("nochmal erlauben", w.sections()[1]["items"][2]["meta"])

    def test_a_house_without_wallbox_shows_no_switch(self):
        class NoLp:
            def state(self):
                return {"kein_ladepunkt": True}

        self.ev = NoLp()
        w = self.w()
        self.assertIn("keine Wallbox", w.tick(T0))
        self.assertEqual(w.sections(), [])

    def test_unreachable_evcc_changes_nothing(self):
        class Down:
            def state(self):
                raise OSError("down")

        self.ev = Down()
        self.assertEqual(self.w().tick(T0), "evcc nicht erreichbar")


if __name__ == "__main__":
    unittest.main()
