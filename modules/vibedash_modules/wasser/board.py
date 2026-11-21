"""Board of the module "wasser": the house's water meter as answers to questions – is the house tight (no leak)?
how much today, compared with a usual day up to this time? when did water run today (per quarter hour)? which
draws of water were there (from–to, litres, a careful guess what it was)? Second level: per hour (48 h), per day
(30 days with the mean), night use 2–5 o'clock, the meter's state and its reading. Pure functions over plain data
(no I/O), so tests run on a synthetic meter:

  build(rows, live, now, tz, t, personen)

rows: [{"t": seconds, "zaehlerstand_m3", "stichtag_m3", "batterie_jahre", "rssi", "ausfall", "status"}] oldest
first (the course the collector writes: on every new reading to the minute, else every 15 min). live: the base
station's meter object ({alter_s, zaehlerstand_m3, …}, {} = nothing received yet) or None when the station does not
answer.

Use is always a difference of meter readings (never summed up from flow): reading at the end minus reading at the
start, each the last reading at or before that time. A span without data stays a gap (None).

bezuege(rd, a, b) is the draw detection, also for the weekly report: -> [{"start", "ende" (seconds), "liter" (int),
"art" (key of ARTEN), "text" (ARTEN[art]), "schuebe" (number of pushes)}] oldest first.
"""

from __future__ import annotations

from bisect import bisect_right
from datetime import datetime, timedelta

from ..fmt import number

HOUR = 3600
QUARTER = 900
STILL_S = 3600  # a full hour without a new reading = the water stood still
STALE_S = 20 * 60  # no point for 20 min (collector writes at least every 15 min): data missing
NIGHT = (2, 5)  # night use from 2 to 5 o'clock
NIGHTS_IN_ROW = 3

# ── Faustregeln der Bezugs-Erkennung (Vermutung aus Menge und Dauer – der Zähler kennt keine Geräte) ─────────────
TAKT_S = 60  # der Sammler liest jede Minute: ein Zuwachs floss in der Minute vor dem Messpunkt
SPIEL_S = 30  # Spiel für die Sekunde, in der der Sammler liest (Messpunkte schwanken um einige Sekunden)
LUECKE_S = 4 * 60  # bis 4 min ohne Zuwachs gehören noch zum selben Bezug (Hände waschen nach dem WC …)
SCHUB_S = TAKT_S + SPIEL_S  # Zuwachs in aufeinanderfolgenden Minuten = ein Schub (ein Ventil öffnet einmal)
KURZ_L = 2  # ≤ 2 l: kurz (Hände, Glas)
WC_L, WC_S = (3, 12), 3 * 60  # 3–12 l in ≤ 3 min: ein Spülkasten füllt sich
DUSCHE_L, DUSCHE_S = (25, 100), (4 * 60, 20 * 60)  # 25–100 l über 4–20 min: Dusche oder Wanne
MASCHINE_L, MASCHINE_S, MASCHINE_N = (4, 15), 75 * 60, 3  # ≥ 3 Schübe je 4–15 l in 75 min: Wasch-/Spülmaschine
# … und je Schub mindestens eine Minute mit ≥ 4 l: ein Magnetventil füllt kräftig (6–10 l/min), ein Wasserhahn in der
# Küche tröpfelt 1–3 l je Minute (geprüft an echten Tagen: ohne diese Schwelle galt Abwasch per Hand als Maschine)
MASCHINE_MIN_L = 4
GARTEN_L, GARTEN_S = 100, 20 * 60  # > 100 l über > 20 min: Garten oder ein Becken befüllen
LISTE_MAX = 15  # Zeilen der Bezugs-Liste, der Rest als „… und n weitere“
UEBLICH_MIN = 3  # ganze Tage, ab denen „üblich bis jetzt“ erscheint

ARTEN = {
    "kurz": "kurz (Hände, Glas)",
    "wc": "vermutlich WC",
    "dusche": "vermutlich Dusche oder Bad",
    "maschine": "vermutlich Wasch- oder Spülmaschine",
    "garten": "vermutlich Garten oder Befüllen",
    "bezug": "Wasserbezug",
    "unklar": "Zeit unklar (Datenlücke)",
}

TEXT = {
    "tiles_title": "Jetzt",
    "tile": "Wasser",  # the start page shows the tile "Heute" under this word
    "dicht": "Dicht?",
    "dicht_ok": "dicht",
    "dicht_leak": "Leck-Verdacht",
    "dicht_collect": "sammelt",
    "dicht_sub": "Nacht {night} · längste Pause {pause}",
    "dicht_collect_sub": "braucht eine Nacht oder 24 h Daten",
    "dicht_what": "„dicht“: in der letzten Nacht (2–5 Uhr) floss kein Wasser, oder der Zähler stand in den letzten "
    "24 Stunden mindestens eine volle Stunde still. „Leck-Verdacht“: in {k} Nächten hintereinander floss zwischen "
    "2 und 5 Uhr Wasser, oder der Zähler stand 24 Stunden lang nie eine Stunde still (z. B. ein tropfendes Klo). "
    "Kleinste Stufe des Zählers: 1 Liter – ganz leichtes Tropfen sieht er erst nach Stunden.",
    "today": "Heute",
    "today_sub": "üblich ≈ {l} l bis jetzt ({lo}–{hi} l, n = {n} Tage)",
    "today_collect": "üblich: sammelt ({n} von {k} Tagen)",
    "today_since": "seit {hm}",
    "today_what": "Verbrauch heute: Zählerstand jetzt minus Zählerstand um Mitternacht. „Üblich“ = Mittelwert "
    "(Median) der ganzen Tage der letzten 30 Tage bis zur selben Uhrzeit, Spanne = kleinster bis größter Tag. "
    "Zählerstand jetzt {stand} m³ (genau wie auf dem Zähler-Display).",
    "tile_source": "Funk-Wasserzähler über die Basis-Station im Heimnetz, Verlauf aus InfluxDB.",
    "tile_sub_nodata": "noch keine Werte",
    "warn_outage": "Zähler sendet nicht",
    "warn_status": "Status {status}",
    "warn_stale": "Daten fehlen seit {ago}",
    "since_due": "Seit Stichtag",
    "since_due_sub": "Datum sendet der Zähler nicht",
    "since_due_what": "Verbrauch seit dem Stichtag, den der Zähler selbst speichert: Zählerstand {stand} m³ minus "
    "Stichtagswert {due} m³. Das Datum des Stichtags steht nicht im Funktelegramm (meist die Jahresablesung).",
    "hint_title": "Hinweis",
    "hint_night": "Läuft nachts irgendwo Wasser? In den letzten {k} Nächten floss zwischen 2 und 5 Uhr Wasser: {l}.",
    "hint_steady": "Läuft irgendwo dauerhaft Wasser, z. B. ein Klo? Der Zähler stand in den letzten 24 Stunden "
    "nie eine volle Stunde still (längste Pause {m} min).",
    "hint_meta": "Haupthahn zu? Zähler beobachten. Erklärbar (Gäste)? Nichts tun.",
    "hint_info": "Alle Hähne zu und den Zähler ein paar Minuten beobachten: zählt er weiter, läuft irgendwo Wasser – "
    "dann Haupthahn zu und nachsehen lassen. Wenn es erklärbar ist (Gäste, Spülmaschine nachts): nichts tun.",
    "when_title": "Wann lief Wasser?",  # the switch above says today or yesterday
    "when_today": "Heute",
    "when_yday": "Gestern",
    "when_note": "Liter je Viertelstunde; Strich = keine Daten oder noch nicht.",
    "when_what": "Je Viertelstunde der Zählerstand am Ende minus der am Anfang. Fehlen in einer Viertelstunde Daten "
    "länger als 20 Minuten, bleibt sie leer (Lücke) – nie 0.",
    "draws_today": "Wasserbezüge heute",
    "draws_yday": "Wasserbezüge gestern",
    "draws_none": "Kein Wasser gelaufen.",
    "draws_more": "… und {n} weitere",
    "draws_line": "{von}–{bis} · {l} l · {art}",
    "draws_meta": "≈ {m} min",
    "draws_meta_push": "≈ {m} min · {n} Schübe",
    "draws_note": "Neueste oben. Was es war, ist eine Vermutung aus Menge und Dauer.",
    "draws_what": "Ein Bezug = Minuten mit Zuwachs am Zähler; bis 4 Minuten Pause gehören dazu. Faustregeln: "
    "bis 2 l kurz (Hände, Glas) · 3–12 l in höchstens 3 min WC · 25–100 l über 4–20 min Dusche oder Bad · "
    "mindestens 3 Schübe von je 4–15 l in 75 min Wasch- oder Spülmaschine (ein Bezug) · über 100 l länger als "
    "20 min Garten oder Befüllen · sonst Wasserbezug. Der Zähler kennt keine Geräte: zwei Dinge zugleich sehen "
    "aus wie eins.",
    "hours_title": "Verbrauch je Stunde",
    "hours_note": "Letzte 48 Stunden, aus dem Zählerstand; leer = keine Daten.",
    "days_title": "Verbrauch je Tag",
    "days_note": "Letzte 30 Tage; Linie = Mittel {mean} l (n = {n}). Heute läuft noch.",
    "days_note_nomean": "Letzte 30 Tage; das Mittel braucht ganze Tage.",
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
    "nights_title": "Nachtverbrauch 2–5 Uhr",
    "nights_note": "Je Nacht; über 0 l in {k} Nächten hintereinander gibt einen Hinweis.",
    "state_title": "Zustand",
    "state_line": "Funk {rssi} dBm · Batterie {bat} Jahre · Status {status} · letztes Telegramm vor {ago}",
    "state_offline": "Basis-Station antwortet nicht – letzter gespeicherter Wert vor {ago}.",
    "state_none": "Basis-Station und Datenbank haben noch keine Werte.",
    "state_outage": " · seit über 5 min kein Telegramm vom Zähler",
    "stand_title": "Zählerstand",
    "stand_line": "{m3} m³ und {l} l · Stichtagswert {due}",
    "stand_what": "Genau wie auf dem Display: {stand} m³; Stichtagswert {due_exact} m³.",
    "unknown": "–",
    **{f"art_{k}": v for k, v in ARTEN.items()},
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
    i = bisect_right(rd, t, key=lambda x: x[0])
    return rd[i - 1][1] if i else None


def use_l(rd: list, times: list, a: float, b: float) -> float | None:
    """Litres between a and b; None when no point lies in [a, b) or nothing is known before a."""
    i = bisect_right(times, a - 1e-9)
    if i >= len(times) or times[i] >= b:
        return None
    s0, s1 = stand_at(rd, a), stand_at(rd, b)
    if s0 is None or s1 is None or s1 < s0:
        return None
    return round((s1 - s0) * 1000)


def covered(times: list, a: float, b: float, now: float) -> bool:
    """True when the data cover [a, b]: a point at or before a, and no pause between two points (now counts as the
    last one) longer than STALE_S that touches the span."""
    i = bisect_right(times, a) - 1
    if i < 0:
        return False
    prev = times[i]
    for t in times[i + 1 :]:
        if t - prev > STALE_S:
            return False
        if t >= b:
            return True
        prev = t
    return min(b, now) - prev <= STALE_S


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


def quarters(rd, times, day, now, tz):
    """-> (labels "HH:MM", litres) per quarter hour of the local day (96; 92/100 on a clock change day); a quarter
    still to come or with missing data is None (a gap, never 0)."""
    a0, b0 = _midnight(day, tz), _midnight(day + timedelta(days=1), tz)
    labels, vals = [], []
    a = a0
    while a < b0:
        b = a + QUARTER
        labels.append(datetime.fromtimestamp(a, tz).strftime("%H:%M"))
        v = None
        if a < now and covered(times, a, min(b, now), now):
            s0, s1 = stand_at(rd, a), stand_at(rd, min(b, now))
            if s0 is not None and s1 is not None and s1 >= s0:
                v = round((s1 - s0) * 1000)
        vals.append(v)
        a = b
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


def longest_pause(rd, a, b) -> float | None:
    """Longest time (s) without a new reading in [a, b], clipped to the data; None without data. For the sub-line
    only – the leak hint uses longest_still (which needs 24 h)."""
    inside = [(t, s) for t, s in rd if a <= t <= b]
    s0 = stand_at(rd, a)
    if s0 is None:
        if not inside:
            return None
        (a, s0), inside = inside[0], inside[1:]
    last_change, last, longest = a, s0, 0.0
    for t, s in inside:
        if s > last:
            longest = max(longest, t - last_change)
            last_change, last = t, s
    return max(longest, b - last_change)


# ── draws of water (Wasserbezüge) ────────────────────────────────────────────────────────────────────────────────


def _zuwaechse(rd, a, b) -> list[tuple[float, float, int, bool]]:
    """(start, end, litres, after a data gap) of every rise of the reading with its end in (a, b]."""
    out = []
    for (t0, s0), (t1, s1) in zip(rd, rd[1:], strict=False):
        if t1 <= a or t1 > b:
            continue
        lit = round((s1 - s0) * 1000)
        if lit > 0:
            gap = t1 - t0 > STALE_S
            out.append((t0 if gap else max(t0, t1 - TAKT_S), t1, lit, gap))
    return out


def _fuellung(schub: list) -> bool:
    """A push [litres, strongest minute] that looks like a machine filling: 4–15 l, at least 4 l in one minute."""
    return MASCHINE_L[0] <= schub[0] <= MASCHINE_L[1] and schub[1] >= MASCHINE_MIN_L


def _fuellungen(g: dict) -> int:
    return sum(1 for x in g["schuebe"] if _fuellung(x))


def _maschinenartig(g: dict) -> bool:
    """At least one filling and no push beyond 15 l (a shower or a hose runs on)."""
    return not g["luecke"] and _fuellungen(g) > 0 and all(x[0] <= MASCHINE_L[1] for x in g["schuebe"])


def art(liter: int, dauer: float, luecke: bool = False) -> str:
    """Key of ARTEN for one draw by its litres and duration (s) – a guess from rules of thumb."""
    if luecke:
        return "unklar"
    if liter <= KURZ_L:
        return "kurz"
    if WC_L[0] <= liter <= WC_L[1] and dauer <= WC_S + SPIEL_S:
        return "wc"
    if DUSCHE_L[0] <= liter <= DUSCHE_L[1] and DUSCHE_S[0] - SPIEL_S <= dauer <= DUSCHE_S[1] + SPIEL_S:
        return "dusche"
    if liter > GARTEN_L and dauer > GARTEN_S:
        return "garten"
    return "bezug"


def _out(start, ende, liter, a, schuebe) -> dict:
    return {"start": start, "ende": ende, "liter": liter, "art": a, "text": ARTEN[a], "schuebe": schuebe}


def bezuege(rd: list, a: float, b: float) -> list[dict]:
    """Draws of water whose minutes with a rise end in (a, b]: minutes with a rise, pauses up to LUECKE_S belong to
    the same draw; at least MASCHINE_N fillings (pushes of 4–15 l) within MASCHINE_S are ONE draw (a machine).
    rd = readings(); "schuebe" = pushes (minutes with a rise in a row), for a machine its fillings.
    -> [{"start", "ende" (seconds), "liter" (int), "art" (key of ARTEN), "text", "schuebe"}] oldest first."""
    groups: list[dict] = []
    for start, end, lit, gap in _zuwaechse(rd, a, b):
        g = groups[-1] if groups else None
        if g and not gap and not g["luecke"] and end - g["ende"] <= TAKT_S + LUECKE_S + SPIEL_S:
            if end - g["ende"] <= SCHUB_S:
                last = g["schuebe"][-1]
                last[0], last[1] = last[0] + lit, max(last[1], lit)
            else:
                g["schuebe"].append([lit, lit])
            g["ende"], g["liter"] = end, g["liter"] + lit
        else:
            groups.append({"start": start, "ende": end, "liter": lit, "schuebe": [[lit, lit]], "luecke": gap})
    out, i = [], 0
    while i < len(groups):
        g = groups[i]
        if _maschinenartig(g):
            last, k = i, i + 1
            while k < len(groups) and groups[k]["ende"] - g["start"] <= MASCHINE_S:
                if _maschinenartig(groups[k]):
                    last = k
                elif groups[k]["luecke"] or groups[k]["liter"] > KURZ_L:
                    break  # a short draw in between belongs to the machine only when another fill follows
                k += 1
            part = groups[i : last + 1]
            n = sum(_fuellungen(x) for x in part)
            if n >= MASCHINE_N:
                out.append(_out(g["start"], part[-1]["ende"], sum(x["liter"] for x in part), "maschine", n))
                i = last + 1
                continue
        kind = art(g["liter"], g["ende"] - g["start"], g["luecke"])
        out.append(_out(g["start"], g["ende"], g["liter"], kind, len(g["schuebe"])))
        i += 1
    return out


def _draw_items(ds: list, tz, t: dict) -> list[dict]:
    """List items, newest first, at most LISTE_MAX plus one line for the rest."""
    hm = lambda x: datetime.fromtimestamp(x, tz).strftime("%H:%M")  # noqa: E731
    items = []
    for d in reversed(ds[-LISTE_MAX:] if len(ds) > LISTE_MAX else ds):
        m = max(1, round((d["ende"] - d["start"]) / 60))
        items.append(
            {
                "text": t["draws_line"].format(
                    von=hm(d["start"]), bis=hm(d["ende"]), l=_de(d["liter"]), art=t.get(f"art_{d['art']}", d["text"])
                ),
                "meta": t["draws_meta_push"].format(m=m, n=d["schuebe"])
                if d["art"] == "maschine"
                else t["draws_meta"].format(m=m),
            }
        )
    if len(ds) > LISTE_MAX:
        items.append({"text": t["draws_more"].format(n=len(ds) - LISTE_MAX)})
    return items


def usual_until(rd, now, tz, n=30) -> list[int]:
    """Litres of each whole day of the last n days from midnight up to the same clock time as now (both ends covered
    by readings), oldest first."""
    local = datetime.fromtimestamp(now, tz)
    out = []
    for k in range(n, 0, -1):
        d = local.date() - timedelta(days=k)
        a = _midnight(d, tz)
        c = datetime(d.year, d.month, d.day, local.hour, local.minute, local.second, tzinfo=tz).timestamp()
        nxt = _midnight(d + timedelta(days=1), tz)
        sa, sc = stand_at(rd, a), stand_at(rd, c)
        if sa is None or sc is None or sc < sa or stand_at(rd, nxt) is None:
            continue
        out.append(round((sc - sa) * 1000))
    return out


def _median(xs: list) -> float:
    s = sorted(xs)
    m = len(s) // 2
    return s[m] if len(s) % 2 else (s[m - 1] + s[m]) / 2


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
    rows.sort(key=lambda r: r["t"])
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
    yday = today - timedelta(days=1)
    midnight = _midnight(today, tz)
    base, since = stand_at(rd, midnight), None
    if base is None:
        first = next(((ti, s) for ti, s in rd if ti >= midnight), None)
        base, since = (first[1], first[0]) if first else (None, None)
    today_l = None if stand is None or base is None or stand < base else round((stand - base) * 1000)
    dl, dv, _ = days(rd, times, now, tz)
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

    # ── Dicht? (leak logic: nights 2–5 o'clock in a row, longest pause of the last 24 h) ──
    ns = nights(rd, times, now, tz)
    nh = night_hint(ns)
    still = longest_still(rd, times, now)
    steady = still is not None and still < STILL_S
    night_last = ns[-1][1] if ns else None
    pause = still if still is not None else longest_pause(rd, now - 24 * HOUR, now)
    sub_belege = t["dicht_sub"].format(
        night=f"{_de(night_last)} l" if night_last is not None else t["unknown"],
        pause=_ago(pause) if pause is not None else t["unknown"],
    )
    if nh or steady:
        d_val, d_state, d_sub = t["dicht_leak"], "look", sub_belege
    elif night_last == 0 or still is not None:
        d_val, d_state, d_sub = t["dicht_ok"], "ok", sub_belege
    else:
        d_val, d_state, d_sub = t["dicht_collect"], "open", t["dicht_collect_sub"]
    dicht = {
        "label": t["dicht"],
        "value": d_val,
        "sub": d_sub,
        "icon": "droplet",
        "color": "climate",
        "state": d_state,
        "info": {"what": t["dicht_what"].format(k=NIGHTS_IN_ROW), "source": t["tile_source"]},
    }
    nv = [v for _, v in ns]
    while nv and nv[0] is None:
        nv.pop(0)  # nights before the first data are no gaps, just not there yet
    if sum(v is not None for v in nv) >= 2:
        dicht["spark"] = nv

    # ── Heute (with the usual day up to this time) ──
    usual = usual_until(rd, now, tz)
    if len(usual) >= UEBLICH_MIN:
        lo, hi = min(usual), max(usual)
        sub = t["today_sub"].format(l=_de(_median(usual)), lo=_de(lo), hi=_de(hi), n=len(usual))
    else:
        sub = t["today_collect"].format(n=len(usual), k=UEBLICH_MIN)
    if stand is None:
        sub = t["tile_sub_nodata"]
    if since is not None:
        sub = f"{t['today_since'].format(hm=datetime.fromtimestamp(since, tz).strftime('%H:%M'))} · {sub}"
    if warn:
        sub = f"{warn} · {sub}"
    if d_state == "look":
        sub = f"{t['dicht_leak']} · {sub}"
    heute = {
        "label": t["today"],
        "home": t["tile"],
        "value": _de(today_l),
        "unit": "l",
        "sub": sub,
        "icon": "droplet",
        "color": "climate",
        "state": "act"
        if (ausfall or (warn and warn != t["tile_sub_nodata"]))
        else d_state
        if d_state == "look"
        else "ok",
        "info": {"what": t["today_what"].format(stand=_de(stand, 3)), "source": t["tile_source"]},
    }
    hl, hv = hours(rd, times, now, tz)
    h_today = hv[-(datetime.fromtimestamp(now, tz).hour + 1) :]
    if any(v is not None for v in h_today):
        heute["spark"] = h_today
        if len(h_today) > 1:  # the enlarged tile shows the hours of today on a time axis
            heute["sparkFrom"] = int(midnight * 1000)
            heute["sparkTo"] = int((midnight + (len(h_today) - 1) * HOUR) * 1000)

    due = number(val("stichtag_m3"))
    stichtag = {
        "label": t["since_due"],
        "value": _de(stand - due, 1) if stand is not None and due is not None and stand >= due else "–",
        "unit": "m³",
        "sub": t["since_due_sub"],
        "icon": "droplet",
        "color": "climate",
        "info": {"what": t["since_due_what"].format(stand=_de(stand, 3), due=_de(due, 3)), "source": t["tile_source"]},
    }

    # one row: the tile "Heute" also stands on the start page (slot "home", tile key "home" = its word there)
    sections: list[dict] = [
        {"type": "tiles", "title": t["tiles_title"], "slot": "home", "tiles": [dicht, heute, stichtag]}
    ]
    items = []
    if nh:
        items.append(
            {
                "text": t["hint_night"].format(k=NIGHTS_IN_ROW, l=", ".join(f"{_de(v)} l" for v in nh)),
                "meta": t["hint_meta"],
                "info": t["hint_info"],
                "state": "look",
            }
        )
    if steady:
        items.append(
            {
                "text": t["hint_steady"].format(m=round(still / 60)),
                "meta": t["hint_meta"],
                "info": t["hint_info"],
                "state": "look",
            }
        )
    if items:
        sections.append({"type": "list", "title": t["hint_title"], "items": items})

    # ── Wann lief Wasser? (quarter hours, switch today / yesterday) ──
    ql, qv = quarters(rd, times, today, now, tz)
    yl, yv = quarters(rd, times, yday, now, tz)
    # the running quarter (fixed 15-min steps from midnight, also on a clock change day): lighter, "bis jetzt"
    qp = min(len(ql) - 1, max(0, int((now - midnight) // QUARTER)))
    sections.append(
        {
            "type": "bars",
            "title": t["when_title"],
            "unit": "l",
            "labels": ql,
            "values": qv,
            "partial": qp,
            "color": "climate",
            "group": "tag",
            "ranges": [
                {"id": "heute", "label": t["when_today"], "labels": ql, "values": qv, "partial": qp},
                {"id": "gestern", "label": t["when_yday"], "labels": yl, "values": yv},
            ],
            "note": t["when_note"],
            "info": {"what": t["when_what"], "source": t["tile_source"]},
        }
    )

    # ── Wasserbezüge heute / gestern ──
    def draws(title, a, b, more):
        ds = bezuege(rd, a, b)
        sec = {
            "type": "list",
            "title": title,
            "items": _draw_items(ds, tz, t) if ds else [{"text": t["draws_none"] if rd else t["tile_sub_nodata"]}],
            "note": t["draws_note"],
            "info": {"what": t["draws_what"], "source": t["tile_source"]},
        }
        if more:
            sec["more"] = True
        return sec

    sections.append(draws(t["draws_today"], midnight, now, False))

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

    # ── second level ("Details") ──
    sections.append(draws(t["draws_yday"], _midnight(yday, tz), midnight, True))
    sections.append(
        {
            "type": "bars",
            "title": t["hours_title"],
            "unit": "l",
            "labels": hl,
            "values": hv,
            "partial": len(hv) - 1,
            "color": "climate",
            "note": t["hours_note"],
            "more": True,
        }
    )
    days_sec = {
        "type": "bars",
        "title": t["days_title"],
        "unit": "l",
        "labels": dl,
        "values": dv,
        "partial": len(dv) - 1,
        "color": "climate",
        "note": t["days_note"].format(mean=_de(mean), n=len(full)) if mean is not None else t["days_note_nomean"],
        "more": True,
    }
    if mean is not None:
        days_sec["mean"] = round(mean, 1)
    sections.append(days_sec)
    sections.append(
        {
            "type": "bars",
            "title": t["nights_title"],
            "unit": "l",
            "labels": [f"{d.day}.{d.month}." for d, _ in ns],
            "values": [v for _, v in ns],
            "color": "climate",
            "note": t["nights_note"].format(k=NIGHTS_IN_ROW),
            "more": True,
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
    sections.append({"type": "text", "title": t["state_title"], "text": text, "more": True})
    if stand is not None:
        liters = round(stand * 1000)
        sections.append(
            {
                "type": "text",
                "title": t["stand_title"],
                "text": t["stand_line"].format(
                    m3=_de(liters // 1000),
                    l=_de(liters % 1000),
                    due=f"{_de(due, 1)} m³" if due is not None else t["unknown"],
                ),
                "info": {
                    "what": t["stand_what"].format(stand=_de(stand, 3), due_exact=_de(due, 3)),
                    "source": t["tile_source"],
                },
                "more": True,
            }
        )
    return {"updated": int((times[-1] if times else now) * 1000), "sections": sections}
