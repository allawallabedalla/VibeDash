from datetime import UTC, datetime, timedelta

import numpy as np
from fastapi.testclient import TestClient

from vibedash_forecast import pv
from vibedash_forecast.app import create_app
from vibedash_forecast.solar import clear_sky_gti
from vibedash_forecast.store import Store

from .test_pv import PLANT, TRUE_K

ANLAGE = {
    "lat": PLANT.lat,
    "lon": PLANT.lon,
    "tz": PLANT.tz,
    "flaechen": [
        {"name": p.name, "neigung": p.tilt, "azimut": p.azimuth, "kwp": p.kwp} for p in PLANT.planes
    ],
    "max_kw": 8.0,
}


def test_pv_api_flow():
    rng = np.random.default_rng(9)
    start = datetime(2026, 5, 1, tzinfo=UTC) - timedelta(hours=2)
    days = 50
    hours = pv.hour_range(start, start + timedelta(days=days + 2))
    now = start + timedelta(days=days) - timedelta(hours=4)  # 20:00 local, evening before
    stunden, gti = [], []
    cloud = {}
    for h in hours:
        d = (h + timedelta(hours=2)).date()
        c = cloud.setdefault(d, float(rng.uniform(0.2, 1.0)))
        day_start = datetime.combine(d, datetime.min.time(), UTC) - timedelta(hours=2)
        g = []
        for p in PLANT.planes:
            v = (
                clear_sky_gti(h + timedelta(minutes=30), PLANT.lat, PLANT.lon, p.tilt, p.azimuth)
                * c
            )
            g.append(v)
            # forecasts for the coming days are known "now"; past ones the evening before
            stand = now if h >= now else day_start - timedelta(hours=4)
            gti.append(
                {"zeit": h.isoformat(), "flaeche": p.name, "wert": v, "stand": stand.isoformat()}
            )
        if h < now - timedelta(hours=20):
            stunden.append(
                {
                    "zeit": h.isoformat(),
                    "wert": float(np.array(g) @ TRUE_K / 1000) * float(rng.normal(1, 0.1)),
                }
            )

    c = TestClient(create_app(Store(), now=lambda: now))
    assert c.put("/pv/pv_anlage/anlage", json=ANLAGE).status_code == 200
    # a GTI value that arrives after its day began is refused
    late = {
        "zeit": hours[30].isoformat(),
        "flaeche": "sued",
        "wert": 999.0,
        "stand": hours[40].isoformat(),
    }
    r = c.put("/pv/pv_anlage/daten", json={"stunden": stunden, "gti": [late, *gti]}).json()
    assert r["gti_angenommen"] < len(gti) + 1

    assert c.get("/pv/pv_anlage/status").json()["zustand"] == "bereit"
    f = c.get("/pv/pv_anlage/prognose").json()["prognosen"]
    assert len(f) >= 1
    for day in f:
        assert len(day["p50"]) in (23, 24, 25)
        lo, mid, hi = day["summe"]
        assert lo <= mid <= hi
        assert all(a <= b <= x for a, b, x in zip(day["p10"], day["p50"], day["p90"], strict=True))
    g = c.get("/pv/pv_anlage/guete").json()
    assert g["zustand"] == "bewertbar" and g["korrekt_pct"] > 70
    assert len(g["modellkarte"]["faktoren"]) == 2


def test_unknown_plant_and_bad_input():
    c = TestClient(create_app(Store(), now=lambda: datetime(2026, 5, 1, tzinfo=UTC)))
    assert c.get("/pv/none/prognose").status_code == 404
    bad = {**ANLAGE, "flaechen": [{"name": "Süd!", "neigung": 30, "azimut": 0, "kwp": 5}]}
    assert c.put("/pv/x/anlage", json=bad).status_code == 422
