"""Board of the module "druck": the 3D printer now (state, progress, time left, nozzle, bed, file), temperatures
and print time back in time, the last jobs and links to the house's printer tools. Pure function over plain data
(no I/O), so tests run on a synthetic printer:

  build(live, history, links, now_ms, tz, t)

live: the newest reading, history: older readings oldest first (lines as in source.py), links: [{label, url}].
"""

from __future__ import annotations

from datetime import datetime, timedelta

GAP_MS = 300_000  # readings further apart are a gap (printer off, service stopped)
WORKING = {"PRINTING", "PAUSED"}

# state -> (word, tile state)
STATES = {
    "PRINTING": ("Druckt", None),
    "PAUSED": ("Pausiert", "look"),
    "ATTENTION": ("Braucht Hilfe", "act"),
    "ERROR": ("Fehler", "act"),
    "FINISHED": ("Fertig", "look"),
    "STOPPED": ("Abgebrochen", None),
    "BUSY": ("Beschäftigt", None),
    "IDLE": ("Bereit", "ok"),
    "READY": ("Bereit", "ok"),
    "OFFLINE": ("Aus", "open"),
}

TEXT = {
    "now_title": "Drucker",
    "state": "Zustand",
    "state_what": "Was der Drucker selbst meldet. „Fertig“: Teil abnehmen, dann ist er wieder bereit. "
    "„Aus“: keine Antwort (ausgeschaltet oder WLAN weg).",
    "state_source": "PrusaLink des Druckers, einmal je Minute und beim Öffnen der Seite.",
    "no_job": "kein Druckjob",
    "offline_sub": "keine Antwort · zuletzt da {when}",
    "offline_never": "keine Antwort",
    "unknown": "Unbekannt",
    "progress": "Fortschritt",
    "progress_sub": "seit {dur}",
    "done_sub": "fertig {when}",
    "left": "Restzeit",
    "left_sub": "fertig ≈ {clock}",
    "left_what": "Schätzung des Druckers aus dem G-Code; sie wird während des Drucks genauer.",
    "left_source": "PrusaLink, time_remaining.",
    "temp_title": "Temperatur",
    "nozzle": "Düse",
    "bed": "Bett",
    "target": "Ziel {v} °C",
    "heat_off": "Heizung aus",
    "temp_what": "Gemessene Temperatur; die Linie zeigt die letzten 2 Stunden.",
    "temp_source": "PrusaLink, temp_nozzle / temp_bed.",
    "series_title": "Temperaturen",
    "r6h": "6 h",
    "r24h": "24 h",
    "r7d": "7 Tage",
    "series_note": "Lücken: Drucker aus oder ohne Antwort.",
    "hours_title": "Druckzeit je Tag",
    "r7": "7 Tage",
    "r30": "30 Tage",
    "hours_note": "Zeit im Zustand „Druckt“ aus den Minutenwerten (± 1 min je Druck).",
    "today_short": "heute",
    "jobs_title": "Letzte Druckjobs",
    "col_file": "Datei",
    "col_start": "Start",
    "col_dur": "Dauer",
    "col_end": "Ergebnis",
    "jobs_note": "Dauer aus den Minutenwerten (± 1 min); die Liste beginnt mit dem Mitschreiben.",
    "end_running": "läuft",
    "end_FINISHED": "fertig",
    "end_STOPPED": "abgebrochen",
    "end_ERROR": "Fehler",
    "end_OFFLINE": "Verbindung weg",
    "end_other": "beendet",
    "link_title": "{label}",
    "link_text": "Eigenes Werkzeug für den Drucker – öffnet in einem neuen Fenster.",
    "link_open": "Öffnen",
}


def de(x, nd=1) -> str:
    if x is None:
        return "–"
    s = f"{x:,.{nd}f}"
    return s.replace(",", " ").replace(".", ",")


def dur(sec) -> str:
    m = max(0, round((sec or 0) / 60))
    if m < 60:
        return f"{m} min"
    return f"{m // 60} h {m % 60:02d} min"


def _clock(ms, tz) -> str:
    return datetime.fromtimestamp(ms / 1000, tz).strftime("%H:%M")


def _when(ms, now_ms, tz) -> str:
    d = datetime.fromtimestamp(ms / 1000, tz)
    today = datetime.fromtimestamp(now_ms / 1000, tz).date()
    if d.date() == today:
        return d.strftime("%H:%M")
    if d.date() == today - timedelta(days=1):
        return "gestern " + d.strftime("%H:%M")
    return d.strftime("%d.%m. %H:%M")


def jobs(lines: list) -> list:
    """Print jobs seen in the readings, newest first: [{id, file, start, end, end_state, progress}]; end None =
    still running; late = first seen mid-job, so start and duration are only a lower bound. A job begins with
    its first reading in PRINTING/PAUSED and ends with the first reading that is something else (or another job)."""
    out, cur = [], None
    for r in lines:
        s, j = r.get("s"), r.get("j")
        if cur and (s not in WORKING or j != cur["id"]):
            cur.update(end=r["t"], end_state=s)
            if s != "OFFLINE" and j == cur["id"] and r.get("p") is not None:
                cur["progress"] = r["p"]
            out.append(cur)
            cur = None
        if s in WORKING and j is not None and cur is None:
            cur = {"id": j, "file": r.get("f") or "", "start": r["t"], "end": None, "end_state": None}
            cur["late"] = (r.get("p") or 0) > 2  # first seen mid-job (before the history began): start unknown
        if cur:
            cur["file"] = cur["file"] or r.get("f") or ""
            if r.get("p") is not None:
                cur["progress"] = r["p"]
            cur["last"] = r["t"]
    if cur:
        out.append(cur)
    return out[::-1]


def print_hours(lines: list, tz) -> dict:
    """{date: hours printing}: each gap ≤ GAP_MS after a PRINTING reading counts for that reading's day."""
    out: dict = {}
    for a, b in zip(lines, lines[1:], strict=False):
        if a.get("s") == "PRINTING" and 0 < b["t"] - a["t"] <= GAP_MS:
            d = datetime.fromtimestamp(a["t"] / 1000, tz).date()
            out[d] = out.get(d, 0.0) + (b["t"] - a["t"]) / 3_600_000
    return out


def _resample(lines: list, key: str, start: int, end: int, step: int) -> tuple[list, list]:
    """Mean per step; steps without a reading are None (a gap in the line)."""
    n = max(1, (end - start) // step)
    sums, cnt = [0.0] * n, [0] * n
    for r in lines:
        v = r.get(key)
        i = (r["t"] - start) // step
        if v is not None and 0 <= i < n:
            sums[i] += v
            cnt[i] += 1
    x = [start + i * step + step // 2 for i in range(n)]
    return x, [round(sums[i] / cnt[i], 1) if cnt[i] else None for i in range(n)]


def build(live: dict, history: list, links: list, now_ms: int, tz, t: dict) -> dict:
    lines = [r for r in history if r["t"] < live["t"]] + [live]
    seen = [r for r in lines if r.get("s") != "OFFLINE"]
    off = live.get("s") == "OFFLINE"
    word, st = STATES.get(live.get("s"), (t["unknown"], "look"))
    job_list = jobs(lines)
    running = job_list[0] if job_list and job_list[0]["end"] is None and not off else None

    # first level: state, progress, time left
    if off:
        sub = t["offline_sub"].format(when=_when(seen[-1]["t"], now_ms, tz)) if seen else t["offline_never"]
    else:
        sub = live.get("f") or (running or {}).get("file") or t["no_job"]
    state_tile = {
        "label": t["state"],
        "value": word,
        "sub": sub,
        "icon": "printer",
        "color": "home",
        "info": {"what": t["state_what"], "source": t["state_source"]},
    }
    if st:
        state_tile["state"] = st
    has_job = not off and live.get("j") is not None and live.get("s") in WORKING | {"FINISHED", "ATTENTION"}
    prog = {"label": t["progress"], "value": "–", "sub": t["no_job"], "icon": "target", "color": "home"}
    left = {"label": t["left"], "value": "–", "sub": t["no_job"], "icon": "clock", "color": "home"}
    if has_job and live.get("p") is not None:
        prog.update(value=de(live["p"], 0), unit="%")
        if running:
            since = dur((now_ms - running["start"]) / 1000)
            prog["sub"] = t["progress_sub"].format(dur=("≥ " if running["late"] else "") + since)
        elif job_list and job_list[0]["id"] == live["j"]:
            prog["sub"] = t["done_sub"].format(when=_when(job_list[0]["end"], now_ms, tz))
        else:
            prog.pop("sub")
        if running:
            pts = [r for r in lines if r["t"] >= running["start"] and r.get("p") is not None]
            if len(pts) >= 2:
                prog.update(spark=[r["p"] for r in pts[-300:]], sparkFrom=pts[-300:][0]["t"], sparkTo=pts[-1]["t"])
    if has_job and live.get("r") is not None and live.get("s") in WORKING:
        sec = live["r"]
        m = max(0, round(sec / 60))
        if m < 60:
            left.update(value=str(m), unit="min")
        else:
            left.update(value=f"{m // 60}:{m % 60:02d}", unit="h")
        left.update(
            sub=t["left_sub"].format(clock=_clock(now_ms + sec * 1000, tz)),
            approx=True,
            info={"what": t["left_what"], "source": t["left_source"]},
        )
    sections = [{"type": "tiles", "title": t["now_title"], "tiles": [state_tile, prog, left]}]

    # temperatures now, with the last two hours
    temp_tiles = []
    for key, target, label, color in (("d", "dz", t["nozzle"], "import"), ("b", "bz", t["bed"], "sun")):
        tile = {
            "label": label,
            "value": "–" if off else de(live.get(key)),
            "unit": "°C",
            "icon": "thermometer",
            "color": color,
            "info": {"what": t["temp_what"], "source": t["temp_source"]},
        }
        if not off:
            tile["sub"] = t["target"].format(v=de(live[target], 0)) if (live.get(target) or 0) > 0 else t["heat_off"]
        x, v = _resample(seen, key, now_ms - 2 * 3_600_000, now_ms, 120_000)
        if sum(y is not None for y in v) >= 2:
            tile.update(spark=v, sparkFrom=x[0], sparkTo=x[-1])
        temp_tiles.append(tile)
    sections.append({"type": "tiles", "title": t["temp_title"], "tiles": temp_tiles})

    # second level: back in time
    if len(seen) >= 2:

        def temps(hours, step):
            x, d = _resample(seen, "d", now_ms - hours * 3_600_000, now_ms, step)
            _, b = _resample(seen, "b", now_ms - hours * 3_600_000, now_ms, step)
            return {
                "x": x,
                "lines": [
                    {"label": t["nozzle"], "values": d, "color": "import"},
                    {"label": t["bed"], "values": b, "color": "sun"},
                ],
            }

        sections.append(
            {
                "type": "series",
                "title": t["series_title"],
                "unit": "°C",
                **temps(24, 120_000),
                "group": "temp",
                "ranges": [
                    {"id": "6h", "label": t["r6h"], **temps(6, 60_000)},
                    {"id": "24h", "label": t["r24h"], **temps(24, 120_000)},
                    {"id": "7d", "label": t["r7d"], **temps(168, 600_000)},
                ],
                "note": t["series_note"],
            }
        )
        hours = print_hours(lines, tz)
        today = datetime.fromtimestamp(now_ms / 1000, tz).date()

        def per_day(back):
            ds = [today - timedelta(days=k) for k in range(back - 1, -1, -1)]
            return {
                "labels": [t["today_short"] if d == today else d.strftime("%d.%m.") for d in ds],
                "values": [round(hours.get(d, 0.0), 2) for d in ds],
            }

        sections.append(
            {
                "type": "bars",
                "title": t["hours_title"],
                "unit": "h",
                **per_day(7),
                "color": "home",
                "group": "druckzeit",
                "ranges": [{"id": "7", "label": t["r7"], **per_day(7)}, {"id": "30", "label": t["r30"], **per_day(30)}],
                "note": t["hours_note"],
            }
        )
    if job_list:
        rows = []
        for j in job_list[:10]:
            end = j["end"] if j["end"] is not None else (now_ms if j is running else j.get("last", j["start"]))
            res = t["end_running"] if j is running else t.get(f"end_{j['end_state']}", t["end_other"])
            if j["end_state"] == "IDLE" and (j.get("progress") or 0) >= 99:
                res = t["end_FINISHED"]
            row = {
                "cells": {
                    "datei": j["file"] or f"Job {j['id']}",
                    "start": _when(j["start"], now_ms, tz),
                    "dauer": ("≥ " if j["late"] else "") + dur((end - j["start"]) / 1000),
                    "ende": res,
                }
            }
            if j["end_state"] in ("ERROR", "ATTENTION"):
                row["state"] = "act"
            rows.append(row)
        sections.append(
            {
                "type": "table",
                "title": t["jobs_title"],
                "columns": [
                    {"key": "datei", "label": t["col_file"]},
                    {"key": "start", "label": t["col_start"]},
                    {"key": "dauer", "label": t["col_dur"], "align": "right"},
                    {"key": "ende", "label": t["col_end"], "phone": True},
                ],
                "rows": rows,
                "note": t["jobs_note"],
            }
        )
    for lk in links:
        sections.append(
            {
                "type": "text",
                "title": t["link_title"].format(label=lk["label"]),
                "text": lk.get("text") or t["link_text"],
                "link": {"label": t["link_open"], "url": lk["url"]},
            }
        )
    return {"updated": live["t"] if not off or not seen else seen[-1]["t"], "sections": sections}
