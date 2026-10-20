"""Board of the module "korrelation": the weekly correlation atlas – robust signal pairs, what is worth a look,
what is new or gone since last week, a ranking without technically coupled pairs. Pure function:

  build(data, now_ms, t, tz)

data (house service, config "einschub_url"): {"stand_ms", "aktuell": {"statistik": [{ebene: h|d, signale,
paare_getestet, zeitraum}], "paare": [{ebene: Stunden|Tage, a, b, r, rb, einordnung, nur_tagesgang}]},
"vorwoche": same | null, "namen": {signal: readable name}}. einordnung: prüfen | erwartet | gleicher Sensor |
technisch gekoppelt.
"""

from __future__ import annotations

from datetime import datetime

from ..fmt import clean

KINDS = (
    ("prüfen", "prüfen"),
    ("erwartet", "erwartet"),
    ("gleicher Sensor", "gl. Sensor"),
    ("technisch gekoppelt", "technisch"),
)

TEXT = {
    "none_title": "Noch kein Ergebnis",
    "none_text": "Der Wochenlauf des Korrelationsatlas hat noch nichts geschrieben.",
    "source": "Korrelationsatlas des Hauses",
    "robust_what": "Signalpaare mit starkem Gleichlauf (Korrelation |r| ≥ 0,5), die roh oder nach Abzug des "
    "Tagesgangs signifikant sind (Autokorrelation und Mehrfachtest berücksichtigt). Ohne Paare, bei denen ein "
    "Signal aus dem anderen gerechnet ist.",
    "stand_what": "Wird jede Woche neu gerechnet.",
    "kinds_note": "Technisch gekoppelt = Kanäle desselben Geräts; prüfen = nicht erklärbar.",
    "kinds_what": "Einordnung nach Regeln: technisch gekoppelt, gleicher Sensor auf zwei Wegen, physikalisch erwartet, "
    "sonst prüfen.",
    "check_what": "Paare, die weder technisch noch physikalisch naheliegen. Korrelation ist keine Ursache – "
    "Hinweis, wo man hinschauen kann.",
    "rank_note": "Stärke = Korrelation r von −1 bis 1, roh / ohne Tagesgang bzw. Saison. Stärkste 150; alles mit "
    "Filter im Korrelationsatlas.",
    "rank_what": "Ohne technisch gekoppelte Kanäle, ohne Paare aus demselben Sensor und ohne Paare, bei denen ein "
    "Signal aus dem anderen gerechnet ist (z. B. WP-Strom aus der Außentemperatur).",
}


def de(x, nd=2) -> str:
    return "–" if x is None else f"{x:.{nd}f}".replace(".", ",").replace("-", "−")


def _key(p):
    return (p["ebene"],) + tuple(sorted((p["a"], p["b"])))


def build(data: dict, now_ms: int, t: dict, tz) -> dict:
    e = data.get("aktuell")
    if not isinstance(e, dict) or not e.get("statistik"):
        return {"updated": now_ms, "sections": [{"type": "text", "title": t["none_title"], "text": t["none_text"]}]}
    v = data.get("vorwoche") if isinstance(data.get("vorwoche"), dict) else None
    names = data.get("namen") or {}
    # a signal computed from the other one is circular, not a finding (Audit04 ST-15)
    pairs = [p for p in e.get("paare") or [] if not p.get("abgeleitet")]
    st = {s["ebene"]: s for s in e["statistik"]}
    stand_ms = int(data.get("stand_ms") or now_ms)
    stand = datetime.fromtimestamp(stand_ms / 1000, tz).strftime("%d.%m. %H:%M")

    def name(sig):
        return names.get(sig, sig)

    def pair(p):
        return clean(f"{name(p['a'])} ~ {name(p['b'])}", 160)

    def rtext(p):
        # plain words in the first line, with n (Audit04 ST-19, UX-06)
        part = [f"Stärke {de(p['r'])}"]
        if p.get("rb") is not None:
            part.append(f"ohne Tagesgang {de(p['rb'])}")
        part.append(f"{p['n']} {'Std.' if p['ebene'] == 'Stunden' else 'Tage'}" if p.get("n") else p["ebene"])
        return " · ".join(part)

    # compare with last week (only once last week comes from an earlier run)
    cmp = None
    if v and v.get("statistik") and [s["zeitraum"] for s in v["statistik"]] != [s["zeitraum"] for s in e["statistik"]]:
        old = {_key(p): p for p in v.get("paare") or []}
        new = {_key(p): p for p in pairs}
        cmp = {
            "neu": [new[k] for k in new if k not in old and new[k]["einordnung"] != "technisch gekoppelt"],
            "weg": [old[k] for k in old if k not in new and old[k]["einordnung"] != "technisch gekoppelt"],
        }
    # "check" = not explained beforehand AND still there without the daily rhythm (Audit04 ST-04: 19 of 31 were only
    # the daily rhythm); a correlation is never a task, so nothing here carries a "look" state (Audit04 UX-10)
    check_all = [p for p in pairs if p["einordnung"] == "prüfen"]
    check = [p for p in check_all if not p.get("nur_tagesgang")]
    rhythm_only = len(check_all) - len(check)
    tested = st.get("h", {}).get("paare_getestet", 0) + st.get("d", {}).get("paare_getestet", 0)
    tiles = [
        {
            "label": "Robust",
            "value": f"{len(pairs):,}".replace(",", "."),
            "icon": "target",
            "color": "home",
            "sub": "starke Paare von " + f"{tested:,}".replace(",", ".") + " getesteten",
            "info": {"what": t["robust_what"], "source": t["source"]},
        },
        {
            "label": "Prüfen",
            "value": str(len(check)),
            "icon": "eye",
            "sub": "nicht von vornherein erklärbar",
        },
        {
            "label": "Neu",
            "value": str(len(cmp["neu"])) if cmp else "–",
            "icon": "eye",
            "sub": "seit Vorwoche (ohne Technik)" if cmp else "Vergleich ab nächster Woche",
        },
        {
            "label": "Entfallen",
            "value": str(len(cmp["weg"])) if cmp else "–",
            "icon": "undo",
            "sub": "seit Vorwoche (ohne Technik)" if cmp else "Vergleich ab nächster Woche",
        },
        {
            "label": "Signale",
            "value": f"{st.get('h', {}).get('signale', '–')}/{st.get('d', {}).get('signale', '–')}",
            "icon": "overview",
            "sub": "Stunden / Tage",
        },
        {
            "label": "Stand",
            "value": stand.split()[0],
            "icon": "calendar",
            "sub": f"Lauf {stand.split()[1]} Uhr",
            "info": {"what": t["stand_what"], "source": t["source"]},
        },
    ]
    sections = [{"type": "tiles", "title": "Zusammenhänge diese Woche", "tiles": tiles}]
    sections.append(
        {
            "type": "bars",
            "title": "Paare je Einordnung",
            "unit": "",
            "labels": [k[1] for k in KINDS],
            "values": [sum(1 for p in pairs if p["einordnung"] == k[0]) for k in KINDS],
            "color": "home",
            "note": t["kinds_note"],
            "info": {"what": t["kinds_what"], "source": t["source"]},
        }
    )
    sections.append(
        {
            "type": "list",
            "title": "Prüfen",
            "items": [{"text": pair(p), "meta": clean(rtext(p), 60)} for p in check[:20]],
            "note": (f"Die {min(20, len(check))} stärksten von {len(check)}." if check else "Keine.")
            + (
                f" Dazu {rhythm_only} Paare, die nur dem Tagesrhythmus folgen (nicht aufgeführt)."
                if rhythm_only
                else ""
            ),
            "info": {"what": t["check_what"], "source": t["source"]},
        }
    )
    if cmp:
        for title, items in (("Neu diese Woche", cmp["neu"]), ("Weggefallen", cmp["weg"])):
            items = sorted(items, key=lambda p: -max(abs(p["r"]), abs(p.get("rb") or 0)))
            sections.append(
                {
                    "type": "list",
                    "title": title,
                    "items": [{"text": pair(p), "meta": clean(rtext(p), 60)} for p in items[:15]],
                    "note": f"{len(items)} Paare (ohne technisch gekoppelte)" if items else "Keine Änderung.",
                }
            )
    rank = [p for p in pairs if p["einordnung"] not in ("technisch gekoppelt", "gleicher Sensor")][:150]
    sections.append(
        {
            "type": "table",
            "title": "Rangliste ohne Technik",
            "columns": [
                {"key": "p", "label": "Paar"},
                {"key": "r", "label": "Stärke", "align": "right"},
                {"key": "k", "label": "Art"},
            ],
            "rows": [
                {
                    "cells": {
                        "p": pair(p),
                        "r": f"{de(p['r'])} / {de(p.get('rb'))}",
                        "k": ("prüfen" if p["einordnung"] == "prüfen" else "erwartet")
                        + (" · Tag" if p["ebene"] == "Tage" else "")
                        + (" · nur Tagesgang" if p["nur_tagesgang"] else ""),
                    },
                }
                for p in rank
            ],
            "note": t["rank_note"],
            "info": {"what": t["rank_what"], "source": t["source"]},
        }
    )
    return {"updated": stand_ms, "sections": sections}
