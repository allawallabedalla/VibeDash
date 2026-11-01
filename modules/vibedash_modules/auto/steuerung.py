"""„Jetzt voll laden“ / „Automatik“ on the charging page (Nutzer 20.10.2026: „gibts einen Knopf mit force-full ASAP?“ –
„ja mach das so“).

A choice with two options. It only forwards the person's tap to the house's own charge control (config "steuerung":
{status_url, jetzt_url, automatik_url, ampere?}); the house's guard does the switching with its own rules (force at
"ampere", grid power allowed, until the car is full, unplugged or back to automatic). Without that config there is no
such choice; without "ampere" the text names no current (it is the house's, not ours to guess).

With "ampere_stufen" (e.g. [6, 8, 10, 13, 16]) and "ziel_stufen" (e.g. [60, 70, 80, 90, 100]) two more choices follow
(Nutzer 01.11.2026: Stromstärke und „auto auf XX % laden“): a tap on a current or a target starts "Jetzt laden" with
it, or changes the running one; the other value stays. The target is in % of the car's battery while the house knows
its charge level ("auto_soc"), otherwise in kWh from now ("ziel_kwh_stufen", default 10/20/30/40). 100 % = full.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request

ITEM = "laden:modus"
AMP_ITEM = "laden:ampere"
ZIEL_ITEM = "laden:ziel"
ITEMS = (ITEM, AMP_ITEM, ZIEL_ITEM)
ZIEL_KWH = (10, 20, 30, 40)
OPTIONS = (
    ("automatik", "Automatik", "nach Plan, ohne Netzstrom fürs Auto"),
    ("jetzt", "Jetzt voll laden", "sofort{a}, auch Netzstrom, bis voll"),
)
TIMEOUT_S = 8  # the VibeDash server waits 10 s; the house goes on with the request after that


def _req(url: str, post: bool, body: dict | None = None):
    req = urllib.request.Request(
        url,
        data=json.dumps({"quelle": "vibedash", **(body or {})}).encode() if post else None,
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


def _stufen(cfg: dict | None, key: str, lo: int, hi: int) -> list[int]:
    vals = (cfg or {}).get(key)
    if not isinstance(vals, list):
        return []
    out = [v for v in vals if isinstance(v, int) and not isinstance(v, bool) and lo <= v <= hi]
    return out[:5] if len(out) >= 2 else []


def _de(x: float) -> str:
    return f"{x:.1f}".replace(".", ",")


def _soc(st: dict | None) -> float | None:
    v = (st or {}).get("auto_soc")
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and 0 <= v <= 100 else None


def _aktiv(st: dict | None) -> dict:
    """The running "Jetzt laden": {a, bis_pct} or {} when the automatic runs."""
    kn = (st or {}).get("knoepfe") or {}
    return kn if kn.get("aktiv") == "jetzt" else {}


def sections(st: dict | None, cfg: dict | None = None) -> list[dict]:
    """„Laden“, then (if configured) „Stärke“ and „Ziel“."""
    out = [section(st, cfg)]
    akt, phasen = _aktiv(st), (cfg or {}).get("phasen", 3)
    amps = _stufen(cfg, "ampere_stufen", 6, 32)
    if amps:
        out.append(
            {
                "type": "choice",
                "title": "Stärke",
                "id": AMP_ITEM,
                "slot": "top",
                "selected": f"a{akt['a']}" if akt.get("a") in amps else None,
                "options": [
                    {"value": f"a{a}", "label": f"{a} A", "sub": f"≈ {_de(a * 230 * phasen / 1000)} kW"} for a in amps
                ],
                "note": "Tippen lädt sofort mit dieser Stärke (auch Netzstrom).",
                "info": {
                    "what": f"Ladestrom je Phase ({phasen} Phasen, 230 V). Weniger Strom = weniger Netzbezug, dauert "
                    "länger. Während der Ladung stellt die Steuerung kurz Stopp → neue Stärke → Start.",
                    "source": "Ladesteuerung des Hauses (Wächter); VibeDash gibt nur den Wunsch weiter.",
                },
            }
        )
    ziele = _stufen(cfg, "ziel_stufen", 20, 100)
    if ziele:
        soc = _soc(st)
        if soc is not None:
            p_akt = akt.get("bis_pct") or (100 if akt else None)
            sel = f"p{p_akt}" if p_akt in ziele else None
            opts = [
                {
                    "value": f"p{p}",
                    "label": "Voll" if p == 100 else f"{p} %",
                    "sub": "erreicht" if p <= soc else ("bis voll" if p == 100 else ""),
                }
                for p in ziele
            ]
            note = f"Auto jetzt ≈ {soc:.0f} % (letzte Meldung des Autos + seither Geladenes)."
        else:
            kwhs = _stufen(cfg, "ziel_kwh_stufen", 1, 100)[:4] or list(ZIEL_KWH)
            sel = "voll" if akt and not akt.get("bis_kwh") else None
            opts = [{"value": f"k{k}", "label": f"+{k} kWh", "sub": ""} for k in kwhs]
            opts.append({"value": "voll", "label": "Voll", "sub": "bis voll"})
            note = "Ladestand des Autos gerade unbekannt – Ziel in kWh ab jetzt."
        out.append(
            {
                "type": "choice",
                "title": "Ziel",
                "id": ZIEL_ITEM,
                "slot": "top",
                "selected": sel,
                "options": opts,
                "note": note,
                "info": {
                    "what": "Bis wohin „Jetzt laden“ lädt. Prozent gehen über die letzte Meldung des Autos und den "
                    "gemessenen Ladewirkungsgrad; das Ziel kann um einige Prozent danebenliegen (Meldung bis 48 h alt, "
                    "Wirkungsgrad schwankt). Voll = bis das Auto nichts mehr nimmt.",
                    "source": "Ladesteuerung des Hauses (Wächter); VibeDash gibt nur den Wunsch weiter.",
                },
            }
        )
    return out


def _wunsch(item: str, value: str, st: dict | None) -> dict | None:
    """Tap -> body for "Jetzt laden" (current and target; the one not tapped stays as it is)."""
    akt = _aktiv(st)
    body: dict = {}
    if akt.get("a"):
        body["a"] = akt["a"]
    if akt.get("bis_pct"):
        body["bis_pct"] = akt["bis_pct"]
    if item == ITEM:
        return body if value == "jetzt" else None
    if item == AMP_ITEM and value[:1] == "a" and value[1:].isdigit():
        return {**body, "a": int(value[1:])}
    if item == ZIEL_ITEM:
        body.pop("bis_pct", None)
        if value == "voll":
            return body
        if value[:1] == "p" and value[1:].isdigit():
            return {**body, "bis_pct": int(value[1:])}
        if value[:1] == "k" and value[1:].isdigit():
            return {**body, "bis_kwh": int(value[1:])}
    return None


def choose(cfg: dict, value: str, post=_req, item: str = ITEM, get=_req) -> tuple[int, dict]:
    if item == ITEM and value not in ("jetzt", "automatik"):
        return 400, {"ok": False, "text": "unbekannte Wahl"}
    st = status(cfg, get) if item != ITEM or value == "jetzt" else None
    body = _wunsch(item, value, st) if (item != ITEM or value == "jetzt") else {}
    if (
        body is not None
        and item in (AMP_ITEM, ZIEL_ITEM)
        and value not in {o["value"] for s in sections(st, cfg) if s["id"] == item for o in s["options"]}
    ):
        body = None
    url = (
        cfg.get("automatik_url")
        if item == ITEM and value == "automatik"
        else cfg.get("jetzt_url")
        if body is not None
        else None
    )
    if not url:
        return 400, {"ok": False, "text": "unbekannte Wahl"}
    try:
        code, body = post(url, True, body) if body else post(url, True)
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
