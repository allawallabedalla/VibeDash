"""Method ladder (ANLEITUNG.md section 11), daily targets.

Every method predicts day D only from days <= D - LEAD_DAYS: the forecast is
made the evening before D, when D - 1 is not complete yet. Live and backtest
use the same lead.

Each method is a *fitter*: fit(history, features, cutoff) -> predictor(target).
Fitting uses only days <= cutoff. In the backtest, learning methods are refit
once a week (on data before that week), rules every day.

Targets:
- "wert": a number (e.g. kWh per day).
- "janein": 0/1 (e.g. "was the light on?"). Methods return probabilities,
  never a hard yes/no.
"""

import math
from collections.abc import Callable
from datetime import date, timedelta

import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

LEAD_DAYS = 2
MIN_ROWS = 21
MIN_LEAF = 20
History = dict[date, float]
Features = dict[date, dict[str, float]]
Predictor = Callable[[date], float | None]
Fitter = Callable[[History, Features, date, str], Predictor]


def cutoff_for(target: date) -> date:
    return target - timedelta(days=LEAD_DAYS)


def known(history: History, target: date) -> list[tuple[date, float]]:
    """Values that were complete when the forecast for `target` was made."""
    cutoff = cutoff_for(target)
    return sorted((d, v) for d, v in history.items() if d <= cutoff)


def _upto(history: History, cutoff: date) -> list[tuple[date, float]]:
    return sorted((d, v) for d, v in history.items() if d <= cutoff)


# 1. rules of thumb ------------------------------------------------------
def fit_last_full_day(history: History, _f: Features, cutoff: date, _z: str) -> Predictor:
    k = _upto(history, cutoff)
    value = k[-1][1] if k else None
    return lambda _t: value


def fit_mean_7(history: History, _f: Features, cutoff: date, _z: str) -> Predictor:
    k = _upto(history, cutoff)[-7:]
    value = float(np.mean([v for _, v in k])) if len(k) == 7 else None
    return lambda _t: value


def fit_same_weekday(history: History, _f: Features, cutoff: date, _z: str) -> Predictor:
    k = _upto(history, cutoff)

    def predict(target: date) -> float | None:
        vals = [v for d, v in k if d.weekday() == target.weekday()][-4:]
        return float(np.mean(vals)) if len(vals) >= 2 else None

    return predict


RULES: dict[str, Fitter] = {
    "letzter_voller_tag": fit_last_full_day,
    "mittel_7_tage": fit_mean_7,
    "mittel_wochentag": fit_same_weekday,
}


# features ---------------------------------------------------------------
def calendar(d: date) -> list[float]:
    doy = d.timetuple().tm_yday
    return [
        math.sin(2 * math.pi * doy / 365.25),
        math.cos(2 * math.pi * doy / 365.25),
        1.0 if d.weekday() >= 5 else 0.0,
    ]


def feature_names(features: Features) -> list[str]:
    names: set[str] = set()
    for f in features.values():
        names.update(f)
    return sorted(names)


def _design(history: History, features: Features, cutoff: date):
    """Rows up to cutoff; forecast features (e.g. weather) only once >= 21 days have them."""
    k = _upto(history, cutoff)
    names = feature_names(features)
    if names and sum(1 for d, _ in k if all(n in features.get(d, {}) for n in names)) < MIN_ROWS:
        names = []
    rows, ys = [], []
    for d, v in k:
        f = features.get(d, {})
        if all(n in f for n in names):
            rows.append(calendar(d) + [f[n] for n in names])
            ys.append(v)
    return names, np.array(rows), np.array(ys)


def _row(target: date, names: list[str], features: Features) -> list[float] | None:
    f = features.get(target, {})
    if not all(n in f for n in names):
        return None
    return calendar(target) + [f[n] for n in names]


def _fit_model(make_reg, make_clf, history, features, cutoff, ziel) -> Predictor:
    names, x, y = _design(history, features, cutoff)
    if len(y) < MIN_ROWS:
        return lambda _t: None
    if ziel == "janein":
        if len(set(y.tolist())) < 2:
            p = float(y.mean())
            return lambda _t: p
        model = make_clf()
        model.fit(x, y.astype(int))
    else:
        model = make_reg()
        model.fit(x, y)

    def predict(target: date) -> float | None:
        row = _row(target, names, features)
        if row is None:
            # the target has no forecast features: no prediction rather than a guess
            return None
        if ziel == "janein":
            return float(model.predict_proba(np.array([row]))[0][1])
        return float(model.predict(np.array([row]))[0])

    return predict


# 2. ridge / logistic regression -----------------------------------------
def fit_ridge(history: History, features: Features, cutoff: date, ziel: str) -> Predictor:
    return _fit_model(
        lambda: make_pipeline(StandardScaler(), Ridge(alpha=1.0)),
        lambda: make_pipeline(StandardScaler(), LogisticRegression(C=1.0)),
        history,
        features,
        cutoff,
        ziel,
    )


# 3. gradient boosting (regularised) -------------------------------------
def fit_boosting(history: History, features: Features, cutoff: date, ziel: str) -> Predictor:
    return _fit_model(
        lambda: HistGradientBoostingRegressor(
            max_iter=150, learning_rate=0.05, min_samples_leaf=MIN_LEAF, random_state=0
        ),
        lambda: HistGradientBoostingClassifier(
            max_iter=150, learning_rate=0.05, min_samples_leaf=MIN_LEAF, random_state=0
        ),
        history,
        features,
        cutoff,
        ziel,
    )


LEARNERS: dict[str, Fitter] = {"ridge": fit_ridge, "boosting": fit_boosting}
LADDER: dict[str, Fitter] = {**RULES, **LEARNERS}
# Rungs above the rules, in order: each must beat the current winner by >= 2 SE.
RUNGS = ["ridge", "boosting"]


def predict_one(method: str, history: History, features: Features, target: date, ziel: str):
    """Live prediction for one target, from data known at decision time only."""
    return LADDER[method](history, features, cutoff_for(target), ziel)(target)
