"""Board of the module "ml": accuracy per model (share of correct days, n, history) and how far each model has
learned. Pure function over the house program's model results (it calculates nothing new):

  build(data, now_ms, t)

data (house service, config "einschub_url"):
  {"treffer": [{id, name, korrekt_pct, zeige_pct, n, verlauf: [{treffer_pct}], art, zeitraum, grund, ab_text,
                frage, stufe_wort, kennzahl_kurz}],
   "fortschritt": [{id, name, prozent, stand_text, eta_text, offen_text}]}
A model without enough judged days shows "open" (no fake percent).
"""

from __future__ import annotations

from ..fmt import clean, number

MIN_DAYS = 14

TEXT = {
    "title": "Treffsicherheit je Modell",
    "note": "Vorne: wie oft das Modell richtig lag (n = bewertete Tage). Darunter der Lernstand.",
    "what": "Jedes Modell sagt voraus, bevor es den Tag kennt; danach wird mit dem gemessenen Wert verglichen.",
    "source": "Modell-Auswertungen des Hauses",
    "d_learned": "Lernstand",
    "d_state": "Stand",
    "d_done": "Fertig",
    "d_judged": "Bewertet",
    "d_since": "Seit",
    "art_live": "aus echten Vorhersagen",
    "art_recalc": "nachgerechnet",
    "few_days": "Urteil ab {min} bewerteten Tagen – noch {rest} (das Haus-Programm sagt jetzt: {word})",
    "table_title": "Lernstand aller Modelle",
    "c_model": "Modell",
    "c_learned": "Lernstand",
    "c_state": "Stand",
    "c_done": "Fertig",
    "table_note": "100 % = genug Daten, das Modell ist voll gelernt (lernt danach weiter mit).",
}


def build(data: dict, now_ms: int, t: dict) -> dict:
    hits = [m for m in data.get("treffer") or [] if isinstance(m, dict)]
    progress = {f.get("id"): f for f in data.get("fortschritt") or [] if isinstance(f, dict)}
    models = []
    for m in hits:
        f = progress.get(m.get("id")) or {}
        hist = [number(v.get("treffer_pct")) for v in (m.get("verlauf") or []) if isinstance(v, dict)]
        details = []
        if f:
            details.append({"label": t["d_learned"], "value": clean(f"{f.get('prozent')} %", 20)})
            if f.get("stand_text"):
                details.append({"label": t["d_state"], "value": clean(f.get("stand_text"), 160)})
            if f.get("eta_text") or f.get("offen_text"):
                details.append({"label": t["d_done"], "value": clean(f.get("eta_text") or f.get("offen_text"), 120)})
        details.append(
            {
                "label": t["d_judged"],
                "value": clean(
                    {"live": t["art_live"], "nachgerechnet": t["art_recalc"]}.get(m.get("art"), m.get("art") or "–"), 40
                ),
            }
        )
        if m.get("zeitraum"):
            details.append({"label": t["d_since"], "value": clean(str(m.get("zeitraum")).replace("seit ", ""), 30)})
        n = int(number(m.get("n")) or 0)
        # why there is no verdict (yet) and from when – so that "open" needs no explanation
        if not m.get("zeige_pct"):
            why = clean(m.get("grund"), 120)
            since = clean(m.get("ab_text"), 80)
            if since and not since.startswith(("ab", "nicht", "noch", "erst", "Datenbasis")):
                since = "ab " + since
            if why and since and (why in since or since in why):  # both say the same: only the longer one
                parts = [max(since, why, key=len)]
            else:
                parts = [x for x in (since, why) if x]
            note = " · ".join(parts) or clean(m.get("frage"), 160)
        elif n < MIN_DAYS:
            note = t["few_days"].format(min=MIN_DAYS, rest=MIN_DAYS - n, word=clean(m.get("stufe_wort"), 20))
        else:
            note = clean(m.get("frage") or m.get("kennzahl_kurz"), 160)
        models.append(
            {
                "label": clean(m.get("name"), 60),
                "pct": number(m.get("korrekt_pct")) if m.get("zeige_pct") else None,
                "n": n,
                "history": hist if sum(1 for v in hist if v is not None) >= 2 else [],
                "note": note,
                "details": details,
            }
        )
    sections = [
        {
            "type": "accuracy",
            "title": t["title"],
            "models": models,
            "note": t["note"],
            "info": {"what": t["what"], "source": t["source"]},
        }
    ]
    if progress:
        rows = []
        for f in progress.values():
            row = {
                "cells": {
                    "m": clean(f.get("name"), 60),
                    "p": f"{f.get('prozent')} %",
                    "s": clean(f.get("stand_text"), 160),
                    "e": clean(f.get("eta_text") or f.get("offen_text") or "", 80),
                }
            }
            if (number(f.get("prozent")) or 0) >= 100:
                row["state"] = "ok"
            rows.append(row)
        sections.append(
            {
                "type": "table",
                "title": t["table_title"],
                "columns": [
                    {"key": "m", "label": t["c_model"]},
                    {"key": "p", "label": t["c_learned"], "align": "right"},
                    {"key": "s", "label": t["c_state"]},
                    {"key": "e", "label": t["c_done"]},
                ],
                "rows": rows,
                "note": t["table_note"],
            }
        )
    return {"updated": now_ms, "sections": sections}
