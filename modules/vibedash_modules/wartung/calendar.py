"""Maintenance plan as a calendar subscription (iCalendar) – e.g. for the iPhone.

One all-day event per Saturday (next `weeks` Saturdays): everything due by that Saturday as a walk by station –
the same choice as the maintenance day (no professional jobs, interval >= 4 weeks, most urgent first, time
budget). What does not fit moves to the next Saturday. For later Saturdays the plan assumes you do everything on
the Saturday before (the interval then runs from that Saturday). Professional jobs come as their own event
"Termin ausmachen" on the Saturday before the "book by" date. One-off open items with "termin"
(YYYY-MM-DDTHH:MM, local time) and "dauer_min" come as an event with a time and a reminder 15 min before.

Read-only; ticking off stays in VibeDash. Served by the module service at /feed/wartung/kalender.ics.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

from .plan import SAFETY_FIRST, Plan, state, to_date

WEEKS = 8


def next_saturday(day: date) -> date:
    return day + timedelta(days=(5 - day.weekday()) % 7)


def _prio(a: dict) -> tuple:
    rank = -1 if a.get("monat") else {"faellig": 0, "nie": 1, "bald": 2}.get(a["zustand"], 3)
    return (
        rank,
        a.get("rest_tage") or 0,
        a.get("intervall_tage") or 9999,
        0 if a.get("gruppe") in SAFETY_FIRST else 1,
    )


def saturdays(p: Plan, plan: dict | None = None, now: float | None = None, weeks: int = WEEKS) -> list[dict]:
    """-> one entry per Saturday: {tag, stationen, minuten, anzahl, werkzeug}."""
    plan = plan if plan is not None else p.load()
    budget = plan.get("wartungstag_minuten") or 240
    iv = plan.get("intervalle_tage") or {}
    move_in = to_date(plan["erstbezug"]) if plan.get("erstbezug") else None
    snooze = {k: to_date(v) for k, v in p._snoozed().items()}
    tasks = [
        {**a, "gruppe": g.get("id")}
        for g in plan.get("gruppen") or []
        for a in g.get("aufgaben") or []
        if not a.get("service") and a.get("ort") != "Service" and (iv.get(a.get("intervall")) or 0) >= 28
    ]
    last = {a["id"]: a.get("zuletzt") for a in tasks}  # carried forward in the simulation
    s = next_saturday(p.today(now))
    out = []
    for _ in range(weeks):
        cand = []
        for a in tasks:
            sp = snooze.get(a["id"])
            if sp and sp > s:
                continue
            z = state({**a, "zuletzt": last[a["id"]]}, iv, s, move_in)
            if z["zustand"] == "nie" or (z["zustand"] in ("faellig", "bald") and z["faellig"] and z["faellig"] <= s):
                cand.append({**a, **z, "intervall_tage": iv.get(a.get("intervall"))})
        chosen, total = [], 0
        for a in sorted(cand, key=_prio):
            m = a.get("minuten") or 15
            if total + m <= budget or not chosen:
                chosen.append(a)
                total += m
        for a in chosen:
            last[a["id"]] = s.isoformat()
        order = plan.get("orte") or []
        stations = []
        for place in order + sorted({a.get("ort") or "Sonstiges" for a in chosen} - set(order)):
            here = [a for a in chosen if (a.get("ort") or "Sonstiges") == place]
            if here:
                stations.append({"ort": place, "aufgaben": here, "minuten": sum(a.get("minuten") or 15 for a in here)})
        tools: list[str] = []
        for a in chosen:
            for w in str(a.get("werkzeug") or "").split(","):
                w = w.strip()
                if w and w != "–" and w.lower() not in (x.lower() for x in tools):
                    tools.append(w)
        out.append({"tag": s, "stationen": stations, "minuten": total, "anzahl": len(chosen), "werkzeug": tools})
        s += timedelta(days=7)
    return out


def service_events(p: Plan, plan: dict | None = None, now: float | None = None, weeks: int = WEEKS) -> list[dict]:
    """Professional jobs: arrange the appointment on the Saturday before "book by" (next Saturday if due)."""
    first = next_saturday(p.today(now))
    last = first + timedelta(days=7 * (weeks - 1))
    out = []
    for a in p.service(plan, now):
        if a.get("zustand") in ("ruht", "verschoben"):
            continue
        b = a.get("buchen_bis")
        if a.get("jetzt_buchen") or b is None or b <= first:
            day = first
        else:
            day = b - timedelta(days=(b.weekday() - 5) % 7)  # Saturday on or before "book by"
        if day <= last:
            out.append({"tag": day, "aufgabe": a})
    return out


# ── iCalendar ────────────────────────────────────────────────────────────────
def _esc(t) -> str:
    return str(t).replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def _fold(line: str) -> str:
    """RFC 5545: lines over 75 octets are folded (continuation starts with a space), never inside a UTF-8 char."""
    if len(line.encode("utf-8")) <= 75:
        return line
    parts, cur, limit = [], b"", 75
    for ch in line:
        c = ch.encode("utf-8")
        if len(cur) + len(c) > limit:
            parts.append(cur.decode("utf-8"))
            cur, limit = b"", 74
        cur += c
    parts.append(cur.decode("utf-8"))
    return "\r\n ".join(parts)


def _allday(uid: str, domain: str, day: date, title: str, text: str, stamp: str) -> list[str]:
    return [
        "BEGIN:VEVENT",
        f"UID:{uid}@{domain}",
        f"DTSTAMP:{stamp}",
        f"DTSTART;VALUE=DATE:{day.strftime('%Y%m%d')}",
        f"DTEND;VALUE=DATE:{(day + timedelta(days=1)).strftime('%Y%m%d')}",
        f"SUMMARY:{_esc(title)}",
        f"DESCRIPTION:{_esc(text)}",
        "TRANSP:TRANSPARENT",
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        f"DESCRIPTION:{_esc(title)}",
        "TRIGGER;RELATED=START:PT9H",
        "END:VALARM",
        "END:VEVENT",
    ]


def _timed(uid, domain, start: datetime, minutes, title, text, stamp, tz) -> list[str]:
    """Event with a time (local -> UTC) and a reminder 15 min before."""
    a = start.replace(tzinfo=tz).astimezone(UTC)
    e = a + timedelta(minutes=minutes or 30)
    return [
        "BEGIN:VEVENT",
        f"UID:{uid}@{domain}",
        f"DTSTAMP:{stamp}",
        f"DTSTART:{a.strftime('%Y%m%dT%H%M%SZ')}",
        f"DTEND:{e.strftime('%Y%m%dT%H%M%SZ')}",
        f"SUMMARY:{_esc(title)}",
        f"DESCRIPTION:{_esc(text)}",
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        f"DESCRIPTION:{_esc(title)}",
        "TRIGGER:-PT15M",
        "END:VALARM",
        "END:VEVENT",
    ]


def duration(m: int) -> str:
    return f"{m} min" if m < 60 else f"{m // 60} h {m % 60:02d} min" if m % 60 else f"{m // 60} h"


def ics(
    p: Plan,
    plan: dict | None = None,
    now: float | None = None,
    weeks: int = WEEKS,
    domain: str = "vibedash.wartung",
    name: str = "Hauswartung",
) -> str:
    plan = plan if plan is not None else p.load()
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    z = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//VibeDash//Hauswartung//DE",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        f"X-WR-CALNAME:{_esc(name)}",
        f"X-WR-TIMEZONE:{p.tz.key}",
        "X-WR-CALDESC:Fällige Wartung je Samstag (aus dem Wartungsplan; abhaken in VibeDash)",
        "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
        "X-PUBLISHED-TTL:PT6H",
    ]
    for s in saturdays(p, plan, now, weeks):
        if not s["anzahl"]:
            continue
        title = f"Wartung · {s['anzahl']} {'Aufgabe' if s['anzahl'] == 1 else 'Aufgaben'} · ≈ {duration(s['minuten'])}"
        lines = []
        for st in s["stationen"]:
            lines.append(f"{st['ort']} ({duration(st['minuten'])})")
            lines += [f"• {a['text']}" for a in st["aufgaben"]]
            lines.append("")
        if s["werkzeug"]:
            lines.append("Werkzeug: " + ", ".join(s["werkzeug"]))
        lines.append("Abhaken in VibeDash → Wartung. Stand " + p.today(now).strftime("%d.%m.%Y") + ".")
        z += _allday(f"tag-{s['tag'].isoformat()}", domain, s["tag"], title, "\n".join(lines), stamp)
    for t in service_events(p, plan, now, weeks):
        a = t["aufgabe"]
        text = a.get("service_text") or ""
        if a.get("werkzeug"):
            text += f"\nWer: {a['werkzeug']}"
        z += _allday(f"service-{a.get('id')}", domain, t["tag"], f"Termin ausmachen: {a.get('text')}", text, stamp)
    for o in p.open_items(plan):
        if not o.get("termin"):
            continue
        try:
            start = datetime.fromisoformat(o["termin"])
        except ValueError:
            continue
        z += _timed(
            f"offen-{o['id']}",
            domain,
            start,
            o.get("dauer_min"),
            o.get("text", ""),
            (o.get("hinweis") or "") + "\nAbhaken in VibeDash → Wartung → Offene Punkte.",
            stamp,
            p.tz,
        )
    z.append("END:VCALENDAR")
    return "\r\n".join(_fold(x) for x in z) + "\r\n"
