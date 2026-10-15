import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import numpy as np
from fastapi.testclient import TestClient

from vibedash_forecast import pv
from vibedash_forecast.app import create_app
from vibedash_forecast.solar import clear_sky_gti
from vibedash_forecast.store import Store

from .test_pv import PLANT, TRUE_K
from .test_pv_api import ANLAGE

PLAN = {
    "pv": "pv_anlage",
    "akku": {"kapazitaet_kwh": 10, "max_laden_kw": 5, "max_entladen_kw": 5, "reserve_kwh": 2},
    "auto": {"kapazitaet_kwh": 60, "phasen": 3, "min_a": 6, "max_a": 16},
}


def synthetic(days: int = 45):
    """Made-up home: PV from clear-sky GTI x daily cloud, house load with an evening peak."""
    rng = np.random.default_rng(5)
    start = datetime(2026, 5, 1, tzinfo=UTC) - timedelta(hours=2)  # local midnight (CEST)
    hours = pv.hour_range(start, start + timedelta(days=days + 2))
    now = start + timedelta(days=days, hours=8, minutes=30)  # 08:30 local
    stunden, gti, last, soc, temp = [], [], [], [], []
    cloud, level = {}, {}
    for h in hours:
        local = h + timedelta(hours=2)
        d = local.date()
        c = cloud.setdefault(d, float(rng.uniform(0.3, 1.0)))
        lv = level.setdefault(d, float(rng.uniform(8, 12)))
        day_start = datetime.combine(d, datetime.min.time(), UTC) - timedelta(hours=2)
        stand = min(now, day_start - timedelta(hours=4))
        g = []
        for p in PLANT.planes:
            v = (
                clear_sky_gti(h + timedelta(minutes=30), PLANT.lat, PLANT.lon, p.tilt, p.azimuth)
                * c
            )
            g.append(v)
            gti.append(
                {"zeit": h.isoformat(), "flaeche": p.name, "wert": v, "stand": stand.isoformat()}
            )
        t = 14 + 4 * np.sin((local.hour - 9) / 24 * 2 * np.pi)
        temp.append({"zeit": h.isoformat(), "wert": float(t)})
        if h < now - timedelta(hours=1):
            stunden.append(
                {
                    "zeit": h.isoformat(),
                    "wert": float(np.array(g) @ TRUE_K / 1000) * float(rng.normal(1, 0.08)),
                }
            )
            shape = 0.6 + (1.0 if 17 <= local.hour <= 21 else 0.0)
            last.append(
                {"zeit": h.isoformat(), "wert": lv / 30 * shape * float(rng.lognormal(0, 0.1))}
            )
            soc.append({"zeit": h.isoformat(), "wert": 50.0})
    return now, stunden, gti, last, soc, temp


def test_plan_api_flow():
    now, stunden, gti, last, soc, temp = synthetic()
    c = TestClient(create_app(Store(), now=lambda: now))
    assert c.put("/pv/pv_anlage/anlage", json=ANLAGE).status_code == 200
    c.put("/pv/pv_anlage/daten", json={"stunden": stunden, "gti": gti})
    assert c.get("/plan/haus?soc_kwh=5").status_code == 404
    assert c.put("/plan/haus/anlage", json=PLAN).status_code == 200
    bad = {**PLAN, "auto": {**PLAN["auto"], "min_a": 20}}
    assert c.put("/plan/haus/anlage", json=bad).status_code == 422

    # too little load history: collecting, no plan
    c.put("/plan/haus/daten", json={"last": last[: 24 * 5], "soc": soc, "temp": temp})
    assert c.get("/plan/haus?soc_kwh=5").json()["zustand"] == "sammelt"

    c.put("/plan/haus/daten", json={"last": last, "soc": soc, "temp": temp})
    r = c.get("/plan/haus?soc_kwh=5&geladen_kwh=0").json()
    assert r["zustand"] == "bereit", r
    n = len(r["stunden"])
    assert n == 16 + 24  # 08:00 today to the end of tomorrow
    assert len(r["auto_kw"]) == n and all(len(x) == n for x in r["pv_listen"])
    assert len(r["paar_pv"]) == 300 and max(r["paar_pv"]) < len(r["pv_listen"])
    assert r["spanne"][0] <= r["spanne"][1]
    assert r["grund"] in ("none", "sun", "sunBattery", "full")
    assert r["kwh"] > 0
    # contract with the page (Audit01 P-02): every key the browser parses
    keys_file = Path(__file__).parents[2] / "tests/contract/plan-api-keys.json"
    contract = json.loads(keys_file.read_text())
    assert set(contract["keys"]) <= set(r), set(contract["keys"]) - set(r)
    assert r["akku"]["kapazitaet_kwh"] > 0 and r["auto"]["phasen"] in (1, 3)

    g = c.get("/plan/haus/guete").json()
    assert g["n"] + g["rechnet_noch"] >= 1
    while g["rechnet_noch"]:
        g = c.get("/plan/haus/guete").json()
    assert g["n"] >= 7 and g["zustand"] == "bewertbar"
    assert g["tage_netz"] <= 1
    assert g["geladen_kwh"] > 0
