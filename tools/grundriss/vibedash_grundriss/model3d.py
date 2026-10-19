"""Walls and 3D model from the house plan – an approximation good enough to find your way around, not a CAD model.

walls(haus)   -> {floor id: [polygon, ...]}  2D walls (waende_plan.json): outer wall around the rooms plus the gaps
                 between rooms. A plan with real wall lines (e.g. read from a vector PDF) can be kept instead.
model(haus, walls) -> modell3d.json: per floor the wall mass (base, height), roof faces, stairs, extra blocks.

Settings in haus.json "modell" (all optional):
  wand_aussen   outer wall thickness, default 0.30 m
  wand_innen    widest gap between rooms still drawn as a wall, default 0.32 m
  offen         [[room, room], …] rooms open to each other: no wall between them
  gelaender     [[room, void], …] a railing instead of a wall (gallery to an open space), height gelaender_hoehe (1.0)
  dach          {form: walm | sattel | flach, neigung (deg), traufe (eaves height m), ueberstand (m)}
  bloecke       [{raum, hoehe}] separate buildings (garage, barn) as plain blocks
  treppen       [{raum, y0?, y1?, stufen?}] stairs; default: every room of art "treppe" on the lowest floor
"""

from __future__ import annotations

import math

from shapely.geometry import LineString, Polygon, box
from shapely.ops import split, unary_union

from .plan import INSIDE, polygon


def _rings(geo) -> list[dict]:
    parts = [geo] if geo.geom_type == "Polygon" else list(getattr(geo, "geoms", []))
    out = []
    for p in parts:
        if p.geom_type != "Polygon" or p.area < 0.02:
            continue
        p = p.simplify(0.01)
        out.append(
            {
                "aussen": [[round(x, 3), round(y, 3)] for x, y in list(p.exterior.coords)[:-1]],
                "loecher": [
                    [[round(x, 3), round(y, 3)] for x, y in list(r.coords)[:-1]]
                    for r in p.interiors
                    if Polygon(r).area > 0.02
                ],
            }
        )
    return out


def _without_holes(geo) -> list[Polygon]:
    """Pieces without holes (the 2D plan draws each wall as one filled outline): cut through every hole."""
    todo = [p for p in ([geo] if geo.geom_type == "Polygon" else getattr(geo, "geoms", [])) if p.geom_type == "Polygon"]
    out = []
    for _ in range(10_000):
        if not todo:
            break
        p = todo.pop()
        if p.area < 0.02:
            continue
        if not p.interiors:
            out.append(p)
            continue
        hx = Polygon(p.interiors[0]).representative_point().x
        _, y0, _, y1 = p.bounds
        todo += [q for q in split(p, LineString([(hx, y0 - 1), (hx, y1 + 1)])).geoms if q.geom_type == "Polygon"]
    return out


def _railing_edges(floor: dict, cfg: dict) -> list:
    """Edges between a room and an open space that get a railing instead of a wall (config "gelaender")."""
    polys = {r["id"]: p for r in floor.get("raeume") or [] if (p := polygon(r)) is not None and p.is_valid}
    out = []
    for a, b in cfg.get("gelaender") or []:
        pa, pb = polys.get(a), polys.get(b)
        if pa is None or pb is None:
            continue
        edge = pb.exterior.intersection(pa.buffer(0.45))
        out += [k for k in getattr(edge, "geoms", [edge]) if k.geom_type == "LineString" and k.length > 0.3]
    return out


def _floor_geometry(floor: dict, cfg: dict):
    polys = {r["id"]: p for r in floor.get("raeume") or [] if (p := polygon(r)) is not None and p.is_valid}
    kinds = {r["id"]: r.get("art", "raum") for r in floor.get("raeume") or []}
    inner = [polys[i] for i in polys if kinds[i] in INSIDE]
    open_zones = [
        unary_union([polys[a], polys[b]]).buffer(0.15, join_style=2).buffer(-0.15, join_style=2)
        for a, b in cfg.get("offen") or []
        if a in polys and b in polys
    ]
    inside = unary_union(inner + open_zones) if inner else Polygon()
    outside = unary_union([polys[i] for i in polys if kinds[i] in ("aussen", "nutz")]) if polys else Polygon()
    hull = inside.buffer(0.4, join_style=2).buffer(-0.4, join_style=2) if not inside.is_empty else Polygon()
    return polys, kinds, inner, inside, outside, hull


def walls(haus: dict) -> dict:
    cfg = haus.get("modell") or {}
    outer_w = float(cfg.get("wand_aussen", 0.30))
    inner_w = float(cfg.get("wand_innen", 0.32))
    out = {}
    for floor in haus.get("geschosse") or []:
        _, _, inner, inside, outside, hull = _floor_geometry(floor, cfg)
        if hull.is_empty:
            out[floor["id"]] = []
            continue
        ring = hull.buffer(outer_w, join_style=2).difference(hull)
        gaps = hull.difference(inside).intersection(
            unary_union([p.exterior.buffer(inner_w, join_style=2) for p in inner])
        )
        w = unary_union([ring, gaps]).difference(inside).difference(outside)
        cut = unary_union([k.buffer(0.4, cap_style=2) for k in _railing_edges(floor, cfg)])
        w = w.difference(cut.intersection(hull))  # only inside: the outer wall stays whole
        # closed rings (first point repeated): the 2D plan draws each wall as an open line through its points
        out[floor["id"]] = [
            [[round(x, 3), round(y, 3)] for x, y in p.simplify(0.01).exterior.coords] for p in _without_holes(w)
        ]
    return out


def _roof(x0, y0, x1, y1, cfg) -> dict | None:
    d = cfg.get("dach") or {}
    form = d.get("form")
    if form not in ("walm", "sattel", "flach"):
        return None
    eaves, pitch, over = float(d.get("traufe", 0)), float(d.get("neigung", 30)), float(d.get("ueberstand", 0.4))
    t = math.tan(math.radians(pitch)) if form != "flach" else 0.0
    bx0, by0, bx1, by1 = x0 - over, y0 - over, x1 + over, y1 + over
    low = eaves - over * t
    if form == "flach":
        return {
            "form": form,
            "traufe": eaves,
            "flaechen": {"dach": [[bx0, by0, eaves], [bx1, by0, eaves], [bx1, by1, eaves], [bx0, by1, eaves]]},
        }
    along_x = (bx1 - bx0) >= (by1 - by0)  # ridge along the longer side
    half = ((by1 - by0) if along_x else (bx1 - bx0)) / 2
    ridge = low + half * t
    r = lambda v: round(v, 3)  # noqa: E731
    if along_x:
        ym = (by0 + by1) / 2
        fx0, fx1 = (bx0 + half, bx1 - half) if form == "walm" else (bx0, bx1)
        faces = {
            "a": [[bx0, by0, low], [bx1, by0, low], [fx1, ym, ridge], [fx0, ym, ridge]],
            "b": [[bx1, by1, low], [bx0, by1, low], [fx0, ym, ridge], [fx1, ym, ridge]],
        }
        if form == "walm":
            faces["c"] = [[bx0, by1, low], [bx0, by0, low], [fx0, ym, ridge]]
            faces["d"] = [[bx1, by0, low], [bx1, by1, low], [fx1, ym, ridge]]
    else:
        xm = (bx0 + bx1) / 2
        fy0, fy1 = (by0 + half, by1 - half) if form == "walm" else (by0, by1)
        faces = {
            "a": [[bx0, by1, low], [bx0, by0, low], [xm, fy0, ridge], [xm, fy1, ridge]],
            "b": [[bx1, by0, low], [bx1, by1, low], [xm, fy1, ridge], [xm, fy0, ridge]],
        }
        if form == "walm":
            faces["c"] = [[bx0, by0, low], [bx1, by0, low], [xm, fy0, ridge]]
            faces["d"] = [[bx1, by1, low], [bx0, by1, low], [xm, fy1, ridge]]
    return {
        "form": form,
        "neigung": pitch,
        "traufe": eaves,
        "first": round(ridge, 2),
        "flaechen": {k: [[r(a), r(b), r(c)] for a, b, c in v] for k, v in faces.items()},
    }


def model(haus: dict, plan_walls: dict | None = None) -> dict:
    cfg = haus.get("modell") or {}
    plan_walls = plan_walls if plan_walls is not None else walls(haus)
    clear = haus.get("lichte_hoehe_m") or {}
    out: dict = {"quelle": f"haus.json ({haus.get('quelle', 'Plan')}), näherungsweise", "einheit": "m", "geschosse": []}
    footprints, all_polys = [], {}
    floors = haus.get("geschosse") or []
    for floor in floors:
        polys, kinds, _, inside, outside, hull = _floor_geometry(floor, cfg)
        all_polys.update(polys)
        if hull.is_empty:
            continue
        w = unary_union([Polygon(p) for p in plan_walls.get(floor["id"]) or [] if len(p) >= 3]).buffer(0)
        w = w.difference(inside).difference(outside) if not w.is_empty else w
        railings = []
        for k in _railing_edges(floor, cfg):
            w = w.difference(k.buffer(0.4, cap_style=2).intersection(hull))
            railings.append(
                {
                    "pfad": [[round(x, 3), round(y, 3)] for x, y in k.coords],
                    "laenge": round(k.length, 2),
                    "hoehe": float(cfg.get("gelaender_hoehe", 1.0)),
                }
            )
        footprint = hull.buffer(float(cfg.get("wand_aussen", 0.30)), join_style=2)
        footprints.append(footprint)
        voids = [polys[i] for i in polys if kinds[i] == "luftraum"]
        out["geschosse"].append(
            {
                "id": floor["id"],
                "boden": float(floor.get("hoehe_fussboden_m", 0.0)),
                "hoehe": float(clear.get(floor["id"], 2.6)),
                "waende": _rings(w) if not w.is_empty else [],
                "gelaender": railings,
                "decke": _rings(footprint.difference(unary_union(voids)) if voids else footprint),
            }
        )
    blocks = []
    for b in cfg.get("bloecke") or []:
        p = all_polys.get(b.get("raum"))
        if p is None:
            continue
        bb = box(*p.bounds)
        blocks.append(
            {
                "base": 0,
                "height": float(b.get("hoehe", 3.0)),
                "walls": [
                    {"outer": x["aussen"], "holes": x["loecher"]}
                    for x in _rings(bb.buffer(0.25, join_style=2).difference(bb))
                ],
            }
        )
    out["bloecke"] = blocks
    if footprints:
        x0, y0, x1, y1 = unary_union(footprints).bounds
        out["gebaeude"] = [round(v, 3) for v in (x0, y0, x1, y1)]
        roof = _roof(x0, y0, x1, y1, cfg)
        if roof:
            out["dach"] = roof
    stairs = []
    lowest = floors[0] if floors else {"raeume": []}
    wanted = cfg.get("treppen") or [{"raum": r["id"]} for r in lowest.get("raeume") or [] if r.get("art") == "treppe"]
    up = next((float(f.get("hoehe_fussboden_m", 0)) for f in floors[1:2]), 0.0) or float(
        clear.get(lowest.get("id"), 2.6)
    )
    for s in wanted:
        p = all_polys.get(s.get("raum"))
        if p is None:
            continue
        x0, y0, x1, y1 = p.bounds
        stairs.append(
            {
                "x0": round(x0 + 0.05, 3),
                "x1": round(x1 - 0.05, 3),
                "y0": float(s.get("y0", y0)),
                "y1": float(s.get("y1", y1)),
                "stufen": int(s.get("stufen", 15)),
                "hoehe": up,
            }
        )
    out["treppen"] = stairs
    return out
