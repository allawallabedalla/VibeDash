"""Charge timeline on the charging page (Nutzer 20.10.2026: „baue den Zeitstrahl in die Auto-Seite“; „es sollte
informativ bleiben“): the house's own weather cases for today and tomorrow, so the person can try charge windows.
Shown only – nothing goes back to the house.

The house's planner writes the file (config "zeitstrahl": path), format:
  {"stand", "tage": [{"tag": "YYYY-MM-DD", "ab_stufe", "start_kwh", "pv": [[96]×n], "last": [[96]×n]}],
   "akku": {"kwh", "reserve_kwh", "eta", "kw"}, "auto_bedarf_kwh", "wallbox_kw": [...]}
"""

from __future__ import annotations

import json
import time
from datetime import date

MAX_AGE_S = 3 * 3600  # older than that: not shown (the weather has moved on)
WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]


def section(path: str, today: date, now: float | None = None, mtime: float | None = None) -> dict | None:
    try:
        with open(path, encoding="utf-8") as f:
            z = json.load(f)
    except (OSError, ValueError):
        return None
    if mtime is not None and (now or time.time()) - mtime > MAX_AGE_S:
        return None
    a = z.get("akku") or {}
    days = []
    for d in z.get("tage") or []:
        try:
            day = date.fromisoformat(d["tag"])
        except (KeyError, ValueError):
            continue
        k = (day - today).days
        if k not in (0, 1):
            continue
        days.append(
            {
                "label": "Heute" if k == 0 else f"Morgen ({WEEKDAYS[day.weekday()]})",
                "startStep": int(d.get("ab_stufe") or 0) if k == 0 else 0,
                "startKwh": d.get("start_kwh"),
                "pv": d.get("pv"),
                "load": d.get("last"),
            }
        )
    if not days:
        return None
    need = z.get("auto_bedarf_kwh")
    return {
        "type": "chargetimeline",
        "title": "Ladefenster ausprobieren",
        "days": days,
        "battery": {
            "kwh": a.get("kwh"),
            "reserveKwh": a.get("reserve_kwh"),
            "eta": a.get("eta"),
            "kw": a.get("kw"),
        },
        "carNeedKwh": need if isinstance(need, (int, float)) and need > 0 else 40,
        "powers": z.get("wallbox_kw") or [4.3, 7.1, 11.4],
        "slot": "plan",
        "note": "Nur zum Ausprobieren – schaltet nichts und ändert den Ladeplan nicht. "
        f"Wetterfälle von {str(z.get('stand') or '')[11:16]} Uhr.",
        "info": {
            "what": "Ladefenster verschieben, länger oder kürzer ziehen, weitere hinzufügen: oben stehen sofort, "
            "wie viel das Auto bekäme, wie viel Netzstrom das Haus bräuchte (Mitte und Spanne über die "
            "Wetterfälle) und der Sonnenanteil. Gerechnet wird mit dem Hausakku ab seinem Ladestand jetzt "
            "(morgen: erwarteter Stand um 0 Uhr) und seiner Reserve.",
            "source": "31 Wetter- und Verbrauchsfälle je Tag aus dem Ladeplaner des Hauses, Rechnung im Browser.",
        },
    }
