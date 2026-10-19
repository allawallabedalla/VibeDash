"""Module "wartung": maintenance plan, maintenance day, service, open items, calendar subscription.

Config (local/modules/wartung.json, template modules/templates/wartung.json):
  plan            path of the plan file (relative to the modules folder), default "wartungsplan.json"
  notizen         path of the notes store, default "notizen.json"
  protokoll       optional path of the action log (.jsonl)
  zeitzone        default "Europe/Berlin"
  sprache         "de" (default) or "en"
  bereiche        [{id, titel}] – areas of the plan in board order
  layout          board order, see board.py
  ort_zeigen      areas whose list items also show the station
  einschub_url    optional house service with extra sections/values (see board.py)
  kalender_url    address of the calendar feed as the phone sees it (shown on the board)
  kalender_uid    UID domain of the calendar events, default "vibedash.wartung"
  kalender_name   default "Hauswartung"
  fahrzeug        optional {status: path, name, werkstatt} – vehicle inspection from a status file
  texte           optional wording overrides (keys of board.TEXT)
"""

from __future__ import annotations

import time

from ..notes import ACTIONS, Notes
from . import calendar
from .board import WartungBoard
from .plan import Plan


class Module:
    name = "wartung"
    feeds = {"kalender.ics": "text/calendar; charset=utf-8"}

    def __init__(self, cfg: dict, path):
        self.cfg = cfg
        lang = cfg.get("sprache") or "de"
        self.notes = Notes(
            path(cfg.get("notizen") or "notizen.json"),
            lang,
            path(cfg["protokoll"]) if cfg.get("protokoll") else None,
        )
        self.plan = Plan(
            path(cfg.get("plan") or "wartungsplan.json"),
            self.notes,
            cfg.get("zeitzone") or "Europe/Berlin",
            {
                **(cfg.get("fahrzeug") or {}),
                **({"status": path(cfg["fahrzeug"]["status"])} if (cfg.get("fahrzeug") or {}).get("status") else {}),
            },
        )
        self.board_ = WartungBoard(self.plan, cfg)

    def board(self) -> dict:
        return self.board_.build(self.notes)

    def feed(self, name: str) -> str | None:
        if name != "kalender.ics":
            return None
        return calendar.ics(
            self.plan,
            domain=self.cfg.get("kalender_uid") or "vibedash.wartung",
            name=self.cfg.get("kalender_name") or "Hauswartung",
        )

    def action(self, d: dict) -> tuple[int, dict]:
        """done / ack / comment / delete / undo / snooze on an item of this board."""
        item, action = str(d.get("item") or "")[:80], str(d.get("action") or "")
        if not item or action not in ACTIONS:
            return 400, {"ok": False, "text": "ungültig"}
        kind, _, tid = item.partition(":")
        if action == "done" and kind in ("plan", "offen"):
            before = None
            if kind == "plan":
                before = next((a.get("zuletzt") for a in self.plan.all() if a.get("id") == tid), None)
            else:
                before = next(
                    (o.get("erledigt") for o in self.plan.load().get("offen") or [] if o.get("id") == tid), None
                )
            ok, text = self.plan.done(tid, d.get("date") or None)
            if ok:
                # timestamp: today with the time, a back-dated one only the date; "later" is over with it
                self.notes.remember(
                    item, {"done": d.get("date") or time.strftime("%Y-%m-%d %H:%M"), "vorher": before, "snooze": None}
                )
        elif action == "undo" and kind in ("plan", "offen") and self.notes.load().get(item, {}).get("done"):
            ok, text = self.plan.done(tid, self.notes.load()[item].get("vorher") or "")
            if ok:
                self.notes.remember(item, {"done": None, "vorher": None})
                text = self.notes.msg["undo"]
        else:
            ok, text = self.notes.change(item, action, d.get("text"), d.get("date"))
        self.notes.log(
            {
                "board": str(d.get("board") or self.name)[:32],
                "item": item,
                "action": action,
                "ok": ok,
                "text": text,
                **({"kommentar": str(d.get("text"))[:500]} if action == "comment" else {}),
            }
        )
        return (200 if ok else 400), {"ok": ok, "text": text}
