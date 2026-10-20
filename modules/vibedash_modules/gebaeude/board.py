"""Board of the module "gebaeude": what the measurements say about the building – cooling down, heat storage,
sun gain, heat pump efficiency per degree, hot water in the PV time, tilted window, front door – each with its
range and n, the levers that follow, heat pump and hot water per time of day, sun per room, PV forecast per weather.

Pure function over the result of the daily analysis (a JSON file, see README "Module gebaeude"):

  build(result, stand_ms, t)

Each part of the result has "status" ("ok", "sammelt" = still collecting, "fehler") and a "text" (method, shown
behind ⓘ). Parts that are not "ok" show as "collecting" or are left out.
"""

from __future__ import annotations

import re

PUA = re.compile(r"[-]")

TEXT = {
    "none_title": "Noch kein Ergebnis",
    "none_text": "Die tägliche Gebäude-Auswertung hat noch nichts geschrieben.",
    "source": "tägliche Gebäude-Auswertung",
    "collecting": "sammelt Daten",
    "t_cool": "Auskühlen",
    "t_cool_sub": "Auskühlzeit, {lo}–{hi} h · {k} K je Nacht ohne Heizung",
    "t_store": "Speicher",
    "t_store_sub": "geschätzt, nicht gemessen ({lo}–{hi}) · n {n} Nächte",
    "t_sun": "Sonne",
    "t_sun_sub": "wirkt wie wärmer, je kWh/m² ({lo}–{hi})",
    "t_sun_what": "So viel wärmere Außenluft ersetzt 1 kWh/m² Sonnenstrahlung beim Heizbedarf "
    "(Ventil-Offenstunden je Tag ~ Heizgradtag + Strahlungssumme, n Tage {n}). Klarer Oktobertag ≈ 3 kWh/m².",
    "t_cop": "WP je Grad wärmer",
    "t_cop_unit": "COP",
    "t_cop_sub": "wahrscheinlich {lo} bis {hi} · erst {n} Tage",
    "t_water": "Wasser",
    "t_water_sub": "Warmwasser in der PV-Zeit · {n} Läufe",
    "t_tilt": "Kippfenster",
    "t_tilt_sub": "Wärme je Nacht ({lo}–{hi})",
    "tiles_title": "Gebäude in Zahlen",
    "lever_water": "Warmwasser mittags laden: {pct} % der Läufe außerhalb der PV-Zeit (meist {h1} und {h2} Uhr, ≈ "
    "{kwh} kWh je Lauf). Warmwasser-Zeit an der Wärmepumpe auf 11–15 Uhr prüfen.",
    "lever_heat": "Noch offen: Heizen mittags könnte Strom sparen (grob ≈ {kwh} kWh/Woche), weil die Wärmepumpe bei "
    "wärmerer Luft effizienter ist. Belastbar erst mit Winterdaten – bisher {n} Tage.",
    "find_cool": "Das Haus hält Wärme lange: ohne Heizung kühlt es nachts nur ≈ {k} K ab (Auskühlzeit ≈ {tau} h, eher "
    "etwas zu lang gemessen). Nachtabsenkung bringt darum wenig.",
    "find_tilt": "Schlafzimmer (Fenster nachts gekippt) kühlt {pct} % ± {se} % schneller ab als die übrigen Räume, "
    "≈ {kwh} kWh Wärme je Nacht. Ob das am Fenster liegt, ist offen: es gibt keine Nächte mit zu.",
    "find_door": "Haustür öffnen: Flur {k} ± {se} K nach 30 min (n {n}) – kein messbarer Effekt.",
    "pv_old": "Alte PV-Tagesprognose lag an klaren Tagen {bias} ± {se} kWh daneben (n {n}). Das neue Stundenmodell ",
    "pv_new_ok": "wird ausgewertet.",
    "pv_new_collect": "sammelt ({n} von 20 Tagen).",
    "m_lever": "Hebel",
    "m_estimate": "Abschätzung",
    "m_finding": "Befund",
    "m_forecast": "Prognose",
    "levers_title": "Was das heißt",
    "levers_what": "Hebel = Einstellung, die Netzstrom spart; Befund = Wissen über das Haus.",
    "wp_title": "Wärmepumpe je Tageszeit",
    "wp_note": "Ø {kwh} kWh/Tag, {mid} % mittags 11–15 Uhr; Netzanteil nachts ≈ {grid_r} %, mittags ≈ {grid_m} %.",
    "ww_title": "Warmwasser-Läufe je Tageszeit",
    "ww_note_ok": "Duschen (Bad-Feuchte): {n} erkannt, Median {min} min bis zum nächsten Lauf",
    "ww_note_collect": "Duschen (Bad-Feuchte): sammelt ({n} erkannt, Feuchte seit {days} Tagen)",
    "sun_title": "Sonne je Raum",
    "sun_room": "Raum",
    "sun_k": "K/klarer Tag",
    "sun_measurable": "messbar",
    "yes": "ja",
    "odd": "fraglich",
    "no": "nein",
    "sun_note": "Meist im Rauschen: die Fußbodenheizung puffert stark. „fraglich“ = messbar, aber kühler bei Sonne – "
    "bei 8 Räumen ist ein Zufallstreffer zu erwarten.",
    "pv_title": "PV-Prognose je Wetterlage",
    "pv_weather": "Wetterlage",
    "pv_dev": "Abweichung",
    "pv_days": "Tage",
    "pv_note": "Alte Tagesprognose {von}–{bis}; − = zu niedrig.",
}


def clean(x, max_len=400) -> str:
    """Text without icon glyphs and double spaces."""
    if x is None:
        return ""
    s = PUA.sub("", str(x))
    s = re.sub(r"[ \t]+", " ", s).strip()
    return s[:max_len]


def de(x, nd=1, plus=False) -> str:
    if x is None:
        return "–"
    s = f"{x:+.{nd}f}" if plus else f"{x:.{nd}f}"
    return s.replace(".", ",").replace("-", "−")


def t95(df) -> float:
    """Student t for a two-sided 95 % range (small n)."""
    table = {1: 12.71, 2: 4.30, 3: 3.18, 4: 2.78, 5: 2.57, 6: 2.45, 7: 2.36, 8: 2.31, 9: 2.26, 10: 2.23}
    return table.get(df, 2.0) if df >= 1 else float("inf")


def _ok(b) -> bool:
    return isinstance(b, dict) and b.get("status") == "ok"


def blocks(values, n=3):
    """24 hourly values -> 8 blocks of 3 h (readable on a phone)."""
    return (
        [f"{i}–{i + n}" for i in range(0, 24, n)],
        [round(sum(v or 0 for v in values[i : i + n]), 2) for i in range(0, 24, n)],
    )


def empty(t: dict, now_ms: int) -> dict:
    return {"updated": now_ms, "sections": [{"type": "text", "title": t["none_title"], "text": t["none_text"]}]}


def build(result: dict, stand_ms: int, t: dict) -> dict:
    a, s, w, ww, pv, k, door = (
        result.get(x) or {}
        for x in ("auskuehlen", "sonne", "wp_tageszeit", "warmwasser", "pv_prognose", "kippfenster", "haustuer")
    )

    def info(b, part=None):
        return {"what": clean(b.get("text") or "", 600), "source": t["source"] + (f" ({part})" if part else "")}

    def collecting(b):
        return clean(b.get("text") or t["collecting"], 60)

    tiles = []
    if _ok(a):
        tiles.append(
            {
                "label": t["t_cool"],
                "value": f"{a['tau_h']}",
                "unit": "h",
                "icon": "clock",
                "color": "climate",
                "sub": t["t_cool_sub"].format(lo=a["tau_lo"], hi=a["tau_hi"], k=de(-a["nacht_k"], 2)),
                "info": info(a),
            }
        )
        tiles.append(
            {
                "label": t["t_store"],
                "value": de(a["c_kwh_k"], 0),
                "unit": "kWh/K",
                "icon": "battery",
                "color": "climate",
                "sub": t["t_store_sub"].format(lo=de(a["c_lo"], 0), hi=de(a["c_hi"], 0), n=a["n_naechte"]),
                "info": info(a),
            }
        )
    else:
        tiles.append({"label": t["t_cool"], "value": "–", "icon": "clock", "sub": collecting(a)})
    h = (s.get("haus") or {}) if _ok(s) else {}
    tiles.append(
        {
            "label": t["t_sun"],
            "value": de(h.get("aequiv_k")),
            "unit": "K",
            "icon": "sun",
            "color": "sun",
            "sub": t["t_sun_sub"].format(lo=de(h.get("lo")), hi=de(h.get("hi"))) if h else collecting(s),
            "info": {"what": t["t_sun_what"].format(n=h.get("n_tage", "–")), "source": t["source"] + " (sonne)"},
        }
    )
    if w.get("cop_je_k") is not None:
        tiles.append(
            {
                "label": t["t_cop"],
                "value": de(w["cop_je_k"], 2, plus=True),
                "unit": t["t_cop_unit"],
                "icon": "bolt",
                "color": "home",
                # 95 % range from the standard error with n − 2 degrees of freedom (Audit04 ST-08)
                "sub": t["t_cop_sub"].format(
                    lo=de(w["cop_je_k"] - t95(w["cop_n"] - 2) * w["cop_je_k_se"], 2, plus=True),
                    hi=de(w["cop_je_k"] + t95(w["cop_n"] - 2) * w["cop_je_k_se"], 2, plus=True),
                    n=w["cop_n"],
                ),
                "info": info(w),
            }
        )
    if ww.get("anteil_pv_zeit") is not None:
        pv_pct = round(100 * ww["anteil_pv_zeit"])
        tiles.append(
            {
                "label": t["t_water"],
                "value": f"{pv_pct}",
                "unit": "%",
                "icon": "droplet",
                "state": "look" if pv_pct < 30 else "ok",
                "sub": t["t_water_sub"].format(n=ww["laeufe"]),
                "info": info(ww),
            }
        )
    if _ok(k) and k.get("kwh_nacht") is not None:
        tiles.append(
            {
                "label": t["t_tilt"],
                "value": f"≈ {de(k['kwh_nacht'])}",
                "unit": "kWh",
                "icon": "moon",
                "sub": t["t_tilt_sub"].format(lo=de(k["kwh_lo"]), hi=de(k["kwh_hi"])),
                "info": info(k),
            }
        )
    sections = [{"type": "tiles", "title": t["tiles_title"], "tiles": tiles[:8]}]

    levers = []
    if ww.get("anteil_pv_zeit") is not None:
        peaks = sorted(range(24), key=lambda i: -ww["je_stunde"][i])[:2]
        levers.append(
            {
                "text": clean(
                    t["lever_water"].format(
                        pct=round(100 * (1 - ww["anteil_pv_zeit"])),
                        h1=peaks[0],
                        h2=peaks[1],
                        kwh=de(ww.get("kwh_lauf")),
                    ),
                    200,
                ),
                "meta": t["m_lever"],
                "state": "look",
            }
        )
    if _ok(w) and w.get("szenario_kwh_tag") is not None:
        levers.append(
            {
                "text": clean(
                    # the COP line from a few autumn days, stretched to midday air: an open question, not a lever
                    # (Audit04 EN-06/ST-08)
                    t["lever_heat"].format(kwh=de(w["strom_weniger_kwh_woche"]), n=w.get("cop_n", "–")),
                    200,
                ),
                "meta": t["m_estimate"],
            }
        )
    if _ok(a):
        levers.append(
            {"text": clean(t["find_cool"].format(tau=a["tau_h"], k=de(-a["nacht_k"], 2)), 200), "meta": t["m_finding"]}
        )
    if _ok(k):
        levers.append(
            {
                "text": clean(
                    t["find_tilt"].format(
                        pct=round(k.get("mehr_pct") or 0),
                        se=round(k.get("mehr_se_pct") or 0),
                        kwh=de(k.get("kwh_nacht")),
                    ),
                    200,
                ),
                "meta": t["m_finding"],
            }
        )
    if _ok(door):
        levers.append(
            {
                "text": clean(
                    t["find_door"].format(k=de(door["effekt_k"], 2, plus=True), se=de(door["se_k"], 2), n=door["n"]),
                    200,
                ),
                "meta": t["m_finding"],
            }
        )
    old = (pv.get("alt") or {}) if isinstance(pv, dict) else {}
    if _ok(old):
        clear = next((x for x in old["lagen"] if x["lage"] == "klar"), None)
        hm = pv.get("stundenmodell") or {}
        if clear:
            levers.append(
                {
                    "text": clean(
                        t["pv_old"].format(bias=de(clear["bias"], 1, plus=True), se=de(clear["bias_se"]), n=clear["n"])
                        + (t["pv_new_ok"] if _ok(hm) else t["pv_new_collect"].format(n=hm.get("n", 0))),
                        200,
                    ),
                    "meta": t["m_forecast"],
                }
            )
    sections.append(
        {
            "type": "list",
            "title": t["levers_title"],
            "items": levers,
            "info": {"what": t["levers_what"], "source": t["source"]},
        }
    )

    if w.get("wp_kwh_je_stunde"):
        lab, val = blocks(w["wp_kwh_je_stunde"])
        sections.append(
            {
                "type": "bars",
                "title": t["wp_title"],
                "unit": "kWh",
                "labels": lab,
                "values": val,
                "color": "home",
                "note": t["wp_note"].format(
                    kwh=de(w.get("wp_kwh_tag")),
                    mid=round(100 * (w.get("anteil_mittag") or 0)),
                    grid_r=round(100 * (w.get("netz_rest") or 0)),
                    grid_m=round(100 * (w.get("netz_mittag") or 0)),
                ),
                "info": info(w),
            }
        )
    if ww.get("je_stunde"):
        lab, val = blocks(ww["je_stunde"])
        sections.append(
            {
                "type": "bars",
                "title": t["ww_title"],
                "unit": "",
                "labels": lab,
                "values": [int(v) for v in val],
                "color": "sun",
                "note": t["ww_note_ok"].format(n=ww["duschen"], min=ww["abstand_min_median"])
                if ww.get("dusch_status") == "ok"
                else t["ww_note_collect"].format(n=ww.get("duschen", 0), days=ww.get("feuchte_tage", 0)),
                "info": info(ww),
            }
        )
    if _ok(s):
        sections.append(
            {
                "type": "table",
                "title": t["sun_title"],
                "columns": [
                    {"key": "r", "label": t["sun_room"]},
                    {"key": "k", "label": t["sun_k"], "align": "right"},
                    {"key": "m", "label": t["sun_measurable"]},
                ],
                "rows": [
                    {
                        "cells": {
                            "r": clean(x["raum"], 30),
                            "k": f"{de(x['klarer_tag_k'], 1, plus=True)} ± {de(3 * x['se'], 1)}",
                            # sun that cools is implausible – with 8 rooms one chance hit is expected (Audit04 ST-17)
                            "m": (t["odd"] if x["klarer_tag_k"] < 0 else t["yes"]) if x["messbar"] else t["no"],
                        }
                    }
                    for x in s["raeume"]
                ],
                "note": t["sun_note"],
                "info": info(s),
            }
        )
    if _ok(old):
        sections.append(
            {
                "type": "table",
                "title": t["pv_title"],
                "columns": [
                    {"key": "l", "label": t["pv_weather"]},
                    {"key": "b", "label": t["pv_dev"], "align": "right"},
                    {"key": "n", "label": t["pv_days"], "align": "right"},
                ],
                "rows": [
                    {
                        "cells": {
                            "l": x["lage"],
                            "b": f"{de(x['bias'], 1, plus=True)} ± {de(x['bias_se'])} kWh",
                            "n": str(x["n"]),
                        },
                        **(
                            {"state": "look"}
                            if abs(x["bias"]) > 2 * (x["bias_se"] or 99) and abs(x["bias"]) > 5
                            else {}
                        ),
                    }
                    for x in old["lagen"]
                ],
                "note": t["pv_note"].format(von=old["von"][:7], bis=old["bis"][:7]),
                "info": info(pv),
            }
        )
    return {"updated": stand_ms, "sections": sections}
