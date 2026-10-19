import json
import os
import threading
import unittest
import urllib.error
import urllib.request

from vibedash_modules.app import serve
from vibedash_modules.config import load_modules
from vibedash_modules.wartung import calendar

from .helpers import at, cleanup, folder


def _read(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def _write(p, d):
    with open(p, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False)


class TestWartung(unittest.TestCase):
    def setUp(self):
        self.base = folder({"erstbezug": "2026-01-01"})
        self.mod = load_modules(self.base)["modules"]["wartung"]

    def tearDown(self):
        cleanup(self.base)

    def test_board_shape(self):
        b = self.mod.board()
        titles = [s["title"] for s in b["sections"]]
        self.assertEqual(titles[0], "Haus & Wartung")
        self.assertIn("Wartungstag: dein Rundgang", titles)
        self.assertIn("Wartungsplan: Haus, Garten & Geräte", titles)
        ids = [it.get("id") for s in b["sections"] for it in s.get("items") or [] if it.get("id")]
        self.assertTrue(all(i.split(":")[0] in ("plan", "offen", "service") for i in ids))
        self.assertTrue(all(len(it.get("meta", "")) <= 80 for s in b["sections"] for it in s.get("items") or []))

    def test_empty_plan_still_works(self):
        _write(os.path.join(self.base, "wartungsplan.json"), {})
        b = load_modules(self.base)["modules"]["wartung"].board()
        walk = next(s for s in b["sections"] if s["title"] == "Wartungstag: dein Rundgang")
        self.assertEqual(walk["items"][0]["text"], "Nichts fällig – alles auf Stand.")

    def test_done_undo_comment_snooze(self):
        st, r = self.mod.action({"item": "plan:siebe", "action": "done", "date": "2026-10-01"})
        self.assertEqual(st, 200, r)
        plan = _read(os.path.join(self.base, "wartungsplan.json"))
        siebe = next(a for g in plan["gruppen"] for a in g["aufgaben"] if a["id"] == "siebe")
        self.assertEqual(siebe["zuletzt"], "2026-10-01")
        self.assertEqual(self.mod.action({"item": "plan:siebe", "action": "undo"})[0], 200)
        plan = _read(os.path.join(self.base, "wartungsplan.json"))
        siebe = next(a for g in plan["gruppen"] for a in g["aufgaben"] if a["id"] == "siebe")
        self.assertIsNone(siebe["zuletzt"])
        self.assertEqual(self.mod.action({"item": "plan:siebe", "action": "comment", "text": "neu"})[0], 200)
        self.assertEqual(self.mod.action({"item": "plan:siebe", "action": "comment", "text": " "})[0], 400)
        self.assertEqual(self.mod.action({"item": "plan:siebe", "action": "snooze", "date": "2000-01-01"})[0], 400)
        self.assertEqual(self.mod.action({"item": "plan:siebe", "action": "snooze", "date": "2099-01-01"})[0], 200)
        self.assertEqual(self.mod.action({"item": "plan:nope", "action": "done"})[0], 400)
        self.assertEqual(self.mod.action({"item": "plan:siebe", "action": "switch"})[0], 400)
        b = self.mod.board()
        it = next(i for s in b["sections"] for i in s.get("items") or [] if i.get("id") == "plan:siebe")
        self.assertEqual(it["snoozed"], "2099-01-01")
        self.assertEqual(it["comments"][-1]["text"], "neu")
        with open(os.path.join(self.base, "notizen.jsonl")) as f:
            log = f.read().splitlines()
        self.assertGreaterEqual(len(log), 6)

    def test_house_insert_and_values(self):
        house = {
            "teile": {"server": [{"type": "text", "title": "Server", "text": "ok"}]},
            "werte": {"akku": "99 %"},
            "kacheln": [{"label": "Feuchte innen", "value": "55"}],
        }
        plan = _read(os.path.join(self.base, "wartungsplan.json"))
        plan["offen"] = [{"id": "o1", "text": "Akku prüfen", "daten": "akku", "termin": "2026-10-20T19:00"}]
        _write(os.path.join(self.base, "wartungsplan.json"), plan)
        cfg = {"plan": "wartungsplan.json", "einschub_url": "http://house/x", "layout": ["einschub:server", "kern"]}
        from vibedash_modules.wartung import Module

        m = Module(cfg, lambda p: os.path.join(self.base, p))
        m.board_.fetch = lambda url: house
        b = m.board()
        self.assertEqual(b["sections"][0]["title"], "Server")
        tiles = b["sections"][1]["tiles"]
        self.assertEqual(tiles[-1]["label"], "Feuchte innen")
        o = next(i for s in b["sections"] for i in s.get("items") or [] if i.get("id") == "offen:o1")
        self.assertEqual(o["text"], "Akku prüfen – jetzt: 99 %")
        self.assertTrue(o["meta"].startswith("Termin"))
        m.board_.fetch = lambda url: (_ for _ in ()).throw(OSError("down"))
        self.assertEqual(m.board()["sections"][0]["title"], "Haus & Wartung")

    def test_calendar_rfc5545_basics(self):
        t = calendar.ics(self.mod.plan, now=at(2026, 10, 19))
        lines = t.split("\r\n")
        self.assertEqual(lines[0], "BEGIN:VCALENDAR")
        self.assertEqual(lines[-2], "END:VCALENDAR")
        self.assertTrue(all(len(x.encode()) <= 75 for x in lines))
        self.assertEqual(t.count("BEGIN:VEVENT"), t.count("END:VEVENT"))
        self.assertIn("DTSTART;VALUE=DATE:20261024", t)
        sats = calendar.saturdays(self.mod.plan, now=at(2026, 10, 19), weeks=3)
        self.assertTrue(all(s["tag"].weekday() == 5 for s in sats))


class TestHttp(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.base = folder()
        cls.srv = serve("127.0.0.1", 0, cls.base)
        cls.url = f"http://127.0.0.1:{cls.srv.server_address[1]}"
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.srv.server_close()
        cleanup(cls.base)

    def get(self, path):
        try:
            with urllib.request.urlopen(self.url + path, timeout=5) as r:
                return r.status, r.headers.get("Content-Type"), r.read().decode()
        except urllib.error.HTTPError as e:
            return e.code, e.headers.get("Content-Type"), e.read().decode()

    def post(self, path, body, header=True):
        req = urllib.request.Request(
            self.url + path,
            data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json", **({"X-VibeDash-Action": "1"} if header else {})},
        )
        try:
            with urllib.request.urlopen(req, timeout=5) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    def test_routes(self):
        st, _, body = self.get("/gesund")
        self.assertEqual((st, json.loads(body)["modules"]), (200, ["wartung"]))
        st, _, body = self.get("/board/wartung")
        self.assertEqual(st, 200)
        self.assertIn("sections", json.loads(body))
        self.assertEqual(self.get("/board/nope")[0], 404)
        st, ctype, body = self.get("/feed/wartung/kalender.ics")
        self.assertEqual((st, ctype.split(";")[0]), (200, "text/calendar"))
        self.assertEqual(self.get("/feed/wartung/x.ics")[0], 404)
        self.assertEqual(self.get("/feed/wartung/../../etc")[0], 404)

    def test_action_needs_header(self):
        self.assertEqual(self.post("/board/wartung/action", {"item": "plan:siebe", "action": "ack"}, False)[0], 403)
        self.assertEqual(self.post("/board/wartung/action", {"item": "plan:siebe", "action": "ack"})[0], 200)
        self.assertEqual(self.post("/board/nope/action", {"item": "plan:x", "action": "ack"})[0], 404)


if __name__ == "__main__":
    unittest.main()
