"""Board of the module "saugroboter": per robot what it does (one word) and its battery with the last 24 h
behind a tap. Pure function over plain data, so tests run on synthetic robots:

  build(robots, now_ms, t, tz)

robots: [{"name", "time", "batterie", "status", "online", "x": [ms], "akku": [...]}] (see source.py).
status: state code of the Dreame/MOVA cloud (latestStatus); unknown codes are shown as a number.
"""

from __future__ import annotations

from datetime import datetime

STALE_MS = 20 * 60_000  # the collector asks every 5 min: 20 min without a point means it stopped

# Dreame/MOVA state codes (same numbering as the community integration dreame-vacuum)
STATE = {
    1: "saugt",
    2: "bereit",
    3: "pausiert",
    4: "Fehler",
    5: "fährt heim",
    6: "lädt",
    7: "wischt",
    8: "trocknet",
    9: "wäscht Mopp",
    10: "fährt waschen",
    11: "kartiert",
    12: "saugt + wischt",
    13: "voll geladen",
    14: "Update",
    15: "kommt",
    16: "Station",
    17: "holt Mopp",
    18: "legt Mopp ab",
    19: "prüft Wasser",
    20: "füllt Wasser",
    21: "pausiert",
    22: "leert Staub",
    23: "ferngesteuert",
    24: "lädt",
    25: "2. Runde",
    26: "folgt",
    27: "Punktreinigung",
    28: "fährt leeren",
    29: "wartet",
    30: "Station",
    31: "fährt ablassen",
    32: "lässt ab",
    33: "lässt ab",
    34: "leert",
    35: "trocknet Beutel",
    36: "pausiert",
    37: "fährt Extrarunde",
    38: "Extrarunde",
}
WORKING = {1, 7, 11, 12, 25, 27, 38}

TEXT = {
    "title": "Saugroboter",
    "none_title": "Noch keine Daten",
    "none_text": "Der Sammler hat noch keine Werte geschrieben.",
    "state_sub": "seit {t} · Akku {b} %",
    "offline": "offline",
    "offline_sub": "nicht mit der Cloud verbunden",
    "stale": "kein Stand",
    "stale_sub": "letzter Wert {t}",
    "battery": "Akku",
    "battery_sub": "letzte 24 h beim Antippen",
    "source": "Hersteller-Cloud (MOVA/Dreame), alle 5 min gelesen und in InfluxDB gespeichert.",
    "state_what": "Was der Roboter gerade tut, wie es die Hersteller-Cloud meldet.",
    "note": "Stand {t}. Nur lesen – gesteuert wird nichts.",
}


def word(code) -> str:
    if code is None:
        return "–"
    return STATE.get(int(code), f"Code {int(code)}")


def build(robots: list, now_ms: int, t: dict, tz) -> dict:
    if not robots:
        return {"updated": now_ms, "sections": [{"type": "text", "title": t["none_title"], "text": t["none_text"]}]}

    def hm(ms):
        return datetime.fromtimestamp(ms / 1000, tz).strftime("%H:%M")

    tiles = []
    for r in robots:
        stale = now_ms - (r.get("time") or 0) > STALE_MS
        code = r.get("status")
        bat = r.get("batterie")
        if stale:
            value, sub, state = t["stale"], t["stale_sub"].format(t=hm(r.get("time") or 0)), "look"
        elif not r.get("online"):
            value, sub, state = t["offline"], t["offline_sub"], "look"
        else:
            value = word(code)
            sub = t["state_sub"].format(t=hm(r["time"]), b="–" if bat is None else round(bat))
            state = "act" if code == 4 else None
        tiles.append(
            {
                "label": r["name"],
                "value": value,
                "sub": sub,
                **({"state": state} if state else {}),
                "icon": "robot",
                "color": "home",
                "info": {"what": t["state_what"], "source": t["source"]},
            }
        )
        akku = r.get("akku") or []
        tiles.append(
            {
                "label": f"{t['battery']} {r['name']}",
                "value": "–" if bat is None else str(round(bat)),
                **({"unit": "%"} if bat is not None else {}),
                "sub": t["battery_sub"],
                "icon": "battery",
                "color": "battery",
                **(
                    {"spark": akku, "sparkFrom": r["x"][0], "sparkTo": r["x"][-1]}
                    if sum(v is not None for v in akku) >= 2
                    else {}
                ),
            }
        )
    newest = max(r.get("time") or 0 for r in robots)
    return {
        "updated": newest or now_ms,
        "sections": [{"type": "tiles", "title": t["title"], "tiles": tiles, "note": t["note"].format(t=hm(newest))}],
    }
