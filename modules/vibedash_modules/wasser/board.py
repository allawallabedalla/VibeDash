"""Board of the module "wasser": the house's water meter – use today (a tile for the start page too), per hour (48 h),
per day (30 days with the mean), since the meter's due date, night use 2–5 o'clock with a leak hint, and a small
state line. Pure functions over plain data (no I/O), so tests run on a synthetic meter:

  build(rows, live, now, tz, t)

rows: [{"t": seconds, "zaehlerstand_m3", "stichtag_m3", "batterie_jahre", "rssi", "ausfall", "status"}] oldest
first (the course the collector writes: on every new reading, else every 15 min). live: the base station's meter
object ({alter_s, zaehlerstand_m3, …}, {} = nothing received yet) or None when the station does not answer.

Use is always a difference of meter readings (never summed up from flow): reading at the end minus reading at the
start, each the last reading at or before that time. A span without any point stays a gap (None).
"""

from __future__ import annotations

from datetime import datetime, timedelta

from ..fmt import number

HOUR = 3600
STILL_S = 3600  # a full hour without a new reading = the water stood still
STALE_S = 20 * 60  # no point for 20 min (collector writes at least every 15 min): data missing
NIGHT = (2, 5)  # night use from 2 to 5 o'clock
NIGHTS_IN_ROW = 3

TEXT = {
    "tile": "Wasser",
    "tile_sub": "gestern {yday} l",
    "tile_sub_nodata": "noch keine Werte",
    "tile_since": "seit {hm}",
    "tile_what": "Verbrauch heute: Zählerstand jetzt minus Zählerstand um Mitternacht. Zählerstand jetzt {stand} m³ "
    "(genau wie auf dem Zähler-Display).",
    "tile_source": "Funk-Wasserzähler über die Basis-Station im Heimnetz, Verlauf aus InfluxDB.",
    "warn_outage": "Zähler sendet nicht",
    "warn_status": "Status {status}",
    "warn_stale": "Daten fehlen seit {ago}",
    "tiles_title": "Zähler",
    "since_due": "Seit Stichtag",
    "since_due_sub": "seit dem letzten Stichtag (Datum sendet der Zähler nicht)",
    "since_due_what": "Verbrauch seit dem Stichtag, den der Zähler selbst speichert: Zählerstand {stand} m³ minus "
    "Stichtagswert {due} m³. Das Datum des Stichtags steht nicht im Funktelegramm (meist die Jahresablesung).",
    "mean": "Ø Tag",
    "mean_sub": "30 Tage · n {n}",
    "mean_what": "Mittel der ganzen Tage der letzten 30 Tage mit Werten; n = Zahl der Tage.",
    "leak": "Leck",
    "leak_none": "kein Hinweis",
    "leak_hint": "Hinweis",
    "leak_collect": "sammelt",
    "leak_collect_sub": "braucht 24 h Daten",
    "leak_ok_sub": "Nächte ruhig",
    "leak_night_sub": "{n} Nächte nicht ruhig",
    "leak_steady_sub": "24 h ohne Pause",
    "leak_what": "Hinweis, wenn in {k} Nächten hintereinander zwischen 2 und 5 Uhr Wasser floss, oder wenn der "
    "Zähler 24 Stunden lang nie eine volle Stunde stillstand (Dauerverbrauch, z. B. ein tropfendes Klo). Kleinste "
    "Stufe des Zählers: 1 Liter – ein ganz leichtes Tropfen sieht er erst nach Stunden.",
    "hint_title": "Hinweis",
    "hint_night": "Läuft nachts irgendwo Wasser? In den letzten {k} Nächten floss zwischen 2 und 5 Uhr Wasser: {l}.",
    "hint_steady": "Läuft irgendwo dauerhaft Wasser, z. B. ein Klo? Der Zähler stand in den letzten 24 Stunden "
    "nie eine volle Stunde still (längste Pause {m} min).",
    "hint_meta": "Wenn das erklärbar ist (Gäste, Spülmaschine nachts): nichts tun.",
    "hours_title": "Verbrauch je Stunde",
    "hours_note": "Letzte 48 Stunden, aus dem Zählerstand; leer = keine Daten.",
    "days_title": "Verbrauch je Tag",
    "cmp_title": "Je Person und Tag im Vergleich",
    "cmp_labels": ["Wir je Person", "Deutschland", "Welt (grob)", "Grundbedarf"],  # the chart adds the value
    "cmp_note": "Linie = wir je Person und ganzem Tag ({p} Personen, Garten eingerechnet), im Mittel ≈ {v} l (n {n}). "
    "Gestrichelt: Deutschland (BDEW 2023), Welt (grobe Angabe, kein amtlicher Weltwert), Grundbedarf (WHO).",
    "cmp_collect": "Unsere Linie erscheint mit den ersten ganzen Tagen (bisher {n}). Gestrichelt: Deutschland 121 l "
    "(BDEW 2023), Welt ≈ 95 l (grobe Angabe), Grundbedarf ≈ 50 l (WHO).",
    "cmp_what": "Wasser je Person und Tag: unser Mittel der ganzen Tage geteilt durch die Personen im Haus, daneben "
    "Vergleichswerte. Ein amtlicher Welt-Durchschnitt für Haushaltswasser existiert nicht; „Welt (Mitte)“ ist eine "
    "grobe Angabe, darum mit ≈.",
    "cmp_source": "Zähler (ganze Tage), Personen aus der Modul-Einstellung; BDEW 2023, WHO, OpenLearn/UN-Water.",
    "days_note": "Letzte 30 Tage; Linie = Mittel {mean} l (n {n}). Heute läuft noch.",
    "days_note_nomean": "Letzte 30 Tage; das Mittel braucht ganze Tage.",
    "nights_title": "Nachtverbrauch 2–5 Uhr",
    "nights_note": "Je Nacht; über 0 l in {k} Nächten hintereinander gibt einen Hinweis.",
    "state_title": "Zustand",
    "state_line": "Funk {rssi} dBm · Batterie {bat} Jahre · Status {status} · letztes Telegramm vor {ago}",
    "state_offline": "Basis-Station antwortet nicht – letzter gespeicherter Wert vor {ago}.",
    "state_none": "Basis-Station und Datenbank haben noch keine Werte.",
    "state_outage": " · seit über 5 min kein Telegramm vom Zähler",
    "unknown": "–",
}


def _de(x, nd=0) -> str:
    if x is None:
        return "–"
    v = 0.0 if round(x, nd) == 0 else x
    return f"{v:,.{nd}f}".replace(",", " ").replace(".", ",").replace(" ", ".").replace("-", "−")


def _ago(s) -> str:
    s = max(0, int(s))
    if s < 90:
        return f"{s} s"
    if s < 5400:
        return f"{round(s / 60)} min"
    if s < 172800:
        return f"{round(s / 3600)} h"
    return f"{round(s / 86400)} Tagen"


def readings(rows: list[dict]) -> list[tuple[float, float]]:
    """(time, reading m³) of the rows that have one, oldest first."""
    out = []
    for r in rows:
        v = number(r.get("zaehlerstand_m3"))
        if v is not None and not isinstance(r.get("zaehlerstand_m3"), bool):
            out.append((float(r["t"]), v))
    return out


def stand_at(rd: list, t: float) -> float | None:
    """Last reading at or before t."""
    v = None
    for ti, s in rd:
        if ti > t:
            break
        v = s
    return v


def use_l(rd: list, times: list, a: float, b: float) -> float | None:
    """Litres between a and b; None when no point lies in [a, b) or nothing is known before a."""
    if not any(a <= ti < b for ti in times):
        return None
    s0, s1 = stand_at(rd, a), stand_at(rd, b)
    if s0 is None or s1 is None or s1 < s0:
        return None
    return round((s1 - s0) * 1000)


def _midnight(d, tz) -> float:
    return datetime(d.year, d.month, d.day, tzinfo=tz).timestamp()


def hours(rd, times, now, tz, n=48):
    """-> (labels, litres) of the last n hours, the running one last."""
    start = datetime.fromtimestamp(now, tz).replace(minute=0, second=0, microsecond=0).timestamp()
    labels, vals = [], []
    for k in range(n - 1, -1, -1):
        a = start - k * HOUR
        labels.append(datetime.fromtimestamp(a, tz).strftime("%H"))
        vals.append(use_l(rd, times, a, min(a + HOUR, now)))
    return labels, vals


def days(rd, times, now, tz, n=30):
    """-> (labels, litres, dates) of the last n days, today last."""
    today = datetime.fromtimestamp(now, tz).date()
    labels, vals, dates = [], [], []
    for k in range(n - 1, -1, -1):
        d = today - timedelta(days=k)
        a, b = _midnight(d, tz), _midnight(d + timedelta(days=1), tz)
        labels.append(f"{d.day}.{d.month}.")
        vals.append(use_l(rd, times, a, min(b, now)))
        dates.append(d)
    return labels, vals, dates


def nights(rd, times, now, tz, n=14):
    """-> [(date, litres 2–5 o'clock)] of the last n finished nights, newest last."""
    today = datetime.fromtimestamp(now, tz).date()
    out = []
    for k in range(n, -1, -1):
        d = today - timedelta(days=k)
        a = datetime(d.year, d.month, d.day, NIGHT[0], tzinfo=tz).timestamp()
        b = datetime(d.year, d.month, d.day, NIGHT[1], tzinfo=tz).timestamp()
        if b <= now:
            out.append((d, use_l(rd, times, a, b)))
    return out[-n:]


def night_hint(ns: list) -> list | None:
    """The last NIGHTS_IN_ROW nights (litres) when all of them had use, else None."""
    last = ns[-NIGHTS_IN_ROW:]
    if len(last) < NIGHTS_IN_ROW or any(v is None or v <= 0 for _, v in last):
        return None
    if any((last[i + 1][0] - last[i][0]).days != 1 for i in range(len(last) - 1)):
        return None
    return [v for _, v in last]


def longest_still(rd, times, now) -> float | None:
    """Longest pause (s) between two new readings in the last 24 h, the ends included; None when 24 h of data are not
    there yet. A hole in the data of a full hour counts as a possible pause (no hint from missing data)."""
    a = now - 24 * HOUR
    if stand_at(rd, a) is None:
        return None
    inside = sorted(t for t in times if a <= t <= now)
    for x, y in zip([a, *inside], [*inside, now], strict=False):
        if y - x >= STILL_S:
            return float(y - x)
    last_change, last, longest = a, stand_at(rd, a), 0.0
    for t, s in rd:
        if t < a or t > now:
            continue
        if s > last:
            longest = max(longest, t - last_change)
            last_change, last = t, s
    return max(longest, now - last_change)


# Reference values per person and day (litres), with their source in the note (Audit05-Nutzerwunsch 20.11.2026)
VERGLEICH_L = (121, 95, 50)  # Germany (BDEW 2023) · world, rough middle · basic need (WHO)
CMP_MIN_DAYS = 3


def whole_days(rd, now, tz, n=30) -> list:
    """[(noon ms, litres | None)] of the last n finished days; litres only when start AND end are covered by readings
    (a started day is no day – it stays a gap)."""
    today = datetime.fromtimestamp(now, tz).date()
    out = []
    for k in range(n, 0, -1):
        d = today - timedelta(days=k)
        a, b = _midnight(d, tz), _midnight(d + timedelta(days=1), tz)
        sa, sb = stand_at(rd, a), stand_at(rd, b)
        out.append(
            (int((a + b) / 2 * 1000), (sb - sa) * 1000 if sa is not None and sb is not None and sb >= sa else None)
        )
    return out


def build(rows: list, live: dict | None, now: float, tz, t: dict, personen: int | None = None) -> dict:
    rows = [r for r in rows or [] if isinstance(r, dict) and isinstance(r.get("t"), (int, float))]
    rd = readings(rows)
    times = [float(r["t"]) for r in rows]
    last = rows[-1] if rows else {}
    z = live if isinstance(live, dict) else {}

    def val(k):
        v = z.get(k)
        return v if v is not None else last.get(k)

    stand = number(z.get("zaehlerstand_m3"))
    if stand is None and rd:
        stand = rd[-1][1]
    today = datetime.fromtimestamp(now, tz).date()
    midnight = _midnight(today, tz)
    base, since = stand_at(rd, midnight), None
    if base is None:
        first = next(((ti, s) for ti, s in rd if ti >= midnight), None)
        base, since = (first[1], first[0]) if first else (None, None)
    today_l = None if stand is None or base is None or stand < base else round((stand - base) * 1000)
    dl, dv, _ = days(rd, times, now, tz)
    yday_l = dv[-2]
    full = [v for v in dv[:-1] if v is not None]
    mean = sum(full) / len(full) if full else None

    # warnings of the meter itself
    ausfall, status = val("ausfall") is True, val("status")
    warn = None
    if ausfall:
        warn = t["warn_outage"]
    elif isinstance(status, str) and status and status != "OK":
        warn = t["warn_status"].format(status=status[:20])
    elif live is None and times and now - times[-1] > STALE_S:
        warn = t["warn_stale"].format(ago=_ago(now - times[-1]))
    elif live is None and not times:
        warn = t["tile_sub_nodata"]

    hl, hv = hours(rd, times, now, tz)
    # decimals only where they say something (Nutzer 20.11.2026): the exact meter reading lives in the ⓘ
    sub = t["tile_sub"].format(yday=_de(yday_l)) if stand is not None else t["tile_sub_nodata"]
    if since is not None:
        sub = f"{t['tile_since'].format(hm=datetime.fromtimestamp(since, tz).strftime('%H:%M'))} · {sub}"
    if warn:
        sub = f"{warn} · {sub}"
    home = {
        "label": t["tile"],
        "value": _de(today_l),
        "unit": "l",
        "sub": sub,
        "icon": "droplet",
        "color": "climate",
        "state": "act" if (ausfall or (warn and warn != t["tile_sub_nodata"])) else "ok",
        "info": {"what": t["tile_what"].format(stand=_de(stand, 3)), "source": t["tile_source"]},
    }
    if any(v is not None for v in hv[-24:]):
        home["spark"] = hv[-24:]

    # leak
    ns = nights(rd, times, now, tz)
    nh = night_hint(ns)
    still = longest_still(rd, times, now)
    steady = still is not None and still < STILL_S
    if nh or steady:
        leak_val, leak_state = t["leak_hint"], "look"
        leak_sub = t["leak_night_sub"].format(n=len(nh)) if nh else t["leak_steady_sub"]
    elif still is None and not any(v is not None for _, v in ns):
        leak_val, leak_state, leak_sub = t["leak_collect"], "open", t["leak_collect_sub"]
    else:
        leak_val, leak_state, leak_sub = t["leak_none"], "ok", t["leak_ok_sub"]

    due = number(val("stichtag_m3"))
    tiles = [
        {
            "label": t["since_due"],
            "value": _de(stand - due, 1) if stand is not None and due is not None and stand >= due else "–",
            "unit": "m³",
            "sub": t["since_due_sub"],
            "icon": "droplet",
            "color": "climate",
            "info": {
                "what": t["since_due_what"].format(stand=_de(stand, 3), due=_de(due, 3)),
                "source": t["tile_source"],
            },
        },
        {
            "label": t["mean"],
            "value": _de(mean),
            "unit": "l",
            "sub": t["mean_sub"].format(n=len(full)),
            "icon": "overview",
            "color": "climate",
            "info": {"what": t["mean_what"], "source": t["tile_source"]},
        },
        {
            "label": t["leak"],
            "value": leak_val,
            "sub": leak_sub,
            "icon": "info",
            "color": "muted",
            "state": leak_state,
            "info": {"what": t["leak_what"].format(k=NIGHTS_IN_ROW), "source": t["tile_source"]},
        },
    ]

    # one row: the first tile also stands on the start page (slot "home")
    sections: list[dict] = [{"type": "tiles", "title": t["tiles_title"], "slot": "home", "tiles": [home, *tiles]}]
    items = []
    if nh:
        items.append(
            {
                "text": t["hint_night"].format(k=NIGHTS_IN_ROW, l=", ".join(f"{_de(v)} l" for v in nh)),
                "meta": t["hint_meta"],
                "state": "look",
            }
        )
    if steady:
        items.append({"text": t["hint_steady"].format(m=round(still / 60)), "meta": t["hint_meta"], "state": "look"})
    if items:
        sections.append({"type": "list", "title": t["hint_title"], "items": items})
    sections.append(
        {
            "type": "bars",
            "title": t["hours_title"],
            "unit": "l",
            "labels": hl,
            "values": hv,
            "color": "climate",
            "note": t["hours_note"],
        }
    )
    days_sec = {
        "type": "bars",
        "title": t["days_title"],
        "unit": "l",
        "labels": dl,
        "values": dv,
        "color": "climate",
        "note": t["days_note"].format(mean=_de(mean), n=len(full)) if mean is not None else t["days_note_nomean"],
    }
    if mean is not None:
        days_sec["mean"] = round(mean, 1)
    sections.append(days_sec)
    if personen:
        # line per whole day, the reference values as flat dashed lines (Nutzer 20.11.2026)
        wd = whole_days(rd, now, tz)
        per = [round(v / personen) if v is not None else None for _, v in wd]
        got = [v for v in per if v is not None]
        lab = t["cmp_labels"]
        sections.append(
            {
                "type": "series",
                "title": t["cmp_title"],
                "unit": "l",
                "x": [x for x, _ in wd],
                "lines": [
                    {"label": lab[0], "values": per, "color": "climate", "dashed": False},
                    *(
                        {"label": lab[i + 1], "values": [ref] * len(wd), "color": "muted", "dashed": True}
                        for i, ref in enumerate(VERGLEICH_L)
                    ),
                ],
                "note": t["cmp_note"].format(v=_de(sum(got) / len(got)), p=personen, n=len(got))
                if len(got) >= CMP_MIN_DAYS
                else t["cmp_collect"].format(n=len(got)),
                "info": {"what": t["cmp_what"], "source": t["cmp_source"]},
            }
        )
    sections.append(
        {
            "type": "bars",
            "title": t["nights_title"],
            "unit": "l",
            "labels": [f"{d.day}.{d.month}." for d, _ in ns],
            "values": [v for _, v in ns],
            "color": "climate",
            "note": t["nights_note"].format(k=NIGHTS_IN_ROW),
        }
    )

    # state line
    if live is None:
        text = t["state_offline"].format(ago=_ago(now - times[-1])) if times else t["state_none"]
    else:
        alter = number(z.get("alter_s"))
        text = t["state_line"].format(
            rssi=_de(number(val("rssi"))),
            bat=_de(number(val("batterie_jahre")), 1),
            status=str(status or t["unknown"])[:20],
            ago=_ago(alter) if alter is not None else t["unknown"],
        )
        if ausfall:
            text += t["state_outage"]
    sections.append({"type": "text", "title": t["state_title"], "text": text})
    return {"updated": int((times[-1] if times else now) * 1000), "sections": sections}
