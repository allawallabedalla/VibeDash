"""The answer to "compare two values" (section "pair" of the korrelation board) as ordinary sections. Pure function:

  sections(res, t)

res (house service, config "paar_url", GET ?a=&b=&ebene=h|d): {"ok": true, "ebene", "name_a", "name_b",
"einheit_a", "einheit_b", "n", "neff", "r", "r_lo", "r_hi", "p", "rs", "rb", "rb_lo", "rb_hi", "p_b",
"haelften": [r1, r2] | null, "versatz_h", "r_versatz", "min_ueberlappung", "warum", "verlauf": {x, a, b},
"stufen": [{von, bis, b, n}]} – or {"ok": false, "grund": gleich | fehlt | zu_selten | zu_wenig, "signale", "n"}.
"""

from __future__ import annotations

from ..fmt import clean

TEXT = {
    "p_strength_what": "Wie gleichmäßig beide gemeinsam steigen (bis 1) oder gegenläufig sind (bis −1); 0 = kein "
    "Gleichlauf. Spanne: 95-%-Bereich. Rangkorrelation (robust gegen Ausreißer): {rs}.",
    "p_clean_what": "Was bleibt, wenn man bei beiden den üblichen Tagesverlauf und den Wochentrend abzieht – "
    "Gleichlauf nur über die Uhrzeit fällt hier weg.",
    "p_clean_what_d": "Was bleibt, wenn man bei beiden die Saison (gleitendes 15-Tage-Mittel) abzieht.",
    "p_data_what": "Aufeinanderfolgende Werte ähneln sich. Für die Sicherheit zählen sie deshalb nur wie weniger "
    "unabhängige Werte (effektives n).",
    "p_stable_what": "Stärke getrennt in der ersten und zweiten Hälfte des Zeitraums. Stabil = beide mindestens 0,3 "
    "und gleiche Richtung.",
    "p_lag_what": "Bei diesem Versatz laufen beide am stärksten gemeinsam (ohne Tagesgang gerechnet).",
    "p_level_note": "Wochenlauf-Daten: Stunden der letzten 30 Tage, Tage seit März.",
    "p_series_note": "Beide auf gleicher Skala: 0 = eigenes Mittel, ±1 = übliche Schwankung.",
    "p_cause": "Gleichlauf ist keine Ursache.",
}

REASON = {
    "gleich": "Zwei verschiedene Messwerte wählen.",
    "fehlt": "Diesen Messwert gibt es in dieser Auflösung nicht.",
    "zu_selten": "{names} ändert sich zu selten für eine Korrelation.",
    "zu_wenig": "Zu wenig gemeinsame Daten ({n} {unit}, nötig {min_n}).",
    "ebene": "Unbekannte Auflösung.",
}


def de(x, nd=2) -> str:
    return "–" if x is None else f"{x:.{nd}f}".replace(".", ",").replace("-", "−")


def short(x) -> str:
    """A bin border: few digits (labels of bars are short)."""
    if x is None:
        return "–"
    a = abs(x)
    return de(x, 0 if a >= 100 else 1 if a >= 10 else 2)


def word(r) -> str:
    a = abs(r)
    return "kein" if a < 0.1 else "schwach" if a < 0.3 else "mittel" if a < 0.5 else "deutlich" if a < 0.7 else "stark"


def span(lo, hi) -> str:
    return f"95 %: {de(lo)} bis {de(hi)}" if lo is not None and hi is not None else "Spanne offen"


def failed(res: dict, unit: str) -> list:
    g = res.get("grund")
    txt = REASON.get(g, "Rechnung gescheitert – nochmal versuchen.")
    txt = txt.format(
        names=" und ".join(res.get("namen") or res.get("signale") or ["Ein Wert"]),
        n=res.get("n", 0),
        min_n=res.get("min_n", "–"),
        unit=unit,
    )
    return [{"type": "text", "title": "Kein Ergebnis", "text": clean(txt, 300)}]


def sections(res: dict, t: dict) -> list:
    t = {**TEXT, **t}
    hours = res.get("ebene") != "d"
    unit = "Std." if hours else "Tage"
    if not isinstance(res, dict) or not res.get("ok") or res.get("r") is None:
        return failed(res if isinstance(res, dict) else {}, unit)
    a, b = clean(res.get("name_a") or "A", 60), clean(res.get("name_b") or "B", 60)
    r, rb = float(res["r"]), res.get("rb")
    n, neff = int(res.get("n") or 0), res.get("neff")
    tiles = [
        {
            "label": "Stärke",
            "value": de(r),
            "icon": "target",
            "color": "home",
            "approx": True,
            "sub": span(res.get("r_lo"), res.get("r_hi")),
            "info": {"what": t["p_strength_what"].format(rs=de(res.get("rs"))), "source": t["source"]},
        },
        {
            "label": "Ohne Tagesgang" if hours else "Ohne Saison",
            "value": de(rb),
            "icon": "target",
            "approx": rb is not None,
            "sub": span(res.get("rb_lo"), res.get("rb_hi")) if rb is not None else "zu wenig Daten",
            "info": {"what": t["p_clean_what"] if hours else t["p_clean_what_d"], "source": t["source"]},
        },
        {
            "label": "Daten",
            "value": f"{n:,}".replace(",", "."),
            "unit": unit,
            "icon": "calendar",
            "sub": f"zählen wie ~{neff:.0f} unabhängige" if neff else "",
            "info": {"what": t["p_data_what"], "source": t["source"]},
        },
    ]
    h = res.get("haelften")
    if h and len(h) == 2:
        ok = all(x is not None and abs(x) >= 0.3 and (x > 0) == (r > 0) for x in h)
        tiles.append(
            {
                "label": "Stabil",
                "value": "ja" if ok else "nein",
                "icon": "overview",
                "sub": f"Hälften {de(h[0])} / {de(h[1])}",
                "info": {"what": t["p_stable_what"], "source": t["source"]},
            }
        )
    lag, rlag = int(res.get("versatz_h") or 0), res.get("r_versatz")
    if hours and lag and rlag is not None and abs(rlag) >= abs(rb or 0) + 0.05:
        # corr(a, b shifted by lag): lag < 0 -> b comes later than a
        lead, follow = (a, b) if lag < 0 else (b, a)
        tiles.append(
            {
                "label": "Versatz",
                "value": f"{abs(lag)}",
                "unit": "Std.",
                "icon": "clock",
                "sub": clean(f"{follow} folgt {lead} · Stärke {de(rlag)}", 120),
                "info": {"what": t["p_lag_what"], "source": t["source"]},
            }
        )
    out = [{"type": "tiles", "title": clean(f"{a} und {b}", 120), "tiles": tiles}]

    # in words: strength, direction, chance, what remains without the daily rhythm, a likely reason
    p = res.get("p")
    w = word(r)
    if w == "kein":
        s = f"Kein erkennbarer Gleichlauf (Stärke {de(r)})."
    else:
        adj = {"schwach": "Schwacher", "mittel": "Mittlerer", "deutlich": "Deutlicher", "stark": "Starker"}[w]
        s = (
            f"{adj} Gleichlauf: steigt {a}, {'steigt' if r > 0 else 'sinkt'} meist {'auch ' if r > 0 else ''}{b} "
            f"(Stärke {de(r)})."
        )
    if p is not None:
        s += (
            " Das ist kaum Zufall."
            if p < 0.01
            else " Wahrscheinlich kein Zufall."
            if p < 0.05
            else " Könnte Zufall sein."
        )
    if rb is not None and abs(r) >= 0.3:
        if abs(rb) < 0.3:
            s += (
                " Ohne Tagesgang bleibt wenig – beide folgen vor allem der Uhrzeit."
                if hours
                else " Ohne Saison bleibt wenig – beide folgen vor allem der Jahreszeit."
            )
        elif (rb > 0) == (r > 0):
            s += f" Auch ohne {'Tagesgang' if hours else 'Saison'} bleibt er ({de(rb)})."
    if res.get("warum") and max(abs(r), abs(rb or 0)) >= 0.3:
        s += f" Vermutlich: {res['warum']}"
    if n < int(res.get("min_ueberlappung") or 0):
        s += " Wenig gemeinsame Daten – das Ergebnis ist unsicher."
    s += f" {t['p_cause']}"
    out.append({"type": "text", "title": "In Worten", "text": clean(s, 600), "note": t["p_level_note"]})

    stufen = [x for x in res.get("stufen") or [] if isinstance(x, dict) and x.get("b") is not None]
    if len(stufen) >= 2:
        ua, ub = res.get("einheit_a") or "", res.get("einheit_b") or ""
        nd = 0 if max(abs(x["b"]) for x in stufen) >= 100 else 1 if max(abs(x["b"]) for x in stufen) >= 10 else 2
        cnt = [int(x.get("n") or 0) for x in stufen]
        ns = f"je {min(cnt)} {unit}" if max(cnt) - min(cnt) <= 2 else f"{min(cnt)} bis {max(cnt)} {unit} je Gruppe"
        out.append(
            {
                "type": "bars",
                "title": clean(f"{b} je nach {a}", 120),
                "unit": clean(ub, 12),
                "labels": [
                    short(x["von"]) if short(x["von"]) == short(x["bis"]) else f"{short(x['von'])}–{short(x['bis'])}"
                    for x in stufen
                ],
                "values": [round(float(x["b"]), nd) for x in stufen],
                "color": "home",
                "note": clean(
                    f"{a}{f' ({ua})' if ua else ''} in {len(stufen)} Gruppen ({ns}), Balken: {b} im Mittel", 200
                ),
            }
        )
    v = res.get("verlauf") or {}
    x = v.get("x") or []
    if len(x) >= 2 and len(v.get("a") or []) == len(x) and len(v.get("b") or []) == len(x):
        out.append(
            {
                "type": "series",
                "title": "Verlauf" + (" (Tagesmittel)" if hours else ""),
                "unit": "relativ",
                "x": x,
                "lines": [
                    {"label": clean(a, 40), "values": v["a"], "color": "home"},
                    {"label": clean(b, 40), "values": v["b"], "color": "sun"},
                ],
                "note": t["p_series_note"],
            }
        )
    return out
