"""Driving forecast of the module "auto": does the car need the wallbox soon, or is there time? From the car's
trips (driving profile per weekday), its last report, the wallbox counter since then and the house's charge plan
(sun for the car). Only reads; switches nothing. Ported from the house script auto_prognose.py (numpy -> stdlib;
the Monte-Carlo draws differ, the rest is the same arithmetic).

Calculation:
  * driving profile = energy per calendar day from the trips (state-of-charge drop × capacity), per weekday
  * state of charge now = last report + wallbox kWh since then × charging efficiency (measured from earlier charges:
    jump ÷ wallbox kWh; until 3 are measured, 0.90 is assumed)
  * Monte-Carlo (2000 runs, 14 days): per day a random earlier day of the same weekday (fewer than 4 such days: any
    day); today only the rest of the day (share by hour from the trips) -> the day the charge falls below the reserve
    (early case = 10 % value)
  * look back (accuracy): each earlier day predicted only from the days before – how often was the real use in the
    10–90 % band
"""

from __future__ import annotations

import random
import time
from collections import defaultdict
from datetime import date, datetime, timedelta
from statistics import fmean, median
from zoneinfo import ZoneInfo

TZ = ZoneInfo("Europe/Berlin")
WT = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]

RESERVE_PCT = 20.0  # below: "charging needed" (≈ 60–80 km left)
ETA_ANNAHME = 0.90  # charging efficiency wallbox -> car battery until enough charges are measured
ETA_MIN_N = 3
KAP_ANNAHME = 52.8  # usable capacity if the report has none
HORIZONT = 14
SZEN = 2000
MIN_WT = 4  # this many days of the same weekday, else all days as pool
SONNE_MIN_KWH = 3.0  # planned charge from which a day counts as "sun day for the car"
BACKTEST_START = 14  # predict only from this many earlier days on


def epoch(iso):
    return int(datetime.fromisoformat(str(iso).replace("Z", "+00:00")).timestamp())


def lokal(ts):
    return datetime.fromtimestamp(ts, TZ)


def q(werte, p):
    """Quantile with linear interpolation (as numpy's default)."""
    xs = sorted(float(x) for x in werte)
    if not xs:
        return None
    pos = p * (len(xs) - 1)
    i = int(pos)
    if i + 1 >= len(xs):
        return xs[-1]
    return xs[i] + (xs[i + 1] - xs[i]) * (pos - i)


def r1(x):
    return None if x is None else round(float(x), 1)


# ── Fahrprofil ───────────────────────────────────────────────────────────────────────────────────────────────────
def tagesverbrauch(fahrten, kap, bis_tag):
    """{Datum: kWh} für jeden Kalendertag von der ersten Fahrt bis bis_tag (ausschließlich); Tage ohne Fahrt = 0."""
    kwh, km = defaultdict(float), defaultdict(float)
    for f in fahrten:
        d = lokal(f["start"]).date()
        if f.get("soc_start") is not None and f.get("soc_ende") is not None:
            # in seltenen Fällen steigt der Ladestand in der Fahrt (Rekuperation/Rundung): nicht negativ zählen
            kwh[d] += max(0.0, (f["soc_start"] - f["soc_ende"]) * kap / 100)
        km[d] += f.get("km") or 0
    if not fahrten:
        return {}, {}
    d0 = lokal(fahrten[0]["start"]).date()
    tage = [d0 + timedelta(i) for i in range((bis_tag - d0).days)]
    return {d: kwh.get(d, 0.0) for d in tage}, {d: km.get(d, 0.0) for d in tage}


def stundenanteil(fahrten, kap):
    """Anteil des Tagesverbrauchs je Stunde (0–23) aus den Fahrten, leicht geglättet."""
    h = [0.02] * 24
    for f in fahrten:
        if f.get("soc_start") is not None and f.get("soc_ende") is not None:
            h[lokal(f["start"]).hour] += max(0.0, (f["soc_start"] - f["soc_ende"]) * kap / 100)
    s = sum(h)
    return [x / s for x in h]


def vorrat(tage_kwh, wt, bis=None):
    """Frühere Tagesverbräuche für einen Wochentag (bei < MIN_WT gleichen Tagen: alle)."""
    alle = [(d, v) for d, v in tage_kwh.items() if bis is None or d < bis]
    gleich = [v for d, v in alle if d.weekday() == wt]
    return (gleich, True) if len(gleich) >= MIN_WT else ([v for _, v in alle], False)


def rueckblick(tage_kwh):
    """Jeden Tag nur aus den Vortagen vorhersagen: Anteil im 10–90-%-Band, mittlerer Fehler des Medians."""
    tage = sorted(tage_kwh)
    im, n, fehler, fehler_naiv = 0, 0, [], []
    for i, d in enumerate(tage):
        if i < BACKTEST_START:
            continue
        pool, _ = vorrat(tage_kwh, d.weekday(), bis=d)
        alle = [tage_kwh[x] for x in tage[:i]]
        if len(pool) < 3:
            continue
        lo, mi, hi = q(pool, 0.1), q(pool, 0.5), q(pool, 0.9)
        ist = tage_kwh[d]
        n += 1
        im += lo - 0.3 <= ist <= hi + 0.3  # ±0,3 kWh: Ladestand kommt in ganzen Prozent (≈ 0,5 kWh)
        fehler.append(abs(ist - mi))
        fehler_naiv.append(abs(ist - fmean(alle)))
    if not n:
        return {"n": 0}
    return {
        "n": n,
        "im_band": im,
        "quote_pct": round(100 * im / n),
        "fehler_kwh": round(fmean(fehler), 2),
        "fehler_naiv_kwh": round(fmean(fehler_naiv), 2),
    }


# ── Ladewirkungsgrad und Ladestand jetzt ─────────────────────────────────────────────────────────────────────────
def zaehler(c, ts):
    """Wallbox-Zählerstand (Wh) zuletzt vor ts, None wenn keine Daten (Punkte gibt es oft nur, solange die Wallbox
    lädt – dazwischen bleibt der Zähler stehen). c: quellen.Influx mit wallbox_zaehler()."""
    return c.wallbox_zaehler(ts)


def wirkungsgrad(c, fahrten, kap):
    """Ladestand-Sprung zwischen zwei Fahrten ÷ Wallbox-kWh in derselben Zeit (nur Lücken mit ≥ 5 Punkten Sprung)."""
    werte, verworfen = [], 0
    for a, b in zip(fahrten, fahrten[1:], strict=False):
        if a.get("soc_ende") is None or b.get("soc_start") is None or b["soc_start"] - a["soc_ende"] < 5:
            continue
        z1, z2 = zaehler(c, a["ende"]), zaehler(c, b["start"])
        if z1 is None or z2 is None or z2 - z1 < 1000:
            continue
        eta = (b["soc_start"] - a["soc_ende"]) * kap / 100 / ((z2 - z1) / 1000)
        if 0.6 <= eta <= 1.05:  # sonst lag eine fremde Ladung oder ein Messfehler dazwischen
            werte.append(round(eta, 3))
        else:
            verworfen += 1
    if len(werte) >= ETA_MIN_N:
        return {
            "wert": round(median(werte), 3),
            "n": len(werte),
            "min": min(werte),
            "max": max(werte),
            "quelle": "gemessen",
            "verworfen": verworfen,
        }
    return {"wert": ETA_ANNAHME, "n": len(werte), "werte": werte, "quelle": "angenommen", "verworfen": verworfen}


# ── Planer: wo lädt die Sonne? ───────────────────────────────────────────────────────────────────────────────────
def sonnentage(plan, heute):
    out = []
    for t in (plan or {}).get("tage") or []:
        try:
            d = date.fromisoformat(t["tag"])
        except (KeyError, ValueError):
            continue
        if d < heute:
            continue
        out.append(
            {
                "tag": d.isoformat(),
                "k": (d - heute).days,
                "kwh": r1(t.get("kwh") or 0),
                "kwh_p90": r1(t.get("kwh_p90") or 0),
                "pv_kwh": r1(t.get("pv_kwh")),
                "start": ((t.get("bloecke") or [{}])[0]).get("start_lokal"),
            }
        )
    return out


def tag_wort(d, heute):
    k = (d - heute).days
    if k == 0:
        return "heute"
    if k == 1:
        return "morgen"
    if k == 2:
        return "übermorgen"
    return f"{WT[d.weekday()]} {d.day}.{d.month}."


# ── Hauptrechnung ────────────────────────────────────────────────────────────────────────────────────────────────
def rechne(fahrten, st, plan, c=None, jetzt=None, rng=None):
    """fahrten/st: Dateien des Hersteller-Abrufs, plan: Ladeplan des Hauses ({tage: [...]}) oder None, c: Influx
    (Wallbox-Zähler) oder None. -> dict (Format: board.py)."""
    jetzt = jetzt or time.time()
    rng = rng or random.Random(int(jetzt) // 900)  # stabil innerhalb einer Viertelstunde
    fahrten = sorted(fahrten or [], key=lambda f: f["start"])
    st = st or {}
    plan = plan or {}
    kap = float(st.get("kapazitaet_kwh") or KAP_ANNAHME)
    heute = lokal(jetzt).date()

    tage_kwh, tage_km = tagesverbrauch(fahrten, kap, heute)
    werte = list(tage_kwh.values())
    anteil = stundenanteil(fahrten, kap)

    # Ladestand jetzt
    eta = wirkungsgrad(c, fahrten, kap) if c else {"wert": ETA_ANNAHME, "n": 0, "quelle": "angenommen"}
    soc_meldung = st.get("soc")
    t_meldung = epoch(st["meldung"]) if st.get("meldung") else None
    geladen_kwh = 0.0
    if c and t_meldung:
        z1, z2 = zaehler(c, t_meldung), zaehler(c, jetzt)
        if z1 is not None and z2 is not None and z2 > z1:
            geladen_kwh = (z2 - z1) / 1000
    soc_jetzt = None
    if soc_meldung is not None:
        soc_jetzt = min(100.0, soc_meldung + geladen_kwh * eta["wert"] / kap * 100)

    # Monte-Carlo ohne Laden
    vorhersage = None
    if soc_jetzt is not None and len(werte) >= 7:
        h = lokal(jetzt).hour
        rest_heute = float(sum(anteil[h + 1 :]) + anteil[h] * (1 - lokal(jetzt).minute / 60))
        pools = [vorrat(tage_kwh, (heute + timedelta(k)).weekday())[0] for k in range(HORIZONT)]
        soc = []  # je Durchlauf: Ladestand am Tagesende je Tag
        for _ in range(SZEN):
            s, reihe = soc_jetzt, []
            for k in range(HORIZONT):
                s -= rng.choice(pools[k]) * (rest_heute if k == 0 else 1.0) / kap * 100
                reihe.append(s)
            soc.append(reihe)
        # erster Tag unter der Reserve; HORIZONT = reicht über 14 Tage
        tag_unter = [next((k for k, x in enumerate(r) if x < RESERVE_PCT), HORIZONT) for r in soc]
        spalte = [[r[k] for r in soc] for k in range(HORIZONT)]
        vorhersage = {
            "reserve_pct": RESERVE_PCT,
            "tage_bis_reserve": {
                "frueh": int(q(tag_unter, 0.1)),
                "mitte": int(q(tag_unter, 0.5)),
                "spaet": int(q(tag_unter, 0.9)),
            },
            "tage": [(heute + timedelta(k)).isoformat() for k in range(HORIZONT)],
            # Anzeige: ein Akku wird nicht leerer als 0 % (das Auto würde vorher stehen bleiben)
            "soc_p10": [r1(max(0.0, q(spalte[k], 0.1))) for k in range(HORIZONT)],
            "soc_p50": [r1(max(0.0, q(spalte[k], 0.5))) for k in range(HORIZONT)],
            "soc_p90": [r1(max(0.0, q(spalte[k], 0.9))) for k in range(HORIZONT)],
            "szenarien": SZEN,
            "rest_heute_anteil": round(rest_heute, 2),
        }

    sonne = sonnentage(plan, heute)
    entscheidung = entscheide(soc_jetzt, vorhersage, sonne, heute, fahrten)

    # Profil
    je_wt = []
    for w in range(7):
        v = [x for d, x in tage_kwh.items() if d.weekday() == w]
        je_wt.append(
            {
                "wt": WT[w],
                "n": len(v),
                "mittel": r1(fmean(v)) if v else None,
                "p10": r1(q(v, 0.1)),
                "p90": r1(q(v, 0.9)),
            }
        )
    wochen = defaultdict(lambda: [0.0, 0.0, 0])
    for d, v in tage_kwh.items():
        m = (d - timedelta(d.weekday())).isoformat()
        wochen[m][0] += v
        wochen[m][1] += tage_km[d]
        wochen[m][2] += 1
    km_sum = sum(tage_km.values())
    profil = {
        "tage_n": len(werte),
        "erster_tag": min(tage_kwh).isoformat() if tage_kwh else None,
        "tag_mittel": r1(fmean(werte)) if werte else None,
        "tag_p10": r1(q(werte, 0.1)),
        "tag_p90": r1(q(werte, 0.9)),
        "km_tag": r1(km_sum / len(werte)) if werte else None,
        "kwh_100km": r1(100 * sum(werte) / km_sum) if km_sum > 50 else None,
        "je_wt": je_wt,
        "wochen": [{"montag": m, "kwh": r1(v[0]), "km": round(v[1]), "tage": v[2]} for m, v in sorted(wochen.items())],
        "fahrten_n": len(fahrten),
    }
    # Ladungen (Sprünge zwischen Fahrten)
    ladungen = []
    for a, b in zip(fahrten, fahrten[1:], strict=False):
        if a.get("soc_ende") is not None and b.get("soc_start") is not None and b["soc_start"] - a["soc_ende"] >= 3:
            ladungen.append(
                {
                    "ab": a["ende"],
                    "bis": b["start"],
                    "von": a["soc_ende"],
                    "auf": b["soc_start"],
                    "kwh": r1((b["soc_start"] - a["soc_ende"]) * kap / 100),
                }
            )

    out = {
        "stand": lokal(jetzt).isoformat(timespec="seconds"),
        "jetzt": int(jetzt),
        "kap_kwh": kap,
        "meldung": st.get("meldung"),
        "soc_meldung": soc_meldung,
        "soc_jetzt": r1(soc_jetzt),
        "geladen_seit_meldung_kwh": round(geladen_kwh, 2),
        "wirkungsgrad": eta,
        "profil": profil,
        "rueckblick": rueckblick(tage_kwh),
        "vorhersage": vorhersage,
        "sonne": sonne,
        "entscheidung": entscheidung,
        "ladungen": ladungen[-60:],
        # Anteil des Tagesverbrauchs je Ortsstunde 0–23 (für „Ladestand um HH:MM“ im Rechner des Hauses)
        "stundenanteil": [round(x, 4) for x in anteil],
        "status": st,
    }
    return out


def unterwegs(fahrten, tag, stunde, bis_tag):
    """Wie oft war das Auto an früheren Tagen desselben Wochentags um `stunde` (Ortszeit) unterwegs? -> (k, n).
    „Unterwegs“ = zwischen erster Abfahrt und letzter Rückkehr des Tages (Näherung: die Fahrten haben keinen
    Standort – ein Zwischenhalt zu Hause zählt mit). Tage ohne Fahrt zählen als zu Hause. Nutzer 20.10.2026: an manchen
    Arbeitstagen Home-Office -> eine Frage nach Häufigkeit, kein Ja/Nein."""
    if not fahrten:
        return 0, 0
    je_tag = defaultdict(list)
    for f in fahrten:
        je_tag[lokal(f["start"]).date()].append(f)
    d0 = lokal(fahrten[0]["start"]).date()
    k = n = 0
    d = d0
    while d < bis_tag:
        if d.weekday() == tag.weekday():
            n += 1
            fs = je_tag.get(d) or []
            if fs:
                t = datetime(d.year, d.month, d.day, int(stunde), int(stunde % 1 * 60), tzinfo=TZ).timestamp()
                if min(f["start"] for f in fs) <= t <= max(f["ende"] for f in fs):
                    k += 1
        d += timedelta(days=1)
    return k, n


def zu_hause_hinweis(fahrten, s, heute):
    """Satzteil für die Ansage, wenn das Auto zur geplanten Sonnen-Ladung meist unterwegs war (≥ 50 %, n ≥ 4)."""
    if not fahrten or not s.get("start"):
        return "", ""
    d = date.fromisoformat(s["tag"])
    hh, mm = (int(x) for x in s["start"].split(":"))
    k, n = unterwegs(fahrten, d, hh + mm / 60 + 1, heute)  # Blockmitte ≈ Start + 1 h
    if n < 4 or k < n / 2:
        return "", ""
    wt = WT[d.weekday()]
    return (
        f" Nur wenn das Auto dann zu Hause ist – {wt} um {hh + 1} Uhr war es an {k} von {n} {wt}-Tagen unterwegs.",
        " · falls zu Hause",
    )


def entscheide(soc, vh, sonne, heute, fahrten=None):
    """Eine Ansage: Hat Zeit / <Tag> anstecken / <Tag> laden / Jetzt laden – immer nach dem frühen Fall.
    text = ganzer Satz, kurz = für die Kachel (≤ 110 Zeichen). Mit fahrten: Hinweis, wenn das Auto zur geplanten
    Sonnen-Ladung meist unterwegs war."""
    if soc is None:
        return {
            "stufe": None,
            "wort": "Kein Wert",
            "text": "Das Auto hat noch keinen Ladestand gemeldet.",
            "kurz": "noch keine Meldung vom Auto",
        }
    if vh is None:
        return {
            "stufe": None,
            "wort": "Lernt noch",
            "text": "Für eine Vorhersage fehlen noch Fahrten (mind. 7 Tage).",
            "kurz": "zu wenig Fahrten (mind. 7 Tage)",
        }
    if soc < RESERVE_PCT:
        t = f"Nur noch {round(soc)} % – unter der Reserve von {round(RESERVE_PCT)} %."
        return {"stufe": "act", "wort": "Jetzt laden", "text": t, "kurz": t}
    frueh, mitte = vh["tage_bis_reserve"]["frueh"], vh["tage_bis_reserve"]["mitte"]

    def tag(k):
        return tag_wort(heute + timedelta(k), heute)

    def gross(w):
        return w[:1].upper() + w[1:]

    reicht = (
        f"reicht ohne Laden bis {tag(frueh)} (eher {tag(mitte)})"
        if mitte < HORIZONT
        else (
            f"reicht ohne Laden mindestens bis {tag(frueh)}" if frueh < HORIZONT else "reicht ohne Laden über 2 Wochen"
        )
    )
    reicht_kurz = f"reicht bis {tag(frueh)}" if frueh < HORIZONT else "reicht über 2 Wochen"
    # Sonnentage vor dem frühen Unterschreiten (Laden ohne Netzstrom, wenn angesteckt)
    gute = [s for s in sonne if s["kwh"] >= SONNE_MIN_KWH and s["k"] <= frueh]
    if frueh <= 0:
        return {
            "stufe": "act",
            "wort": "Heute laden",
            "reicht": reicht,
            "text": f"Heute Abend kann es unter {round(RESERVE_PCT)} % gehen. Anstecken und „Jetzt laden“.",
            "kurz": f"heute Abend unter {round(RESERVE_PCT)} % möglich – anstecken, „Jetzt laden“",
        }
    if gute:
        s = gute[0]
        wann = tag_wort(date.fromisoformat(s["tag"]), heute)
        ab = f" ab {s['start']}" if s.get("start") else ""
        weg_text, weg_kurz = zu_hause_hinweis(fahrten, s, heute)
        if frueh <= len(sonne):  # wird innerhalb des Planer-Blicks knapp: Sonne nutzen
            return {
                "stufe": "look",
                "wort": f"{gross(wann)} anstecken",
                "reicht": reicht,
                "sonne": s,
                "text": f"Ladestand {reicht}. {gross(wann)}{ab} lädt die Sonne ≈ {de(s['kwh'])} kWh ohne Netzstrom."
                + weg_text,
                "kurz": f"{gross(reicht_kurz)} · {wann}{ab} Sonne ≈ {de(s['kwh'])} kWh" + weg_kurz,
            }
        return {
            "stufe": "ok",
            "wort": "Hat Zeit",
            "reicht": reicht,
            "sonne": s,
            "text": f"Ladestand {reicht}. Gratis-Strom: {wann}{ab} ≈ {de(s['kwh'])} kWh, wenn das Auto steckt."
            + weg_text,
            "kurz": f"{gross(reicht_kurz)} · gratis {wann}{ab} ≈ {de(s['kwh'])} kWh" + weg_kurz,
        }
    if frueh <= 2:
        return {
            "stufe": "act",
            "wort": f"{gross(tag(frueh))} laden",
            "reicht": reicht,
            "text": f"Ladestand {reicht}, und bis dahin reicht die Sonne nicht. Anstecken – dann lädt das Haus "
            f"aus Sonne und Hausakku, notfalls „Jetzt laden“.",
            "kurz": f"{gross(reicht_kurz)}, Sonne reicht nicht – anstecken",
        }
    return {
        "stufe": "ok",
        "wort": "Hat Zeit",
        "reicht": reicht,
        "text": f"Ladestand {reicht}. In den nächsten Tagen ist kaum Sonne fürs Auto übrig.",
        "kurz": f"{gross(reicht_kurz)} · kaum Sonne fürs Auto in Sicht",
    }


def de(x, nd=0):
    return "–" if x is None else f"{x:.{nd}f}".replace(".", ",")
