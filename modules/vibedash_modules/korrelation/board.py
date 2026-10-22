"""Board of the module "korrelation": the weekly correlation atlas in plain words – what moves together, the likely
reason behind an ⓘ per line, what is unexplained, what is new or gone since last week. Pure function:

  build(data, now_ms, t, tz)

data (house service, config "einschub_url"): {"stand_ms", "aktuell": {"statistik": [{ebene: h|d, signale,
paare_getestet, zeitraum}], "paare": [{ebene: Stunden|Tage, a, b, r, rb, n, einordnung, nur_tagesgang, abgeleitet,
gruppe, warum}]}, "vorwoche": same | null, "namen": {signal: everyday name}}.
einordnung: prüfen | erwartet | gleicher Sensor | technisch gekoppelt (the atlas' own rules).
gruppe (optional, from the house): unklar | erklaert | zeit | technik – what is most likely behind the pair;
warum (optional): one sentence why. Without them the group follows from einordnung and a general sentence is shown.
"""

from __future__ import annotations

from datetime import datetime

from ..fmt import clean

# most interesting first; the bar chart and every list keep this order (technical ones at the end)
GROUPS = ("unklar", "erklaert", "zeit", "technik")

TEXT = {
    "none_title": "Noch kein Ergebnis",
    "none_text": "Der Wochenlauf des Korrelationsatlas hat noch nichts geschrieben.",
    "source": "Korrelationsatlas des Hauses",
    "g_unklar": "unklar",
    "g_erklaert": "erklärt",
    "g_zeit": "Sonne/Zeit",
    "g_technik": "Technik",
    "why_unklar": "Kein naheliegender Grund bekannt – ein Blick lohnt.",
    "why_erklaert": "Physikalisch naheliegend: das eine wirkt direkt auf das andere.",
    "why_zeit": "Beide folgen nur Sonne, Tages- oder Jahreszeit – keine direkte Wirkung.",
    "why_technik": "Messtechnik: dasselbe Gerät oder derselbe Wert, doppelt gezählt.",
    "found_what": "Messwerte, die deutlich gemeinsam steigen oder fallen (Stärke |r| ≥ 0,5 von 1), geprüft gegen "
    "Zufall und stabil in beiden Hälften des Zeitraums. Ohne Paare, bei denen ein Wert aus dem anderen gerechnet "
    "ist.",
    "stand_what": "Wird jede Woche neu gerechnet.",
    "kinds_note": "Links lohnt der Blick, rechts ist es Messtechnik.",
    "kinds_what": "unklar: kein naheliegender Grund. erklärt: eins wirkt aufs andere (Heizung wärmt Raum, Bewegung "
    "schaltet Licht). Sonne/Zeit: beide folgen nur Sonne, Tages- oder Jahreszeit. Technik: dasselbe Gerät, "
    "derselbe Messwert zweimal oder Busmeldungen, die das Schalten selbst sind.",
    "unclear_what": "Gleichlauf ohne naheliegenden Grund. Gleichlauf ist keine Ursache – nur ein Hinweis, wo man "
    "hinschauen kann. Stärke von −1 bis 1; „ohne Tagesgang“: was bleibt, wenn man den üblichen Tagesverlauf "
    "(bei Tageswerten: die Saison) abzieht.",
    "known_what": "Die stärksten Paare mit naheliegender Erklärung. ⓘ je Zeile: warum.",
    "rank_note": "Stärke von −1 bis 1; ohne Tagesgang: bei Tageswerten ohne Saison; Daten: Stunden bzw. Tage mit "
    "Werten; graue Zeile: Art. Ohne Technik; unklar zuerst.",
    "rank_what": "Ohne Messtechnik (dasselbe Gerät, derselbe Wert zweimal) und ohne Paare, bei denen ein Wert aus "
    "dem anderen gerechnet ist (z. B. WP-Strom aus der Außentemperatur). Stärkste 150.",
}


def de(x, nd=2) -> str:
    return "–" if x is None else f"{x:.{nd}f}".replace(".", ",").replace("-", "−")


def _key(p):
    return (p["ebene"],) + tuple(sorted((p["a"], p["b"])))


def group(p) -> str:
    g = p.get("gruppe")
    if g in GROUPS:
        return g
    k = p.get("einordnung")
    if k in ("gleicher Sensor", "technisch gekoppelt"):
        return "technik"
    if p.get("nur_tagesgang"):
        return "zeit"
    return "unklar" if k == "prüfen" else "erklaert"


def strength(p) -> float:
    return max(abs(p["r"]), abs(p.get("rb") or 0))


def _plural(name: str) -> bool:
    # counts are named in the plural ("Busmeldungen Dimmer 4", "Tastendrücke Büro"): the verb follows
    w = name.split(" ", 1)[0].lower()
    return w == "alle" or w.endswith(("ungen", "drücke", "hinweise", "meldungen"))


def _cap(s: str) -> str:
    return s[:1].upper() + s[1:]


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
        # direction as words; the sign of the stronger of raw and without-daily-rhythm
        r = p["rb"] if p.get("rb") is not None and abs(p["rb"]) > abs(p["r"]) else p["r"]
        a, b = name(p["a"]), name(p["b"])
        if r >= 0:
            return clean(_cap(f"{a} und {b} steigen gemeinsam"), 160)
        if _plural(a) and not _plural(b):
            a, b = b, a
        verb = "sinken" if _plural(a) else "sinkt"
        return clean(_cap(f"{a} {verb}, wenn {b} {'steigen' if _plural(b) else 'steigt'}"), 160)

    def n_text(p):
        return f"{p['n']} {'Std.' if p['ebene'] == 'Stunden' else 'Tage'}" if p.get("n") else p["ebene"]

    def rtext(p, with_group=False):
        # plain words in the first line, with n (Audit04 ST-19, UX-06)
        part = [t[f"g_{group(p)}"]] if with_group else []
        part.append(f"Stärke {de(p['r'])}")
        if p.get("rb") is not None:
            part.append(f"ohne Tagesgang {de(p['rb'])}")
        part.append(n_text(p))
        return clean(" · ".join(part), 80)

    def item(p, with_group=False):
        return {
            "text": pair(p),
            "meta": rtext(p, with_group),
            "info": clean(p.get("warum") or t[f"why_{group(p)}"], 300),
        }

    def ordered(items):
        # unclear first, technical last; strongest first within a group
        return sorted(items, key=lambda p: (GROUPS.index(group(p)), -strength(p)))

    def distinct(items):
        # the same two values by the hour and by the day: one line in a list (the stronger, as sorted)
        seen = set()
        out = []
        for p in items:
            k = tuple(sorted((p["a"], p["b"])))
            if k not in seen:
                seen.add(k)
                out.append(p)
        return out

    # compare with last week (only once last week comes from an earlier run); technical pairs are not news
    cmp = None
    if v and v.get("statistik") and [s["zeitraum"] for s in v["statistik"]] != [s["zeitraum"] for s in e["statistik"]]:
        old = {_key(p): p for p in v.get("paare") or [] if not p.get("abgeleitet")}
        new = {_key(p): p for p in pairs}
        cmp = {
            "neu": [new[k] for k in new if k not in old and group(new[k]) != "technik"],
            "weg": [old[k] for k in old if k not in new and group(old[k]) != "technik"],
        }
    by = {g: sorted((p for p in pairs if group(p) == g), key=lambda p: -strength(p)) for g in GROUPS}
    unclear = by["unklar"]
    tested = st.get("h", {}).get("paare_getestet", 0) + st.get("d", {}).get("paare_getestet", 0)
    tiles = [
        {
            "label": "Gefunden",
            "value": f"{len(pairs):,}".replace(",", "."),
            "unit": "Paare",
            "icon": "target",
            "color": "home",
            "sub": "von " + f"{tested:,}".replace(",", ".") + " geprüften",
            "info": {"what": t["found_what"], "source": t["source"]},
        },
        {
            "label": "Unklar",
            "value": str(len(unclear)),
            "unit": "Paare",
            "icon": "eye",
            "sub": "ohne naheliegenden Grund",
        },
        {
            "label": "Neu",
            "value": str(len(cmp["neu"])) if cmp else "–",
            **({"unit": "Paare"} if cmp else {}),
            "icon": "eye",
            "sub": "seit Vorwoche (ohne Technik)" if cmp else "Vergleich ab nächster Woche",
        },
        {
            "label": "Entfallen",
            "value": str(len(cmp["weg"])) if cmp else "–",
            **({"unit": "Paare"} if cmp else {}),
            "icon": "undo",
            "sub": "seit Vorwoche (ohne Technik)" if cmp else "Vergleich ab nächster Woche",
        },
        {
            "label": "Messreihen",
            "value": f"{st.get('h', {}).get('signale', '–')}/{st.get('d', {}).get('signale', '–')}",
            "icon": "overview",
            "sub": "Anzahl stündlich / täglich",
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
            "title": "Was steckt dahinter",
            "unit": "Paare",
            "labels": [t[f"g_{g}"] for g in GROUPS],
            "values": [len(by[g]) for g in GROUPS],
            "color": "home",
            "note": t["kinds_note"],
            "info": {"what": t["kinds_what"], "source": t["source"]},
        }
    )
    # a correlation is never a task, so nothing here carries a "look" state (Audit04 UX-10)
    sections.append(
        {
            "type": "list",
            "title": "Unklar",
            "items": [item(p) for p in distinct(unclear)[:20]],
            "note": f"{len(unclear)} Paare, stärkste zuerst." if unclear else "Keine – alles erklärbar.",
            "info": {"what": t["unclear_what"], "source": t["source"]},
        }
    )
    if by["erklaert"]:
        sections.append(
            {
                "type": "list",
                "title": "Erklärt",
                "items": [item(p) for p in distinct(by["erklaert"])[:10]],
                "note": f"Die stärksten von {len(by['erklaert'])}.",
                "info": {"what": t["known_what"], "source": t["source"]},
            }
        )
    if cmp:
        for title, items in (("Neu diese Woche", cmp["neu"]), ("Weggefallen", cmp["weg"])):
            sections.append(
                {
                    "type": "list",
                    "title": title,
                    "items": [item(p, True) for p in distinct(ordered(items))[:15]],
                    "note": f"{len(items)} Paare (ohne Technik)" if items else "Keine Änderung.",
                }
            )
    rank = ordered(p for p in pairs if group(p) != "technik")[:150]
    sections.append(
        {
            "type": "table",
            "title": "Alle nach Art",
            "columns": [
                {"key": "p", "label": "Zusammenhang"},
                {"key": "r", "label": "Stärke", "align": "right"},
                {"key": "rb", "label": "ohne Tagesgang", "align": "right"},
                {"key": "n", "label": "Daten", "align": "right", "phone": True},
            ],
            "rows": [
                {
                    "cells": {"p": pair(p), "r": de(p["r"]), "rb": de(p.get("rb")), "n": n_text(p)},
                    "note": t[f"g_{group(p)}"],
                }
                for p in rank
            ],
            "note": t["rank_note"],
            "info": {"what": t["rank_what"], "source": t["source"]},
        }
    )
    return {"updated": stand_ms, "sections": sections}
