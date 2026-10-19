"""Board of the module "raeume": floor plan with live values per room and today's light/motion timeline.

Pure functions over plain data (no I/O), so tests run on a synthetic house:

  plan(geo, walls, model, names)       floors + rooms (+ 3D model) from the floor plan files
  build(plan, readings, events, ...)   the whole board (one section of type "plan", contract src/model/board.ts)

Readings (from InfluxDB, see source.py): {"klima": [(typ, raum, wert)], "lux": [(raum, lux)]} – typ one of
ist (room controller), ist_matter (room sensor), ist_decke (ceiling), aussen_temp, feuchte, aussen_feuchte, soll
(set point), stellgroesse (valve %). "raum" is the name the house uses in its series; rooms list these names in
the plan ("knx": [...]) or in the config ("namen": {room_id: [...]}).

Events (optional house service, config "einschub_url", see source.py):
  {"licht": {"vorher": [[raum, quelle, an]], "wechsel": [[ts_ms, raum, quelle, an]]},
   "bewegung": [[ts_ms, raum]], "letzte_bewegung": {room_id: ts_ms}}
  vorher = last state of every light (quelle = its id, e.g. a group address) before today 0:00,
  wechsel = every change since then, bewegung = motion reports since then, letzte_bewegung = last motion of every
  room with a motion sensor.
"""

from __future__ import annotations

KIND = {
    "raum": "room",
    "aussen": "outside",
    "nutz": "outside",
    "dach": "outside",
    "luftraum": "void",
    "treppe": "stairs",
}
STEP_S = 15 * 60

TEXT = {
    "title": "Grundriss",
    "temp": "Temperatur",
    "humidity": "Feuchte",
    "valve": "Heizung",
    "light": "Licht",
    "presence": "Bewegung",
    "t_room": "Temperatur (Raum)",
    "t_ctrl": "Temperatur (Regler)",
    "t_ceiling": "Temperatur (Decke)",
    "t_plain": "Temperatur",
    "set": "Soll",
    "valve_d": "Heizventil",
    "hum_d": "Luftfeuchte",
    "lux_d": "Helligkeit",
    "light_d": "Licht",
    "on": "an",
    "off": "aus",
    "motion_d": "Letzte Bewegung",
    "motion_ago": "vor {m} min",
    "area": "Fläche",
    "note": "Temperatur und Feuchte vom Raumsensor (sonst Heizungsregler), Licht aus der Rückmeldung der "
    "Aktoren, Bewegung von den Präsenzmeldern. Raum antippen für alle Werte.",
    "what": "Grundriss mit Live-Werten je Raum; Licht und Bewegung lassen sich für heute abspielen.",
    "source": "Grundriss aus local/modules (Plan-Dateien); Werte aus InfluxDB (Raumklima, Helligkeit) und – "
    "falls angebunden – Licht/Bewegung vom Haus-Dienst.",
    "floor_EG": "Erdgeschoss",
    "floor_OG": "Obergeschoss",
}


def norm(name) -> str:
    """Series names are matched loosely: case, umlauts, spaces and dashes do not matter."""
    return (
        str(name or "")
        .lower()
        .replace("ä", "ae")
        .replace("ö", "oe")
        .replace("ü", "ue")
        .replace("ß", "ss")
        .replace(" ", "")
        .replace("-", "")
    )


def _clean(x, n=40) -> str:
    return " ".join(str(x or "").split())[:n]


def de1(v):
    return None if v is None else f"{v:.1f}".replace(".", ",")


def plan(geo: dict, walls: dict, model: dict | None, t: dict) -> tuple[list, list, dict | None]:
    """-> (floors, rooms (raw, in plan order), model3d or None)."""
    box = [float(v) for v in geo.get("ausschnitt", [0, 0, 15, 15])]
    floors, rooms_all = [], []
    for g in geo.get("geschosse") or []:
        rooms = []
        for r in g.get("raeume") or []:
            rooms.append(
                {
                    "id": r["id"],
                    "name": _clean(r["name"], 40),
                    "kind": KIND.get(r.get("art"), "room"),
                    "polygon": r["polygon"],
                    "label": r.get("zentrum_sichtbar") or r.get("zentrum"),
                }
            )
            rooms_all.append(r)
        floors.append(
            {
                "id": g["id"],
                "name": t.get(f"floor_{g['id']}") or g.get("name") or g["id"],
                "box": box,
                "walls": walls.get(g["id"], []),
                "rooms": rooms,
            }
        )
    return floors, rooms_all, model3d(model) if model else None


def model3d(m: dict) -> dict:
    """Walls per floor (outline minus rooms), roof, stairs, barn – the plan's 3D file in the board's shape."""

    def solids(ws):
        return [{"outer": w["aussen"], "holes": w.get("loecher") or []} for w in ws]

    return {
        "floors": [
            {
                "id": g["id"],
                "base": g.get("boden", 0),
                "height": g.get("hoehe", 2.75),
                "walls": solids(g.get("waende") or []),
            }
            for g in m.get("geschosse") or []
        ],
        "roof": list((m.get("dach") or {}).get("flaechen", {}).values()),
        "stairs": [
            {
                "x0": s["x0"],
                "x1": s["x1"],
                "y0": s["y0"],
                "y1": s["y1"],
                "base": 0,
                "height": s.get("hoehe", 3.0),
                "steps": s.get("stufen", 15),
            }
            for s in m.get("treppen") or []
        ],
        "blocks": (
            [{"base": 0, "height": m["scheune"].get("hoehe", 5.5), "walls": solids(m["scheune"].get("waende") or [])}]
            if m.get("scheune")
            else []
        )
        + [b for b in m.get("bloecke") or [] if isinstance(b, dict)],  # from tools/grundriss (already in board shape)
    }


def room_index(rooms: list, names: dict) -> dict:
    """norm(series name) -> [room ids]."""
    out: dict = {}
    for r in rooms:
        for n in (r.get("knx") or []) + list(names.get(r["id"], [])):
            out.setdefault(norm(n), []).append(r["id"])
    return out


def timeline(events: dict, to_room: dict, start_ms: int, now_ms: int):
    """-> (light now {room: 0|1}, light per step {room: [...]}, presence per step {room: [...]}, steps)."""
    step_ms = STEP_S * 1000
    steps = max(1, (now_ms - start_ms) // step_ms)
    light = events.get("licht") or {}
    state = {q: (raum, an) for raum, q, an in light.get("vorher") or []}
    changes = sorted(light.get("wechsel") or [], key=lambda w: w[0])

    def on_by_room(z):
        on: dict = {}
        for raum, an in z.values():
            for rid in to_room.get(norm(raum), []):
                on[rid] = on.get(rid, 0) or (1 if an == 1 else 0)
        return on

    light_tl: dict = {}
    i = 0
    for k in range(steps):
        end = start_ms + (k + 1) * step_ms
        on_step = on_by_room(state)  # on at the start of the step
        while i < len(changes) and changes[i][0] < end:
            _ts, raum, q, an = changes[i]
            state[q] = (raum, an)
            if an == 1:
                for rid in to_room.get(norm(raum), []):
                    on_step[rid] = 1
            i += 1
        for rid, v in on_step.items():
            light_tl.setdefault(rid, [0] * steps)[k] = 1 if v else 0
    presence_tl: dict = {}
    for ts, raum in events.get("bewegung") or []:
        k = (ts - start_ms) // step_ms
        if 0 <= k < steps:
            for rid in to_room.get(norm(raum), []):
                presence_tl.setdefault(rid, [0] * steps)[k] = 1
    return on_by_room(state), light_tl, presence_tl, steps


def build(
    floors: list,
    rooms: list,
    model: dict | None,
    readings: dict,
    events: dict,
    cfg: dict,
    start_ms: int,
    now_ms: int,
    t: dict,
) -> dict:
    to_room = room_index(rooms, cfg.get("namen") or {})
    values: dict = {}
    for typ, raum, v in readings.get("klima") or []:
        for rid in to_room.get(norm(raum), []):
            values.setdefault(rid, {}).setdefault(typ, []).append(v)
    # rooms that share one climate (e.g. an open kitchen/dining area heated with the living room)
    for target, src in (cfg.get("gleicher_raum") or {}).items():
        if values.get(src) and not values.get(target):
            values[target] = values[src]
    lux: dict = {}
    for raum, v in readings.get("lux") or []:
        for rid in to_room.get(norm(raum), []):
            lux[rid] = max(lux.get(rid, 0), v)

    def first(rid, *types):
        for typ in types:
            vs = (values.get(rid) or {}).get(typ)
            if vs:
                return vs[0] if typ != "stellgroesse" else max(vs)
        return None

    light_now, light_tl, presence_tl, steps = timeline(events, to_room, start_ms, now_ms)
    pj = {}
    for rid, ts in (events.get("letzte_bewegung") or {}).items():
        if ts:
            m = (now_ms - int(ts)) / 60000
            pj[rid] = round(m) if m <= 60 else None

    ids = [r["id"] for r in rooms]
    temp = {i: first(i, "ist_matter", "ist", "aussen_temp") for i in ids}
    hum = {i: first(i, "feuchte", "aussen_feuchte") for i in ids}
    valve = {i: first(i, "stellgroesse") for i in ids}
    views = [
        {
            "id": "temp",
            "label": t["temp"],
            "kind": "temp",
            "unit": "°",
            "values": temp,
            "texts": {i: f"{de1(v)}°" for i, v in temp.items() if v is not None},
        },
        {
            "id": "feuchte",
            "label": t["humidity"],
            "kind": "humidity",
            "unit": " %",
            "values": hum,
            "texts": {i: f"{round(v)} %" for i, v in hum.items() if v is not None},
        },
        {
            "id": "heizung",
            "label": t["valve"],
            "kind": "valve",
            "unit": " %",
            "values": valve,
            "texts": {i: f"{round(v)} %" for i, v in valve.items() if v is not None},
        },
        {
            "id": "licht",
            "label": t["light"],
            "kind": "light",
            "unit": "",
            "values": {i: light_now.get(i, 0) if i in light_tl or i in light_now else None for i in ids},
            "texts": {},
        },
        {"id": "praesenz", "label": t["presence"], "kind": "presence", "unit": " min", "values": pj, "texts": {}},
    ]
    details = {}
    for r in rooms:
        i = r["id"]
        d = []
        for typ, label in (
            ("ist_matter", "t_room"),
            ("ist", "t_ctrl"),
            ("ist_decke", "t_ceiling"),
            ("aussen_temp", "t_plain"),
            ("soll", "set"),
        ):
            if first(i, typ) is not None:
                d.append({"label": t[label], "value": f"{de1(first(i, typ))} °C"})
        if valve.get(i) is not None:
            d.append({"label": t["valve_d"], "value": f"{round(valve[i])} %"})
        if hum.get(i) is not None:
            d.append({"label": t["hum_d"], "value": f"{round(hum[i])} %"})
        if i in lux:
            d.append({"label": t["lux_d"], "value": f"{round(lux[i])} lx"})
        if i in light_now:
            d.append({"label": t["light_d"], "value": t["on"] if light_now[i] else t["off"]})
        if i in pj:
            d.append({"label": t["motion_d"], "value": "–" if pj[i] is None else t["motion_ago"].format(m=pj[i])})
        if r.get("flaeche_m2"):
            d.append({"label": t["area"], "value": f"{str(r['flaeche_m2']).replace('.', ',')} m²"})
        details[i] = d
    section = {
        "type": "plan",
        "title": t["title"],
        "floors": floors,
        "views": views,
        "details": details,
        "timeline": {
            "start": start_ms,
            "stepMs": STEP_S * 1000,
            "steps": steps,
            "light": light_tl,
            "presence": presence_tl,
        },
        **({"model3d": model} if model else {}),
        "note": t["note"],
        "info": {"what": t["what"], "source": t["source"]},
    }
    return {"updated": now_ms, "sections": [section]}
