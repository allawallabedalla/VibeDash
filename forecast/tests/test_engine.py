"""Synthetic data only. Checks the honesty rules of ANLEITUNG.md section 11."""

from datetime import UTC, date, datetime, timedelta

import numpy as np

from vibedash_forecast import engine
from vibedash_forecast.methods import LEAD_DAYS, known, ridge
from vibedash_forecast.store import Store

START = date(2026, 5, 1)


def pv_like(days: int, seed: int = 1, with_weather: bool = True):
    """Daily yield = 45 kWh x cloud factor; the cloud factor is 'forecast' in advance."""
    rng = np.random.default_rng(seed)
    history, features = {}, {}
    for i in range(days):
        d = START + timedelta(days=i)
        cloud = float(rng.uniform(0.2, 1.0))
        history[d] = 45 * cloud + float(rng.normal(0, 1.5))
        if with_weather:
            features[d] = {"sonne": cloud + float(rng.normal(0, 0.05))}
    return history, features


def test_known_respects_lead_time():
    history, _ = pv_like(40)
    target = START + timedelta(days=30)
    assert max(d for d, _ in known(history, target)) == target - timedelta(days=LEAD_DAYS)


def test_no_look_into_the_future():
    history, features = pv_like(60)
    target = START + timedelta(days=50)
    before = ridge(history, features, target)
    changed = dict(history)
    for d in changed:
        if d >= target - timedelta(days=1):
            changed[d] = 9999.0
    assert ridge(changed, features, target) == before


def test_rule_of_thumb_wins_without_information():
    # Pure noise around a level: Ridge has nothing to add.
    rng = np.random.default_rng(3)
    history = {START + timedelta(days=i): 18 + float(rng.normal(0, 1)) for i in range(90)}
    choice = engine.choose(engine.backtest(history, {}))
    assert choice.method != "ridge"
    assert choice.beats_rule_pct == 0.0


def test_ridge_wins_only_with_a_paired_2se_advantage():
    history, features = pv_like(120)
    bt = engine.backtest(history, features)
    choice = engine.choose(bt)
    assert choice.method == "ridge"
    assert choice.paired_diff > engine.SE_FACTOR * choice.paired_se
    assert choice.beats_rule_pct > 0


def test_range_and_n():
    history, features = pv_like(120)
    bt = engine.backtest(history, features)
    choice = engine.choose(bt)
    target = max(history) + timedelta(days=1)
    features[target] = {"sonne": 0.5}
    f = engine.forecast(history, features, target, bt, choice, nonnegative=True)
    assert f is not None
    assert f.p10 <= f.p50 <= f.p90
    assert f.n == bt.n


def test_status_collecting_open_assessable():
    h, f = pv_like(10)
    s = engine.status(h, engine.backtest(h, f))
    assert s["zustand"] == "sammelt" and s["tage"] == 10 and s["benoetigt"] == 30
    h, f = pv_like(36)
    assert engine.status(h, engine.backtest(h, f))["zustand"] == "offen"
    h, f = pv_like(60)
    assert engine.status(h, engine.backtest(h, f))["zustand"] == "bewertbar"


def test_errors_are_averaged_as_magnitudes():
    pct = engine.correct_pct(np.array([14.0, 6.0]), np.array([10.0, 10.0]))
    assert pct == 60.0  # +40 % and -40 % must not cancel to 100 %


def test_accuracy_is_open_below_14_and_names_its_source():
    h, f = pv_like(36)
    bt = engine.backtest(h, f)
    g = engine.guete(bt, engine.choose(bt), live=[])
    assert g["zustand"] == "offen" and g["quelle"] == "rueckrechnung"
    assert "korrekt_pct" not in g


def test_season_warning_in_the_first_year():
    h, _ = pv_like(60)
    assert engine.season_untested(h, START + timedelta(days=61)) is False
    assert engine.season_untested(h, date(2026, 12, 20)) is True


def test_store_first_forecast_wins_and_features_must_be_known_in_advance():
    s = Store()
    day = date(2026, 6, 10)
    t1 = datetime(2026, 6, 9, 20, tzinfo=UTC)
    assert s.put_prognose("x", day, t1, 4.0, (1, 2, 3), "a")
    assert not s.put_prognose("x", day, t1 + timedelta(hours=1), 3.0, (9, 9, 9), "b")
    assert s.prognosen("x")[0]["p50"] == 2
    assert s.put_merkmal("x", "2026-06-10", "sonne", 0.5, t1)
    assert not s.put_merkmal("x", "2026-06-10", "sonne", 0.9, t1)  # first wins
    late = datetime(2026, 6, 10, 9, tzinfo=UTC)
    assert not s.put_merkmal("x", "2026-06-11", "sonne", 0.1, late + timedelta(days=1))
