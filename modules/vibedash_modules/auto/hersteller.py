"""The maker's car account (Stellantis: Citroën, Peugeot, Opel, DS – the API of the maker's app, as used by the
Home Assistant integration "Stellantis Vehicles"). Only reads: vehicle list, status, trips. Never wakes the car,
no remote commands. Stored WITHOUT location (no positions of status or trips).

Keys (local, never in the repo): an app file {client_id, client_secret, oauth_url, realm, scheme, culture, locale,
vin_endet_auf} and a token file (written here, mode 600). First sign-in by hand:

    python3 -m vibedash_modules.auto.hersteller login-url <app.json>
    python3 -m vibedash_modules.auto.hersteller code <app.json> <token.json> <code or redirect address>
"""

from __future__ import annotations

import base64
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime

API = "https://api.groupe-psa.com"


class Fehler(Exception):
    """The account or the API refused; the message says why (no secrets in it)."""


def lies(p, leer=None):
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return leer


def schreib(p, obj, mode=0o600):
    os.makedirs(os.path.dirname(p) or ".", exist_ok=True)
    tmp = f"{p}.neu{os.getpid()}"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, mode)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False)
    os.replace(tmp, p)


def _http(req, timeout=30):
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:  # noqa: S310 – fixed maker address
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, (e.read() or b"")[:300].decode("utf-8", "replace")


def redirect(a):
    return f"{a['scheme']}://oauth2redirect/{a['culture']}"


def _basic(a):
    return base64.b64encode(f"{a['client_id']}:{a['client_secret']}".encode()).decode()


class Konto:
    """One account: app keys (read) + token file (refreshed and written back)."""

    def __init__(self, app_datei: str, token_datei: str, http=_http, clock=time.time):
        self.a = lies(app_datei)
        if not isinstance(self.a, dict) or not self.a.get("client_id"):
            raise Fehler("app file missing or incomplete")
        self.token_datei = token_datei
        self.http = http
        self.clock = clock

    def tausche(self, daten: dict) -> dict:
        req = urllib.request.Request(  # noqa: S310
            f"{self.a['oauth_url']}/am/oauth2/access_token",
            data=urllib.parse.urlencode(daten).encode(),
            headers={"Authorization": f"Basic {_basic(self.a)}", "Content-Type": "application/x-www-form-urlencoded"},
            method="POST",
        )
        status, body = self.http(req)
        if status != 200 or not isinstance(body, dict):
            raise Fehler(f"sign-in refused: HTTP {status}")
        body["ablauf"] = self.clock() + int(body.get("expires_in", 900)) - 60
        schreib(self.token_datei, body)
        return body

    def token(self) -> dict:
        t = lies(self.token_datei)
        if not isinstance(t, dict) or not t.get("refresh_token"):
            raise Fehler("not signed in (token file missing)")
        if self.clock() < t.get("ablauf", 0):
            return t
        return self.tausche({"grant_type": "refresh_token", "refresh_token": t["refresh_token"]})

    def hole(self, pfad: str, extra: dict | None = None) -> dict:
        t = self.token()
        q = {"client_id": self.a["client_id"], "locale": self.a["locale"], **(extra or {})}
        req = urllib.request.Request(  # noqa: S310
            f"{API}{pfad}?" + urllib.parse.urlencode(q),
            headers={
                "Authorization": f"Bearer {t['access_token']}",
                "x-introspect-realm": self.a["realm"],
                "Accept": "application/hal+json",
            },
        )
        status, body = self.http(req)
        if status != 200 or not isinstance(body, dict):
            raise Fehler(f"{pfad.split('/')[-1]}: HTTP {status}")
        return body

    def mein_auto(self) -> dict:
        fz = self.hole("/connectedcar/v4/user/vehicles")
        autos = (fz.get("_embedded") or {}).get("vehicles") or []
        # the API lists vehicles in changing order – always pick by VIN
        autos = [v for v in autos if str(v.get("vin", "")).endswith(self.a.get("vin_endet_auf") or "")]
        if not autos:
            raise Fehler("vehicle not in the account")
        return autos[0]

    def fahrten_holen(self, vid: str, bekannt: set) -> list:
        """New finished trips. The API sorts oldest first, so all pages to the end."""
        neu, pfad, seiten, seite = [], f"/connectedcar/v4/user/vehicles/{vid}/trips", 0, None
        while seiten < 200:
            r = self.hole(pfad, {"pageToken": seite} if seite else {})
            for t in (r.get("_embedded") or {}).get("trips") or []:
                if t.get("done") and t.get("id") not in bekannt and t.get("startedAt") and t.get("stoppedAt"):
                    neu.append(fahrt_kurz(t))
            nxt = ((r.get("_links") or {}).get("next") or {}).get("href")
            if not nxt:
                break
            seite = urllib.parse.parse_qs(urllib.parse.urlparse(nxt).query).get("pageToken", [None])[0]
            if not seite:
                break
            seiten += 1
        return neu

    def abruf(self, status_datei: str, fahrten_datei: str) -> tuple[dict, list, list]:
        """Status + new trips -> files. Returns (status, all trips, new trips)."""
        v = self.mein_auto()
        st = self.hole(f"/connectedcar/v4/user/vehicles/{v['id']}/status")
        try:
            wartung = self.hole(f"/connectedcar/v4/user/vehicles/{v['id']}/maintenance")
        except Fehler:
            wartung = None
        s = status_kurz(st, wartung)
        s["abgerufen"] = int(self.clock())
        vorher = lies(status_datei, {}) or {}
        schreib(status_datei, s)
        alt = lies(fahrten_datei, []) or []
        # new trips come only with a new report of the car; otherwise do not fetch all pages again
        neu = (
            []
            if (alt and vorher.get("meldung") == s["meldung"])
            else self.fahrten_holen(v["id"], {f["id"] for f in alt})
        )
        alle = sorted(alt + neu, key=lambda f: f["start"])
        schreib(fahrten_datei, alle)
        return s, alle, neu


def _elektro(liste):
    for e in liste or []:
        if e.get("type") == "Electric":
            return e
    return {}


def dauer_min(iso):
    """'PT10H30M' -> 630."""
    m = re.fullmatch(r"P(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?", str(iso or ""))
    if not m:
        return None
    h, mi, se = (int(x or 0) for x in m.groups())
    return h * 60 + mi + round(se / 60)


def epoch(iso):
    return int(datetime.fromisoformat(str(iso).replace("Z", "+00:00")).timestamp())


def status_kurz(st, wartung):
    """Status without location, flat, with German names."""
    e = _elektro(st.get("energies"))
    el = (e.get("extension") or {}).get("electric") or {}
    ch = el.get("charging") or {}
    bat = el.get("battery") or {}
    vk = ((st.get("preconditioning") or {}).get("airConditioning")) or {}
    return {
        "meldung": e.get("createdAt") or st.get("updatedAt"),
        "soc": e.get("level"),
        "reichweite_km": e.get("autonomy"),
        "angesteckt": ch.get("plugged"),
        "lade_status": ch.get("status"),
        "restzeit_min": dauer_min(ch.get("remainingTime")),
        "lademodus": ch.get("chargingMode"),
        "verzoegert_min": dauer_min(ch.get("nextDelayedTime")),
        "kapazitaet_kwh": (bat.get("load") or {}).get("capacity", 0) / 1000 or None,
        "gesundheit_kap_pct": (bat.get("health") or {}).get("capacity"),
        "gesundheit_widerstand_pct": (bat.get("health") or {}).get("resistance"),
        "km_stand": (st.get("odometer") or {}).get("mileage"),
        "batterie_12v": (st.get("battery") or {}).get("voltage"),
        "aussen_c": ((st.get("environment") or {}).get("air") or {}).get("temp"),
        "zuendung": (st.get("ignition") or {}).get("type"),
        "alarm": ((st.get("alarm") or {}).get("status") or {}).get("activation"),
        "vorklima": vk.get("status"),
        "vorklima_programme": [
            {
                "an": p.get("enabled"),
                "start_min": dauer_min(p.get("start")),
                "tage": (p.get("occurence") or {}).get("day") or [],
            }
            for p in vk.get("programs") or []
        ],
        "wartung_tage": (wartung or {}).get("daysBeforeMaintenance"),
        "wartung_km": (wartung or {}).get("mileageBeforeMaintenance"),
    }


def fahrt_kurz(t):
    """Trip without location."""
    a, b = _elektro(t.get("startEnergies")), _elektro(t.get("endEnergies"))
    return {
        "id": t.get("id"),
        "start": epoch(t["startedAt"]),
        "ende": epoch(t["stoppedAt"]),
        "km": t.get("distance"),
        "soc_start": a.get("level"),
        "soc_ende": b.get("level"),
        "km_stand": t.get("startMileage"),
        "v_mittel": (t.get("kinetic") or {}).get("avgSpeed"),
    }


def main(argv: list[str]) -> int:
    if len(argv) >= 2 and argv[0] == "login-url":
        a = lies(argv[1]) or {}
        q = {
            "client_id": a["client_id"],
            "response_type": "code",
            "redirect_uri": redirect(a),
            "scope": "openid profile email",
            "locale": a["locale"],
        }
        print(f"{a['oauth_url']}/am/oauth2/authorize?" + urllib.parse.urlencode(q, quote_via=urllib.parse.quote))
        return 0
    if len(argv) >= 4 and argv[0] == "code":
        k = Konto(argv[1], argv[2])
        code = urllib.parse.parse_qs(urllib.parse.urlparse(argv[3]).query).get("code", [argv[3]])[0]
        k.tausche({"grant_type": "authorization_code", "code": code, "redirect_uri": redirect(k.a)})
        print("signed in, token stored")
        return 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
