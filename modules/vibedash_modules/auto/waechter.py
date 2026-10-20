"""The product's charge guard (BL-277; Nutzer 20.10.2026: „baue schon alles mal ein und dann eher mit einem
toggleswitch oder einer sperrverriegelung in der er sich selbst öffnet wenn die vorhersagequalität stimmt“).

It switches the wallbox through evcc (which knows the wallbox) by the product's charge plan (forecast service,
/plan/<id>): plan wants the car charged this hour -> evcc mode "pv" (evcc does the fine control with the sun),
otherwise "off". „Jetzt voll laden“ -> "now" until the car is unplugged.

The automatic is LOCKED until it has earned trust, and opens by itself when all three hold:
  lesen       evcc answered with plausible values on at least LESE_TAGE days (what it reads is real)
  treffsicher the plan's own backtest: at least TREFF_N days and the lower 95 % bound of "days without grid power
              for the car" at least TREFF_MIN (judged on the past only, same as the Modelle tab shows)
  pausetest   once, with the person's yes: while the car charges, pause for a moment and see the charging power drop
              (feedback from the wallbox, not the command) – then back as before
It closes by itself again when the backtest drops below the bar or a switch is not confirmed by evcc three times.
„Aus“ never writes anything. A change made in the evcc or wallbox app wins: the guard steps back until the car is
unplugged. All of it is shown on the car tab (sections(); the person's switch is the choice "laden:waechter").

Config (auto.json "waechter"): evcc_url, passwort_env (default EVCC_ADMIN_PASSWORD), ladepunkt (1), plan_url,
guete_url, zustand (state file, relative to the modules folder).
"""

from __future__ import annotations

import http.cookiejar
import json
import math
import os
import urllib.error
import urllib.request
from datetime import UTC, datetime

ITEM = "laden:waechter"
TEST_ITEM = "laden:pausetest"
LESE_TAGE = 7
TREFF_N = 14
TREFF_MIN = 0.75
FEHL_MAX = 3
LAEDT_KW = 1.0  # the car is charging
PAUSE_KW = 0.2  # a pause has arrived
PAUSE_S = 120  # how long the pause may take to show
TIMEOUT_S = 8

MODES = ("aus", "automatik", "jetzt")


def wilson_low(k: int, n: int, z: float = 1.96) -> float:
    """Lower bound of the 95 % interval for k of n (n small: honest instead of a bare share)."""
    if n <= 0:
        return 0.0
    p = k / n
    d = 1 + z * z / n
    c = p + z * z / (2 * n)
    r = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return (c - r) / d


class Evcc:
    """evcc's REST API: state (no login) and the loadpoint mode (admin login, cookie)."""

    def __init__(self, url: str, password: str | None, lp: int = 1, opener=None):
        self.url = url.rstrip("/")
        self.password = password
        self.lp = lp
        self.opener = opener or urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())
        )
        self._in = False

    def _call(self, method: str, path: str, body=None):
        req = urllib.request.Request(  # noqa: S310 – address from the local config only
            self.url + path,
            data=None if body is None else json.dumps(body).encode(),
            headers={"Content-Type": "application/json"},
            method=method,
        )
        with self.opener.open(req, timeout=TIMEOUT_S) as r:
            raw = r.read()
            return json.loads(raw) if raw else None

    def state(self) -> dict | None:
        """The loadpoint as {connected, charging, kw, mode, soc} or None."""
        s = self._call("GET", "/api/state")
        if isinstance(s, dict) and "result" in s:  # older evcc
            s = s["result"]
        lps = (s or {}).get("loadpoints") or []
        if len(lps) < self.lp:
            return {"kein_ladepunkt": True}
        p = lps[self.lp - 1]
        w = p.get("chargePower")
        return {
            "connected": bool(p.get("connected")),
            "charging": bool(p.get("charging")),
            "kw": None if not isinstance(w, (int, float)) else round(float(w) / 1000, 3),
            "mode": p.get("mode"),
            "soc": p.get("vehicleSoc"),
        }

    def set_mode(self, mode: str) -> None:
        if not self.password:
            raise PermissionError("kein evcc-Passwort")
        if not self._in:
            self._call("POST", "/api/auth/login", {"password": self.password})
            self._in = True
        self._call("POST", f"/api/loadpoints/{self.lp}/mode/{mode}")


def _read(path: str) -> dict:
    try:
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def _write(path: str, d: dict) -> None:
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    tmp = f"{path}.{os.getpid()}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


def _get_json(url: str):
    with urllib.request.urlopen(url, timeout=TIMEOUT_S) as r:  # noqa: S310 – local config
        return json.load(r)


def plan_now(plan: dict | None, now: float) -> float | None:
    """kW the plan wants for the car in this hour; None without a usable plan."""
    if not plan or plan.get("zustand") != "bereit":
        return None
    hour = datetime.fromtimestamp(now, UTC).replace(minute=0, second=0, microsecond=0)
    for h, kw in zip(plan.get("stunden") or [], plan.get("auto_kw") or [], strict=False):
        try:
            if datetime.fromisoformat(h) == hour:
                return float(kw)
        except (TypeError, ValueError):
            continue
    return None


def lock(st: dict, guete: dict | None) -> dict:
    """The three conditions and whether the lock is open."""
    tage = len(st.get("lesetage") or [])
    n = int((guete or {}).get("n") or 0)
    k = round(n * float((guete or {}).get("korrekt_pct") or 0) / 100)
    low = wilson_low(k, n)
    test = (st.get("pausetest") or {}).get("ergebnis")
    conds = {
        "lesen": {"ok": tage >= LESE_TAGE, "have": tage, "need": LESE_TAGE},
        "treffsicher": {"ok": n >= TREFF_N and low >= TREFF_MIN, "n": n, "k": k, "low": round(low, 3)},
        "pausetest": {"ok": test == "ok", "ergebnis": test},
    }
    is_open = all(c["ok"] for c in conds.values())
    wegen = None
    if not is_open and st.get("war_offen"):
        wegen = "Wallbox bestätigt nicht" if test and test != "ok" else "Plan trifft schlechter"
    return {"conds": conds, "open": is_open, "wegen": wegen}


class Waechter:
    def __init__(self, cfg: dict, path, evcc: Evcc | None = None, get=_get_json):
        self.cfg = cfg
        self.file = path(cfg.get("zustand") or "auto/waechter.json")
        pw = os.environ.get(cfg.get("passwort_env") or "EVCC_ADMIN_PASSWORD")
        self.evcc = evcc or Evcc(cfg["evcc_url"], pw, int(cfg.get("ladepunkt") or 1))
        self.get = get

    def state(self) -> dict:
        st = _read(self.file)
        st.setdefault("schalter", "aus")
        return st

    def _guete(self):
        try:
            g = self.get(self.cfg["guete_url"]) if self.cfg.get("guete_url") else None
            return g if isinstance(g, dict) else None
        except (OSError, ValueError, urllib.error.URLError):
            return None

    def _plan(self):
        try:
            p = self.get(self.cfg["plan_url"]) if self.cfg.get("plan_url") else None
            return p if isinstance(p, dict) else None
        except (OSError, ValueError, urllib.error.URLError):
            return None

    # ── one tick (every minute, from the module's lauf) ─────────────────────────────────────────────────────
    def tick(self, now: float) -> str:
        st = self.state()
        try:
            lp = self.evcc.state()
        except (OSError, ValueError, urllib.error.URLError):
            lp = None
        st["gelesen"] = {"am": now, "lp": lp}
        if lp is None:
            _write(self.file, st)
            return "evcc nicht erreichbar"
        if lp.get("kein_ladepunkt"):
            _write(self.file, st)
            return "keine Wallbox in evcc – nichts zu tun"
        day = datetime.fromtimestamp(now, UTC).date().isoformat()
        if lp["kw"] is not None and day not in (st.setdefault("lesetage", [])):
            st["lesetage"] = (st["lesetage"] + [day])[-60:]

        g = self._guete()
        if g is not None:
            st["guete"] = {k: g.get(k) for k in ("n", "korrekt_pct", "zustand")}
        text = self._pausetest(st, lp, now)
        if text is None:
            lk = lock(st, st.get("guete"))
            # just closed while the automatic ran: hand back to evcc's own sun charging once, then hands off
            if st.get("offen_zuletzt") and not lk["open"] and st.get("schalter") == "automatik" and lp["connected"]:
                if lp["mode"] != "pv" and lk["wegen"] != "Wallbox bestätigt nicht":
                    self._set(st, "pv", now)
                text = f"gesperrt ({lk['wegen']})"
            else:
                text = self._steuern(st, lp, lk, now)
            st["offen_zuletzt"] = lk["open"]
            if lk["open"]:
                st["war_offen"] = True
        _write(self.file, st)
        return text

    def _pausetest(self, st: dict, lp: dict, now: float) -> str | None:
        t = st.get("pausetest") or {}
        if t.get("ergebnis") == "ok" or not t.get("erlaubt"):
            return None
        if t.get("laeuft"):
            if lp["kw"] is not None and lp["kw"] <= PAUSE_KW:
                self._set(st, t.get("vorher") or "pv", now, test=True)
                st["pausetest"] = {**t, "laeuft": False, "ergebnis": "ok", "am": now}
                return "Pausetest bestanden"
            if now - t["laeuft"] > PAUSE_S:
                self._set(st, t.get("vorher") or "pv", now, test=True)
                st["pausetest"] = {"erlaubt": False, "ergebnis": "keine Pause", "am": now}
                return "Pausetest: Ladeleistung fiel nicht"
            return "Pausetest läuft"
        if lp["connected"] and lp["kw"] is not None and lp["kw"] >= LAEDT_KW:
            st["pausetest"] = {**t, "laeuft": now, "vorher": lp["mode"]}
            self._set(st, "off", now, test=True)
            return "Pausetest gestartet"
        return None

    def _set(self, st: dict, mode: str, now: float, test: bool = False, grund: str = "") -> None:
        """Every command is logged with time, reason and result (LADESTEUERUNG.md 7.6)."""
        try:
            self.evcc.set_mode(mode)
            ok = True
        except (OSError, ValueError, PermissionError, urllib.error.URLError) as e:
            ok = False
            grund = f"{grund} – Fehler: {type(e).__name__}".strip(" –")
        st["gesetzt"] = {"mode": mode, "am": now, "test": test}
        st["log"] = (
            (st.get("log") or [])
            + [{"am": now, "mode": mode, "grund": grund or ("Pausetest" if test else ""), "ok": ok}]
        )[-100:]

    def _steuern(self, st: dict, lp: dict, lk: dict, now: float) -> str:
        sw = st.get("schalter")
        if not lp["connected"]:
            # unplugged: a change by hand is over, and what was set before no longer counts
            st.pop("hand", None)
            st.pop("gesetzt", None)
            if sw == "jetzt":
                st["schalter"] = st.get("vor_jetzt") or "aus"
            return "Auto nicht angesteckt"
        if sw == "aus":
            return "aus – schreibt nichts"
        last = st.get("gesetzt") or {}
        # somebody else changed the mode (evcc or wallbox app): that wins until the car is unplugged
        if last.get("mode") and lp["mode"] and lp["mode"] != last["mode"] and now - last.get("am", 0) > 90:
            if last.get("bestaetigt"):
                st["hand"] = lp["mode"]
            else:
                st["fehl"] = int(st.get("fehl") or 0) + 1
                last["bestaetigt"] = False
                if st["fehl"] >= FEHL_MAX:
                    # the lock closes: the pause test has to be passed again
                    st["pausetest"] = {"ergebnis": "keine Rückmeldung", "am": now}
                    st["schalter"] = "aus"
                    st["fehl"] = 0
                    return "gesperrt: Wallbox bestätigt das Umschalten nicht"
        elif last.get("mode") == lp["mode"] and not last.get("bestaetigt"):
            last["bestaetigt"] = True
            st["fehl"] = 0
        if st.get("hand"):
            return f"von Hand auf {st['hand']} – wartet bis abgesteckt"
        grund = ""
        if sw == "jetzt":
            want = "now"
        elif sw == "automatik":
            if not lk["open"]:
                st["wuerde"] = None
                return "gesperrt"
            kw = plan_now(self._plan(), now)
            # dead man (LADESTEUERUNG.md 7.2): no plan for this hour -> stop, never "go on as before"
            want = "off" if kw is None else "pv" if kw > 0.05 else "off"
            grund = "kein Plan (Totmann)" if kw is None else f"Plan {kw:.1f} kW"
        else:
            return "unbekannter Schalter"
        if lp["mode"] == want:
            return f"passt ({want})"
        self._set(st, want, now, grund=grund if sw == "automatik" else "Jetzt voll laden")
        return f"umgeschaltet auf {want}"

    # ── the person's taps ───────────────────────────────────────────────────────────────────────────────────
    def choose(self, item: str, value: str) -> tuple[int, dict]:
        st = self.state()
        if item == TEST_ITEM:
            if value == "spaeter":
                return 200, {"ok": True, "text": "Gut, später"}
            if value != "erlauben":
                return 400, {"ok": False, "text": "unbekannt"}
            st["pausetest"] = {"erlaubt": True}
            _write(self.file, st)
            return 200, {"ok": True, "text": "Pausetest beim nächsten Laden"}
        if item != ITEM or value not in MODES:
            return 400, {"ok": False, "text": "unbekannte Wahl"}
        if value == "automatik" and not lock(st, st.get("guete"))["open"]:
            return 409, {"ok": False, "text": "Automatik ist noch gesperrt"}
        if value == "jetzt" and st.get("schalter") != "jetzt":
            st["vor_jetzt"] = st.get("schalter")
        st["schalter"] = value
        st.pop("hand", None)
        _write(self.file, st)
        return 200, {
            "ok": True,
            "text": {"aus": "Aus", "automatik": "Automatik an", "jetzt": "Lädt gleich voll"}[value],
        }

    # ── on the car tab ──────────────────────────────────────────────────────────────────────────────────────
    def sections(self) -> list[dict]:
        st = self.state()
        lp = (st.get("gelesen") or {}).get("lp")
        if lp and lp.get("kein_ladepunkt"):
            return []  # a house without a wallbox: no switch at all
        lk = lock(st, st.get("guete"))
        c = lk["conds"]
        auto_sub = "nach Plan, Sonne zuerst" if lk["open"] else "gesperrt – öffnet sich selbst"
        choice = {
            "type": "choice",
            "title": "Laden",
            "id": ITEM,
            "slot": "top",
            "selected": st.get("schalter") or "aus",
            "options": [
                {"value": "aus", "label": "Aus", "sub": "VibeDash schaltet nichts"},
                {"value": "automatik", "label": "Automatik", "sub": auto_sub, "disabled": not lk["open"]},
                {"value": "jetzt", "label": "Jetzt voll laden", "sub": "sofort, bis abgesteckt"},
            ],
            "note": _lage(st, lp),
            "info": {
                "what": "Automatik schaltet die Wallbox über evcc nach dem Ladeplan: Sonne fürs Auto, kein Netzstrom. "
                "Sie ist gesperrt, bis sie sich bewährt hat, und öffnet sich dann von selbst. Eine Änderung in der "
                "evcc- oder Wallbox-App gewinnt immer – bis zum Abstecken.",
                "source": "evcc (Ladepunkt), Ladeplan und seine Rückrechnung (nur Vergangenheit).",
            },
        }
        tr = c["treffsicher"]
        items = [
            {
                "text": "Werte lesen",
                "meta": f"{c['lesen']['have']} von {c['lesen']['need']} Tagen",
                **({"state": "ok"} if c["lesen"]["ok"] else {}),  # open = only waiting, no task
            },
            {
                "text": "Plan trifft",
                "meta": (
                    f"{tr['k']} von {tr['n']} Tagen ohne Netzstrom · sicher ≥ {round(tr['low'] * 100)} % "
                    f"(nötig {round(TREFF_MIN * 100)} %, ab {TREFF_N} Tagen)"
                    if tr["n"]
                    else "sammelt Daten · 0 Tage"
                ),
                **({"state": "ok"} if tr["ok"] else {}),  # open = only waiting, no task
            },
            {
                "text": "Pausetest",
                "meta": _test_text(st.get("pausetest") or {}),
                **({"state": "ok"} if c["pausetest"]["ok"] else {}),  # open = only waiting, no task
            },
        ]
        out = [choice]
        if not lk["open"]:
            title = "Automatik gesperrt" + (f": {lk['wegen']}" if lk["wegen"] else "")
            out.append(
                {
                    "type": "list",
                    "title": title,
                    "slot": "top",
                    "items": items,
                    "info": {
                        "what": "Die Automatik öffnet sich erst, wenn alle drei Punkte erfüllt sind, und "
                        "schließt sich wieder, wenn der Plan schlechter trifft oder die Wallbox das Umschalten "
                        "nicht bestätigt.",
                        "source": "evcc, Rückrechnung des Ladeplans, Ladeleistung beim Pausetest.",
                    },
                }
            )
            t = st.get("pausetest") or {}
            if not t.get("erlaubt") and t.get("ergebnis") != "ok":
                out.append(
                    {
                        "type": "choice",
                        "title": "Pausetest",
                        "id": TEST_ITEM,
                        "slot": "top",
                        "selected": None,
                        "options": [
                            {"value": "erlauben", "label": "Erlauben", "sub": "beim nächsten Laden, ≈ 1 Minute"},
                            {"value": "spaeter", "label": "Später", "sub": "nichts passiert"},
                        ],
                        "note": "Ich pausiere das Laden einmal kurz und schaue, ob die Ladeleistung wirklich fällt – "
                        "danach geht es weiter wie vorher.",
                    }
                )
        return out


def _lage(st: dict, lp: dict | None) -> str:
    if not lp:
        return "evcc nicht erreichbar."
    if not lp["connected"]:
        return "Auto nicht angesteckt."
    kw = lp["kw"] or 0
    s = (
        f"Auto angesteckt, lädt {str(round(kw, 1)).replace('.', ',')} kW."
        if kw >= 0.1
        else "Auto angesteckt, lädt nicht."
    )
    if st.get("hand"):
        s += " In der App von Hand umgestellt – VibeDash wartet bis zum Abstecken."
    return s


def _test_text(t: dict) -> str:
    if t.get("ergebnis") == "ok":
        return "bestanden"
    if t.get("ergebnis"):
        return f"nicht bestanden ({t['ergebnis']}) – nochmal erlauben"
    if t.get("laeuft"):
        return "läuft gerade"
    return "erlaubt – beim nächsten Laden" if t.get("erlaubt") else "noch nicht erlaubt"
