"""Board "Wartung": maintenance day (walk), service appointments, open items and the plan per area.

Layout (config "layout", in this order):
  "kern"             tiles Haus & Wartung + the walk + service + open items
  "plan:<bereich>"   recurring tasks of one area (only what is due or soon; the rest as one line)
  "plan:*"           all areas not placed elsewhere, in the order of config "bereiche"
  "einschub:<teil>"  sections a house service adds (config "einschub_url", optional) – e.g. the house's own
                     server/PV/heating checks until they have their own modules
Default layout: ["kern", "plan:*"].

Optional house values (config "einschub_url" answers {"teile": {teil: [sections]}, "werte": {key: text},
"kacheln": [tiles]}): "werte" show next to a task with "daten": key (e.g. the battery's capacity next to
"check the battery"); "kacheln" are added to the Haus & Wartung tiles.
"""

from __future__ import annotations

import json
import urllib.request
from datetime import datetime

from .plan import Plan

STATE = {"faellig": "act", "nie": "open", "bald": "look", "ok": "ok", "verschoben": "ok"}
RANK = {"faellig": 0, "nie": 1, "bald": 2, "verschoben": 3, "ok": 4, "ruht": 5}
WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]

TEXT = {
    "de": {
        "kern_title": "Haus & Wartung",
        "tile_day": "Wartungstag",
        "tasks": "{n} Aufgaben",
        "day_sub": "≈ {h} h · {s} Stationen",
        "day_rest": " · danach noch {n}",
        "day_info": "Alles Fällige ohne Fachbetrieb, das Dringendste zuerst, bis {h} h voll sind – als Rundgang "
        "nach Ort sortiert. Werkzeug: ",
        "tile_service": "Service buchen",
        "nothing": "nichts",
        "next": "nächster: {t} bis {d}",
        "service_info": "Fachbetrieb-Termine: „buchen“ = fällig in weniger als {n} Tagen (Handwerker brauchen "
        "Vorlauf).",
        "tile_open": "Offene Punkte",
        "open_sub": "einmalige Aufgaben",
        "open_info": "Einmalige Aufgaben aus deiner Liste.",
        "walk_title": "Wartungstag: dein Rundgang",
        "walk_empty": "Nichts fällig – alles auf Stand.",
        "walk_note": "≈ {h} h, Reihenfolge = Weg durchs Haus. Einpacken: ",
        "walk_info": "Aufgaben mit Intervall ab 1 Monat ohne Fachbetrieb; Jahreszeit-Aufgaben (Außenhahn, Reifen …) "
        "zuerst, dann am längsten Überfälliges.",
        "cal_note": " · Kalender-Abo: {u}",
        "cal_info": " Kalender-Abo fürs iPhone (je Samstag ein Termin, nur im Heimnetz): {u} – Einstellungen → Apps → "
        "Kalender → Kalender-Accounts → Account hinzufügen → Andere → Kalenderabo hinzufügen.",
        "service_title": "Service: wann der Fachbetrieb kommen muss",
        "service_note": "„Zur Kenntnis“ = Termin ist ausgemacht; „Erledigt“, wenn der Termin war.",
        "service_list_info": "Fällig = letzte Erledigung (sonst Einzug {d}) + Intervall laut Plan. Auto: Tage bis "
        "zur Inspektion meldet das Auto selbst.",
        "service_list_info_nomove": "Fällig = letzte Erledigung + Intervall laut Plan.",
        "open_title": "Offene Punkte",
        "open_note": "{n} offen",
        "open_list_info": "Einmalige Aufgaben; wo das Haus einen passenden Messwert hat, steht er dabei.",
        "now": " – jetzt: ",
        "date_today": "heute",
        "appointment": "Termin {d} {t}",
        "rest_line": "{n} weitere auf Stand",
        "rest_next": " – als Nächstes: {t}",
        "plan_due": "{n} dran · ",
        "plan_ok": "Alles auf Stand · ",
        "plan_note": "Antippen für Notiz, Erledigt und Später; Intervalle zählen ab Einzug ({d}), bis du eine "
        "Erledigung einträgst.",
        "plan_note_nomove": "Antippen für Notiz, Erledigt und Später.",
        "plan_info": "Alle Aufgaben: ",
        "plan_title": "Wartungsplan: {b}",
        "source": "Wartungsplan (Modul wartung).",
    },
    "en": {
        "kern_title": "House & maintenance",
        "tile_day": "Maintenance day",
        "tasks": "{n} tasks",
        "day_sub": "≈ {h} h · {s} stops",
        "day_rest": " · {n} more after that",
        "day_info": "Everything due without a professional, most urgent first, until {h} h are full – ordered as a "
        "walk through the house. Tools: ",
        "tile_service": "Book service",
        "nothing": "nothing",
        "next": "next: {t} by {d}",
        "service_info": "Professional jobs: “book” = due in less than {n} days (tradespeople need lead time).",
        "tile_open": "Open items",
        "open_sub": "one-off tasks",
        "open_info": "One-off tasks from your list.",
        "walk_title": "Maintenance day: your walk",
        "walk_empty": "Nothing due – all up to date.",
        "walk_note": "≈ {h} h, order = the way through the house. Bring: ",
        "walk_info": "Tasks every month or less often without a professional; seasonal tasks first, then the "
        "longest overdue.",
        "cal_note": " · calendar: {u}",
        "cal_info": " Calendar subscription (one event per Saturday, home network only): {u}",
        "service_title": "Service: when the professional has to come",
        "service_note": "“Acknowledged” = appointment made; “Done” once it took place.",
        "service_list_info": "Due = last done (else move-in {d}) + interval from the plan.",
        "service_list_info_nomove": "Due = last done + interval from the plan.",
        "open_title": "Open items",
        "open_note": "{n} open",
        "open_list_info": "One-off tasks; where the house has a matching reading, it is shown.",
        "now": " – now: ",
        "date_today": "today",
        "appointment": "Appointment {d} {t}",
        "rest_line": "{n} more up to date",
        "rest_next": " – next: {t}",
        "plan_due": "{n} due · ",
        "plan_ok": "All up to date · ",
        "plan_note": "Tap for note, done and later; intervals count from move-in ({d}) until you record one.",
        "plan_note_nomove": "Tap for note, done and later.",
        "plan_info": "All tasks: ",
        "plan_title": "Maintenance plan: {b}",
        "source": "Maintenance plan (module wartung).",
    },
}


def num(x, nd=0) -> str:
    return "–" if x is None else f"{x:,.{nd}f}".replace(",", " ").replace(".", ",").replace(" ", ".")


class WartungBoard:
    def __init__(self, plan: Plan, cfg: dict, fetch=None):
        self.p = plan
        self.cfg = cfg
        lang = cfg.get("sprache") or "de"
        self.t = {**TEXT.get(lang, TEXT["de"]), **(cfg.get("texte") or {})}
        self.fetch = fetch or _fetch_json

    # ── pieces ───────────────────────────────────────────────────────────────
    def _appointment(self, t: str) -> str:
        try:
            d = datetime.fromisoformat(t)
        except ValueError:
            return f"Termin {t}"
        day = self.t["date_today"] if d.date() == self.p.today() else WEEKDAYS[d.weekday()] + d.strftime(" %d.%m.")
        return self.t["appointment"].format(d=day, t=d.strftime("%H:%M"))

    def item(self, a: dict, values: dict, with_place: bool = False) -> dict:
        """One plan task as a clickable list item (id plan:<id>)."""
        reading = values.get(a.get("daten") or "")
        parts = [a.get("intervall") + (f" ({a['saison']})" if a.get("saison") else "")]
        if with_place:
            parts.append(a.get("ort") or "")
        if a.get("minuten"):
            parts.append(f"{a['minuten']} min")
        parts.append(a.get("stand") or "")
        return {
            "id": f"plan:{a['id']}",
            "actions": ["done", "snooze", "comment"],
            "text": (a.get("text") or "")[:300] + (f"{self.t['now']}{reading}" if reading else ""),
            "meta": " · ".join(x for x in parts if x)[:80],
            **({"state": STATE[a["zustand"]]} if a.get("zustand") in STATE else {}),
        }

    def plan_list(self, tasks: list[dict], area: str, title: str, values: dict, plan: dict) -> list[dict]:
        mine = [a for a in tasks if a.get("bereich") == area]
        if not mine:
            return []
        mine.sort(
            key=lambda a: (
                RANK.get(a["zustand"], 5),
                a.get("rest_tage") if a.get("rest_tage") is not None else 9999,
            )
        )
        # put-off tasks stay visible (with "put off until" and undo) but come after what is due
        due = [a for a in mine if a["zustand"] in ("faellig", "nie", "bald", "verschoben")]
        calm = [a for a in mine if a not in due]
        with_place = area in (self.cfg.get("ort_zeigen") or [])
        items = [self.item(a, values, with_place) for a in due]
        if calm:
            nxt = next((a for a in calm if a.get("faellig")), None)
            items.append(
                {
                    "text": self.t["rest_line"].format(n=len(calm))
                    + (self.t["rest_next"].format(t=nxt["text"][:60]) if nxt else ""),
                    "meta": (nxt["faellig"].strftime("%d.%m.%Y") if nxt else ""),
                    "state": "ok",
                }
            )
        mv = _move_in(plan)
        n_due = sum(1 for a in due if a["zustand"] != "verschoben")
        note = (self.t["plan_due"].format(n=n_due) if due else self.t["plan_ok"]) + (
            self.t["plan_note"].format(d=mv) if mv else self.t["plan_note_nomove"]
        )
        return [
            {
                "type": "list",
                "title": title,
                "items": items,
                "note": note,
                "info": {
                    "what": self.t["plan_info"]
                    + " · ".join(f"{a.get('text')} ({a.get('intervall')}, {a.get('stand')})" for a in mine)[:590],
                    "source": self.t["source"],
                },
            }
        ]

    def core(self, plan: dict, tasks: list[dict], values: dict, extra_tiles: list[dict]) -> list[dict]:
        t = self.t
        day = self.p.maintenance_day(plan)
        serv = self.p.service(plan)
        open_ = self.p.open_items(plan)
        book = [x for x in serv if x["jetzt_buchen"]]
        nxt = next((x for x in serv if not x["jetzt_buchen"] and x.get("buchen_bis")), None)
        tiles = [
            {
                "label": t["tile_day"],
                "value": t["tasks"].format(n=day["anzahl"]),
                "icon": "wrench",
                "state": "look" if day["anzahl"] else "ok",
                "sub": t["day_sub"].format(h=num(day["minuten"] / 60, 1), s=len(day["stationen"]))
                + (t["day_rest"].format(n=day["rest_anzahl"]) if day["rest_anzahl"] else ""),
                "info": {
                    "what": t["day_info"].format(h=num(day["budget"] / 60, 1)) + ", ".join(day["werkzeug"])[:450],
                    "source": t["source"],
                },
            },
            {
                "label": t["tile_service"],
                "value": str(len(book)) if book else t["nothing"],
                "icon": "calendar",
                "state": "act" if book else "ok",
                "sub": (
                    ", ".join(x["text"][:30] for x in book[:2])
                    if book
                    else (t["next"].format(t=nxt["text"][:40], d=nxt["buchen_bis"].strftime("%d.%m.%Y")) if nxt else "")
                ),
                "info": {
                    "what": t["service_info"].format(n=plan.get("service_vorlauf_tage", 42)),
                    "source": t["source"],
                },
            },
            {
                "label": t["tile_open"],
                "value": str(len(open_)),
                "icon": "lookCircle",
                "state": "look" if open_ else "ok",
                "sub": t["open_sub"],
                "info": {"what": t["open_info"], "source": t["source"]},
            },
            *extra_tiles,
        ]
        out = [{"type": "tiles", "title": t["kern_title"], "tiles": tiles}]
        walk = []
        for st in day["stationen"]:
            for a in st["aufgaben"]:
                it = self.item(a, values)
                it["meta"] = f"{st['ort'][:28]} · {a.get('minuten') or 15} min · {a.get('stand')}"[:80]
                walk.append(it)
        cal = self.cfg.get("kalender_url")
        note = (t["walk_note"].format(h=num(day["minuten"] / 60, 1)) + ", ".join(day["werkzeug"][:10]))[:330]
        out.append(
            {
                "type": "list",
                "title": t["walk_title"],
                "items": walk or [{"text": t["walk_empty"], "state": "ok"}],
                "note": note + (t["cal_note"].format(u=cal) if cal else ""),
                "info": {
                    "what": t["walk_info"] + (t["cal_info"].format(u=cal) if cal else ""),
                    "source": t["source"],
                },
            }
        )
        items = []
        for x in serv[:20]:
            auto = x["id"] == "auto_inspektion"
            items.append(
                {
                    "id": "service:auto_inspektion" if auto else f"plan:{x['id']}",
                    "actions": ["ack", "snooze", "comment"] if auto else ["done", "ack", "snooze", "comment"],
                    "text": x["text"][:300],
                    "meta": x["service_text"][:80],
                    "state": "act" if x["jetzt_buchen"] else "ok",
                }
            )
        mv = _move_in(plan)
        out.append(
            {
                "type": "list",
                "title": t["service_title"],
                "items": items,
                "note": t["service_note"],
                "info": {
                    "what": t["service_list_info"].format(d=mv) if mv else t["service_list_info_nomove"],
                    "source": t["source"],
                },
            }
        )
        if open_:
            out.append(
                {
                    "type": "list",
                    "title": t["open_title"],
                    "items": [
                        {
                            "id": f"offen:{o['id']}",
                            "actions": ["done", "snooze", "comment", "delete"],
                            "text": o.get("text", "")[:200]
                            + (f"{t['now']}{values[o['daten']]}" if values.get(o.get("daten") or "") else ""),
                            **({"meta": self._appointment(o["termin"])} if o.get("termin") else {}),
                            "state": "look",
                        }
                        for o in sorted(open_, key=lambda o: o.get("termin") or "9999")
                    ],
                    "note": t["open_note"].format(n=len(open_)),
                    "info": {"what": t["open_list_info"], "source": t["source"]},
                }
            )
        return out

    # ── whole board ──────────────────────────────────────────────────────────
    def build(self, notes=None) -> dict:
        plan = self.p.load()
        tasks = self.p.all(plan)
        house = {}
        if self.cfg.get("einschub_url"):
            try:
                house = self.fetch(self.cfg["einschub_url"]) or {}
            except Exception:  # the house part is optional; the plan works without it
                house = {}
        parts = house.get("teile") or {}
        values = house.get("werte") or {}
        areas = self.cfg.get("bereiche") or [
            {"id": b, "titel": self.t["plan_title"].format(b=b)}
            for b in dict.fromkeys(g.get("bereich") for g in plan.get("gruppen") or [] if g.get("bereich"))
        ]
        layout = self.cfg.get("layout") or ["kern", "plan:*"]
        placed = {e[5:] for e in layout if e.startswith("plan:") and e != "plan:*"}
        sections: list[dict] = []
        for entry in layout:
            if entry == "kern":
                sections += self.core(plan, tasks, values, house.get("kacheln") or [])
            elif entry == "plan:*":
                for a in areas:
                    if a["id"] not in placed:
                        sections += self.plan_list(tasks, a["id"], a["titel"], values, plan)
            elif entry.startswith("plan:"):
                a = next((x for x in areas if x["id"] == entry[5:]), None)
                if a:
                    sections += self.plan_list(tasks, a["id"], a["titel"], values, plan)
            elif entry.startswith("einschub:"):
                sections += [s for s in parts.get(entry[9:]) or [] if isinstance(s, dict)]
        if notes is not None:
            notes.apply(sections)
        out = {"sections": sections}
        if house.get("updated"):
            out["updated"] = house["updated"]
        return out


def _move_in(plan: dict) -> str | None:
    from .plan import to_date

    d = to_date(plan.get("erstbezug")) if plan.get("erstbezug") else None
    return d.strftime("%d.%m.%Y") if d else None


def _fetch_json(url: str):
    with urllib.request.urlopen(url, timeout=20) as r:  # noqa: S310 – address from the local config only
        return json.load(r)
