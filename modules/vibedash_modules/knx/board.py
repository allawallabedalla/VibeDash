"""Board of the module "knx": light and operation over 7 days, defects, reports per kind, light per day, daily
rhythm, activity at night, best light ideas, light per room. Pure function over the house program's own KNX
results (it calculates nothing new):

  build(data, now_ms)

data (house service, config "einschub_url"): {"kopf", "defekte", "arten", "tage": {"7d", "30d", "90d"}, "alltag",
"profil", "nacht": {"7d", "30d", "90d"}, "karten", "licht"} – the fields of each part are those the board reads below.
"""

from __future__ import annotations

import json
import time
from datetime import datetime

from ..fmt import clean, level, number, value_unit

RANGES = [("7d", "7 Tage"), ("30d", "30 Tage"), ("90d", "90 Tage")]
NOON_MS = 12 * 3_600_000


def _list(x):
    return x if isinstance(x, list) else []


def build(data: dict, now_ms: int, tz=None) -> dict:
    sections = []
    head = _list(data.get("kopf"))
    if head:
        tiles = []
        for k in head:
            try:
                spark = [number(v) for v in json.loads(k.get("verlauf") or "[]")]
            except ValueError:
                spark = []
            name = clean(k.get("kennzahl"), 40)
            val, unit = value_unit(k.get("kachel_wert"))
            tiles.append(
                {
                    "label": name,
                    "value": val,
                    **({"unit": unit} if unit else {}),
                    "sub": clean(k.get("kachel_kurz"), 120),
                    "state": level(k.get("stufe_neu")),
                    "icon": {"Licht an": "bolt", "Von Hand": "target"}.get(name, "info"),
                    "spark": spark,
                    "color": "home",
                }
            )
        sections.append({"type": "tiles", "title": "Licht und Bedienung · 7 Tage", "tiles": tiles})

    def at(ms):
        if tz is None:
            return time.strftime("%d.%m. %H:%M", time.localtime(int(ms) / 1000))
        return datetime.fromtimestamp(int(ms) / 1000, tz).strftime("%d.%m. %H:%M")

    defects = _list(data.get("defekte"))
    sections.append(
        {
            "type": "list",
            "title": "Defekte",
            "items": [
                {
                    "text": clean(f"{d.get('name')} · {d.get('objekt')}", 200),
                    "meta": clean(at(d["zeit"]), 30),
                    "state": level(d.get("stufe")) or "look",
                }
                for d in defects[:15]
            ],
            "note": f"{len(defects)} Meldungen in 7 Tagen, neueste zuerst.",
            "info": {
                "what": "Ausfälle und Auffälligkeiten am KNX-Bus, die der KNX-Monitor erkennt.",
                "source": "KNX-Monitor des Hauses.",
            },
        }
    )
    kinds = _list(data.get("arten"))
    if kinds:
        sections.append(
            {
                "type": "table",
                "title": "Meldungen je Art",
                "columns": [
                    {"key": "a", "label": "Art"},
                    {"key": "n", "label": "Anzahl", "align": "right"},
                    {"key": "d", "label": "davor", "align": "right"},
                    {"key": "h", "label": "am häufigsten"},
                ],
                "rows": [
                    {
                        "cells": {
                            "a": clean(a.get("art"), 60),
                            "n": str(a.get("anzahl") or 0),
                            "d": str(a.get("vorzeitraum") or 0),
                            "h": clean(a.get("haeufigste"), 160),
                        }
                    }
                    for a in kinds
                ],
            }
        )

    def light(days):
        return {
            "x": [int(t["zeit"]) + NOON_MS for t in days],
            "lines": [
                {
                    "label": "Automatik",
                    "values": [number(t.get("Licht an (Automatik)")) for t in days],
                    "color": "home",
                },
                {"label": "Taster", "values": [number(t.get("Licht an (Taster)")) for t in days], "color": "sun"},
                {
                    "label": "Präsenz",
                    "values": [number(t.get("Präsenz")) for t in days],
                    "color": "muted",
                    "dashed": True,
                },
            ],
        }

    per_day = data.get("tage") if isinstance(data.get("tage"), dict) else {}
    if _list(per_day.get("7d")):
        rs = [{"id": i, "label": lab, **light(_list(per_day.get(i)))} for i, lab in RANGES]
        sections.append(
            {
                "type": "series",
                "title": "Licht je Tag",
                "unit": "×",
                **light(per_day["7d"]),
                "group": "knx-tage",
                "ranges": [r for r in rs if r["x"]],
                "note": "Einschaltungen je Tag: Automatik (Melder) gegen Taster von Hand.",
            }
        )
    daily = _list(data.get("alltag"))
    if daily:
        sections.append(
            {
                "type": "tiles",
                "title": "Alltag",
                "tiles": [
                    {
                        "label": clean(a.get("kurz_name") or a.get("name"), 40),
                        "value": clean(a.get("kurz_wert") or a.get("wert"), 20),
                        "sub": clean(a.get("kurz_vgl"), 120),
                        "icon": "clock",
                        "color": "climate",
                        "info": {"what": clean(a.get("name"), 200), "source": clean(a.get("vergleich"), 400)},
                    }
                    for a in daily[:8]
                ],
            }
        )
    profile = _list(data.get("profil"))
    if profile:
        col = next((k for k in profile[0] if k.startswith("Werktage")), None)
        if col:
            sections.append(
                {
                    "type": "bars",
                    "title": f"Aktivität je Stunde · {col}",
                    "unit": "",
                    "labels": [str(p.get("Stunde")) for p in profile],
                    "values": [number(p.get(col)) for p in profile],
                    "color": "climate",
                    "note": "Mittlere Melder- und Tasteraktivität je Stunde an Werktagen.",
                }
            )

    def night_series(night):
        cols = [k for k in night[0] if k != "zeit"] if night else []
        return {
            "x": [int(n["zeit"]) + NOON_MS for n in night],
            "lines": [
                {
                    "label": clean(col, 40),
                    "values": [number(n.get(col)) for n in night],
                    "color": ["climate", "muted", "import"][i % 3],
                    "dashed": i > 0,
                }
                for i, col in enumerate(cols[:3])
            ],
        }

    night = data.get("nacht") if isinstance(data.get("nacht"), dict) else {}
    if _list(night.get("7d")):
        rs = [{"id": i, "label": lab, **night_series(_list(night.get(i)))} for i, lab in RANGES]
        sections.append(
            {
                "type": "series",
                "title": "Aktivität in der Nacht",
                "unit": "×",
                **night_series(night["7d"]),
                "group": "knx-tage",
                "ranges": [r for r in rs if r["x"]],
            }
        )
    ideas = _list(data.get("karten"))
    if ideas:
        sections.append(
            {
                "type": "list",
                "title": "Beste Licht-Ideen",
                "items": [
                    {
                        "text": clean(
                            f"{i.get('raum')}: {i.get('idee_kurz')} "
                            f"({i.get('wirkung_kurz')} {i.get('wirkung_pm') or ''})",
                            200,
                        ),
                        "meta": clean(i.get("sicherheit_text") or "", 30),
                    }
                    for i in ideas[:8]
                ],
                "note": "Vorschläge aus dem Lichtverhalten; Wirkung in Handgriffen pro Woche mit Spanne.",
            }
        )
    rooms = _list(data.get("licht"))
    if rooms:
        sections.append(
            {
                "type": "table",
                "title": "Licht je Raum · 7 Tage",
                "columns": [
                    {"key": "r", "label": "Raum"},
                    {"key": "h", "label": "an bei Helligkeit", "align": "right"},
                    {"key": "t", "label": "von Hand trotz Melder", "align": "right"},
                    {"key": "s", "label": "gleich wieder aus", "align": "right"},
                ],
                "rows": [
                    {
                        "cells": {
                            "r": clean(r.get("raum"), 40),
                            "h": clean(r.get("an_hell_text") or "–", 30),
                            "t": clean(r.get("hand_trotz_melder_text") or "–", 30),
                            "s": clean(r.get("sofort_aus_text") or "–", 30),
                        }
                    }
                    for r in rooms
                ],
                "note": "Je Tag, Mittel ± Standardfehler.",
            }
        )
    return {"updated": now_ms, "sections": sections}
