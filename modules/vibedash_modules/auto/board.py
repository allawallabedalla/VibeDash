"""Board of the module "auto": the car's state of charge, when to plug in, the course without charging, sun for
the car, driving profile, charges seen by the car, model accuracy and the car's own data. Only reads.

Input: one forecast file (config "prognose") the house writes every 15 min – {jetzt, meldung, soc_jetzt,
soc_meldung, kap_kwh, geladen_seit_meldung_kwh, wirkungsgrad, status{…}, vorhersage{…}, entscheidung{…}, profil{…},
sonne[…], ladungen[…], rueckblick{…}}. Field meanings: see the house's car forecast (step 2 of BL-257 moves it
here). Sections carry "slot" so the charging page can place them (top / plan / rest at the end).
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

TZ = ZoneInfo("Europe/Berlin")
WT_LANG = {"Mon": "Mo", "Tue": "Di", "Wed": "Mi", "Thu": "Do", "Fri": "Fr", "Sat": "Sa", "Sun": "So"}
# Audit04 DA-16/EM-19: "Failure" ist ein Fehler, kein „aus“
VORKLIMA = {"Enabled": "läuft", "Disabled": "aus", "Failure": "Fehler gemeldet"}
LADE = {
    "Disconnected": "nicht angesteckt",
    "InProgress": "lädt",
    "Finished": "fertig",
    "Stopped": "gestoppt",
    "Failure": "Fehler",
}

# wording that names the maker's account/app or house details – overridden per house via "texte"
TEXT = {
    "keine_daten": "Noch keine Daten vom Auto – der Abruf läuft alle 15 Minuten.",
    "konto": "Hersteller-Konto",
    "app": "Hersteller-App",
    "verlauf": "Verlauf in der Datenbank.",
    "wallbox_zaehler": "Wallbox-Zähler (OCPP).",
}


def de(x, nd=0):
    return "–" if x is None else f"{x:.{nd}f}".replace(".", ",")


def alter(sek):
    if sek is None:
        return "–"
    m = int(sek // 60)
    if m < 60:
        return f"vor {max(1, m)} min"
    h = m // 60
    return f"vor {h} h" if h < 48 else f"vor {h // 24} Tagen"


def ms_tag(iso):
    d = date.fromisoformat(iso)
    return int(datetime(d.year, d.month, d.day, 18, tzinfo=TZ).timestamp() * 1000)  # Tagesende-Wert um 18 Uhr


def build(p, jetzt, t, calc=None):
    """Board from the car forecast file p (see module docstring); calc: optional calculator section, shown right
    after "Jetzt"; t: texts (TEXT + config overrides)."""
    if not p:
        return {"updated": int(jetzt * 1000), "sections": [{"type": "text", "title": "Auto", "text": t["keine_daten"]}]}

    st = p.get("status") or {}
    meld = p.get("meldung")
    t_meld = datetime.fromisoformat(meld.replace("Z", "+00:00")).timestamp() if meld else None
    vh = p.get("vorhersage") or {}
    ent = p.get("entscheidung") or {}
    prof = p.get("profil") or {}
    eta = p.get("wirkungsgrad") or {}
    rb = p.get("rueckblick") or {}
    kap = p.get("kap_kwh")
    geladen = p.get("geladen_seit_meldung_kwh") or 0
    n_tage = prof.get("tage_n") or 0
    sections = []

    # ── Ansage ──────────────────────────────────────────────────────────────────────────────────────────────────
    tb = vh.get("tage_bis_reserve") or {}
    tiles = [
        {
            "label": "Anstecken?",
            "value": ent.get("wort") or "–",
            "sub": ent.get("kurz") or ent.get("text") or "",
            "icon": "bolt",
            **({"state": ent["stufe"]} if ent.get("stufe") else {}),
            "info": {
                "what": f"{ent.get('text') or ''} – Gerechnet nach dem frühen Fall (10 % der Durchläufe fahren mehr): "
                f"Wann fällt der Ladestand ohne "
                f"Laden unter {de(vh.get('reserve_pct'))} %, und lädt die Sonne vorher genug "
                f"(Planer, schlechtester Wetterfall)? Fahrprofil aus {n_tage} Tagen.",
                "source": f"Fahrten aus dem {t['konto']}, Wallbox-Zähler, Ladeplaner (plan.json); "
                f"{vh.get('szenarien', '–')} Durchläufe je 15 min.",
            },
        },
        {
            "label": "Ladestand",
            "value": de(p.get("soc_jetzt")),
            "unit": "%",
            "color": "battery",
            "icon": "battery",
            **(
                {"spark": sv["werte"], "sparkFrom": sv["von"], "sparkTo": sv["bis"]}
                if (sv := p.get("soc_verlauf")) and sv.get("werte")
                else {}
            ),
            "approx": geladen > 0.05,
            "sub": (
                f"Auto meldete {de(p.get('soc_meldung'))} % {alter(jetzt - t_meld) if t_meld else ''}"
                + (f" · + {de(geladen, 1)} kWh Wallbox" if geladen > 0.05 else "")
            ),
            "info": {
                "what": "Letzte Meldung des Autos plus das, was die Wallbox seitdem geladen hat (× Ladewirkungsgrad "
                f"{de(eta.get('wert'), 2)}, {'gemessen' if eta.get('quelle') == 'gemessen' else 'angenommen'}"
                f", n = {eta.get('n', 0)}). Fahrten seit der Meldung kennt das Haus erst bei der nächsten "
                "Meldung.",
                "source": t["konto"] + " (Auto meldet nur bei Fahrt/Ladung) + Wallbox-Zähler (OCPP).",
            },
        },
        {
            "label": "Reichweite",
            "value": de(st.get("reichweite_km")),
            "unit": "km",
            "icon": "plugCar",
            "sub": "laut Auto, bei der Meldung",
            "info": {
                "what": "Restreichweite, die das Auto selbst schätzt (aus seinem Fahrstil der letzten Zeit).",
                "source": t["konto"] + ".",
            },
        },
    ]
    if tb:
        heute = datetime.fromtimestamp(jetzt, TZ).date()

        def tw(k):
            if k >= 14:
                return "über 2 Wo."
            d = heute + timedelta(k)
            return (
                ["heute", "morgen", "übermorgen"][k]
                if k < 3
                else f"{['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'][d.weekday()]} {d.day}.{d.month}."
            )

        tiles.append(
            {
                "label": f"Unter {de(vh.get('reserve_pct'))} %",
                "value": tw(tb.get("frueh", 0)),
                "icon": "calendar",
                "sub": f"frühestens · eher {tw(tb.get('mitte', 0))}, spätestens {tw(tb.get('spaet', 0))}",
                "info": {
                    "what": "Ohne Laden: frühester (10 %), mittlerer (50 %) und später (90 %) Tag, "
                    "an dem der Ladestand "
                    f"unter die Reserve fällt. Fahrprofil aus {n_tage} Tagen; nimmt an, dass Tage unabhängig "
                    "sind – eine Woche mit Langstrecke kann früher kommen.",
                    "source": "auto_prognose.py (Monte-Carlo über frühere Tage desselben Wochentags).",
                },
            }
        )
    lade = LADE.get(st.get("lade_status"), st.get("lade_status") or "–")
    tiles.append(
        {
            "label": "Ladekabel",
            "value": "steckt" if st.get("angesteckt") else "nicht",
            "icon": "bolt",
            "sub": lade
            + (
                f" · noch ≈ {st['restzeit_min'] // 60} h {st['restzeit_min'] % 60} min"
                if st.get("lade_status") == "InProgress" and st.get("restzeit_min")
                else ""
            ),
            "info": {
                "what": "Stand der letzten Meldung des Autos (Restzeit nur, solange es lädt).",
                "source": t["konto"] + ".",
            },
        }
    )
    sections.append(
        {
            "type": "tiles",
            "title": "Jetzt",
            "tiles": tiles,
            "slot": "top",
            "note": f"Letzte Meldung des Autos {alter(jetzt - t_meld) if t_meld else '–'}.",
        }
    )
    if calc:
        sections.append({**calc, "slot": "plan"})
    # Rechner „Anstecken um“ (19.10.2026): nur rechnen, siehe vibedash_auto_rechner.py
    try:
        import vibedash_auto_rechner

        sections.append(vibedash_auto_rechner.abschnitt())
    except Exception:
        pass

    # ── Ladestand ohne Laden ────────────────────────────────────────────────────────────────────────────────────
    if vh.get("tage"):
        # 8 Tage: die Legende nennt den Endwert, nach 14 Tagen stand dort nur noch „0,0 %“ (Audit04 EM-11/ST-06)
        TAGE = 8
        x = [ms_tag(t) for t in vh["tage"][:TAGE]]
        sections.append(
            {
                "type": "series",
                "title": "Ladestand ohne Laden",
                "unit": "%",
                "x": x,
                "slot": "plan",
                "lines": [
                    {"label": "Mitte", "values": vh["soc_p50"][:TAGE], "color": "battery"},
                    {
                        "label": "Viel gefahren (10 %)",
                        "values": vh["soc_p10"][:TAGE],
                        "color": "import",
                        "dashed": True,
                    },
                    {
                        "label": "Wenig gefahren (90 %)",
                        "values": vh["soc_p90"][:TAGE],
                        "color": "climate",
                        "dashed": True,
                    },
                    {"label": "Reserve", "values": [vh.get("reserve_pct")] * len(x), "color": "grid", "dashed": True},
                ],
                "note": f"Je Tagesende, wenn nicht geladen wird · {vh.get('szenarien')} Durchläufe aus {n_tage} Tagen.",
                "info": {
                    "what": "Jeder Durchlauf zieht für jeden kommenden Tag einen früheren Tag desselben Wochentags "
                    "(bei weniger als 4 solchen Tagen: irgendeinen). Die Linien sind 10-, 50- und 90-%-Werte.",
                    "source": f"auto_prognose.py aus den Fahrten im {t['konto']}.",
                },
            }
        )

    # ── Sonne fürs Auto ─────────────────────────────────────────────────────────────────────────────────────────
    sonne = p.get("sonne") or []
    if sonne:

        def lab(s):
            return ["Heute", "Morgen", "Überm."][s["k"]] if s["k"] < 3 else s["tag"][8:10] + "." + s["tag"][5:7] + "."

        sections.append(
            {
                "type": "bars",
                "title": "Sonne fürs Auto (kWh, wenn angesteckt)",
                "unit": "kWh",
                "slot": "plan",
                "labels": [lab(s) for s in sonne],
                "values": [s.get("kwh") for s in sonne],
                "color": "sun",
                "note": " · ".join(
                    f"{lab(s)}{' ab ' + s['start'] if s.get('start') else ''}: vorsichtig {de(s.get('kwh'))} kWh, "
                    f"bei gutem Wetter bis {de(s.get('kwh_p90'))}"
                    for s in sonne
                    if (s.get("kwh_p90") or 0) > 0
                )
                or "Die nächsten Tage bleibt keine Sonne fürs Auto übrig.",
                "info": {
                    "what": "Was der Ladeplaner ohne Netzstrom ins Auto laden würde. „Vorsichtig“ = auch im "
                    "schlechtesten von etwa 30 Wetterfällen, „bei gutem Wetter“ = 90-%-Wert. Nur, wenn das Auto "
                    "dann steckt.",
                    "source": "auto_planer.py (plan.json, PV-Prognose je Dachfläche, 300 Szenarien).",
                },
            }
        )

    # ── Fahrprofil ──────────────────────────────────────────────────────────────────────────────────────────────
    je = prof.get("je_wt") or []
    if je:
        sections.append(
            {
                "type": "bars",
                "title": "Fahrprofil je Wochentag",
                "unit": "kWh",
                "labels": [w["wt"] for w in je],
                "values": [w.get("mittel") for w in je],
                "color": "home",
                "note": f"Mittel je Tag aus {n_tage} Tagen, n = "
                + (
                    f"{je[0]['n']}"
                    if len({w["n"] for w in je}) == 1
                    else f"{min(w['n'] for w in je)}–{max(w['n'] for w in je)}"
                )
                + " je Wochentag.",
                "info": {
                    "what": "Energie, die das Auto je Kalendertag verbraucht hat (Ladestand-Abfall der Fahrten × "
                    f"{de(kap, 1)} kWh nutzbare Kapazität). 10–90-%-Spanne je Tag: "
                    + " · ".join(f"{w['wt']} {de(w.get('p10'), 1)}–{de(w.get('p90'), 1)} (n {w['n']})" for w in je),
                    "source": f"{prof.get('fahrten_n')} Fahrten seit {prof.get('erster_tag')} ({t['konto']}).",
                },
            }
        )
    # Kilometer je Woche und Ladungen: ein Schalter (8 Wochen / alles) – Nutzer 16.10.2026
    alle_wochen = [w for w in prof.get("wochen") or [] if w.get("tage") == 7]

    def km_bars(ws):
        return {
            "labels": [f"KW{date.fromisoformat(w['montag']).isocalendar()[1]}" for w in ws],
            "values": [w.get("km") for w in ws],
        }

    if alle_wochen:
        wochen = alle_wochen[-8:]
        sections.append(
            {
                "type": "bars",
                "title": "Kilometer je Woche",
                "unit": "km",
                **km_bars(wochen),
                "color": "home",
                "group": "fahrten",
                "ranges": [
                    {"id": "8w", "label": "8 Wochen", **km_bars(wochen)},
                    {"id": "alle", "label": "Alles", **km_bars(alle_wochen[-26:])},
                ],
                "note": (
                    f"Verbrauch letzte Woche {de(100 * wochen[-1]['kwh'] / wochen[-1]['km'], 1)} kWh/100 km."
                    if wochen[-1].get("km", 0) >= 30
                    else "Volle Wochen ab Montag."
                ),
                "info": {
                    "what": "Gefahrene Kilometer je voller Kalenderwoche. Verbrauch je Woche (ab 30 km): "
                    + " · ".join(
                        f"KW{date.fromisoformat(w['montag']).isocalendar()[1]} "
                        f"{de(100 * w['kwh'] / w['km'], 1) if w.get('km', 0) >= 30 else '–'}"
                        for w in alle_wochen[-12:]
                    )
                    + " kWh/100 km.",
                    "source": f"Fahrten im {t['konto']}.",
                },
            }
        )

    # ── Ladungen ────────────────────────────────────────────────────────────────────────────────────────────────
    alle_lad = p.get("ladungen") or []
    if alle_lad:

        def lt(ts):
            d = datetime.fromtimestamp(ts, TZ)
            return f"{d.day}.{d.month}"

        def lad_bars(ls):
            return {"labels": [lt(x["bis"]) for x in ls], "values": [x.get("kwh") for x in ls]}

        lad = alle_lad[-8:]
        sections.append(
            {
                "type": "bars",
                "title": "Im Autoakku angekommen",
                "unit": "kWh",
                **lad_bars(lad),
                "color": "battery",
                "group": "fahrten",
                "ranges": [
                    {
                        "id": "8w",
                        "label": "8 Wochen",
                        **lad_bars([x for x in alle_lad if x["bis"] >= jetzt - 56 * 86400]),
                    },
                    {"id": "alle", "label": "Alles", **lad_bars(alle_lad[-40:])},
                ],
                "note": f"Zuletzt {lt(lad[-1]['bis'])}: {de(lad[-1]['von'])} → {de(lad[-1]['auf'])} %.",
                "info": {
                    "what": "Ladestand-Sprung zwischen zwei Fahrten × Kapazität = was im Akku ankam "
                    "(ohne Ladeverlust). Datum = nächste Meldung des Autos, nicht der Ladetag – darum passt es "
                    "nicht Tag für Tag zu „An der Wallbox geladen“. Fremdladungen sähen gleich aus. "
                    + " · ".join(f"{lt(x['bis'])} {de(x['von'])}→{de(x['auf'])} %" for x in lad),
                    "source": f"Fahrten im {t['konto']}.",
                },
            }
        )

    # ── Treffsicherheit ─────────────────────────────────────────────────────────────────────────────────────────
    if rb.get("n"):
        sections.append(
            {
                "type": "accuracy",
                "title": "Treffsicherheit",
                "models": [
                    {
                        "label": "Tagesverbrauch Auto",
                        "pct": rb.get("quote_pct"),
                        "n": rb["n"],
                        "history": [],
                        # a band model: „band held“, target 8 of 10 – more is not better (Audit04 ST-12)
                        "note": (
                            f"Band hielt an {rb['im_band']} von {rb['n']} Tagen (Ziel 8 von 10). "
                            f"Mittlerer Fehler {de(rb.get('fehler_kwh'), 2)} kWh/Tag, einfacher Mittelwert "
                            f"{de(rb.get('fehler_naiv_kwh'), 2)}"
                            + (
                                " – kaum besser."
                                if (rb.get("fehler_naiv_kwh") or 0) - (rb.get("fehler_kwh") or 0) < 0.1
                                else "."
                            )
                        ),
                        "details": [
                            {"label": "Bewertet", "value": "nachgerechnet (nur aus Vortagen)"},
                            {"label": "Seit", "value": prof.get("erster_tag") or "–"},
                        ],
                    }
                ],
                "note": "Jeder frühere Tag wurde nur aus den Tagen davor vorhergesagt.",
                "info": {
                    "what": "Rückblick: Wie gut sagt das Fahrprofil den Verbrauch eines Tages voraus?",
                    "source": "auto_prognose.py (rueckblick).",
                },
            }
        )

    # ── Auto ────────────────────────────────────────────────────────────────────────────────────────────────────
    autot = [
        {
            "label": "Verbrauch",
            "value": de(prof.get("kwh_100km"), 1),
            "unit": "kWh/100 km",
            "icon": "bolt",
            "sub": f"{de(prof.get('km_tag'))} km am Tag im Mittel",
            "info": {
                "what": f"Akku-Abfall aller Fahrten ÷ Kilometer, {n_tage} Tage (ohne Ladeverlust).",
                "source": f"Fahrten im {t['konto']}.",
            },
        },
        {
            "label": "Kilometerstand",
            "value": de(st.get("km_stand")),
            "unit": "km",
            "icon": "plugCar",
            "sub": f"Wartung in {st['wartung_tage']} Tagen" if st.get("wartung_tage") is not None else "",
            "info": {"what": "Kilometerstand und Tage bis zur nächsten Wartung laut Auto.", "source": t["konto"] + "."},
        },
        {
            "label": "Akku-Zustand",
            "value": de(st.get("gesundheit_kap_pct")),
            "unit": "%",
            "icon": "battery",
            "color": "battery",
            "sub": f"Innenwiderstand {de(st.get('gesundheit_widerstand_pct'))} % · nutzbar {de(kap, 1)} kWh",
            "info": {
                "what": "Kapazität und Innenwiderstand im Vergleich zu neu (100 %), wie das Auto sie meldet.",
                "source": t["konto"] + "; " + t["verlauf"],
            },
        },
        {
            "label": "Ladewirkungsgrad",
            "value": de(100 * (eta.get("wert") or 0)),
            "unit": "%",
            "icon": "bolt",
            "approx": eta.get("quelle") != "gemessen",
            # „angenommen · gemessen 92 / 87 % (n = 2)“ statt „erst 2 von 3 gemessen“ (Audit04 EM-14)
            "sub": (
                f"gemessen, n = {eta['n']} ({de(100 * eta['min'])}–{de(100 * eta['max'])} %)"
                if eta.get("quelle") == "gemessen"
                else "angenommen"
                + (
                    f" · gemessen {' / '.join(de(100 * w) for w in eta['werte'])} % (n = {len(eta['werte'])})"
                    if eta.get("werte")
                    else " · noch keine Messung"
                )
            )
            + (f", {eta['verworfen']} unplausibel verworfen" if eta.get("verworfen") else ""),
            "info": {
                "what": "Was von den Wallbox-kWh im Autoakku ankommt (Ladestand-Sprung ÷ Wallbox-Zähler). "
                "Gemessen wird ab 3 brauchbaren Ladungen; Werte unter 60 % oder über 105 % (fremde Ladung, "
                "Messfehler) werden verworfen.",
                "source": f"Fahrten im {t['konto']} + " + t["wallbox_zaehler"],
            },
        },
        {
            "label": "Außen",
            "value": de(st.get("aussen_c"), 1),
            "unit": "°C",
            "icon": "thermometer",
            "sub": "am Auto, bei der Meldung",
            "info": {"what": "Außentemperatur, die das Auto gemessen hat.", "source": t["konto"] + "."},
        },
        {
            "label": "12-V-Batterie",
            "value": de(st.get("batterie_12v")),
            "icon": "battery",
            "sub": "Wert laut Auto (vermutlich %)",
            "info": {
                "what": "Ladezustand der kleinen Bordbatterie. Die Schnittstelle nennt es „voltage“, der Wert "
                "(100) passt aber eher zu Prozent – Einheit unsicher.",
                "source": t["konto"] + ".",
            },
        },
        {
            "label": "Alarm",
            "value": {"Active": "scharf", "Inactive": "aus"}.get(st.get("alarm"), st.get("alarm") or "–"),
            "icon": "target",
            "sub": f"Zündung {'aus' if st.get('zuendung') == 'Stop' else (st.get('zuendung') or '–')}",
            "info": {"what": "Alarmanlage und Zündung bei der letzten Meldung.", "source": t["konto"] + "."},
        },
    ]
    sections.append({"type": "tiles", "title": "Auto", "tiles": autot})

    prg = st.get("vorklima_programme") or []
    if prg:
        items = []
        for g in prg:
            m = g.get("start_min")
            uhr = f"{m // 60:02d}:{m % 60:02d}" if m is not None else "–"
            items.append(
                {
                    "text": f"{uhr} Uhr · {' '.join(WT_LANG.get(t, t) for t in g.get('tage') or [])}",
                    "meta": "an" if g.get("an") else "aus",
                }
            )
        sections.append(
            {
                "type": "list",
                "title": "Vorklimatisierung",
                "items": items,
                "note": f"Jetzt: {VORKLIMA.get(st.get('vorklima'), 'aus')}. Programme stellst "
                f"du in der {t['app']} ein.",
                "info": {"what": "Zeitpläne der Vorklimatisierung im Auto (nur anzeigen).", "source": t["konto"] + "."},
            }
        )
    return {"updated": int(p.get("jetzt", jetzt) * 1000), "sections": sections}
