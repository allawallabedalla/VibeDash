"""Board of the module "garten": garden weather (today, tomorrow, frost, rain of the week), rain per day and the
garden tips. Pure function over plain data (no I/O), so tests run on a synthetic garden:

  build(days, tips, today, now_ms, t, areas=None)

days: {"gemessen": {date: {tmax, tmin, regen_mm, sonne_h}}, "prognose": {date: {...}}} – looking back (weather
model, no station at the house) and the forecast from today on. tips: [{"date": "YYYY-MM-DD", "tip": "- …\\n- …"}]
newest last (the history file the tip writer keeps). areas: [{"name", "online", "live": base-station device | None,
"course": {"x": [ms], "bodenfeuchte": [...], "lufttemp": [...]}}] – one block per garden area with a soil sensor.
"""

from __future__ import annotations

import re
from datetime import date, timedelta

PUA = re.compile(r"[-]")
EMOJI = re.compile("[\U0001f000-\U0001faff☀-➿️‍⬀-⯿]")
FROST_C = 2.0
BAT_LOOK_V, BAT_ACT_V = 2.9, 2.7  # battery: yellow below 2.9 V, red below 2.7 V
QUIET_S = 2700  # no packet for 45 min: red

TEXT = {
    "today": "Heute",
    "tomorrow": "Morgen",
    "day_sub": "{rain} mm Regen · ≈ {sun} h Sonne",
    "frost": "Frost",
    "frost_yes": "tiefster Wert · Frostgefahr – Kübel schützen",
    "frost_no": "tiefster Wert · kein Frost in 3 Tagen",
    "frost_what": "Tiefster vorhergesagter Wert der nächsten 3 Tage.",
    "frost_source": "Wettermodell (Open-Meteo), Tageswerte.",
    "rain_week": "Regen Woche",
    "rain_week_sub": "an {n} Tagen · Wettermodell",
    "weather_title": "Gartenwetter",
    "weather_note": "Regen und Sonne aus dem Wettermodell (Rückblick und Vorhersage), keine Station am Haus.",
    "rain_title": "Regen je Tag",
    "rain_7": "7 Tage",
    "rain_30": "30 Tage",
    "rain_note": "Bis gestern Rückblick, ab heute 3 Tage Vorhersage – beides Wettermodell.",
    "today_short": "heute",
    "tips_title": "Tipps vom {d}",
    "tips_what": "Vier Vorschläge für den Garten passend zu Jahreszeit und Wetter.",
    "tips_source": "Von einer KI erzeugt, nicht geprüft.",
    "older_title": "Frühere Tipps",
    "base_offline": "Basis offline – die Basis-Station im Heimnetz antwortet nicht. Es wird nichts gespeichert.",
    "no_device": "Die Basis-Station kennt diesen Sensor (noch) nicht.",
    "soil": "Boden",
    "soil_sub": "Feuchte",
    "soil_none": "Sonde liefert nichts",
    "air": "Luft",
    "air_hum": "Feuchte",
    "air_sub": "Temperatur",
    "hum_sub": "relative Feuchte",
    "battery": "Batterie",
    "battery_ok": "Sensor",
    "battery_low": "bald tauschen",
    "battery_empty": "jetzt tauschen",
    "packet": "Funk",
    "packet_value": "vor {m} min",
    "packet_never": "noch nichts",
    "packet_ok": "letztes Paket",
    "packet_late": "Sensor still",
    "packet_what": "Der Sensor misst alle 15 min. Rot, wenn seit über 45 min kein Paket ankam.",
    "area_source": "LoRa-Sensor über die Basis-Station im Heimnetz, Verlauf aus InfluxDB.",
    "soil_title": "Bodenfeuchte 7 Tage",
    "temp_title": "Lufttemperatur 7 Tage",
    "course_note": "Stundenmittel.",
    "older_note": "Je Tag die Stichworte; ganze Texte im Haus-Programm.",
}


def clean(x, max_len=400) -> str:
    """Text without icon glyphs and double spaces."""
    if x is None:
        return ""
    s = PUA.sub("", str(x))
    s = re.sub(r"[ \t]+", " ", s).strip()
    return s[:max_len]


def no_emoji(t) -> str:
    return re.sub(r"[ \t]{2,}", " ", EMOJI.sub("", t or "")).strip()


def de(x, nd=1) -> str:
    return "–" if x is None else f"{x:.{nd}f}".replace(".", ",")


def recent_tips(history: list, today: date, days: int = 7) -> list:
    """Tips of the last `days` days, newest first: [{"tag", "tipps"}]."""
    out = []
    for e in reversed(history or []):
        try:
            d = date.fromisoformat(str(e.get("date")))
        except ValueError:
            continue
        if today - timedelta(days=days) <= d <= today:
            out.append({"tag": d.isoformat(), "tipps": no_emoji(e.get("tip"))})
    return out


def area_sections(a: dict, t: dict) -> list:
    name, g = a["name"], a.get("live")
    if not a.get("online"):
        out = [{"type": "text", "title": name, "text": t["base_offline"]}]
    elif not g:
        out = [{"type": "text", "title": name, "text": t["no_device"]}]
    else:
        src = {"source": t["area_source"]}
        soil, temp, hum, bat = g.get("bodenfeuchte"), g.get("lufttemp"), g.get("luftfeuchte"), g.get("batterie_v")
        age = g.get("alter_s")
        late = bool(g.get("ausfall")) or (isinstance(age, (int, float)) and age > QUIET_S)
        bat_state = None
        if isinstance(bat, (int, float)):
            bat_state = "act" if bat < BAT_ACT_V else "look" if bat < BAT_LOOK_V else None
        tiles = [
            {
                "label": t["soil"],
                "value": de(soil, 0) if soil is not None else "–",
                **({"unit": "%"} if soil is not None else {}),
                "sub": t["soil_sub"] if soil is not None else t["soil_none"],
                "icon": "droplet",
                "color": "climate",
            },
            {
                "label": t["air"],
                "value": f"{de(temp)}°" if temp is not None else "–",
                "sub": t["air_sub"],
                "icon": "thermometer",
                "color": "climate",
            },
            {
                "label": t["air_hum"],
                "value": de(hum, 0) if hum is not None else "–",
                **({"unit": "%"} if hum is not None else {}),
                "sub": t["hum_sub"],
                "icon": "droplet",
                "color": "climate",
            },
            {
                "label": t["battery"],
                "value": de(bat, 2) if bat is not None else "–",
                **({"unit": "V"} if bat is not None else {}),
                "sub": {"act": t["battery_empty"], "look": t["battery_low"]}.get(bat_state, t["battery_ok"]),
                **({"state": bat_state} if bat_state else {}),
                "icon": "battery",
                "color": "climate",
            },
            {
                "label": t["packet"],
                "value": t["packet_value"].format(m=round(age / 60)) if age is not None else t["packet_never"],
                "sub": t["packet_late"] if late else t["packet_ok"],
                **({"state": "act"} if late else {}),
                "icon": "clock",
                "color": "climate",
                "info": {"what": t["packet_what"], **src},
            },
        ]
        out = [{"type": "tiles", "title": name, "tiles": tiles}]
    c = a.get("course") or {}
    for key, title, unit in (("bodenfeuchte", "soil_title", "%"), ("lufttemp", "temp_title", "°C")):
        vals = c.get(key) or []
        if sum(v is not None for v in vals) >= 2:
            out.append(
                {
                    "type": "series",
                    "title": t[title],
                    "unit": unit,
                    "x": c["x"],
                    "lines": [
                        {"label": t["soil" if key == "bodenfeuchte" else "air"], "values": vals, "color": "climate"}
                    ],
                    "note": t["course_note"],
                }
            )
    return out


def build(days: dict, tips: list, today: date, now_ms: int, t: dict, areas=None) -> dict:
    gemessen, prognose = days.get("gemessen") or {}, days.get("prognose") or {}
    sections, tiles = [], []
    for k, word in ((0, t["today"]), (1, t["tomorrow"])):
        r = prognose.get(today + timedelta(days=k))
        if r:
            tiles.append(
                {
                    "label": word,
                    "value": f"{de(r.get('tmax'), 0)}°",
                    "unit": f"/ {de(r.get('tmin'), 0)}°",
                    "sub": t["day_sub"].format(rain=de(r.get("regen_mm")), sun=de(r.get("sonne_h"), 0)),
                    "icon": "cloudSun",
                    "color": "climate",
                }
            )
    coming = [prognose[d] for d in sorted(prognose) if today <= d <= today + timedelta(days=3)]
    lows = [r.get("tmin") for r in coming if r.get("tmin") is not None]
    if lows:
        low = min(lows)
        tile = {
            "label": t["frost"],
            "value": f"{de(low, 0)}°",
            "sub": t["frost_yes"] if low < FROST_C else t["frost_no"],
            "icon": "thermometer",
            "color": "climate",
            "info": {"what": t["frost_what"], "source": t["frost_source"]},
        }
        if low < FROST_C:
            tile["state"] = "look"
        tiles.append(tile)
    past = [gemessen[d] for d in sorted(gemessen) if today - timedelta(days=7) <= d < today]
    if past:
        tiles.append(
            {
                "label": t["rain_week"],
                "value": de(sum(r.get("regen_mm") or 0 for r in past)),
                "unit": "mm",
                "sub": t["rain_week_sub"].format(n=len(past)),
                "icon": "rain",
                "color": "climate",
                "approx": True,
            }
        )
    sections.append({"type": "tiles", "title": t["weather_title"], "tiles": tiles, "note": t["weather_note"]})
    for a in areas or []:
        sections += area_sections(a, t)

    def rain(back):
        ds = [today + timedelta(days=k) for k in range(-back, 4)]
        vals = [(gemessen.get(d) if d < today else prognose.get(d)) for d in ds]
        return {
            "labels": [(t["today_short"] if d == today else d.strftime("%d.%m.")) for d in ds],
            "values": [None if v is None else v.get("regen_mm") for v in vals],
        }

    sections.append(
        {
            "type": "bars",
            "title": t["rain_title"],
            "unit": "mm",
            **rain(7),
            "color": "climate",
            "group": "regen",
            "ranges": [{"id": "7d", "label": t["rain_7"], **rain(7)}, {"id": "30d", "label": t["rain_30"], **rain(30)}],
            "note": t["rain_note"],
        }
    )
    if tips:
        first = tips[0]
        points = [clean(z.lstrip("-• "), 400) for z in str(first.get("tipps") or "").split("\n") if z.strip()]
        sections.append(
            {
                "type": "list",
                "title": t["tips_title"].format(d=date.fromisoformat(first["tag"]).strftime("%d.%m.")),
                "items": [{"text": p} for p in points],
                "info": {"what": t["tips_what"], "source": t["tips_source"]},
            }
        )
        older = []
        for e in tips[1:8]:
            points = [clean(z.lstrip("-• "), 200) for z in str(e.get("tipps") or "").split("\n") if z.strip()]
            if points:
                older.append(
                    {
                        "text": " · ".join(p.split(" – ")[0].split(":")[0] for p in points),
                        "meta": date.fromisoformat(e["tag"]).strftime("%d.%m."),
                    }
                )
        if older:
            sections.append({"type": "list", "title": t["older_title"], "items": older, "note": t["older_note"]})
    return {"updated": now_ms, "sections": sections}
