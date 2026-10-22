"""How cautious the house's charge plan is – a choice on the car/charging tab (Nutzer 20.10.2026: „Es gibt Tage, da ist
man mehr Risiko bereit, wenn man ein volleres Auto braucht, und es gibt Tage, da hat man lieber sicher einen vollen
Speicher“).

Three levels; the house's planner reads the chosen one from a small file (config "risiko": {"datei"}) and plans with
its share of weather cases that may need grid power for the house ("alpha"). The choice holds until midnight, then
"sicher" again – a bold day does not stay set by mistake. With config "bis_kwh" (Nutzer 22.10.2026: „bis das nächste
Mal 10 kWh geladen wurden“) it holds instead until the car has charged that much since the choice: the HOUSE's planner
counts it on the wallbox meter and sets the file back to "sicher" (it writes plan "risiko": {geladen_kwh, bis_kwh});
here it holds at most MAX_DAYS in case nobody counts. The planner can write, per level, what the car would get
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
MAX_DAYS = 7  # a choice "until x kWh" ends here at the latest (the house's planner normally ends it sooner)


def _num(x, nd=0):
    return f"{x:.{nd}f}".replace(".", ",")


def current(path: str, tz, now: float) -> str:
    """The level that holds now: one "until x kWh" (at most MAX_DAYS old), or one set today, else the default."""
    try:
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
    except (OSError, ValueError):
        return DEFAULT
    v = d.get("stufe")
    if v not in {x[0] for x in LEVELS}:
        return DEFAULT
    if d.get("bis_kwh") is not None:
        try:
            age = now - datetime.fromisoformat(str(d.get("gesetzt"))).timestamp()
        except ValueError:
            return DEFAULT
        return v if age <= MAX_DAYS * 86400 else DEFAULT
    today = datetime.fromtimestamp(now, tz).date().isoformat()
    return v if str(d.get("bis") or "") >= today else DEFAULT


def store(path: str, value: str, tz, now: float, bis_kwh: float | None = None) -> dict:
    """Stores the choice: until midnight, or – with bis_kwh – until the car has charged that much."""
    alpha = next(a for v, _, a in LEVELS if v == value)
    d = datetime.fromtimestamp(now, tz)
    data = {"stufe": value, "alpha": alpha, "gesetzt": d.isoformat(timespec="minutes")}
    if bis_kwh is not None and value != DEFAULT:
        data["bis_kwh"] = bis_kwh
    else:
        data["bis"] = d.date().isoformat()
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    tmp = f"{path}.tmp{os.getpid()}"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f)
    os.chmod(tmp, 0o644)  # the house's planner reads it
    os.replace(tmp, path)
    return data


def note(selected: str, plan: dict | None, bis_kwh: float | None) -> str:
    if bis_kwh is None:
        return "Gilt bis Mitternacht, dann wieder „Sicher“. Wirkt ab dem nächsten Planlauf (alle 15 min)."
    r = (plan or {}).get("risiko") or {}
    done = r.get("geladen_kwh") if r.get("stufe") == selected else None
    so_far = f" (bisher {_num(done, 1)} kWh)" if selected != DEFAULT and isinstance(done, (int, float)) else ""
    return (
        f"„Mittel“ und „Mutig“ gelten, bis das Auto {_num(bis_kwh)} kWh geladen hat{so_far}, dann wieder „Sicher“. "
        "Wirkt ab dem nächsten Planlauf (alle 15 min)."
    )


def section(selected: str, plan: dict | None, bis_kwh: float | None = None) -> dict:
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
        "note": note(selected, plan, bis_kwh),
        "info": {
            "what": "Sicher: der Hausakku geht vor, das Auto bekommt, was auch an schlechten Tagen übrig bleibt. "
            "Mittel und Mutig: der Plan rechnet mit besserem Wetter und gibt dem Auto mehr – dafür muss das Haus "
            "in mehr Wetterfällen etwas Netzstrom ziehen (Fälle aus 300 Wetter- und Verbrauchsverläufen). "
            "Die Stopp-Regeln des Wächters bleiben in jeder Stufe gleich.",
            "source": "Ladeplaner des Hauses (Anteil der Wetterfälle mit Netzbezug), Wahl in einer Datei.",
        },
    }
