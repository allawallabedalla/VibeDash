"""Synthetic data only. Checks the honesty rules of ANLEITUNG.md section 11."""

from datetime import UTC, date, datetime, timedelta

import numpy as np

from vibedash_forecast import engine
from vibedash_forecast.methods import LEAD_DAYS, cutoff_for, fit_ridge, known
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
    before = fit_ridge(history, features, cutoff_for(target), "wert")(target)
    changed = dict(history)
    for d in changed:
        if d >= target - timedelta(days=1):
            changed[d] = 9999.0
    assert fit_ridge(changed, features, cutoff_for(target), "wert")(target) == before


def test_rule_of_thumb_wins_without_information():
    # Pure noise around a level: Ridge has nothing to add.
    rng = np.random.default_rng(3)
    history = {START + timedelta(days=i): 18 + float(rng.normal(0, 1)) for i in range(90)}
    choice = engine.choose(engine.backtest(history, {}))
    assert choice.method != "ridge"
    assert choice.beats_rule_pct == 0.0


def test_a_learner_wins_only_with_a_paired_2se_advantage():
    history, features = pv_like(120)
    bt = engine.backtest(history, features)
    choice = engine.choose(bt)
    assert choice.method in ("ridge", "boosting")
    assert choice.paired_diff > engine.SE_FACTOR * choice.paired_se
    assert choice.beats_rule_pct > 0
    # The ladder is documented step by step.
    assert [s["verfahren"] for s in choice.steps] == ["ridge", "boosting"]


def test_boosting_must_beat_ridge_not_just_the_rule():
    # Linear relation: Ridge captures it; boosting has no paired 2 SE advantage over Ridge.
    history, features = pv_like(150, seed=5)
    choice = engine.choose(engine.backtest(history, features))
    step = choice.steps[1]
    assert step["gegen"] == "ridge" or choice.method != "boosting"
    if choice.method == "boosting":
        assert step["vorteil"] > engine.SE_FACTOR * step["standardfehler"]


def test_yes_no_target_gives_probabilities_and_absolute_error_accuracy():
    rng = np.random.default_rng(2)
    history, features = {}, {}
    for i in range(90):
        d = START + timedelta(days=i)
        dark = float(rng.uniform(0, 1))
        features[d] = {"dunkel": dark}
        history[d] = 1.0 if rng.uniform() < dark else 0.0
    bt = engine.backtest(history, features, "janein")
    choice = engine.choose(bt)
    target = max(history) + timedelta(days=1)
    features[target] = {"dunkel": 0.9}
    f = engine.forecast(history, features, target, bt, choice, True, "janein")
    assert f is not None and 0.0 <= f.p50 <= 1.0 and f.p10 == f.p50 == f.p90
    g = engine.guete(bt, choice, [], "janein")
    assert 0 <= g["korrekt_pct"] <= 100 and "Wahrscheinlichkeit" in g["definition"]


def test_doubtful_data_base_is_named_not_scored():
    history, _ = pv_like(40)
    history[START + timedelta(days=5)] = -3.0
    s = engine.status(history, engine.backtest(history, {}), nonnegative=True)
    assert s["zustand"] == "pruefung" and "negative" in s["gruende"][0]
    history, _ = pv_like(40)
    history[START + timedelta(days=5)] = 5000.0
    assert engine.status(history, engine.backtest(history, {}))["zustand"] == "pruefung"


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
    assert not s.put_merkmal("x", "2026-06-10", "sonne", 0.9, t1)  # same run twice: kept once
    # a fresher run before the day began replaces the older one (Audit01 P-03)
    assert s.put_merkmal("x", "2026-06-10", "sonne", 0.7, t1 + timedelta(hours=2))
    assert s.merkmale("x")[day]["sonne"] == 0.7
    late = datetime(2026, 6, 10, 9, tzinfo=UTC)
    assert not s.put_merkmal("x", "2026-06-11", "sonne", 0.1, late + timedelta(days=1))
