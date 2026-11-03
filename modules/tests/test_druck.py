"""Module "druck" on a synthetic printer (no network): state, progress, time left, temperatures, history, jobs."""

import json
import os
import shutil
import tempfile
import unittest

from tests.helpers import TZ, at
from vibedash_modules.druck import Module, board, source

NOW = at(2026, 3, 10, 12)


def status(state="PRINTING", job=7, p=40.0, r=1500, d=215.0, b=60.0):
    out = {
        "printer": {
            "state": state,
            "temp_nozzle": d,
            "target_nozzle": 215.0 if state == "PRINTING" else 0.0,
            "temp_bed": b,
            "target_bed": 60.0 if state == "PRINTING" else 0.0,
        }
    }
    if job is not None:
        out["job"] = {"id": job, "progress": p, "time_remaining": r}
    return out


class Fake:
    def __init__(self, st):
        self.st, self.calls = st, []

    def __call__(self, path):
        self.calls.append(path)
        if isinstance(self.st, Exception):
            raise self.st
        if path == "/api/v1/job":
            return {"file": {"name": "BENCHY~1.GCO", "display_name": "benchy.gcode"}}
        return self.st


class DruckTest(unittest.TestCase):
    def setUp(self):
        self.base = tempfile.mkdtemp(prefix="vd-druck-")
        from vibedash_modules import druck

        druck._NAMES.clear()
        druck._LIVE.clear()

    def tearDown(self):
        shutil.rmtree(self.base, ignore_errors=True)

    def mod(self, st, now=NOW, **cfg):
        from vibedash_modules import druck

        druck._LIVE.clear()  # each test printer answers anew
        fake = Fake(st)
        c = {"prusalink": {"url": "http://printer.test", "passwort": "x"}, "verlauf": "v.jsonl", **cfg}
        m = Module(c, lambda p: os.path.join(self.base, p), get=fake, clock=lambda: now)
        return m, fake

    def history(self, lines):
        with open(os.path.join(self.base, "v.jsonl"), "w", encoding="utf-8") as f:
            for r in lines:
                f.write(json.dumps(r) + "\n")

    def tiles(self, b, title):
        return {x["label"]: x for s in b["sections"] if s.get("title") == title for x in s["tiles"]}

    def test_config_needs_address_and_login(self):
        with self.assertRaises(ValueError):
            Module({"prusalink": {"passwort": "x"}}, lambda p: p)
        with self.assertRaises(ValueError):
            Module({"prusalink": {"url": "http://p"}}, lambda p: p)

    def test_printing_now(self):
        t0 = int(NOW * 1000)
        self.history([{"t": t0 - 600_000 + k * 60_000, "s": "PRINTING", "j": 7, "p": 1.0 + 4 * k} for k in range(10)])
        m, fake = self.mod(status())
        b = m.board()
        now = self.tiles(b, "Drucker")
        self.assertEqual((now["Zustand"]["value"], now["Zustand"]["sub"]), ("Druckt", "benchy.gcode"))
        self.assertEqual((now["Fortschritt"]["value"], now["Fortschritt"]["unit"]), ("40", "%"))
        self.assertEqual(now["Fortschritt"]["sub"], "seit 10 min")
        self.assertEqual((now["Restzeit"]["value"], now["Restzeit"]["unit"]), ("25", "min"))
        self.assertEqual(now["Restzeit"]["sub"], "fertig ≈ 12:25")
        self.assertTrue(now["Restzeit"]["approx"])
        temp = self.tiles(b, "Temperatur")
        self.assertEqual((temp["Düse"]["value"], temp["Düse"]["sub"]), ("215,0", "Ziel 215 °C"))
        self.assertEqual(b["updated"], t0)
        self.assertEqual(set(fake.calls), {"/api/v1/status", "/api/v1/job"})  # only reads
        jobs = next(s for s in b["sections"] if s["type"] == "table")["rows"]
        self.assertEqual(jobs[0]["cells"]["ende"], "läuft")

    def test_long_time_left_in_hours(self):
        m, _ = self.mod(status(r=5 * 3600 + 7 * 60))
        self.assertEqual(self.tiles(m.board(), "Drucker")["Restzeit"]["value"], "5:07")

    def test_ready_and_finished(self):
        m, _ = self.mod(status("IDLE", job=None, d=24.0, b=23.0))
        now = self.tiles(m.board(), "Drucker")
        self.assertEqual((now["Zustand"]["value"], now["Zustand"]["state"]), ("Bereit", "ok"))
        self.assertEqual((now["Fortschritt"]["value"], now["Fortschritt"]["sub"]), ("–", "kein Druckjob"))
        m, _ = self.mod(status("FINISHED", p=100.0, r=0))
        now = self.tiles(m.board(), "Drucker")
        self.assertEqual((now["Zustand"]["value"], now["Zustand"]["state"]), ("Fertig", "look"))
        self.assertEqual(now["Fortschritt"]["value"], "100")
        self.assertEqual(now["Restzeit"]["value"], "–")

    def test_error_needs_action(self):
        m, _ = self.mod(status("ERROR", job=None))
        self.assertEqual(self.tiles(m.board(), "Drucker")["Zustand"]["state"], "act")

    def test_offline_shows_last_seen(self):
        t0 = int(NOW * 1000)
        self.history([{"t": t0 - 3_600_000, "s": "IDLE", "d": 24.0, "b": 23.0}])
        m, _ = self.mod(OSError("no route"))
        b = m.board()
        now = self.tiles(b, "Drucker")
        self.assertEqual((now["Zustand"]["value"], now["Zustand"]["state"]), ("Aus", "open"))
        self.assertEqual(now["Zustand"]["sub"], "keine Antwort · zuletzt da 11:00")
        self.assertEqual(self.tiles(b, "Temperatur")["Düse"]["value"], "–")
        self.assertEqual(b["updated"], t0 - 3_600_000)

    def test_jobs_and_print_hours(self):
        t0 = int(at(2026, 3, 9, 10) * 1000)
        lines = [{"t": t0 + k * 60_000, "s": "PRINTING", "j": 3, "p": k, "f": "a.gcode"} for k in range(90)]
        lines.append({"t": t0 + 90 * 60_000, "s": "FINISHED", "j": 3, "p": 100.0})
        lines += [{"t": t0 + 4 * 3_600_000 + k * 60_000, "s": "PRINTING", "j": 4, "p": 30 + k} for k in range(10)]
        lines.append({"t": t0 + 4 * 3_600_000 + 600_000, "s": "STOPPED", "j": 4})
        js = board.jobs(lines)
        self.assertEqual(
            [(j["id"], j["end_state"], j["late"]) for j in js], [(4, "STOPPED", True), (3, "FINISHED", False)]
        )
        h = board.print_hours(lines, TZ)
        self.assertAlmostEqual(sum(h.values()), 1.5 + 10 / 60, places=3)
        self.history(lines)
        m, _ = self.mod(status("IDLE", job=None))
        rows = next(s for s in m.board()["sections"] if s["type"] == "table")["rows"]
        self.assertEqual([r["cells"]["ende"] for r in rows], ["abgebrochen", "fertig"])
        self.assertEqual([r["cells"]["dauer"] for r in rows], ["≥ 10 min", "1 h 30 min"])
        self.assertEqual(rows[1]["cells"]["start"], "gestern 10:00")

    def test_period_keeps_lines_while_working_else_every_10_min(self):
        m, _ = self.mod(status())
        m.lauf(NOW)
        m.lauf(NOW + 60)
        self.assertEqual(len(source.read_history(m.file)), 2)
        m, _ = self.mod(status("IDLE", job=None, d=24.0, b=23.0))
        m.lauf(NOW + 120)  # state changed: kept
        m.lauf(NOW + 180)  # same, cold: not kept
        m.lauf(NOW + 120 + 600)  # 10 minutes later: kept
        self.assertEqual([r["s"] for r in source.read_history(m.file)], ["PRINTING"] * 2 + ["IDLE"] * 2)

    def test_old_lines_are_dropped(self):
        t0 = int(NOW * 1000)
        self.history([{"t": t0 - 40 * 86_400_000, "s": "IDLE"}, {"t": t0 - 86_400_000, "s": "IDLE"}])
        m, _ = self.mod(status())
        m.lauf(NOW)
        self.assertEqual(len(source.read_history(m.file)), 2)

    def test_links_only_http(self):
        m, _ = self.mod(
            status("IDLE", job=None),
            links=[{"label": "Stiftplotter", "url": "http://host:8771/"}, {"label": "x", "url": "file:///etc"}],
        )
        texts = [s for s in m.board()["sections"] if s["type"] == "text"]
        self.assertEqual([s["link"]["url"] for s in texts], ["http://host:8771/"])


if __name__ == "__main__":
    unittest.main()
