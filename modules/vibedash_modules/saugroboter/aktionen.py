"""Cleaning actions of the module "saugroboter" – predefined like light scenes ("Nach dem Kochen": robot, rooms,
mode) and areas drawn on the floor plan ("Bereich"). A tap stores a wish for the HOUSE in a small file, the house
sends the command to the robot and writes back what happened. Nothing is switched here.

Config:
  aktionen  [{id, name, sub?, geraet, raeume: [segment ids] | "alle" | zonen: [zone ids], modus?, staerke?,
            durchgaenge?}] – the house reads the same entries; per robot "pause" and "heim" are always offered
  zonen     {id: {name, geschoss, rechteck_m: [x0, y0, x1, y1]}} – areas in floor-plan metres for one-off zone
            cleaning (e.g. only the kitchen of a combined room); the house converts them to the robot map
            ("karten" in the same file). Without "sub" a zone action shows "Bereich: <zone names>".
  karten    {robot: {geschoss, sperr_m?: [[x0, y0, x1, y1]], rand_m?, …}} – which floor a robot cleans; with
            "grundriss" the board offers drawing new areas on that floor (section "zones"); never across sperr_m
  grundriss {haus, waende?} – floor-plan files as in the module "raeume"
  bereiche  file with the areas drawn in VibeDash, default "saugroboter_bereiche.json":
            {"bereiche": [{id, name, geraet, geschoss, rechtecke_m: [[x0, y0, x1, y1], …] (1–5), modus}]} – each
            one is an action "b-<id>" for the house that cleans all its rectangles (zones "b-<id>", "b-<id>#2" …);
            older entries with a single "rechteck_m" still count
  wunsch    wish file (relative to the modules folder or absolute), default "saugroboter_wunsch.json":
            {"nr", "id", "geraet", "zeit" (ms)}
  stand     file the house writes after sending, default "saugroboter_stand.json":
            {"nr", "id", "ok", "text", "zeit" (ms)}
"""

from __future__ import annotations

import json
import math
import os
import re
from datetime import datetime

from ..raeume import board as plan_board

ITEM = re.compile(r"^saug:([a-z0-9_-]{1,32})(?:\.([a-z0-9]{1,12}))?$")
ZONE_ITEM = re.compile(r"^zone:([a-z0-9_-]{1,32})$")
BASIC = (("pause", "Pause", "anhalten"), ("heim", "Nach Hause", "zurück zur Station"))
PENDING_MS = 5 * 60_000  # a wish the house has not taken after 5 min counts as lost
PER_ROW = 5  # a choice shows at most 5 options
MODES = (("saugen", "Saugen"), ("saugen_wischen", "Saugen + Wischen"), ("wischen", "Wischen"))
MODE_SUB = {"saugen": "saugen", "saugen_wischen": "saugen und wischen", "wischen": "wischen"}
MAX_OWN = 20  # drawn areas per robot
MAX_RECTS = 5  # rectangles in one area (one zone-cleaning command)
MIN_SIDE_M, MAX_AREA_M2, RAND_M = 0.3, 60.0, 0.2
NAME_OK = re.compile(r"^[^\x00-\x1f\x7f]{1,24}$")


def _load(p: str) -> dict:
    try:
        with open(p, encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def _write(p: str, d: dict) -> None:
    tmp = p + ".neu"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=1)
    os.replace(tmp, p)


def _key(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(name).lower()).strip("-")[:32] or "x"


def _slug(name: str) -> str:
    s = str(name).lower()
    for a, b in (("ä", "ae"), ("ö", "oe"), ("ü", "ue"), ("ß", "ss")):
        s = s.replace(a, b)
    return _key(s)[:24] or "bereich"


def own_areas(cfg: dict, path) -> list:
    """The areas drawn in VibeDash (checked lightly: they come from our own file)."""
    raw = _load(path(cfg.get("bereiche") or "saugroboter_bereiche.json")).get("bereiche")
    return [
        b
        for b in raw or []
        if isinstance(b, dict) and b.get("id") and b.get("name") and b.get("geraet") and rects_of(b)
    ]


def rects_of(b: dict) -> list:
    """The rectangles of a drawn area (new: rechtecke_m, old: one rechteck_m)."""
    raw = b.get("rechtecke_m") if isinstance(b.get("rechtecke_m"), list) else [b.get("rechteck_m")]
    return [r for r in (_rect(x) for x in raw[:MAX_RECTS]) if r]


def merged(cfg: dict, path) -> dict:
    """Config plus the drawn areas, each one as zone "b-<id>" and action "b-<id>"."""
    own = own_areas(cfg, path)
    if not own:
        return cfg
    zonen = dict(cfg.get("zonen") or {})
    acts = list(cfg.get("aktionen") or [])
    for b in own:
        zid = f"b-{b['id']}"
        zids = [zid if i == 0 else f"{zid}#{i + 1}" for i in range(len(rects_of(b)))]
        for z, r in zip(zids, rects_of(b)):
            zonen[z] = {"name": b["name"], "geschoss": b.get("geschoss"), "rechteck_m": r}
        mode = b.get("modus") if b.get("modus") in MODE_SUB else "saugen"
        acts.append(
            {
                "id": zid,
                "name": b["name"],
                "sub": f"Bereich {MODE_SUB[mode]}",
                "geraet": b["geraet"],
                "zonen": zids,
                "modus": mode,
            }
        )
    return {**cfg, "zonen": zonen, "aktionen": acts}


def _zone_sub(cfg: dict, a: dict) -> str:
    zs = a.get("zonen")
    if not isinstance(zs, list) or not zs:
        return ""
    known = cfg.get("zonen") if isinstance(cfg.get("zonen"), dict) else {}
    names = [str((known.get(z) or {}).get("name") or z) if isinstance(z, str) else "?" for z in zs]
    return "Bereich: " + ", ".join(names)


def actions(cfg: dict) -> dict:
    """-> {robot: [(value, label, sub, group)]} in the order of the config; group "raeume" | "bereiche"."""
    out: dict = {}
    for a in cfg.get("aktionen") or []:
        if isinstance(a, dict) and a.get("id") and a.get("name") and a.get("geraet"):
            out.setdefault(str(a["geraet"]), []).append(
                (
                    str(a["id"]),
                    str(a["name"])[:24],
                    str(a.get("sub") or _zone_sub(cfg, a))[:60],
                    "bereiche" if "zonen" in a else "raeume",
                )
            )
    return out


def rows(cfg: dict) -> list:
    """-> [(robot, row key, title, [(value, label, sub)])]: rooms, areas (in rows of 5), pause/home last."""
    out = []
    for robot, opts in actions(cfg).items():
        for group, title in (("raeume", "Räume"), ("bereiche", "Bereiche")):
            mine = [o[:3] for o in opts if o[3] == group]
            chunks = [mine[i : i + PER_ROW] for i in range(0, len(mine), PER_ROW)]
            for n, c in enumerate(chunks):
                key = group if n == 0 else f"{group}{n + 1}"
                if len(c) == 1:  # a choice needs two options: a lone one joins the last row of the group before
                    c = c + [BASIC[0]]
                out.append((robot, key, f"{title} {robot}" + (f" ({n + 1})" if n else ""), c))
        out.append((robot, "steuern", f"Steuern {robot}", list(BASIC)))
    return out


def _item(robot: str, key: str) -> str:
    return f"saug:{_key(robot)}" + ("" if key == "raeume" else f".{key}")


def sections(cfg: dict, path, tz, now_ms: int) -> list:
    cfg = merged(cfg, path)
    rs = rows(cfg)
    if not rs:
        return []
    wish = _load(path(cfg.get("wunsch") or "saugroboter_wunsch.json"))
    stand = _load(path(cfg.get("stand") or "saugroboter_stand.json"))

    def hm(ms):
        return datetime.fromtimestamp(ms / 1000, tz).strftime("%H:%M")

    out = []
    for robot, key, title, opts in rs:
        mine = wish.get("geraet") == robot and any(v == wish.get("id") for v, _, _ in opts)
        done = mine and stand.get("nr") == wish.get("nr")
        open_ = mine and not done and now_ms - int(wish.get("zeit") or 0) < PENDING_MS
        if done:
            note = f"{hm(int(stand.get('zeit') or 0))}: {stand.get('text') or ''}".strip()
        elif open_:
            note = "Wird gesendet …"
        elif mine:
            note = "Nicht gesendet – der Haus-Dienst hat den Wunsch nicht übernommen."
        else:
            note = "Antippen startet die Aktion." if key != "steuern" else "Antippen hält an oder schickt heim."
        out.append(
            {
                "type": "choice",
                "title": title,
                "id": _item(robot, key),
                "selected": wish.get("id") if open_ else None,
                "options": [{"value": v, "label": lb, **({"sub": s} if s else {})} for v, lb, s in opts],
                "note": note,
                "info": {
                    "what": "Vorgefertigte Putzaktionen wie Lichtszenen; Bereiche sind Rechtecke auf dem Grundriss. "
                    "Pause und Nach Hause gibt es immer.",
                    "source": "Wunsch an den Haus-Dienst, der den Befehl über die Hersteller-Cloud schickt.",
                },
            }
        )
    return out + zone_sections(cfg, path)


def choose(cfg: dict, path, item: str, value, now_ms: int) -> tuple[int, dict]:
    cfg = merged(cfg, path)
    m = ITEM.match(str(item or ""))
    rs = [r for r in rows(cfg) if m and _item(r[0], r[1]) == item]
    if not rs:
        return 404, {"ok": False, "text": "keine Aktion"}
    robot, _, _, opts = rs[0]
    label = next((lb for v, lb, _ in opts if v == value), None)
    if label is None:
        return 400, {"ok": False, "text": "unbekannte Aktion"}
    p = path(cfg.get("wunsch") or "saugroboter_wunsch.json")
    nr = int(_load(p).get("nr") or 0) + 1
    _write(p, {"nr": nr, "id": value, "geraet": robot, "zeit": now_ms})
    return 200, {"ok": True, "text": f"{robot}: {label} – wird gesendet"}


# ── areas drawn on the floor plan ─────────────────────────────────────────────


def _rect(r) -> list | None:
    if not (isinstance(r, list) and len(r) == 4):
        return None
    if not all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in r):
        return None
    x0, x1 = sorted((float(r[0]), float(r[2])))
    y0, y1 = sorted((float(r[1]), float(r[3])))
    return [round(x0, 2), round(y0, 2), round(x1, 2), round(y1, 2)]


def _hits(a: list, b: list) -> bool:
    return min(a[2], b[2]) > max(a[0], b[0]) and min(a[3], b[3]) > max(a[1], b[1])


def _floors(cfg: dict, path) -> dict:
    g = cfg.get("grundriss") or {}
    if not g.get("haus"):
        return {}
    try:
        geo = _load(path(g["haus"]))
        walls = _load(path(g["waende"])) if g.get("waende") else {}
        floors, _, _ = plan_board.plan(geo, walls, None, {})
    except (KeyError, TypeError, ValueError):
        return {}
    return {f["id"]: f for f in floors}


def zone_sections(cfg: dict, path) -> list:
    """Per robot with a floor (karten.<robot>.geschoss): the floor plan to draw a new area on."""
    floors = _floors(cfg, path)
    if not floors:
        return []
    own = own_areas(cfg, path)
    out = []
    for robot, k in (cfg.get("karten") or {}).items():
        f = floors.get((k or {}).get("geschoss")) if isinstance(k, dict) else None
        if not f:
            continue
        zones = [
            {"id": zid, "name": str(z.get("name") or zid)[:24], "rects": [_rect(z.get("rechteck_m"))]}
            for zid, z in (cfg.get("zonen") or {}).items()
            if isinstance(z, dict)
            and z.get("geschoss") == k["geschoss"]
            and _rect(z.get("rechteck_m"))
            and not str(zid).startswith("b-")
        ] + [
            {
                "id": b["id"],
                "name": b["name"][:24],
                "rects": rects_of(b),
                "own": True,
                "mode": b.get("modus") if b.get("modus") in MODE_SUB else "saugen",
            }
            for b in own
            if b["geraet"] == robot
        ]
        out.append(
            {
                "type": "zones",
                "title": f"Neuer Bereich {robot}",
                "id": f"zone:{_key(robot)}",
                "floor": {key: f[key] for key in ("id", "name", "box", "walls", "rooms")},
                "zones": zones,
                "blocked": [r for r in (_rect(s) for s in k.get("sperr_m") or []) if r],
                "modes": [{"value": v, "label": lb} for v, lb in MODES],
                "note": "Ein oder mehrere Rechtecke aufziehen, Namen geben, speichern – der Bereich steht dann als "
                "Knopf oben und putzt alle seine Rechtecke.",
                "info": {
                    "what": "Bereiche sind Rechtecke auf dem Grundriss. Der Roboter putzt sie einmal, auf dem Roboter "
                    "wird nichts gespeichert. Gesperrte Flächen (schraffiert) lassen sich nicht wählen.",
                    "source": "Die Umrechnung auf die Roboterkarte macht der Haus-Dienst, auf etwa ±0,3 m genau.",
                },
            }
        )
    return out


def zone(cfg: dict, path, item: str, z, now_ms: int) -> tuple[int, dict]:
    """{name, rects: [[x0, y0, x1, y1], …] (or one rect), mode} adds an area, {…, replace: id} changes one of the drawn areas (same id, so its button
    stays), {remove: id} deletes one."""
    m = ZONE_ITEM.match(str(item or ""))
    karten = cfg.get("karten") or {}
    robot = next((r for r in karten if m and _key(r) == m.group(1)), None)
    if robot is None or not isinstance(z, dict):
        return 404, {"ok": False, "text": "kein Bereich"}
    p = path(cfg.get("bereiche") or "saugroboter_bereiche.json")
    data = _load(p)
    alle = [b for b in data.get("bereiche") or [] if isinstance(b, dict)]
    if "remove" in z:
        keep = [b for b in alle if not (b.get("geraet") == robot and b.get("id") == z["remove"])]
        if len(keep) == len(alle):
            return 404, {"ok": False, "text": "Bereich nicht gefunden"}
        _write(p, {**data, "bereiche": keep})
        return 200, {"ok": True, "text": "Bereich gelöscht"}
    k = karten[robot] if isinstance(karten[robot], dict) else {}
    floor = _floors(cfg, path).get(k.get("geschoss"))
    name = str(z.get("name") or "").strip()
    raw = z.get("rects") if isinstance(z.get("rects"), list) else [z.get("rect")]
    rs = [_rect(x) for x in raw]
    if not floor:
        return 400, {"ok": False, "text": "kein Grundriss für diesen Roboter"}
    if not NAME_OK.match(name):
        return 400, {"ok": False, "text": "Name fehlt (höchstens 24 Zeichen)"}
    if not rs or not all(rs):
        return 400, {"ok": False, "text": "kein Rechteck"}
    if len(rs) > MAX_RECTS:
        return 400, {"ok": False, "text": f"höchstens {MAX_RECTS} Rechtecke je Bereich"}
    bx = floor["box"]
    rs = [[max(r[0], bx[0]), max(r[1], bx[1]), min(r[2], bx[2]), min(r[3], bx[3])] for r in rs]
    if any(r[2] - r[0] < MIN_SIDE_M or r[3] - r[1] < MIN_SIDE_M for r in rs):
        return 400, {"ok": False, "text": "Bereich zu klein"}
    if sum((r[2] - r[0]) * (r[3] - r[1]) for r in rs) > MAX_AREA_M2:
        return 400, {"ok": False, "text": "Bereich zu groß (höchstens 60 m²)"}
    rand = float(k.get("rand_m", RAND_M))
    blocked = [b for b in (_rect(x) for x in k.get("sperr_m") or []) if b]
    for r in rs:
        grown = [r[0] - rand, r[1] - rand, r[2] + rand, r[3] + rand]
        if any(_hits(grown, b) for b in blocked):
            return 400, {"ok": False, "text": "Bereich berührt eine gesperrte Fläche"}
    rects = [[round(v, 2) for v in r] for r in rs]
    mode = z.get("mode") if z.get("mode") in MODE_SUB else "saugen"
    if "replace" in z:
        i = next((i for i, b in enumerate(alle) if b.get("geraet") == robot and b.get("id") == z["replace"]), None)
        if i is None:
            return 404, {"ok": False, "text": "Bereich nicht gefunden"}
        old = {k: v for k, v in alle[i].items() if k != "rechteck_m"}
        alle[i] = {**old, "name": name, "rechtecke_m": rects, "modus": mode, "geaendert": now_ms}
        _write(p, {**data, "bereiche": alle})
        return 200, {"ok": True, "text": f"Bereich „{name}“ geändert"}
    if sum(1 for b in alle if b.get("geraet") == robot) >= MAX_OWN:
        return 400, {"ok": False, "text": f"höchstens {MAX_OWN} Bereiche je Roboter"}
    base = _slug(name)
    taken = {b.get("id") for b in alle}
    bid, n = base, 2
    while bid in taken:
        bid, n = f"{base[:21]}-{n}", n + 1
    alle.append(
        {
            "id": bid,
            "name": name,
            "geraet": robot,
            "geschoss": k.get("geschoss"),
            "rechtecke_m": rects,
            "modus": mode,
            "angelegt": now_ms,
        }
    )
    _write(p, {**data, "bereiche": alle})
    return 200, {"ok": True, "text": f"Bereich „{name}“ gespeichert"}
