"""„Licht-Wecker einmal aussetzen“ on the KNX tab (Nutzer 05.11.2026: „die Licht-Weckfunktion für genau einen Tag
überschreiben“).

A choice with two options. The person's wish goes into a small file (config "wecker": {"datei"}); the HOUSE reads it
and puts it on the bus for its own wake-up logic, which then skips one morning. Nothing is switched here.

The pause is for the next morning: before "ab" (default 04:00) that is today, later tomorrow. It holds until "bis"
(default 10:00) of that day, then everything is normal again – a skipped morning cannot stay set by mistake.
With "stand" (a file the house writes after sending: {"wert": 0|1, "gesendet": iso, "ok": bool}) the note says whether
the house has taken the wish over.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, time, timedelta

ITEM = "wecker:pause"
WOCHENTAG = ("Mo", "Di", "Mi", "Do", "Fr", "Sa", "So")


def _clock(s, default: time) -> time:
    try:
        h, m = str(s).split(":")
        return time(int(h), int(m))
    except (TypeError, ValueError):
        return default


def _load(path: str | None) -> dict:
    if not path:
        return {}
    try:
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def _limits(cfg: dict) -> tuple[time, time]:
    return _clock(cfg.get("ab"), time(4, 0)), _clock(cfg.get("bis"), time(10, 0))


def target_day(cfg: dict, tz, now: float):
    """The morning a tap now skips: today before "ab", else tomorrow."""
    ab, _ = _limits(cfg)
    d = datetime.fromtimestamp(now, tz)
    return d.date() if d.time() < ab else d.date() + timedelta(days=1)


def current(path: str, tz, now: float) -> dict | None:
    """The pause that holds now: {aus_am, bis} or None."""
    d = _load(path)
    try:
        bis = datetime.fromisoformat(str(d.get("bis")))
        day = datetime.fromisoformat(str(d.get("aus_am"))).date()
    except ValueError:
        return None
    return {"aus_am": day, "bis": bis} if bis.timestamp() > now else None


def store(path: str, cfg: dict, value: str, tz, now: float) -> dict:
    """"aus": skip the next morning; "normal": no pause."""
    d = datetime.fromtimestamp(now, tz)
    data: dict = {"gesetzt": d.isoformat(timespec="minutes")}
    if value == "aus":
        day = target_day(cfg, tz, now)
        _, bis = _limits(cfg)
        data.update({"aus_am": day.isoformat(), "bis": datetime.combine(day, bis, tz).isoformat()})
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    tmp = f"{path}.tmp{os.getpid()}"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f)
    os.chmod(tmp, 0o644)  # the house reads it
    os.replace(tmp, path)
    return data


def _day(day) -> str:
    return f"{WOCHENTAG[day.weekday()]} {day.strftime('%d.%m.')}"


def _note(pause: dict | None, stand: dict, have_stand: bool) -> str:
    want = 1 if pause else 0
    if pause:
        head = f"Am {_day(pause['aus_am'])} kein Licht-Wecker, danach wieder normal."
    else:
        head = "Der Licht-Wecker läuft wie gewohnt."
    if not have_stand:
        return head
    if stand.get("ok") is False:
        return head + " Haus meldet Fehler beim Senden – versucht es jede Minute neu."
    if stand.get("wert") != want:
        return head + " Wartet auf das Haus (≤ 1 min)."
    try:
        at = datetime.fromisoformat(str(stand.get("gesendet"))).strftime("%H:%M")
    except ValueError:
        return head
    return head + f" Vom Haus übernommen ({at})."


def section(cfg: dict, path, tz, now: float) -> dict:
    pause = current(path(cfg["datei"]), tz, now)
    day = pause["aus_am"] if pause else target_day(cfg, tz, now)
    have_stand = bool(cfg.get("stand"))
    stand = _load(path(cfg["stand"])) if have_stand else {}
    return {
        "type": "choice",
        "title": "Licht-Wecker",
        "id": ITEM,
        "selected": "aus" if pause else "normal",
        "options": [
            {"value": "normal", "label": "Normal", "sub": "weckt mit Licht"},
            {"value": "aus", "label": f"{WOCHENTAG[day.weekday()]} aus", "sub": f"{day.strftime('%d.%m.')} ohne Licht"},
        ],
        "slot": "top",
        "note": _note(pause, stand, have_stand),
        "info": {
            "what": "Setzt den Licht-Wecker für genau einen Morgen aus: vor "
            f"{_limits(cfg)[0].strftime('%H:%M')} Uhr für heute, sonst für morgen. Ab "
            f"{_limits(cfg)[1].strftime('%H:%M')} Uhr an dem Tag gilt wieder „Normal“. Fällt die Meldung aus, "
            "weckt das Haus ganz normal.",
            "source": "Weck-Logik des Hauses; VibeDash legt nur den Wunsch in einer Datei ab.",
        },
    }


def choose(cfg: dict, path, value: str, tz, now: float) -> tuple[int, dict]:
    if value not in ("normal", "aus"):
        return 400, {"ok": False, "text": "unbekannte Wahl"}
    data = store(path(cfg["datei"]), cfg, value, tz, now)
    if value == "normal":
        return 200, {"ok": True, "text": "Licht-Wecker: normal"}
    day = datetime.fromisoformat(data["aus_am"]).date()
    return 200, {"ok": True, "text": f"Licht-Wecker am {_day(day)} aus"}
