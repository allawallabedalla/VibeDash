"""Module "auto": the car's tab – state of charge, when to plug in, sun for the car, driving profile – and a
calculator "plug in at …" (day + time). Only reads and calculates; switches nothing. On a house with a charging
page (mapping boards[].onPage = "charging") the sections are shown there, placed by "slot".

Config (local/modules/auto.json, template modules/templates/auto.json):
  prognose     the car forecast file (format in board.py) the board shows – written by this module ("betrieb":
               "an") or by the house; relative to the modules folder or absolute
  betrieb      "aus" (default: only show), "schatten" (compute the forecast from the account files into
               "schatten_prognose", no call to the maker, nothing else written) or "an" (every "takt_min": fetch
               from the maker's account, compute, write files, history and heartbeats)
  konto        {app, token, status, fahrten} – maker's account (hersteller.py): app keys, token (rewritten),
               status and trips files (written in "an", read in "schatten")
  plan         optional charge plan of the house ({tage: [{tag, kwh, kwh_p90, pv_kwh, bloecke}]}) – sun for the car
  influx       optional {url, db, wallbox?: {measurement, feld}, schreiben?: true} – wallbox meter (read);
               with schreiben the history auto_cloud / auto_fahrt / auto_prognose is written ("an" only)
  takt_min, versatz_min   default 15 and 9 (runs at :09, :24, :39, :54)
  herzschlag   optional {abruf, prognose} – files touched after a good run (house watchdogs)
  zeitzone     e.g. "Europe/Berlin" (day start of the calculator)
  rechner      optional {url, tage?} – the house's charge planner answers "what if plugged in at …":
               POST {board, value} (value = day × 1440 + minutes, local), header X-Haus-Rechnung: 1 ->
               {"sections": [...]}; it must not change anything. Without it there is no calculator.
  risiko       optional {datei, bis_kwh?} – how cautious the house's charge plan is (risiko.py): the choice is
               stored in this file (the house's planner reads it); without it there is no choice. Holds until
               midnight, with bis_kwh until the car has charged that much (the house's planner ends it)
  steuerung    optional {status_url, jetzt_url, automatik_url} – the house's own charge control (steuerung.py):
               a choice „Automatik / Jetzt voll laden“ that forwards the tap; the house switches by its own rules
  zeitstrahl   optional path of the house's weather cases for the charge timeline (zeitstrahl.py; shown only)
  waechter     optional {evcc_url, passwort_env?, ladepunkt?, plan_url, guete_url, zustand?} – the product's charge
               guard (waechter.py): switches the wallbox through evcc by the charge plan, locked until it has
               proved itself; runs every minute. Not together with "steuerung" (the house's own guard).
  texte        optional wording overrides (keys of board.TEXT, CALC)
"""

from __future__ import annotations

import contextlib
import json
import math
import os
import time
import urllib.request
from datetime import datetime
from zoneinfo import ZoneInfo

from . import board, hersteller, prognose, risiko, steuerung, waechter, zeitstrahl
from .quellen import Influx, zeile

STEP_MIN = 15
CALC = {
    "rechner_titel": "Anstecken um",
    "rechner_knopf": "Rechnen",
    "rechner_note": "Nur Rechnung, steuert nichts. Dauert ≈ 15–25 s.",
    "rechner_was": (
        "Tag und Uhrzeit wählen, zu der du das Auto ansteckst, dann Rechnen. Gerechnet wird der normale Ladeplan "
        "des Hauses – nur mit „Auto steckt erst ab dann“, bis zum Ende des Folgetags."
    ),
    "rechner_quelle": "Ladeplaner des Hauses; schreibt nichts.",
}


def _load(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def _post(url: str, body: dict, timeout: int = 45):
    req = urllib.request.Request(  # noqa: S310 – address from the local config only
        url,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "X-Haus-Rechnung": "1"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:  # noqa: S310
        return r.status, json.load(r)


class Module:
    name = "auto"
    feeds: dict = {}

    def __init__(self, cfg: dict, path, post=_post, clock=time.time):
        if not cfg.get("prognose"):
            raise ValueError("prognose missing")
        self.cfg = cfg
        self.path = path
        self.post = post
        self.clock = clock
        self.t = {**board.TEXT, **CALC, **(cfg.get("texte") or {})}
        self.tz = ZoneInfo(cfg.get("zeitzone") or "Europe/Berlin")

    def _calc_section(self, now: float) -> dict | None:
        r = self.cfg.get("rechner") or {}
        if not r.get("url"):
            return None
        d = datetime.fromtimestamp(now, self.tz)
        m = math.ceil((d.hour * 60 + d.minute + d.second / 60) / STEP_MIN) * STEP_MIN
        m = min(m, 1440 - STEP_MIN)
        t = self.t
        return {
            "type": "calc",
            "title": t["rechner_titel"],
            "label": t["rechner_titel"],
            "min": m,
            "max": 1440 - STEP_MIN,
            "step": STEP_MIN,
            "value": m,
            "format": "clock",
            "days": int(r.get("tage") or 7),
            "button": t["rechner_knopf"],
            "note": t["rechner_note"],
            "info": {"what": t["rechner_was"], "source": t["rechner_quelle"]},
        }

    # ── Takt (called by the modules service, see app.py) ──────────────────────────────────────────────────────
    def _prognose_takt(self) -> tuple[int, int] | None:
        if (self.cfg.get("betrieb") or "aus") not in ("schatten", "an"):
            return None
        return int(self.cfg.get("takt_min") or 15) * 60, int(self.cfg.get("versatz_min", 9)) * 60

    def _waechter(self) -> waechter.Waechter | None:
        w = self.cfg.get("waechter") or {}
        if not w.get("evcc_url") or (self.cfg.get("steuerung") or {}).get("status_url"):
            return None
        return waechter.Waechter(w, self.path)

    def takt(self) -> tuple[int, int] | None:
        """(period, offset) in seconds, or None when the module only shows. With the guard: every minute, the
        forecast still only in its own slots."""
        if self._waechter() is not None:
            return 60, 0
        return self._prognose_takt()

    def lauf(self, now: float | None = None) -> str:
        now = now or self.clock()
        out = []
        w = self._waechter()
        if w is not None:
            out.append("wächter: " + w.tick(now))
        t = self._prognose_takt()
        if t:
            # the forecast keeps its own period: once per slot (the slot is remembered in a small file)
            mark = self.path("auto/.prognose_slot")
            slot = int((now - t[1]) // t[0])
            try:
                with open(mark, encoding="utf-8") as f:
                    last = int(f.read().strip() or -1)
            except (OSError, ValueError):
                last = None
            if w is None or (last is not None and slot != last):
                out.append(self._prognose(now))
            if w is not None:
                os.makedirs(os.path.dirname(mark), exist_ok=True)
                with open(mark, "w", encoding="utf-8") as f:
                    f.write(str(slot))
        return " · ".join(out) or "nichts zu tun"

    def _prognose(self, now: float) -> str:
        """One run: "an" fetches from the maker, computes and writes; "schatten" only computes into its own file."""
        modus = self.cfg.get("betrieb") or "aus"
        k = self.cfg.get("konto") or {}
        st_p, fa_p = self.path(k["status"]), self.path(k["fahrten"])
        ic = self.cfg.get("influx") or {}
        influx = Influx(ic) if ic.get("db") else None
        text = ""
        if modus == "an":
            konto = hersteller.Konto(self.path(k["app"]), self.path(k["token"]), clock=self.clock)
            st, alle, neu = konto.abruf(st_p, fa_p)
            text = f"abruf: {st.get('soc')} % Stand {st.get('meldung')}, {len(neu)} neue Fahrten ({len(alle)} gesamt)"
            self._herz("abruf")
            if influx is not None and ic.get("schreiben"):
                influx.schreibe(_verlauf_auto(st, neu))
        else:
            st, alle = _load(st_p), _load(fa_p)
        plan = _load(self.path(self.cfg["plan"])) if self.cfg.get("plan") else None
        try:
            out = prognose.rechne(alle, st, plan, influx, jetzt=now)
        except Exception as e:  # noqa: BLE001 – without the meter: only the report (as the house script)
            if influx is None:
                raise
            out = prognose.rechne(alle, st, plan, None, jetzt=now)
            text += f" · Influx: {type(e).__name__}"
        if influx is not None:
            # the curve is extra; the tile shows the value without it
            with contextlib.suppress(Exception):
                out["soc_verlauf"] = influx.soc_verlauf(now)
        ziel = self.path(self.cfg["schatten_prognose"] if modus == "schatten" else self.cfg["prognose"])
        hersteller.schreib(ziel, out, mode=0o644)
        if modus == "an":
            self._herz("prognose")
            if influx is not None and ic.get("schreiben"):
                influx.schreibe([_verlauf_prognose(out)])
        e = out.get("entscheidung") or {}
        return f"{text} · {out.get('soc_jetzt')} % · {e.get('wort')}".strip(" ·")

    def _herz(self, was: str) -> None:
        p = (self.cfg.get("herzschlag") or {}).get(was)
        if p:
            with open(self.path(p), "a"):
                pass
            os.utime(self.path(p))

    def board(self) -> dict:
        now = self.clock()
        data = _load(self.path(self.cfg["prognose"]))
        if data is None and (self.cfg.get("betrieb") or "aus") == "aus" and self._waechter() is not None:
            # no car account here (only the wallbox through evcc): no "waiting for the car" text
            out = {"updated": int(now * 1000), "sections": []}
        else:
            out = board.build(data, now, self.t, self._calc_section(now))
        zp = self.cfg.get("zeitstrahl")
        if zp:
            p = self.path(zp)
            try:
                mt = os.path.getmtime(p)
            except OSError:
                mt = None
            tl = zeitstrahl.section(p, datetime.fromtimestamp(now, self.tz).date(), now, mt) if mt else None
            if tl:
                secs = out.get("sections") or []
                # after the house's plan (slot "plan"), before the calculator
                i = next((k for k, s in enumerate(secs) if s.get("type") == "calc"), len(secs))
                out["sections"] = secs[:i] + [tl] + secs[i:]
        sc = self.cfg.get("steuerung") or {}
        if sc.get("status_url"):
            out["sections"] = [steuerung.section(steuerung.status(sc))] + (out.get("sections") or [])
        w = self._waechter()
        if w is not None:
            out["sections"] = w.sections() + (out.get("sections") or [])
        rf = (self.cfg.get("risiko") or {}).get("datei")
        if rf:
            plan = _load(self.path(self.cfg["plan"])) if self.cfg.get("plan") else None
            bis_kwh = (self.cfg.get("risiko") or {}).get("bis_kwh")
            choice = risiko.section(risiko.current(self.path(rf), self.tz, now), plan, bis_kwh)
            secs = out.get("sections") or []
            # at the top, right after „Laden: Automatik / Jetzt voll laden“ (controls first, information after)
            i = 1 if secs and secs[0].get("id") in (steuerung.ITEM, waechter.ITEM) else 0
            out["sections"] = secs[:i] + [choice] + secs[i:]
        return out

    def action(self, d: dict):
        """{item: "laden:risiko", action: "choose", value} -> stores the level (until midnight or bis_kwh)."""
        value = d.get("value")
        w = self._waechter()
        if w is not None and d.get("item") in (waechter.ITEM, waechter.TEST_ITEM) and d.get("action") == "choose":
            return w.choose(d["item"], value)
        sc = self.cfg.get("steuerung") or {}
        if sc.get("status_url") and d.get("item") == steuerung.ITEM and d.get("action") == "choose":
            return steuerung.choose(sc, value)
        rf = (self.cfg.get("risiko") or {}).get("datei")
        if not rf or d.get("item") != risiko.ITEM or d.get("action") != "choose":
            return 404, {"ok": False, "text": "keine Aktion"}
        if value not in {v for v, _, _ in risiko.LEVELS}:
            return 400, {"ok": False, "text": "unbekannte Stufe"}
        bis_kwh = (self.cfg.get("risiko") or {}).get("bis_kwh")
        risiko.store(self.path(rf), value, self.tz, self.clock(), bis_kwh)
        label = next(lb for v, lb, _ in risiko.LEVELS if v == value)
        if value == risiko.DEFAULT:
            return 200, {"ok": True, "text": f"Laden: {label}"}
        until = f"bis {risiko._num(bis_kwh)} kWh geladen" if bis_kwh is not None else "bis Mitternacht"
        return 200, {"ok": True, "text": f"Laden: {label} {until}"}

    def calc(self, d: dict):
        """{value} -> (status, {sections}) from the house's planner; only a calculation."""
        url = (self.cfg.get("rechner") or {}).get("url")
        v = d.get("value")
        if not url:
            return 404, {"error": "no_calc"}
        if not isinstance(v, (int, float)) or isinstance(v, bool) or not -1e6 < v < 1e6:
            return 400, {"error": "bad_value"}
        status, body = self.post(url, {"board": "auto", "value": v})
        if not (200 <= status < 300) or not isinstance(body, dict) or not isinstance(body.get("sections"), list):
            return 502, {"error": "upstream"}
        return 200, {"sections": body["sections"]}


def _verlauf_auto(s: dict, neu: list) -> list:
    """History points as the house wrote them: auto_cloud at the car's report time, auto_fahrt per new trip."""
    out = []
    felder = {
        k: float(s[k])
        for k in (
            "soc",
            "reichweite_km",
            "restzeit_min",
            "kapazitaet_kwh",
            "gesundheit_kap_pct",
            "gesundheit_widerstand_pct",
            "km_stand",
            "batterie_12v",
            "aussen_c",
        )
        if isinstance(s.get(k), (int, float)) and not isinstance(s.get(k), bool)
    }
    for k in ("lade_status", "lademodus", "zuendung", "vorklima"):
        if s.get(k) is not None:
            felder[k] = str(s[k])
    if s.get("angesteckt") is not None:
        felder["angesteckt"] = bool(s["angesteckt"])
    if s.get("meldung") and felder:
        out.append(zeile("auto_cloud", felder, hersteller.epoch(s["meldung"])))
    for f in neu:
        ff = {
            k: float(f[k])
            for k in ("km", "soc_start", "soc_ende", "km_stand", "v_mittel")
            if isinstance(f.get(k), (int, float))
        }
        ff["dauer_min"] = round((f["ende"] - f["start"]) / 60, 1)
        out.append(zeile("auto_fahrt", ff, f["start"]))
    return out


def _verlauf_prognose(out: dict) -> str | None:
    vh, ent = out.get("vorhersage"), out.get("entscheidung") or {}
    if not vh or out.get("soc_jetzt") is None:
        return None
    return zeile(
        "auto_prognose",
        {
            "soc_jetzt": float(out["soc_jetzt"]),
            "tage_frueh": float(vh["tage_bis_reserve"]["frueh"]),
            "tage_mitte": float(vh["tage_bis_reserve"]["mitte"]),
            "soc_morgen_p50": float(vh["soc_p50"][1]),
            "soc_morgen_p10": float(vh["soc_p10"][1]),
            "soc_morgen_p90": float(vh["soc_p90"][1]),
            "stufe": str(ent.get("stufe") or ""),
            "wort": str(ent.get("wort") or ""),
        },
        out["jetzt"],
    )
