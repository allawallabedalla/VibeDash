"""Cleaning actions of the module "saugroboter" – predefined like light scenes ("Nach dem Kochen": robot, rooms,
mode). One choice per robot; a tap stores a wish for the HOUSE in a small file, the house sends the command to
the robot and writes back what happened. Nothing is switched here.

Config:
  aktionen  [{id, name, sub?, geraet, raeume: [segment ids] | "alle", modus?, staerke?, durchgaenge?}] – the house
            reads the same entries; per robot "pause" and "heim" are always offered
  wunsch    wish file (relative to the modules folder or absolute), default "saugroboter_wunsch.json":
            {"nr", "id", "geraet", "zeit" (ms)}
  stand     file the house writes after sending, default "saugroboter_stand.json":
            {"nr", "id", "ok", "text", "zeit" (ms)}
"""

from __future__ import annotations

import json
import os
import re
from datetime import datetime

ITEM = re.compile(r"^saug:[a-z0-9_-]{1,32}$")
BASIC = (("pause", "Pause", "anhalten"), ("heim", "Nach Hause", "zurück zur Station"))
PENDING_MS = 5 * 60_000  # a wish the house has not taken after 5 min counts as lost


def _load(p: str) -> dict:
    try:
        with open(p, encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def _key(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(name).lower()).strip("-")[:32] or "x"


def actions(cfg: dict) -> dict:
    """-> {robot: [(value, label, sub)]} in the order of the config, pause/heim last."""
    out: dict = {}
    for a in cfg.get("aktionen") or []:
        if isinstance(a, dict) and a.get("id") and a.get("name") and a.get("geraet"):
            out.setdefault(str(a["geraet"]), []).append(
                (str(a["id"]), str(a["name"])[:30], str(a.get("sub") or "")[:60])
            )
    return {g: v + list(BASIC) for g, v in out.items()}


def sections(cfg: dict, path, tz, now_ms: int) -> list:
    acts = actions(cfg)
    if not acts:
        return []
    wish = _load(path(cfg.get("wunsch") or "saugroboter_wunsch.json"))
    stand = _load(path(cfg.get("stand") or "saugroboter_stand.json"))

    def hm(ms):
        return datetime.fromtimestamp(ms / 1000, tz).strftime("%H:%M")

    out = []
    for robot, opts in acts.items():
        mine = wish.get("geraet") == robot
        done = mine and stand.get("nr") == wish.get("nr")
        open_ = mine and not done and now_ms - int(wish.get("zeit") or 0) < PENDING_MS
        if done:
            note = f"{hm(int(stand.get('zeit') or 0))}: {stand.get('text') or ''}".strip()
        elif open_:
            note = "Wird gesendet …"
        elif mine:
            note = "Nicht gesendet – der Haus-Dienst hat den Wunsch nicht übernommen."
        else:
            note = "Antippen startet die Aktion."
        out.append(
            {
                "type": "choice",
                "title": f"Aktionen {robot}",
                "id": f"saug:{_key(robot)}",
                "selected": wish.get("id") if open_ else None,
                "options": [{"value": v, "label": lb, **({"sub": s} if s else {})} for v, lb, s in opts],
                "note": note,
                "info": {
                    "what": "Vorgefertigte Putzaktionen wie Lichtszenen. Pause und Nach Hause gibt es immer.",
                    "source": "Wunsch an den Haus-Dienst, der den Befehl über die Hersteller-Cloud schickt.",
                },
            }
        )
    return out


def choose(cfg: dict, path, item: str, value, now_ms: int) -> tuple[int, dict]:
    acts = actions(cfg)
    robot = next((g for g in acts if f"saug:{_key(g)}" == item), None)
    if robot is None or not ITEM.match(str(item)):
        return 404, {"ok": False, "text": "keine Aktion"}
    label = next((lb for v, lb, _ in acts[robot] if v == value), None)
    if label is None:
        return 400, {"ok": False, "text": "unbekannte Aktion"}
    p = path(cfg.get("wunsch") or "saugroboter_wunsch.json")
    nr = int(_load(p).get("nr") or 0) + 1
    tmp = p + ".neu"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"nr": nr, "id": value, "geraet": robot, "zeit": now_ms}, f, ensure_ascii=False)
    os.replace(tmp, p)
    return 200, {"ok": True, "text": f"{robot}: {label} – wird gesendet"}
