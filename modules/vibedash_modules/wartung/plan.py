"""Maintenance plan: due dates, the maintenance day ("Wartungstag") and service appointments.

The plan is one JSON file (field names are German, see modules/templates/wartungsplan.json):
  * "intervalle_tage": interval name -> days ("monatl.": 30, ...)
  * "orte": stations of the walk through the house, in order
  * "gruppen": [{id, titel, bereich, aufgaben: [{id, intervall, text, minuten, ort, werkzeug, hinweis,
                 service, monat, saison, daten, zuletzt}]}]
  * "offen": one-off tasks [{id, text, daten, termin, dauer_min, hinweis, erledigt}]
  * "erstbezug": move-in date; counts as the last time a task was done until it is ticked off
  * "wartungstag_minuten", "service_vorlauf_tage"

Rules:
  * due = last done + interval; never recorded and no move-in date = due now
  * "monat": a yearly task belongs to this month (due from the 1st)
  * "saison": Winter = Oct–Apr, Sommer = Apr–Oct; outside it the task rests
  * maintenance day: everything due without a professional ("service"), interval >= 4 weeks, most urgent first,
    until the time budget is full; then ordered as a walk by station
  * service: professional jobs; "book by" = due - service_vorlauf_tage (tradespeople need lead time)

Reading needs no lock; ticking off (done) writes atomically under a file lock (<plan>.lock), so several writers
(this service, a house script) can share one plan file.
"""

from __future__ import annotations

import fcntl
import json
import os
import time
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

SEASONS = {"Winter": (10, 11, 12, 1, 2, 3, 4), "Sommer": (4, 5, 6, 7, 8, 9, 10)}
SOON_DAYS = 14
SAFETY_FIRST = ("sicherheit", "elektro", "heizung")  # on a tie these groups go first


class Plan:
    """One plan file plus the notes store (for "later"/snooze)."""

    def __init__(self, path: str, notes=None, tz: str = "Europe/Berlin", vehicle: dict | None = None):
        self.path = path
        self.notes = notes
        self.tz = ZoneInfo(tz)
        # optional: a JSON file with {"wartung_tage": n, "abgerufen": epoch} (e.g. from a car module)
        self.vehicle = vehicle or {}

    # ── reading ──────────────────────────────────────────────────────────────
    def load(self) -> dict:
        try:
            with open(self.path, encoding="utf-8") as f:
                return json.load(f)
        except (OSError, ValueError):
            return {}

    def today(self, now: float | None = None) -> date:
        return datetime.fromtimestamp(now or time.time(), self.tz).date()

    def _snoozed(self) -> dict:
        if self.notes is None:
            return {}
        out = {}
        for k, v in self.notes.load().items():
            if k.startswith("plan:") and isinstance(v, dict) and v.get("snooze"):
                out[k[5:]] = v["snooze"]
        return out

    def all(self, plan: dict | None = None, now: float | None = None) -> list[dict]:
        """All tasks, flat, each with gruppe/bereich and its state."""
        plan = plan if plan is not None else self.load()
        day = self.today(now)
        iv = plan.get("intervalle_tage") or {}
        move_in = to_date(plan.get("erstbezug")) if plan.get("erstbezug") else None
        snooze = self._snoozed()
        out = []
        for g in plan.get("gruppen") or []:
            for a in g.get("aufgaben") or []:
                z = state(a, iv, day, move_in)
                # "later" in VibeDash: rests until that day (not in the maintenance day, no reminder)
                sp = to_date(snooze.get(a.get("id"))) if snooze.get(a.get("id")) else None
                if sp and sp > day and z["zustand"] in ("faellig", "nie", "bald"):
                    z = {**z, "zustand": "verschoben", "stand": f"verschoben bis {sp.strftime('%d.%m.%Y')}"}
                out.append(
                    {
                        **a,
                        "gruppe": g.get("id"),
                        "gruppe_titel": g.get("titel"),
                        "bereich": g.get("bereich"),
                        "intervall_tage": iv.get(a.get("intervall")),
                        **z,
                    }
                )
        return out

    def maintenance_day(self, plan: dict | None = None, now: float | None = None) -> dict:
        """The next maintenance day: stations (place -> tasks), minutes, tools, rest."""
        plan = plan if plan is not None else self.load()
        budget = plan.get("wartungstag_minuten") or 240
        cand = [
            a
            for a in self.all(plan, now)
            if not a.get("service")
            and (a.get("intervall_tage") or 0) >= 28
            and a["zustand"] in ("nie", "faellig", "bald")
            and a.get("ort") != "Service"
        ]
        chosen, total = choose(cand, budget)
        rest = [a for a in cand if a not in chosen]
        return {
            "stationen": stations(plan, chosen),
            "minuten": total,
            "anzahl": len(chosen),
            "werkzeug": tools(chosen),
            "rest_anzahl": len(rest),
            "rest_minuten": sum(a.get("minuten") or 15 for a in rest),
            "budget": budget,
        }

    def service(self, plan: dict | None = None, now: float | None = None) -> list[dict]:
        """Professional appointments, ordered by "book by"; with the vehicle's inspection if configured."""
        plan = plan if plan is not None else self.load()
        day = self.today(now)
        lead = plan.get("service_vorlauf_tage") or 42
        out = []
        for a in self.all(plan, now):
            if not a.get("service"):
                continue
            f = a.get("faellig")
            book = (f - timedelta(days=lead)) if f else None
            if a["zustand"] == "verschoben":
                book_now, text = False, a["stand"]
            elif a["zustand"] == "nie":
                book_now, text = True, "noch nie erfasst – wann war der letzte Termin?"
            elif a["zustand"] == "ruht":
                book_now, text = False, a["stand"]
            else:
                book_now = book is not None and book <= day
                text = (
                    (
                        f"fällig {f.strftime('%m/%Y')} · Termin ausmachen "
                        + ("jetzt" if book_now else f"bis {book.strftime('%d.%m.%Y')}")
                    )
                    if f
                    else a["stand"]
                )
            out.append({**a, "buchen_bis": book, "jetzt_buchen": book_now, "service_text": text})
        v = self._vehicle_inspection(day, lead)
        if v:
            out.append(v)
        out.sort(key=lambda a: (not a["jetzt_buchen"], a.get("buchen_bis") or date.max))
        return out

    def _vehicle_inspection(self, day: date, lead: int) -> dict | None:
        path = self.vehicle.get("status")
        if not path:
            return None
        try:
            with open(path, encoding="utf-8") as fh:
                st = json.load(fh)
        except (OSError, ValueError):
            return None
        t = st.get("wartung_tage")
        if t is None:
            return None
        f = date.fromtimestamp(st.get("abgerufen") or time.time()) + timedelta(days=int(t))
        book = f - timedelta(days=lead)
        name = self.vehicle.get("name") or "Auto"
        return {
            "id": "auto_inspektion",
            "text": f"Auto-Inspektion ({name})",
            "service": True,
            "gruppe": "auto",
            "bereich": "elektro",
            "intervall": "laut Auto",
            "faellig": f,
            "buchen_bis": book,
            "jetzt_buchen": book <= day,
            "zustand": "ok" if book > day else "bald",
            "service_text": f"fällig ≈ {f.strftime('%d.%m.%Y')} (laut Auto noch {t} Tage) · Termin ausmachen "
            + ("jetzt" if book <= day else f"bis {book.strftime('%d.%m.%Y')}"),
            "werkzeug": self.vehicle.get("werkstatt") or "Werkstatt",
            "minuten": None,
            "automatisch": True,
        }

    def open_items(self, plan: dict | None = None) -> list[dict]:
        plan = plan if plan is not None else self.load()
        return [o for o in plan.get("offen") or [] if not o.get("erledigt")]

    # ── writing ──────────────────────────────────────────────────────────────
    def done(self, task_id: str, day: str | None = None) -> tuple[bool, str]:
        """Mark a plan task or open item done; day None = today, "" = reset. Atomic under a file lock."""
        if day is None:
            day = self.today().isoformat()
        elif day:
            d = to_date(day)
            if d is None or d > self.today() or d.year < 2000:
                return False, "Datum ungültig"
            day = d.isoformat()
        with open(self.path + ".lock", "w") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            plan = self.load()
            hit = None
            for g in plan.get("gruppen") or []:
                for a in g.get("aufgaben") or []:
                    if a.get("id") == task_id:
                        a["zuletzt"] = day or None
                        hit = a.get("text")
            for o in plan.get("offen") or []:
                if o.get("id") == task_id:
                    o["erledigt"] = day or None
                    hit = o.get("text")
            if hit is None:
                return False, "unbekannte Aufgabe"
            tmp = f"{self.path}.tmp{os.getpid()}"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(plan, f, ensure_ascii=False, indent=1)
                f.write("\n")
            os.replace(tmp, self.path)
        return True, f"{hit}: {'erledigt am ' + day if day else 'zurückgesetzt'}"


# ── pure helpers ─────────────────────────────────────────────────────────────
def to_date(s) -> date | None:
    try:
        return date.fromisoformat(str(s)[:10])
    except ValueError:
        return None


def state(a: dict, iv_days: dict, day: date, move_in: date | None = None) -> dict:
    """-> {zustand, faellig, rest_tage, stand}; zustand: ruht/nie/faellig/bald/ok.
    Without 'zuletzt' the move-in date counts as the last time it was done."""

    def out(z, f, st, **extra):
        return {"zustand": z, "faellig": f, "rest_tage": (f - day).days if f else None, "stand": st, **extra}

    iv = iv_days.get(a.get("intervall"))
    if a.get("saison") and day.month not in SEASONS.get(a["saison"], range(1, 13)):
        return out("ruht", None, f"ruht (nur {a['saison']})")
    z = to_date(a.get("zuletzt")) if a.get("zuletzt") else None
    since_move_in = z is None and move_in is not None
    if since_move_in:
        z = move_in
    if a.get("monat"):
        # yearly in a given month: date = 1st of that month; done if done within 60 days before it
        due = date(day.year, a["monat"], 1)
        if due > day + timedelta(days=SOON_DAYS):
            due_before = date(day.year - 1, a["monat"], 1)
            if z is not None and z >= due_before - timedelta(days=60):
                return out("ok", due, f"erledigt {z.strftime('%d.%m.%Y')} · wieder ab {due.strftime('%m/%Y')}")
            return out("ok", due, f"ab {due.strftime('%m/%Y')}" + ("" if z else " · noch nicht erfasst"))
        if z is not None and z >= due - timedelta(days=60):
            nxt = date(due.year + max(1, (iv or 365) // 365), a["monat"], 1)
            return out("ok", nxt, f"erledigt {z.strftime('%d.%m.%Y')} · wieder ab {nxt.strftime('%m/%Y')}")
        if due > day:
            return out("bald", due, f"ab {due.strftime('%d.%m.')} dran")
        return out("faellig", due, f"jetzt dran (Termin {due.strftime('%m/%Y')})")
    if z is None:
        return out("nie", day, "noch nicht erfasst")
    if not iv:
        return out("ok", None, f"zuletzt {z.strftime('%d.%m.%Y')}")
    f = z + timedelta(days=iv)
    rest = (f - day).days
    note = " (ab Einzug gerechnet)" if since_move_in else ""
    if rest < 0:
        if since_move_in:
            # never ticked off since moving in: due by the plan, but not proven overdue – shown calmly ("nachholen"),
            # still in the maintenance day by the same urgency (Audit04: 33 tasks "Handeln" only because of this)
            return out("faellig", f, "seit Einzug noch nicht abgehakt", seit_einzug=True)
        return out("faellig", f, f"fällig seit {-rest} Tagen{note}")
    if rest <= SOON_DAYS:
        return out("bald", f, f"fällig in {rest} Tagen{note}")
    return out("ok", f, f"fällig am {f.strftime('%d.%m.%Y')}{note}")


def priority(a: dict) -> tuple:
    """Most urgent first: fixed-month tasks (frost, tyres …), longest overdue, never recorded, soon;
    safety/electrics/heating first on a tie."""
    rank = (
        -1
        if a.get("monat") and a["zustand"] in ("faellig", "bald")
        else {"faellig": 0, "nie": 1, "bald": 2}.get(a["zustand"], 3)
    )
    return (
        rank,
        a.get("rest_tage") or 0,
        a.get("intervall_tage") or 9999,
        0 if a.get("gruppe") in SAFETY_FIRST else 1,
    )


def choose(cand: list[dict], budget: int) -> tuple[list[dict], int]:
    chosen, total = [], 0
    for a in sorted(cand, key=priority):
        m = a.get("minuten") or 15
        if total + m <= budget or not chosen:
            chosen.append(a)
            total += m
    return chosen, total


def stations(plan: dict, chosen: list[dict]) -> list[dict]:
    order = plan.get("orte") or []
    out = []
    for place in order + sorted({a.get("ort") or "Sonstiges" for a in chosen} - set(order)):
        tasks = [a for a in chosen if (a.get("ort") or "Sonstiges") == place]
        if tasks:
            out.append({"ort": place, "aufgaben": tasks, "minuten": sum(a.get("minuten") or 15 for a in tasks)})
    return out


def tools(chosen: list[dict]) -> list[str]:
    out: list[str] = []
    for a in chosen:
        for w in str(a.get("werkzeug") or "").split(","):
            w = w.strip()
            if w and w != "–" and w.lower() not in (x.lower() for x in out):
                out.append(w)
    return out
