"""Board of the module "fuehler": temperature and humidity sensors as answers – what does each read now (a tile per
sensor with its last 24 h), does every sensor still answer (a hint only when one is silent), how did it go (one chart
for temperature, one for humidity, switch 24 h / 7 days / 30 days)? Second level: per sensor lowest, highest and mean
of the last 24 hours with the number of readings. Pure functions over plain data (no I/O):

  build(data, fuehler, now, tz, t)

data: the answer of source.read ({"last", "stats", "course"}) or None when the database does not answer. fuehler: the
config list [{"nr", "name"}] or None (then every sensor in data, by number). A bucket without a reading stays a gap.
"""

from __future__ import annotations

import math
from datetime import datetime

from ..fmt import number, unsigned_zero
from .source import SPANS

STALE_S = 10 * 60  # the collector asks every minute: 10 min without a reading = the sensor does not answer
CONDENSE_K = 1.0  # air at most 1 K above its dew point (≈ 93 % rF): water may settle on anything a bit colder
AIR_DIFF = 0.5  # g/m³: smaller differences between inside and outside do not count for airing
COLORS = ("climate", "sun", "battery", "home", "feed", "grid", "import", "muted")  # one per sensor, then again

TEXT = {
    "tiles_title": "Jetzt",
    "name": "Fühler {nr}",
    "sub": "{h} % rF · Taupunkt {td} °C",
    "sub_silent": "keine Antwort seit {when}",
    "sub_never": "noch keine Messung",
    "sub_nodata": "keine Daten (Datenbank antwortet nicht)",
    "tile_what": "Temperatur und relative Luftfeuchte von Fühler {nr} (Busadresse), zuletzt gemessen {when}. Die Linie "
    "zeigt die letzten 24 Stunden (Viertelstunden-Mittel). Genauigkeit laut Datenblatt typisch ± 0,5 °C und ± 3 % rF "
    "(nicht nachgeprüft); die Werte haben eine Nachkommastelle. Taupunkt = Temperatur, ab der sich Wasser "
    "niederschlägt (Magnus-Formel über Wasser, ± 0,5 K bei ± 3 % rF); absolute Feuchte {ah} g/m³.",
    "outdoor": "Außen",
    "hint_condense": "{name}: Luft nur {k} K über dem Taupunkt – an kälteren Stellen (Blech, Balken) kann Wasser "
    "kondensieren.",
    "hint_condense_info": "Erscheint, wenn die Lufttemperatur höchstens 1 K über dem Taupunkt liegt (etwa ab 93 % rF). "
    "Dann reicht eine leicht kältere Fläche für Kondenswasser. Hilft: lüften, wenn außen die absolute Feuchte "
    "niedriger ist (Tabelle unten, Spalte „Lüften“).",
    "abs_title": "Absolute Feuchte",
    "abs_note": "Gramm Wasser je Kubikmeter Luft, aus Temperatur und relativer Feuchte gerechnet. Liegt die Außenlinie "
    "darunter, trocknet Lüften.",
    "abs_what": "Absolute Feuchte je Fühler (Mittel je Zeitschritt). Anders als die relative Feuchte hängt sie "
    "nicht von der Temperatur ab – deshalb lässt sie sich mit außen vergleichen.",
    "source": "Fühler am RS485-Bus, jede Minute abgefragt vom Haus-Sammler, gespeichert in InfluxDB.",
    "hint_title": "Hinweise",
    "hint_silent": "{name} antwortet seit {when} nicht – Kabel, Stromversorgung oder Gateway?",
    "hint_meta": "seit {d}",
    "hint_info": "Der Sammler fragt jeden Fühler jede Minute. Kommt 10 Minuten lang keine Antwort, erscheint dieser "
    "Hinweis. Ein einzelner stummer Fühler deutet auf Kabel oder Adresse, alle zugleich auf das Gateway.",
    "temp_title": "Temperatur",
    "hum_title": "Luftfeuchte",
    "range_tag": "24 h",
    "range_woche": "7 Tage",
    "range_monat": "30 Tage",
    "course_note": "Mittel je Viertelstunde (24 h), Stunde (7 Tage) oder 3 Stunden (30 Tage); Lücke = keine Antwort.",
    "course_what": "Verlauf je Fühler. Jeder Punkt ist das Mittel aller Minutenwerte im Zeitschritt.",
    "table_title": "Letzte 24 Stunden",
    "col_name": "Fühler",
    "col_now": "jetzt",
    "col_min": "tiefste",
    "col_max": "höchste",
    "col_hum": "Feuchte Ø",
    "col_n": "Messungen",
    "col_dew": "Taupunkt",
    "col_abs": "g/m³",
    "col_air": "Lüften",
    "air_dry": "trocknet",
    "air_wet": "feuchtet",
    "air_same": "egal",
    "chart_label": "Temperatur 24 h",
    "table_note": "Punkt = Mittel, Strich = halbe Spanne zwischen tiefster und höchster Temperatur.",
    "table_what": "Tiefste, höchste und mittlere Temperatur der letzten 24 Stunden aus allen Minutenwerten; "
    "Feuchte als Mittel. „Messungen“: Zahl der Minutenwerte (voll = 1440). Taupunkt und g/m³ aus dem letzten Wert. "
    "„Lüften“ vergleicht die absolute Feuchte mit außen: trocknet = außen mindestens 0,5 g/m³ trockener, feuchtet = "
    "außen mindestens 0,5 g/m³ feuchter, sonst egal; ohne Außenfühler „–“.",
    "empty": "Noch kein Fühler hat geantwortet.",
}


def _de(x, nd=1) -> str:
    v = number(x)
    if v is None:
        return "–"
    v = unsigned_zero(v, nd)
    return f"{v:.{nd}f}".replace(".", ",").replace("-", "−")


def _svp(temp: float) -> float:
    """Saturation vapour pressure over water in hPa (Magnus, WMO coefficients)."""
    return 6.112 * math.exp(17.62 * temp / (243.12 + temp))


def dew_point(temp, rh):
    """Dew point in °C from °C and % rF (Magnus over water); None for missing or impossible values."""
    temp, rh = number(temp), number(rh)
    if temp is None or rh is None or not 0 < rh <= 100:
        return None
    g = math.log(rh / 100) + 17.62 * temp / (243.12 + temp)
    return 243.12 * g / (17.62 - g)


def abs_humidity(temp, rh):
    """Absolute humidity in g/m³ from °C and % rF; None for missing or impossible values."""
    temp, rh = number(temp), number(rh)
    if temp is None or rh is None or not 0 <= rh <= 100:
        return None
    return 216.7 * (rh / 100 * _svp(temp)) / (273.15 + temp)


def _when(ts: float, now: float, tz) -> str:
    d, n = datetime.fromtimestamp(ts, tz), datetime.fromtimestamp(now, tz)
    return d.strftime("%H:%M") if d.date() == n.date() else d.strftime("%-d.%-m. %H:%M")


def _since(s: float) -> str:
    if s >= 86400:
        return f"{int(s // 86400)} Tg"
    if s >= 3600:
        return f"{int(s // 3600)} h"
    return f"{int(s // 60)} min"


def _sensors(data: dict | None, fuehler) -> list[tuple[str, str | None]]:
    """-> [(nr, name or None)] in the order to show."""
    if fuehler:
        return [
            (str(f["nr"]), f.get("name") if isinstance(f.get("name"), str) and f.get("name") else None) for f in fuehler
        ]
    seen = set((data or {}).get("last") or {})
    for c in ((data or {}).get("course") or {}).values():
        seen |= set(c)
    return [(nr, None) for nr in sorted(seen, key=lambda x: (len(x), x))]


def _grid(now: float, sid: str) -> list[int]:
    span, step = SPANS[sid]
    end = int(now // step) * step
    n = span // step
    return [int((end - (n - 1 - i) * step) * 1000) for i in range(n)]


def _abs_values(c: dict, grid: list[int]) -> list:
    out = []
    for x in grid:
        v = c.get(x)
        a = abs_humidity(v[0], v[1]) if v else None
        out.append(round(a, 1) if a is not None else None)
    return out


def _values(course: dict, nr: str, grid: list[int], k: int) -> list:
    c = course.get(nr) or {}
    out = []
    for x in grid:
        v = c.get(x)
        out.append(round(v[k], 1) if v and number(v[k]) is not None else None)
    return out


def _air(inside, outside, t: dict) -> str:
    """Does airing dry the room? Compares absolute humidity inside/outside; "–" without both."""
    if inside is None or outside is None:
        return "–"
    if outside <= inside - AIR_DIFF:
        return t["air_dry"]
    if outside >= inside + AIR_DIFF:
        return t["air_wet"]
    return t["air_same"]


def build(data: dict | None, fuehler, now: float, tz, t: dict) -> dict:
    sensors = _sensors(data, fuehler)
    last = (data or {}).get("last") or {}
    stats = (data or {}).get("stats") or {}
    course = (data or {}).get("course") or {}

    def name(nr, nm):
        base = t["name"].format(nr=nr)
        return f"{base} · {nm}" if nm else base

    tiles, hints = [], []
    day_grid = _grid(now, "tag")
    for i, (nr, nm) in enumerate(sensors):
        lv = last.get(nr) or {}
        ts = number(lv.get("t"))
        tile = {
            "label": nm or t["name"].format(nr=nr),
            "value": _de(lv.get("temp")) if ts is not None else "–",
            "unit": "°C",
            "icon": "thermometer",
            "color": COLORS[i % len(COLORS)],
            "state": "ok",
            "info": {
                "what": t["tile_what"].format(
                    nr=nr,
                    when=_when(ts, now, tz) if ts else "–",
                    ah=_de(abs_humidity(lv.get("temp"), lv.get("feuchte"))),
                ),
                "source": t["source"],
            },
        }
        if data is None:
            tile["sub"], tile["state"] = t["sub_nodata"], "open"
        elif ts is None:
            tile["sub"], tile["state"] = t["sub_never"], "open"
        elif now - ts > STALE_S:
            tile["sub"], tile["state"] = t["sub_silent"].format(when=_when(ts, now, tz)), "look"
            hints.append(
                {
                    "text": t["hint_silent"].format(name=name(nr, nm), when=_when(ts, now, tz)),
                    "meta": t["hint_meta"].format(d=_since(now - ts)),
                    "info": t["hint_info"],
                    "state": "look",
                }
            )
        else:
            td = dew_point(lv.get("temp"), lv.get("feuchte"))
            tile["sub"] = t["sub"].format(h=_de(lv.get("feuchte"), 0), td=_de(td))
            tv = number(lv.get("temp"))
            if td is not None and tv is not None and tv - td <= CONDENSE_K:
                tile["state"] = "look"
                hints.append(
                    {
                        "text": t["hint_condense"].format(name=name(nr, nm), k=_de(max(tv - td, 0))),
                        "info": t["hint_condense_info"],
                        "state": "look",
                    }
                )
        spark = _values(course.get("tag") or {}, nr, day_grid, 0)
        if sum(v is not None for v in spark) >= 2:
            tile["spark"], tile["sparkFrom"], tile["sparkTo"] = spark, day_grid[0], day_grid[-1]
        tiles.append(tile)

    if not tiles:
        return {
            "updated": int(now * 1000),
            "sections": [
                {"type": "text", "title": t["tiles_title"], "text": t["sub_nodata"] if data is None else t["empty"]}
            ],
        }

    sections: list[dict] = [{"type": "tiles", "title": t["tiles_title"], "tiles": tiles}]
    if hints:
        sections.append({"type": "list", "title": t["hint_title"], "items": hints})

    for k, title, unit in ((0, "temp_title", "°C"), (1, "hum_title", "%")):
        ranges = []
        for sid in SPANS:
            grid = _grid(now, sid)
            lines = [
                {
                    "label": name(nr, nm) if len(sensors) > 1 else (nm or t["name"].format(nr=nr)),
                    "values": _values(course.get(sid) or {}, nr, grid, k),
                    "color": COLORS[i % len(COLORS)],
                }
                for i, (nr, nm) in enumerate(sensors)
            ]
            ranges.append({"id": sid, "label": t[f"range_{sid}"], "x": grid, "lines": lines})
        sections.append(
            {
                "type": "series",
                "title": t[title],
                "unit": unit,
                "x": ranges[0]["x"],
                "lines": ranges[0]["lines"],
                "group": "zeit",
                "ranges": ranges,
                "note": t["course_note"],
                "info": {"what": t["course_what"], "source": t["source"]},
            }
        )

    outdoor = (data or {}).get("aussen") or {}
    o_name = (data or {}).get("aussen_name") or t["outdoor"]
    ranges = []
    for sid in SPANS:
        grid = _grid(now, sid)
        lines = [
            {
                "label": name(nr, nm) if len(sensors) > 1 else (nm or t["name"].format(nr=nr)),
                "values": _abs_values((course.get(sid) or {}).get(nr) or {}, grid),
                "color": COLORS[i % len(COLORS)],
            }
            for i, (nr, nm) in enumerate(sensors)
        ]
        o_vals = _abs_values((outdoor.get("course") or {}).get(sid) or {}, grid)
        if sum(v is not None for v in o_vals) >= 2:
            lines.append({"label": o_name, "values": o_vals, "color": "muted"})
        ranges.append({"id": sid, "label": t[f"range_{sid}"], "x": grid, "lines": lines})
    sections.append(
        {
            "type": "series",
            "title": t["abs_title"],
            "unit": "g/m³",
            "x": ranges[0]["x"],
            "lines": ranges[0]["lines"],
            "group": "zeit",
            "ranges": ranges,
            "note": t["abs_note"],
            "info": {"what": t["abs_what"], "source": t["source"]},
        }
    )
    o_last = outdoor.get("last") or {}
    o_abs = abs_humidity(o_last.get("temp"), o_last.get("feuchte")) if o_last else None

    rows, lo, hi = [], None, None
    for nr, nm in sensors:
        s = stats.get(nr) or {}
        lv = last.get(nr) or {}
        tmin, tmax, tmean = number(s.get("tmin")), number(s.get("tmax")), number(s.get("tmean"))
        row = {
            "cells": {
                "name": name(nr, nm),
                "now": f"{_de((last.get(nr) or {}).get('temp'))} °C" if last.get(nr) else "–",
                "min": f"{_de(tmin)} °C" if tmin is not None else "–",
                "max": f"{_de(tmax)} °C" if tmax is not None else "–",
                "hum": f"{_de(s.get('hmean'), 0)} %" if number(s.get("hmean")) is not None else "–",
                "n": str(int(s["n"])) if number(s.get("n")) is not None else "0",
                "dew": f"{_de(td)} °C" if (td := dew_point(lv.get("temp"), lv.get("feuchte"))) is not None else "–",
                "abs": _de(ah) if (ah := abs_humidity(lv.get("temp"), lv.get("feuchte"))) is not None else "–",
                "air": _air(ah, o_abs, t),
            },
            "chart": {"value": None},
        }
        if None not in (tmin, tmax, tmean):
            row["chart"] = {"value": round(tmean, 1), "err": round((tmax - tmin) / 2, 1)}
            lo = tmin if lo is None else min(lo, tmin)
            hi = tmax if hi is None else max(hi, tmax)
        rows.append(row)
    chart = {"kind": "dot", "label": t["chart_label"], "unit": "°C", "color": "climate", "col": "now"}
    if lo is not None:
        chart["min"], chart["max"] = float(int(lo // 5 * 5)), float(int(hi // 5 * 5 + 5))
    sections.append(
        {
            "type": "table",
            "title": t["table_title"],
            "columns": [
                {"key": "name", "label": t["col_name"]},
                {"key": "now", "label": t["col_now"], "align": "right"},
                {"key": "min", "label": t["col_min"], "align": "right", "phone": True},
                {"key": "max", "label": t["col_max"], "align": "right", "phone": True},
                {"key": "hum", "label": t["col_hum"], "align": "right"},
                {"key": "dew", "label": t["col_dew"], "align": "right"},
                {"key": "abs", "label": t["col_abs"], "align": "right"},
                {"key": "air", "label": t["col_air"], "align": "right", "phone": True},
                {"key": "n", "label": t["col_n"], "align": "right"},
            ],
            "rows": rows,
            "chart": chart,
            "more": True,
            "note": t["table_note"],
            "info": {"what": t["table_what"], "source": t["source"]},
        }
    )
    return {"updated": int(now * 1000), "sections": sections}
