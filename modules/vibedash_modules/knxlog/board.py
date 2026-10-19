"""Board of the module "knxlog": the last 24 hours on the KNX bus. Pure function over plain data:

  build(data, inventory, cfg, now_ms, tz)

data (house service, config "einschub_url"):
  {"telegramme": [[ms, ga, name, source, raw]], "tueren": [[ms, name, open]],
   "protokoll": [{"zeit": ms, "raum", "was", "wie"}]}   – wie: "Defekt" | "Hinweis" | Taster / Automatik …
inventory (local/modules, config "inventar"): {"geraete": {address: [name, room, model]}, "ga_namen": {ga: name}}

Which group addresses are cyclic readings, valves or doors, and which device is the bridge, comes from the
config (house rules, see README "Module knxlog").
"""

from __future__ import annotations

import re
from datetime import datetime

from ..fmt import clean

STEP_MS = 15 * 60_000
EVENTS_MAX = 200
TEL_MAX = 300

DEFAULTS = {
    "gruppen": [
        {"label": "Heizung", "color": "import", "prefix": ["3/"]},
        {"label": "Licht und Schalten", "color": "home", "prefix": ["1/", "4/", "5/"]},
        {"label": "Präsenz und Türen", "color": "sun", "prefix": ["2/"]},
    ],
    "messwerte": [],
    "stellgroessen": [],
    "tuer_prefix": [],
    "prozent_prefix": ["1/"],
    "bridge": None,
    "ohne_anlass": [],
    "ohne_anlass_name": ["Taster"],
    "arten": [
        ["Präsenz", "Präsenz"],
        ["Taster", "Taster"],
        ["Multi", "Taster"],
        ["Dimmer", "Aktoren"],
        ["Schalt", "Aktoren"],
        ["Heizung", "Heizung"],
    ],
    "raum_namen": {"–": ""},
    "tueren": [],
    "tuer_sonst": "Tür",
}


def _dpt9(b0, b1):
    m = ((b0 & 0x07) << 8) | b1
    if b0 & 0x80:
        m -= 2048
    return 0.01 * m * (1 << ((b0 >> 3) & 0x0F))


def value(ga, raw, cfg):
    """Raw value readable: 1 bit on/off (doors open/closed), 1 byte as % for lights, 2 bytes as float (DPT 9)."""
    m = re.search(r'value="([^"]*)"', raw)
    if not m:
        return raw[:20]
    v = m.group(1)
    if "DPTBinary" in raw:
        if ga.startswith(tuple(cfg["tuer_prefix"])) and cfg["tuer_prefix"]:
            return "zu" if v == "1" else "offen"
        return "Ein" if v == "1" else "Aus"
    try:
        b = [int(x, 16) for x in v.strip("[]").split(",") if x.strip()]
    except ValueError:
        return v[:20]
    if len(b) == 1:
        return f"{round(b[0] * 100 / 255)} %" if ga.startswith(tuple(cfg["prozent_prefix"])) else str(b[0])
    if len(b) == 2:
        return f"{_dpt9(*b):.1f}".replace(".", ",")
    return " ".join(f"{x:02x}" for x in b)


def build(data: dict, inventory: dict, cfg: dict, now_ms: int, tz) -> dict:
    c = {**DEFAULTS, **{k: v for k, v in cfg.items() if k in DEFAULTS}}
    devices = {a: tuple(v) for a, v in (inventory.get("geraete") or {}).items()}
    ga_names = inventory.get("ga_namen") or {}
    bridge = c["bridge"] or {}
    b_addr, b_name = bridge.get("adresse"), bridge.get("name") or "Bridge"
    readings, valves = tuple(c["messwerte"]), tuple(c["stellgroessen"])
    until = now_ms
    since = until - 86_400_000
    today = datetime.fromtimestamp(now_ms / 1000, tz).strftime("%Y-%m-%d")

    def at(ms):
        d = datetime.fromtimestamp(ms / 1000, tz)
        s = d.strftime("%H:%M:%S")
        return s if d.strftime("%Y-%m-%d") == today else "gestern " + s[:5]

    tel = [t for t in data.get("telegramme") or [] if isinstance(t, list) and len(t) == 5]
    doors = data.get("tueren") or []
    proto = data.get("protokoll") or []

    # bus traffic per 15 min
    start = since - since % STEP_MS
    n = (until - start) // STEP_MS + 1
    x = [start + i * STEP_MS + STEP_MS // 2 for i in range(n)]
    groups = [(g["label"], g.get("color") or "home", tuple(g.get("prefix") or ())) for g in c["gruppen"]]
    count = {lab: [0] * n for lab, _, _ in groups}
    n_readings = 0
    hours = [0] * 24
    for ms, ga, _, _, _ in tel:
        i = (ms - start) // STEP_MS
        h = min(23, (ms - since) // 3_600_000)
        if readings and ga.startswith(readings):
            n_readings += 1
            hours[h] += 1
            continue
        for lab, _, pre in groups:
            if pre and ga.startswith(pre):
                if 0 <= i < n:
                    count[lab][i] += 1
                break
        hours[h] += 1

    # devices
    per_src: dict = {}
    for ms, _, _, src, _ in tel:
        a = per_src.setdefault(src, [0, 0])
        a[0] += 1
        a[1] = ms
    active = sum(1 for a in devices if a in per_src)

    def kind(addr):
        if addr == b_addr:
            return b_name
        name = devices.get(addr, ("",))[0]
        for front, lab in c["arten"]:
            if name.startswith(front):
                return lab
        return "Sonstige"

    kinds: dict = {}
    for addr, (cnt, _) in per_src.items():
        kinds[kind(addr)] = kinds.get(kind(addr), 0) + cnt
    kinds_sorted = sorted(kinds.items(), key=lambda kv: -kv[1])

    def sortkey(addr):
        try:
            return tuple(int(p) for p in addr.split("."))
        except ValueError:
            return (999,)

    device_rows = []
    for addr in sorted(set(devices) | set(per_src), key=sortkey):
        name, _room, _model = devices.get(addr, (f"{b_name}-Bridge" if addr == b_addr else "unbekannt", "", ""))
        cnt, last = per_src.get(addr, (0, 0))
        quiet = cnt == 0 and addr not in c["ohne_anlass"] and not any(name.startswith(p) for p in c["ohne_anlass_name"])
        device_rows.append(
            {
                "cells": {
                    "a": addr,
                    "g": clean(f"{name} · {addr}", 50),
                    "n": str(cnt) if cnt else "–",
                    "z": at(last) if last else "nichts in 24 h",
                },
                **({"state": "look"} if quiet or (addr not in devices and addr != b_addr) else {}),
            }
        )

    # events (light, doors, notices; presence only counted)
    events = []
    light_on = presence = notices = defects = 0
    for p in proto:
        what, how = (p.get("was") or "").lstrip("! "), p.get("wie") or ""
        if what == "Präsenz":
            presence += 1
            continue
        light_on += what == "Licht an"
        defects += how == "Defekt"
        notices += how == "Hinweis"
        room = c["raum_namen"].get(p.get("raum") or "", p.get("raum") or "")
        events.append(
            (
                int(p.get("zeit") or 0),
                clean(room, 20),
                clean(f"{what} · {how}".strip(" ·"), 40),
                "act" if how == "Defekt" else None,
            )
        )
    doors_open = 0
    for ms, name, is_open in doors:
        doors_open += bool(is_open)
        label = next((d["name"] for d in c["tueren"] if d.get("enthaelt") and d["enthaelt"] in (name or "")), None)
        events.append((ms, label or c["tuer_sonst"], "Tür auf" if is_open else "Tür zu", None))
    events.sort(key=lambda e: -e[0])

    # telegrams without cyclic readings and valves
    switching = [t for t in tel if not (readings + valves and t[1].startswith(readings + valves))]

    def from_whom(src):
        if src == b_addr:
            return b_name
        g = devices.get(src)
        return g[0] if g else src

    tel_rows = [
        {
            "cells": {
                "t": at(ms),
                "o": clean(f"{name or ga_names.get(ga, '')} ({ga}) · {from_whom(src)}", 110),
                "w": clean(value(ga, raw, c), 16),
            }
        }
        for ms, ga, name, src, raw in reversed(switching[-TEL_MAX:])
    ]
    ok_devices = active >= len(devices) - 3
    sections = [
        {
            "type": "tiles",
            "title": "Letzte 24 Stunden",
            "tiles": [
                {
                    "label": "Bus",
                    "value": f"{len(tel):,}".replace(",", "."),
                    "icon": "bolt",
                    "color": "home",
                    "spark": hours,
                    "sub": f"Telegramme, Ø {round(len(tel) / 1440)}/min",
                    "info": {
                        "what": "Alle Telegramme am Bus, Verlauf je Stunde.",
                        "source": "Bus-Protokoll des Hauses.",
                    },
                },
                {
                    "label": "Geräte",
                    "value": f"{active}/{len(devices)}",
                    "icon": "okCircle" if ok_devices else "lookCircle",
                    "sub": "haben gesendet",
                    "state": "ok" if ok_devices else "look",
                    "info": {
                        "what": "Bus-Geräte mit mindestens einem Telegramm. Taster und IP-Schnittstelle senden nur "
                        "bei Anlass.",
                        "source": "Absender im Bus-Protokoll, Geräteliste aus local/modules.",
                    },
                },
                {"label": "Licht an", "value": str(light_on), "icon": "sun", "sub": "Einschaltungen"},
                {"label": "Präsenz", "value": str(presence), "icon": "eye", "sub": "Meldungen"},
                {"label": "Türen", "value": str(doors_open), "icon": "home", "sub": "mal geöffnet"},
                {
                    "label": "Defekte",
                    "value": str(defects),
                    "icon": "actCircle" if defects else "okCircle",
                    "state": "act" if defects else "ok",
                    "sub": f"dazu {notices} Hinweise",
                    "info": {
                        "what": "Defekte = Handlungsbedarf laut KNX-Monitor; Hinweise (Flackern, Präsenz ohne Licht …) "
                        "sind Beobachtungen ohne Handlungsbedarf.",
                        "source": "KNX-Monitor des Hauses.",
                    },
                },
            ],
        },
        {
            "type": "series",
            "title": "Bus-Verkehr je 15 min",
            "unit": "Telegr.",
            "x": x,
            "lines": [
                {"label": lab, "values": count[lab], "color": color, "dashed": False} for lab, color, _ in groups
            ],
            "note": f"Ohne Helligkeit und Temperatur (zyklisch, {round(n_readings / 96)} je 15 min).",
            "info": {
                "what": "Telegramme je Viertelstunde nach Art, die letzten 24 Stunden.",
                "source": "Bus-Protokoll, Gruppen nach Hauptgruppe der GA.",
            },
        },
        {
            "type": "bars",
            "title": "Telegramme je Geräteart",
            "unit": "",
            "labels": [k for k, _ in kinds_sorted],
            "values": [v for _, v in kinds_sorted],
            "color": "home",
            "note": "Präsenzmelder und Taster senden Helligkeit bzw. Temperatur zyklisch.",
        },
        {
            "type": "table",
            "title": "Geräte",
            "columns": [
                {"key": "g", "label": "Gerät"},
                {"key": "n", "label": "Telegr.", "align": "right"},
                {"key": "z", "label": "zuletzt"},
            ],
            "rows": device_rows,
            "note": "Markiert: still oder unbekannt.",
            "info": {
                "what": "Jedes Bus-Gerät mit Telegrammen und letztem Lebenszeichen.",
                "source": "Bus-Protokoll, Namen aus der Geräteliste.",
            },
        },
        {
            "type": "table",
            "title": "Ereignisse",
            "columns": [{"key": "t", "label": "Zeit"}, {"key": "r", "label": "Raum"}, {"key": "e", "label": "Was"}],
            "rows": [
                {"cells": {"t": at(ms), "r": r, "e": e}, **({"state": s} if s else {})}
                for ms, r, e, s in events[:EVENTS_MAX]
            ],
            "note": f"{len(events)} Ereignisse in 24 h, neueste zuerst"
            + (f" (die {EVENTS_MAX} neuesten)." if len(events) > EVENTS_MAX else ".")
            + " Präsenz nur oben gezählt.",
            "info": {
                "what": "Licht an/aus (Taster oder Automatik), Türen, Auffälligkeiten.",
                "source": "Ereignisse des KNX-Monitors über den Haus-Dienst.",
            },
        },
        {
            "type": "table",
            "title": "Telegramme",
            "columns": [
                {"key": "t", "label": "Zeit"},
                {"key": "o", "label": "Objekt · von"},
                {"key": "w", "label": "Wert", "align": "right"},
            ],
            "rows": tel_rows,
            "note": f"{len(switching):,}".replace(",", ".")
            + " ohne Messwerte und Ventile, neueste "
            + str(len(tel_rows))
            + " gezeigt.",
            "info": {
                "what": "Rohes Bus-Protokoll ohne zyklische Helligkeit, Temperatur und Ventil-Stellgrößen.",
                "source": "Bus-Protokoll. Werte: 1 Bit Ein/Aus, Licht-Byte in %, 2 Byte als Zahl (DPT 9).",
            },
        },
    ]
    return {"updated": until, "sections": sections}
