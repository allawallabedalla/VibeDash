"""„Jetzt voll laden“ / „Automatik“ on the charging page (Nutzer 20.10.2026: „gibts einen Knopf mit force-full ASAP?“ –
„ja mach das so“).

A choice with two options. It only forwards the person's tap to the house's own charge control (config "steuerung":
{status_url, jetzt_url, automatik_url, ampere?}); the house's guard does the switching with its own rules (force at
"ampere", grid power allowed, until the car is full, unplugged or back to automatic). Without that config there is no
such choice; without "ampere" the text names no current (it is the house's, not ours to guess).
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request

ITEM = "laden:modus"
OPTIONS = (
    ("automatik", "Automatik", "nach Plan, ohne Netzstrom fürs Auto"),
    ("jetzt", "Jetzt voll laden", "sofort{a}, auch Netzstrom, bis voll"),
)
TIMEOUT_S = 8  # the VibeDash server waits 10 s; the house goes on with the request after that


def _req(url: str, post: bool):
    req = urllib.request.Request(
        url,
        data=json.dumps({"quelle": "vibedash"}).encode() if post else None,
        headers={"Content-Type": "application/json", "X-Haus-Aktion": "1"},
        method="POST" if post else "GET",
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:  # noqa: S310 – address from the local config only
        return r.status, json.load(r)


def status(cfg: dict, get=_req) -> dict | None:
    try:
        _, body = get(cfg["status_url"], False)
        return body if isinstance(body, dict) else None
    except (OSError, ValueError, KeyError, urllib.error.URLError):
        return None


def wallbox(st: dict, now: float) -> dict:
    """The house's status as the cable tile needs it: is the wallbox charging, is "Jetzt voll laden" on, how fresh.
    "laeuft" stays None when the house does not say it (older house); the tile then keeps the car's own word."""
    stand = st.get("stand_ms")
    return {
        "laeuft": st.get("laeuft") if isinstance(st.get("laeuft"), bool) else None,
        "erzwungen": bool(st.get("erzwungen")),
        "stand": stand / 1000 if isinstance(stand, (int, float)) else None,
    }


def _amps(cfg: dict | None) -> str:
    """ " 16 A" from the config's "ampere" (6–63, the house's force current), else nothing."""
    a = (cfg or {}).get("ampere")
    ok = isinstance(a, (int, float)) and not isinstance(a, bool) and 6 <= a <= 63
    return f" {a:g} A" if ok else ""


def section(st: dict | None, cfg: dict | None = None) -> dict:
    amps = _amps(cfg)
    mode = ((st or {}).get("knoepfe") or {}).get("aktiv")
    selected = mode if mode in {v for v, _, _ in OPTIONS} else None
    opts = []
    for v, label, sub in OPTIONS:
        sub = sub.format(a=amps)
        if v == "automatik" and (st or {}).get("plan_kurz"):
            sub = f"Plan: {st['plan_kurz']}"[:80]
        opts.append({"value": v, "label": label, "sub": sub})
    lage = (st or {}).get("text")
    return {
        "type": "choice",
        "title": "Laden",
        "id": ITEM,
        "selected": selected,
        "options": opts,
        "slot": "top",
        "note": (f"Jetzt: {lage}. " if lage else "Steuerung nicht erreichbar. ")
        + "„Jetzt voll laden“ endet von selbst, wenn das Auto voll ist oder abgesteckt wird.",
        "info": {
            "what": "Automatik lädt nur nach Plan ohne Netzstrom fürs Auto. „Jetzt voll laden“ lädt sofort"
            + (f" mit{amps}" if amps else "")
            + ", auch mit Netzstrom, bis das Auto voll ist, abgesteckt wird oder du wieder Automatik wählst. Ladungen "
            "aus der Wallbox-App oder mit der Karte stoppt die Automatik nie.",
            "source": "Ladesteuerung des Hauses (Wächter); VibeDash gibt nur den Wunsch weiter.",
        },
    }


def choose(cfg: dict, value: str, post=_req) -> tuple[int, dict]:
    url = cfg.get("jetzt_url") if value == "jetzt" else cfg.get("automatik_url") if value == "automatik" else None
    if not url:
        return 400, {"ok": False, "text": "unbekannte Wahl"}
    try:
        code, body = post(url, True)
    except TimeoutError:
        return 200, {"ok": True, "text": "Angefragt – die Steuerung setzt es gleich um"}
    except urllib.error.HTTPError as e:
        try:
            said = json.load(e).get("fehler")
        except (ValueError, AttributeError):
            said = None
        return 502, {"ok": False, "text": str(said or f"Steuerung: Fehler {e.code}")[:120]}
    except (OSError, ValueError, urllib.error.URLError):
        return 502, {"ok": False, "text": "Steuerung nicht erreichbar"}
    ok = (body or {}).get("ok")
    return (200 if ok is not False else 502), {
        "ok": ok is not False,
        "text": str((body or {}).get("text") or ("angefragt" if ok is None else "erledigt"))[:120],
    }
