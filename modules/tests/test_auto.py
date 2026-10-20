import json
import os
import shutil
import tempfile
import unittest

from vibedash_modules.auto import Module
from vibedash_modules.config import load_modules

from .helpers import TEMPLATES, at

NOW = at(2026, 10, 19, 16)  # 16:00 local


def _prognose():
    """Synthetic car forecast (no real car)."""
    return {
        "jetzt": NOW,
        "meldung": "2026-10-19T13:00:00Z",
        "soc_jetzt": 40.0,
        "soc_meldung": 40.0,
        "kap_kwh": 50.0,
        "geladen_seit_meldung_kwh": 0.0,
        "wirkungsgrad": {"wert": 0.9, "n": 1, "quelle": "angenommen", "werte": [0.9]},
        "status": {
            "reichweite_km": 120,
            "lade_status": "Disconnected",
            "angesteckt": False,
            "km_stand": 1000,
            "vorklima_programme": [{"start_min": 420, "tage": ["Mon", "Tue"], "an": True}],
        },
        "vorhersage": {
            "reserve_pct": 20.0,
            "tage_bis_reserve": {"frueh": 2, "mitte": 4, "spaet": 5},
            "tage": ["2026-10-19", "2026-10-20"],
            "soc_p10": [38, 30],
            "soc_p50": [39, 34],
            "soc_p90": [40, 38],
            "szenarien": 100,
        },
        "entscheidung": {"wort": "Hat Zeit", "kurz": "reicht bis übermorgen", "text": "…", "stufe": "ok"},
        "profil": {
            "tage_n": 30,
            "je_wt": [{"wt": "Mo", "n": 4, "mittel": 3.0, "p10": 1.0, "p90": 5.0}],
            "wochen": [],
            "kwh_100km": 16.0,
            "km_tag": 15.0,
            "erster_tag": "2026-09-01",
            "fahrten_n": 50,
        },
        "sonne": [{"k": 0, "tag": "2026-10-19", "kwh": 2.0, "kwh_p90": 4.0, "start": "16:00"}],
        "ladungen": [],
        "rueckblick": {},
    }


class TestAuto(unittest.TestCase):
    def setUp(self):
        self.base = tempfile.mkdtemp(prefix="vd-auto-")
        with open(os.path.join(self.base, "prognose.json"), "w", encoding="utf-8") as f:
            json.dump(_prognose(), f)
        with open(os.path.join(TEMPLATES, "auto.json"), encoding="utf-8") as f:
            self.cfg = json.load(f)
        self.cfg["prognose"] = "prognose.json"
        self.cfg["rechner"]["url"] = "http://haus.invalid/rechne"
        self.sent = []

        def post(url, body):
            self.sent.append((url, body))
            return 200, {"sections": [{"type": "text", "title": "Ergebnis", "text": "ok"}]}

        self.mod = Module(self.cfg, lambda p: os.path.join(self.base, p), post=post, clock=lambda: NOW)

    def tearDown(self):
        shutil.rmtree(self.base, ignore_errors=True)

    def test_board_slots_and_calculator(self):
        b = self.mod.board()
        types = [(s["type"], s.get("slot")) for s in b["sections"]]
        self.assertEqual(types[0], ("tiles", "top"))
        self.assertEqual(types[1], ("calc", "plan"))
        calc = b["sections"][1]
        self.assertEqual((calc["min"], calc["max"], calc["step"], calc["days"]), (960, 1425, 15, 7))
        self.assertIn(("series", "plan"), types)
        # no maker's name in the product: wording comes from texte
        self.assertNotIn("Citro", json.dumps(b, ensure_ascii=False))
        self.assertIn("Hersteller-App", json.dumps(b, ensure_ascii=False))

    def test_soc_tile_gets_its_curve(self):
        """Audit04 UX-15: the enlarged Ladestand tile shows a curve when the module stored one."""
        tile = next(x for x in self.mod.board()["sections"][0]["tiles"] if x["label"] == "Ladestand")
        self.assertNotIn("spark", tile)
        pr = _prognose()
        pr["soc_verlauf"] = {"von": 1000, "bis": 8200000, "werte": [50.0, None, 41.5]}
        with open(os.path.join(self.base, "prognose.json"), "w", encoding="utf-8") as f:
            json.dump(pr, f)
        tile = next(x for x in self.mod.board()["sections"][0]["tiles"] if x["label"] == "Ladestand")
        self.assertEqual((tile["spark"], tile["sparkFrom"], tile["sparkTo"]), ([50.0, None, 41.5], 1000, 8200000))

    def test_soc_curve_query(self):
        from vibedash_modules.auto.quellen import Influx

        class R:
            def __init__(self, body):
                self.body = body

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def read(self, *a):
                return self.body

        asked = []

        def opener(url, timeout):
            asked.append(url)
            vals = [[7200, None], [14400, 55.04]]
            return R(json.dumps({"results": [{"series": [{"columns": ["time", "mean"], "values": vals}]}]}).encode())

        sv = Influx({"db": "x"}, opener=opener).soc_verlauf(20000)
        self.assertEqual(sv, {"von": 7200000, "bis": 14400000, "werte": [None, 55.0]})
        self.assertIn("auto_prognose", asked[0])

    def test_no_calculator_without_url(self):
        self.cfg["rechner"]["url"] = ""
        m = Module(self.cfg, lambda p: os.path.join(self.base, p), clock=lambda: NOW)
        self.assertNotIn("calc", [s["type"] for s in m.board()["sections"]])
        self.assertEqual(m.calc({"value": 1000})[0], 404)

    def test_calc_passes_value_on_and_checks_it(self):
        self.assertEqual(
            self.mod.calc({"value": 4380}), (200, {"sections": [{"type": "text", "title": "Ergebnis", "text": "ok"}]})
        )
        self.assertEqual(self.sent, [("http://haus.invalid/rechne", {"board": "auto", "value": 4380})])
        self.assertEqual(self.mod.calc({"value": "x"})[0], 400)
        self.assertEqual(self.mod.calc({"value": True})[0], 400)
        self.assertEqual(len(self.sent), 1)

    def test_missing_forecast_file_says_so(self):
        os.remove(os.path.join(self.base, "prognose.json"))
        b = self.mod.board()
        self.assertEqual(b["sections"][0]["type"], "text")

    def test_loaded_from_config(self):
        with open(os.path.join(self.base, "auto.json"), "w", encoding="utf-8") as f:
            json.dump(self.cfg, f)
        m = load_modules(self.base)
        self.assertIn("auto", m["modules"], m["errors"])


# ── account, forecast, modes, ticker ─────────────────────────────────────────────────────────────────────────
from vibedash_modules.auto import hersteller, prognose  # noqa: E402


def _read(p):
    with open(p, encoding="utf-8") as f:
        return f.read()


DAY = 86400


def _trips(n_days=21, start=None):
    """One synthetic trip per day: 10 % of charge, 30 km, at 08:00."""
    start = start or at(2026, 9, 28, 8)
    out, soc = [], 90.0
    for i in range(n_days):
        t = start + i * DAY
        out.append(
            {
                "id": f"t{i}",
                "start": int(t),
                "ende": int(t + 1800),
                "km": 30,
                "soc_start": soc,
                "soc_ende": soc - 2,
                "km_stand": 1000 + 30 * i,
                "v_mittel": 40,
            }
        )
        soc -= 2
    return out


class FakeApi:
    """The maker's API as far as the module uses it (no location in the answers)."""

    def __init__(self, trips):
        self.trips, self.calls = trips, []

    def __call__(self, req, timeout=30):
        url = req.full_url
        self.calls.append(url.split("?")[0])
        if url.endswith("/access_token"):
            return 200, {"access_token": "a2", "refresh_token": "r2", "expires_in": 900}
        if "/trips" in url:
            return 200, {"_embedded": {"trips": self.trips}}
        if url.split("?")[0].endswith("/vehicles"):
            return 200, {"_embedded": {"vehicles": [{"id": "v1", "vin": "X123"}, {"id": "v0", "vin": "Y999"}]}}
        if "/maintenance" in url:
            return 200, {"daysBeforeMaintenance": 200}
        return 200, {
            "energies": [
                {
                    "type": "Electric",
                    "level": 55,
                    "autonomy": 180,
                    "createdAt": "2026-10-19T12:00:00Z",
                    "extension": {
                        "electric": {
                            "charging": {"plugged": False, "status": "Disconnected"},
                            "battery": {"load": {"capacity": 50000}},
                        }
                    },
                }
            ],
            "lastPosition": {"geometry": {"coordinates": [1, 2]}},
        }


class TestAccountAndForecast(unittest.TestCase):
    def setUp(self):
        self.base = tempfile.mkdtemp(prefix="vd-auto2-")
        p = lambda n: os.path.join(self.base, n)  # noqa: E731
        with open(p("app.json"), "w") as f:
            json.dump(
                {
                    "client_id": "c",
                    "client_secret": "s",
                    "oauth_url": "https://o.invalid",
                    "realm": "r",
                    "scheme": "x",
                    "culture": "de",
                    "locale": "de-DE",
                    "vin_endet_auf": "123",
                },
                f,
            )
        with open(p("token.json"), "w") as f:
            json.dump({"access_token": "a1", "refresh_token": "r1", "ablauf": 0}, f)
        self.p = p

    def tearDown(self):
        shutil.rmtree(self.base, ignore_errors=True)

    def test_fetch_refreshes_token_picks_vin_and_stores_no_location(self):
        api = FakeApi(
            [
                {
                    "id": "x1",
                    "done": True,
                    "startedAt": "2026-10-19T06:00:00Z",
                    "stoppedAt": "2026-10-19T06:30:00Z",
                    "distance": 12,
                    "startEnergies": [{"type": "Electric", "level": 60}],
                    "endEnergies": [{"type": "Electric", "level": 57}],
                    "startPosition": {"x": 1},
                }
            ]
        )
        k = hersteller.Konto(self.p("app.json"), self.p("token.json"), http=api, clock=lambda: NOW)
        st, alle, neu = k.abruf(self.p("status.json"), self.p("fahrten.json"))
        self.assertEqual(json.loads(_read(self.p("token.json")))["refresh_token"], "r2")
        self.assertIn("/vehicles/v1/status", " ".join(api.calls))
        self.assertEqual((st["soc"], st["kapazitaet_kwh"]), (55, 50.0))
        self.assertEqual([f["id"] for f in alle], ["x1"])
        dump = _read(self.p("status.json")) + _read(self.p("fahrten.json"))
        self.assertNotIn("coordinates", dump)
        self.assertNotIn("Position", dump)
        self.assertEqual(oct(os.stat(self.p("token.json")).st_mode & 0o777), "0o600")
        # same report again: no new trip pages fetched
        api.calls.clear()
        k.abruf(self.p("status.json"), self.p("fahrten.json"))
        self.assertFalse(any("/trips" in c for c in api.calls))

    def test_refused_sign_in_raises_without_secret(self):
        k = hersteller.Konto(self.p("app.json"), self.p("token.json"), http=lambda r, timeout=30: (401, "no"))
        with self.assertRaises(hersteller.Fehler) as e:
            k.token()
        self.assertNotIn("s", str(e.exception).replace("sign-in refused", "").replace("HTTP", ""))

    def test_forecast_profile_and_reserve_day(self):
        trips = _trips()
        st = {"soc": 40, "meldung": "2026-10-19T12:00:00Z", "kapazitaet_kwh": 50.0}

        class Meter:
            def wallbox_zaehler(self, ts):
                return 1000.0

        out = prognose.rechne(
            trips, st, {"tage": [{"tag": "2026-10-20", "kwh": 5.0, "kwh_p90": 8.0}]}, Meter(), jetzt=NOW
        )
        self.assertEqual(out["profil"]["tage_n"], 21)
        self.assertEqual(out["profil"]["tag_mittel"], 1.0)  # 2 % of 50 kWh a day
        self.assertEqual(out["soc_jetzt"], 40.0)
        vh = out["vorhersage"]
        # 2 points a day from 40 %: below 20 % after ~10 days
        self.assertTrue(9 <= vh["tage_bis_reserve"]["mitte"] <= 11, vh["tage_bis_reserve"])
        self.assertEqual(out["entscheidung"]["wort"], "Hat Zeit")
        self.assertEqual(prognose.q([1, 2, 3, 4], 0.5), 2.5)

    def test_modes_shadow_writes_only_its_file_and_on_fetches(self):
        with open(self.p("status.json"), "w") as f:
            json.dump({"soc": 40, "meldung": "2026-10-19T12:00:00Z", "kapazitaet_kwh": 50.0}, f)
        with open(self.p("fahrten.json"), "w") as f:
            json.dump(_trips(), f)
        cfg = {
            "betrieb": "schatten",
            "prognose": "p.json",
            "schatten_prognose": "s.json",
            "konto": {"app": "app.json", "token": "token.json", "status": "status.json", "fahrten": "fahrten.json"},
            "herzschlag": {"abruf": "hb_a", "prognose": "hb_p"},
        }
        m = Module(cfg, self.p, clock=lambda: NOW)
        self.assertEqual(m.takt(), (900, 540))
        m.lauf()
        self.assertTrue(os.path.exists(self.p("s.json")))
        self.assertFalse(os.path.exists(self.p("p.json")) or os.path.exists(self.p("hb_a")))
        self.assertEqual(json.loads(_read(self.p("token.json")))["refresh_token"], "r1")  # account untouched
        self.assertIsNone(Module({**cfg, "betrieb": "aus"}, self.p).takt())

    def test_ticker_runs_once_per_slot_and_skips_the_first(self):
        import threading

        from vibedash_modules import app

        runs, times = [], iter([0.0, 10.0, 950.0, 960.0, 1900.0])

        class M:
            def takt(self):
                return 900, 0

            def lauf(self, now):
                runs.append(now)
                return "ok"

        stop = threading.Event()
        orig = app.load_modules
        app.load_modules = lambda base: {"modules": {"auto": M()}, "errors": {}}
        try:

            def clock():
                try:
                    return next(times)
                except StopIteration:
                    stop.set()
                    return 1900.0

            app.ticker("x", stop, clock=clock, every=0)
        finally:
            app.load_modules = orig
        self.assertEqual(runs, [950.0, 1900.0])


class TestUnterwegs(unittest.TestCase):
    def test_share_of_same_weekdays_away_and_hint(self):
        from datetime import date

        # Tuesdays: away 06:30–15:30 on 4 of 5, one Tuesday without a trip (home office)
        trips = []
        for w in range(5):
            d = at(2026, 9, 1 + 7 * w, 6)  # Tue 01.09., 08.09., …
            if w == 4:
                continue
            trips.append(
                {
                    "id": f"a{w}",
                    "start": int(d + 1800),
                    "ende": int(d + 2 * 3600),
                    "km": 20,
                    "soc_start": 60,
                    "soc_ende": 57,
                }
            )
            trips.append(
                {
                    "id": f"b{w}",
                    "start": int(d + 9.5 * 3600),
                    "ende": int(d + 10 * 3600),
                    "km": 20,
                    "soc_start": 57,
                    "soc_ende": 54,
                }
            )
        k, n = prognose.unterwegs(trips, date(2026, 10, 6), 11, date(2026, 10, 6))
        self.assertEqual((k, n), (4, 5))
        text, kurz = prognose.zu_hause_hinweis(trips, {"tag": "2026-10-06", "start": "10:00"}, date(2026, 10, 5))
        self.assertIn("4 von 5", text)
        self.assertEqual(kurz, " · falls zu Hause")
        # Saturday: never away -> no hint
        self.assertEqual(
            prognose.zu_hause_hinweis(trips, {"tag": "2026-10-10", "start": "10:00"}, date(2026, 10, 5)), ("", "")
        )
