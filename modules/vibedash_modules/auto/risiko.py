"""How cautious the house's charge plan is – a choice on the car/charging tab (Nutzer 20.10.2026: „Es gibt Tage, da ist
man mehr Risiko bereit, wenn man ein volleres Auto braucht, und es gibt Tage, da hat man lieber sicher einen vollen
Speicher“).

Three levels; the house's planner reads the chosen one from a small file (config "risiko": {"datei"}) and plans with
its share of weather cases that may need grid power for the house ("alpha"). The choice holds until midnight, then
"sicher" again – a bold day does not stay set by mistake. The planner can write, per level, what the car would get
(plan file "stufen": {level: {"tage_kwh": [today, tomorrow, …]}}); the options show it.

Only a setting for the planner: nothing is switched here; the house's guard (stop rules, minimum line) stays as it is.
"""

from __future__ import annotations

import json
import os
from datetime import datetime

# value, label, share of weather cases that may need grid power for the house
LEVELS = (
    ("sicher", "Sicher", 1 / 31),
    ("mittel", "Mittel", 0.10),
    ("mutig", "Mutig", 0.25),
)
DEFAULT = "sicher"
ITEM = "laden:risiko"


def _num(x, nd=0):
    return f"{x:.{nd}f}".replace(".", ",")


def current(path: str, tz, now: float) -> str:
    """The level that holds now: the stored one if it was set today, else the default."""
    try:
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
    except (OSError, ValueError):
        return DEFAULT
    today = datetime.fromtimestamp(now, tz).date().isoformat()
    v = d.get("stufe")
    return v if v in {x[0] for x in LEVELS} and str(d.get("bis") or "") >= today else DEFAULT


def store(path: str, value: str, tz, now: float) -> dict:
    alpha = next(a for v, _, a in LEVELS if v == value)
    d = datetime.fromtimestamp(now, tz)
    data = {"stufe": value, "alpha": alpha, "bis": d.date().isoformat(), "gesetzt": d.isoformat(timespec="minutes")}
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    tmp = f"{path}.tmp{os.getpid()}"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f)
    os.chmod(tmp, 0o644)  # the house's planner reads it
    os.replace(tmp, path)
    return data


def section(selected: str, plan: dict | None) -> dict:
    """The choice on the charging page: at the top (something to do, not something to read)."""
    st = (plan or {}).get("stufen") or {}
    opts = []
    for v, label, alpha in LEVELS:
        kwh = ((st.get(v) or {}).get("tage_kwh") or [None])[0]
        risk = f"Netz in ≈ {round(alpha * 100)} von 100 Fällen"
        sub = f"Auto heute {_num(kwh)} kWh · {risk}" if isinstance(kwh, (int, float)) else risk
        opts.append({"value": v, "label": label, "sub": sub})
    return {
        "type": "choice",
        "title": "Wie mutig laden?",
        "id": ITEM,
        "selected": selected,
        "options": opts,
        "slot": "top",
        "note": "Gilt bis Mitternacht, dann wieder „Sicher“. Wirkt ab dem nächsten Planlauf (alle 15 min).",
        "info": {
            "what": "Sicher: der Hausakku geht vor, das Auto bekommt, was auch an schlechten Tagen übrig bleibt. "
            "Mittel und Mutig: der Plan rechnet mit besserem Wetter und gibt dem Auto mehr – dafür muss das Haus "
            "in mehr Wetterfällen etwas Netzstrom ziehen (Fälle aus 300 Wetter- und Verbrauchsverläufen). "
            "Die Stopp-Regeln des Wächters bleiben in jeder Stufe gleich.",
            "source": "Ladeplaner des Hauses (Anteil der Wetterfälle mit Netzbezug), Wahl in einer Datei.",
        },
    }
