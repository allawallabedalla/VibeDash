from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient

from vibedash_forecast.app import create_app
from vibedash_forecast.store import Store

from .test_engine import START, pv_like


def client(now):
    return TestClient(create_app(Store(), now=lambda: now))


def test_full_flow_collect_then_forecast_with_range():
    history, features = pv_like(90)
    last = max(history)
    now = datetime.combine(last + timedelta(days=1), datetime.min.time(), UTC) + timedelta(hours=20)
    c = client(now)
    assert c.post("/reihen", json={"id": "pv_tag", "einheit": "kWh"}).status_code == 201

    # Weather known the day before; one value for "tomorrow" comes in now.
    merkmale = [
        {
            "tag": d.isoformat(),
            "name": "sonne",
            "wert": f["sonne"],
            "stand": (
                datetime.combine(d, datetime.min.time(), UTC) - timedelta(hours=4)
            ).isoformat(),
        }
        for d, f in features.items()
    ]
    tomorrow = last + timedelta(days=2)
    merkmale.append(
        {"tag": tomorrow.isoformat(), "name": "sonne", "wert": 0.7, "stand": now.isoformat()}
    )
    werte = [{"tag": d.isoformat(), "wert": v} for d, v in history.items()]
    r = c.put("/reihen/pv_tag/werte", json={"werte": werte, "merkmale": merkmale})
    assert r.status_code == 200

    p = c.get("/reihen/pv_tag/prognose").json()["prognosen"]
    # Today has already started at 20:00: only tomorrow counts as a forecast.
    assert [x["tag"] for x in p] == [tomorrow.isoformat()]
    assert p[0]["vorlauf_h"] > 0
    for x in p:
        assert x["p10"] <= x["p50"] <= x["p90"]
        assert x["erstellt_am"].startswith(now.date().isoformat())

    g = c.get("/reihen/pv_tag/guete").json()
    assert g["zustand"] == "bewertbar" and g["quelle"] == "rueckrechnung"
    assert 0 <= g["korrekt_pct"] <= 100 and g["n"] >= 14
    assert g["modellkarte"]["vorlauf_tage"] == 2
    assert c.get("/reihen/pv_tag/status").json()["zustand"] == "bewertbar"


def test_collecting_shows_progress_and_no_forecast():
    history, _ = pv_like(12)
    c = client(datetime(2026, 5, 13, 20, tzinfo=UTC))
    c.post("/reihen", json={"id": "pv_tag", "einheit": "kWh"})
    c.put(
        "/reihen/pv_tag/werte",
        json={"werte": [{"tag": d.isoformat(), "wert": v} for d, v in history.items()]},
    )
    s = c.get("/reihen/pv_tag/status").json()
    assert s["zustand"] == "sammelt" and s["tage"] == 12
    assert c.get("/reihen/pv_tag/prognose").json()["prognosen"] == []


def test_rejects_bad_ids_and_unknown_series():
    c = client(datetime(2026, 5, 1, tzinfo=UTC))
    assert c.post("/reihen", json={"id": "Bad-Id", "einheit": "kWh"}).status_code == 422
    assert c.get("/reihen/unknown/status").status_code == 404
    assert c.put(
        "/reihen/x/werte", json={"werte": [{"tag": "2026-05-01", "wert": "nan"}]}
    ).status_code in (404, 422)
    assert START.year == 2026
