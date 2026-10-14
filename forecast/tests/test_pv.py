"""Synthetic PV plant only: two roof planes, made-up location and weather."""

from datetime import UTC, date, datetime, timedelta

import numpy as np

from vibedash_forecast import pv
from vibedash_forecast.solar import clear_sky_gti, sun_position

PLANT = pv.Plant(
    lat=50.0,
    lon=8.0,
    tz="Europe/Berlin",
    planes=[pv.Plane("sued", 30, 0, 6.0), pv.Plane("west", 30, 90, 3.0)],
    max_kw=8.0,
)
TRUE_K = np.array([5.1, 2.4])  # effective factors the model should find


def synthetic(days: int, seed: int = 4):
    """Weather forecast = clear sky x cloud(day) x noise; actual = physics x forecast error."""
    rng = np.random.default_rng(seed)
    start = datetime(2026, 5, 1, tzinfo=UTC) - timedelta(hours=2)
    hours = pv.hour_range(start, start + timedelta(days=days))
    actual, gti = {}, {}
    cloud_by_day = {}
    for h in hours:
        d = (h + timedelta(hours=2)).date()
        cloud = cloud_by_day.setdefault(d, float(rng.uniform(0.2, 1.0)))
        err = float(rng.normal(1.0, 0.12))
        g = []
        for p in PLANT.planes:
            v = (
                clear_sky_gti(h + timedelta(minutes=30), PLANT.lat, PLANT.lon, p.tilt, p.azimuth)
                * cloud
            )
            gti[(h, p.name)] = v
            g.append(v)
        actual[h] = max(0.0, min(8.0, float(np.array(g) @ TRUE_K / 1000) * err))
    now = hours[-1] + timedelta(hours=1)
    return pv.to_days(PLANT, hours, actual, gti, now)


def test_sun_is_up_at_noon_and_down_at_midnight():
    elev_noon, az = sun_position(datetime(2026, 6, 21, 11, tzinfo=UTC), 50, 8)
    assert 60 < elev_noon < 65 and 150 < az < 210
    assert sun_position(datetime(2026, 6, 21, 23, tzinfo=UTC), 50, 8)[0] < 0


def test_days_are_local_and_dst_aware():
    days = synthetic(5)
    assert all(len(d.hours) in (23, 24, 25) for d in days)
    assert days[0].day == date(2026, 5, 1)


def test_factors_recovered_and_capped():
    days = synthetic(60)
    k = pv.fit_factors(days[:50], PLANT)
    assert k is not None and np.allclose(k, TRUE_K, rtol=0.1)
    assert pv.physical(np.array([[2000.0, 2000.0]]), k, PLANT)[0] == 8.0  # inverter cap


def test_forecast_has_range_and_uses_only_past_days():
    days = synthetic(60)
    target = days[-1]
    f = pv.forecast_day(target, days, PLANT)
    assert f is not None
    assert np.all(f.p10 <= f.p50) and np.all(f.p50 <= f.p90)
    lo, mid, hi = f.total
    assert lo <= mid <= hi and f.n_analog == pv.ANALOG_DAYS
    # Changing the target day's (and the day before's) actual values changes nothing.
    changed = [
        pv.DayData(d.day, d.hours, None if d.actual is None else d.actual * 5, d.gti)
        if d.day >= target.day - timedelta(days=1)
        else d
        for d in days
    ]
    g = pv.forecast_day(changed[-1], changed, PLANT)
    assert g is not None and np.allclose(g.p50, f.p50)


def test_backtest_accuracy_and_rule_comparison():
    days = synthetic(70)
    acc = pv.accuracy(pv.backtest(days, PLANT))
    assert acc["zustand"] == "bewertbar" and acc["n"] >= pv.MIN_DAYS
    assert acc["korrekt_pct"] > 75  # weather is known well here, so physics should do well
    assert acc["schlaegt_faustregel_pct"] > 0
    assert 50 <= acc["im_band_pct"] <= 100


def test_too_little_history_gives_no_forecast():
    days = synthetic(10)
    assert pv.forecast_day(days[-1], days, PLANT) is None
    assert pv.accuracy(pv.backtest(days, PLANT))["zustand"] == "offen"
