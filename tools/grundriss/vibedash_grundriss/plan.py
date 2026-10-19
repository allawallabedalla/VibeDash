"""The house plan (haus.json) – the format the Räume tab reads – checked and completed.

Format (metres; x to the right, y down; one plan per house, kept in local/modules, never in the repo):

  {
    "quelle": "where the plan comes from",            # free text
    "lichte_hoehe_m": {"EG": 2.6, "OG": 2.5},          # clear room height per floor (3D)
    "ausschnitt": [x0, y0, x1, y1],                    # visible area of the 2D plan (filled in if missing)
    "modell": {...},                                   # optional 3D settings, see model3d.py
    "geschosse": [
      {"id": "EG", "hoehe_fussboden_m": 0.0,
       "raeume": [
         {"id": "wohnen", "name": "Wohnen", "art": "raum",       # art: raum | aussen | nutz | dach | luftraum | treppe
          "polygon": [[x, y], ...],                             # outline of the room's floor, in order
          "knx": ["Wohnen"],                                    # the room's names in the measurement series
          "flaeche_m2": 30.0, "zentrum": [x, y]}                # filled in if missing
       ]}
    ]
  }

check() finds what would break the tab (missing ids, broken outlines, overlapping rooms); complete() fills derived
fields that are missing (area, label point, visible area) and never changes what is already there.
"""

from __future__ import annotations

import json
import os

from shapely.geometry import Polygon, box
from shapely.ops import polylabel, unary_union

KINDS = ("raum", "aussen", "nutz", "dach", "luftraum", "treppe")
INSIDE = ("raum", "luftraum", "treppe")
MARGIN = 1.0


def load(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save(path: str, data: dict) -> None:
    """Atomic write (a running tab may read the file at the same time)."""
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write("\n")
    os.replace(tmp, path)


def rooms(haus: dict):
    for g in haus.get("geschosse") or []:
        for r in g.get("raeume") or []:
            yield g, r


def polygon(r: dict) -> Polygon | None:
    pts = r.get("polygon")
    if not isinstance(pts, list) or len(pts) < 3:
        return None
    try:
        return Polygon([(float(x), float(y)) for x, y in pts])
    except (TypeError, ValueError):
        return None


def check(haus: dict) -> tuple[list[str], list[str]]:
    """-> (errors, warnings). Errors break the tab; warnings are worth a look with the person."""
    errors: list[str] = []
    warnings: list[str] = []
    floors = haus.get("geschosse")
    if not isinstance(floors, list) or not floors:
        return ["keine Geschosse (geschosse fehlt oder ist leer)"], []
    floor_ids = [g.get("id") for g in floors]
    if len(set(floor_ids)) != len(floor_ids) or not all(floor_ids):
        errors.append(f"Geschoss-IDs fehlen oder doppelt: {floor_ids}")
    seen: dict = {}
    for g in floors:
        inside = []
        for r in g.get("raeume") or []:
            rid = r.get("id")
            where = f"{g.get('id')}/{rid or '?'}"
            if not rid or not isinstance(rid, str):
                errors.append(f"{where}: Raum ohne id")
                continue
            if rid in seen:
                errors.append(f"{where}: id doppelt (auch in {seen[rid]})")
            seen[rid] = g.get("id")
            if not r.get("name"):
                errors.append(f"{where}: name fehlt")
            if r.get("art", "raum") not in KINDS:
                errors.append(f"{where}: art {r.get('art')!r} unbekannt ({', '.join(KINDS)})")
            p = polygon(r)
            if p is None:
                errors.append(f"{where}: polygon fehlt oder hat weniger als 3 Punkte")
                continue
            if not p.is_valid:
                errors.append(f"{where}: Umriss kreuzt sich selbst – Punkte in Reihenfolge um den Raum angeben")
                continue
            if p.area < 0.5:
                warnings.append(f"{where}: sehr klein ({p.area:.2f} m²) – Maßstab prüfen (Meter?)")
            if p.area > 400:
                warnings.append(f"{where}: sehr groß ({p.area:.0f} m²) – Maßstab prüfen (Meter, nicht Zentimeter?)")
            if r.get("art", "raum") in INSIDE:
                inside.append((rid, p))
            if r.get("art", "raum") == "raum" and not r.get("knx"):
                warnings.append(f"{where}: keine Messreihen-Namen (knx) – der Raum bleibt ohne Werte")
        for i, (a, pa) in enumerate(inside):
            for b, pb in inside[i + 1 :]:
                ov = pa.intersection(pb).area
                if ov > 0.05 * min(pa.area, pb.area):
                    errors.append(f"{g.get('id')}: {a} und {b} überlappen ({ov:.1f} m²)")
    return errors, warnings


def complete(haus: dict, margin: float = MARGIN) -> list[str]:
    """Fill missing derived fields in place; -> list of what was filled. Existing values stay as they are."""
    done: list[str] = []
    all_polys = [p for _, r in rooms(haus) if (p := polygon(r)) is not None and p.is_valid]
    if not haus.get("ausschnitt") and all_polys:
        x0, y0, x1, y1 = unary_union(all_polys).bounds
        haus["ausschnitt"] = [
            round(x0 - margin, 2),
            round(y0 - margin, 2),
            round(x1 + margin, 2),
            round(y1 + margin, 2),
        ]
        done.append(f"ausschnitt {haus['ausschnitt']}")
    view = box(*haus["ausschnitt"]) if haus.get("ausschnitt") else None
    for g, r in rooms(haus):
        p = polygon(r)
        if p is None or not p.is_valid:
            continue
        where = f"{g.get('id')}/{r.get('id')}"
        r.setdefault("art", "raum")
        if r.get("flaeche_m2") is None:
            r["flaeche_m2"] = round(p.area, 2)
            done.append(f"{where}: flaeche_m2 {r['flaeche_m2']}")
        if not r.get("zentrum"):
            q = p.representative_point()
            r["zentrum"] = [round(q.x, 2), round(q.y, 2)]
            done.append(f"{where}: zentrum")
        if view is not None and "zentrum_sichtbar" not in r:
            vis = p.intersection(view)
            if not vis.is_empty and vis.geom_type == "Polygon":
                q = polylabel(vis, tolerance=0.05)
                r["zentrum_sichtbar"] = [round(q.x, 2), round(q.y, 2)]
                done.append(f"{where}: zentrum_sichtbar")
    return done
