from datetime import date, timedelta

import numpy as np

from vibedash_forecast import plan

DAY = date(2026, 6, 21)
BATT = plan.Battery(
    capacity_kwh=10, max_charge_kw=5, max_discharge_kw=5, min_soc_pct=5, reserve_kwh=2
)


def pv_scen(peak: float, n: int = 30, t: int = 36, seed: int = 1) -> np.ndarray:
    rng = np.random.default_rng(seed)
    hours = np.arange(t) % 24
    bell = np.clip(np.sin((hours - 5) / 16 * np.pi), 0, None)
    return np.array([bell * peak * rng.uniform(0.7, 1.1) for _ in range(n)])


def load_scen(n: int = 30, t: int = 36, seed: int = 2) -> np.ndarray:
    rng = np.random.default_rng(seed)
    return np.array([np.full(t, 0.5) * rng.uniform(0.8, 1.2) for _ in range(n)])


def car(charged: float = 0.0) -> plan.Car:
    return plan.Car(capacity_kwh=60, phases=3, min_a=6, max_a=16, charged_today_kwh=charged)


def test_sunny_day_charges_without_extra_grid_import():
    pv, ld = pv_scen(8), load_scen()
    p, (lo, hi), _ = plan.plan_with_range(pv, ld, BATT, 6.0, car(), DAY)
    assert p.kwh > 10
    assert lo <= hi
    check = plan.what_if(pv, ld, BATT, 6.0, p.car_kw, DAY)
    # cautious: in at least 30/31 of the scenarios no extra grid import
    assert check["anteil_szenarien_mit_netz"] <= 100 / 31 + 0.5
    # charging only while the sun shines (no night hours)
    for t, kw in enumerate(p.car_kw):
        if kw > 0:
            assert np.median(pv[:, t]) > 0


def test_no_sun_no_charge():
    p, _, _ = plan.plan_with_range(np.zeros((30, 36)), load_scen(), BATT, 6.0, car(), DAY)
    assert p.kwh == 0
    assert p.reason == "none"


def test_cap_by_car_capacity_minus_charged_today():
    p, _, _ = plan.plan_with_range(pv_scen(30), load_scen(), BATT, 10.0, car(charged=55), DAY)
    assert p.kwh <= 5 + 1e-9


def test_same_day_same_plan():
    pv, ld = pv_scen(8), load_scen()
    a, _, _ = plan.plan_with_range(pv, ld, BATT, 6.0, car(), DAY)
    b, _, _ = plan.plan_with_range(pv, ld, BATT, 6.0, car(), DAY)
    assert np.array_equal(a.car_kw, b.car_kw)


def test_reserve_stays_in_battery():
    # little sun: battery must still carry the night; reserve never planned away
    pv, ld = pv_scen(1.2), load_scen()
    p, _, _ = plan.plan_with_range(pv, ld, BATT, 3.0, car(), DAY)
    check = plan.what_if(pv, ld, BATT, 3.0, p.car_kw, DAY)
    assert check["netz_kwh"][1] <= plan.TOLERANCE_KWH


def test_simulate_battery_limits():
    pv = np.array([[0.0, 0.0]])
    ld = np.array([[3.0, 3.0]])
    b = plan.Battery(10, 5, 2, min_soc_pct=10, reserve_kwh=0)
    imported = plan.simulate(pv, ld, np.zeros(2), b, 4.0)
    # hour 1: 2 kWh from the battery (limit), 1 from the grid; hour 2: only 1 kWh left
    # above the floor (1 kWh), 2 from the grid
    assert imported[0] == 3.0


def test_load_model_mean_faithful():
    rng = np.random.default_rng(3)
    start = date(2025, 10, 1)
    days = []
    for i in range(120):
        d = start + timedelta(days=i)
        temp = 12 - 10 * np.sin(i / 120 * np.pi) + rng.normal(0, 2)
        level = 8 + 0.6 * plan.hdd(temp) + (2 if d.weekday() >= 5 else 0)
        prof = np.concatenate([np.full(7, 0.6), np.full(10, 1.0), np.full(7, 1.6)])
        prof = prof / prof.sum() * level * rng.lognormal(0, 0.1)
        days.append((d, float(temp), prof))
    m = plan.fit_load(days)
    assert m is not None
    assert abs(m.coef[1] - 0.6) < 0.1
    scen = plan.load_scenarios(m, date(2026, 2, 7), 2.0, plan.day_rng(DAY))
    assert scen.shape == (30, 24)
    expect = 8 + 0.6 * 16 + 2
    assert abs(scen.sum(axis=1).mean() - expect) / expect < 0.15
    assert plan.load_untested(m, -15.0)
    assert not plan.load_untested(m, 5.0)


def test_too_little_history():
    assert plan.fit_load([(DAY, 10.0, np.ones(24))] * 10) is None


def test_until_limits_charging_hours():
    pv, ld = pv_scen(8), load_scen()
    p = plan.greedy_plan(pv, ld, BATT, 6.0, car(), until=12)
    assert p.car_kw[12:].sum() == 0


def test_step_soc_matches_simulate():
    b = plan.Battery(10, 5, 2, min_soc_pct=10, reserve_kwh=0)
    assert plan.step_soc(4.0, 0.0, 3.0, 0.0, b) == 2.0
    assert plan.step_soc(2.0, 0.0, 3.0, 0.0, b) == 1.0
