"""Method ladder (ANLEITUNG.md section 11), daily targets.

Every method predicts day D only from days <= D - LEAD_DAYS: the forecast is
made the evening before D, when D - 1 is not complete yet. Live and backtest
use the same lead.
"""

import math
from collections.abc import Callable
from datetime import date, timedelta

import numpy as np
from sklearn.linear_model import Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

LEAD_DAYS = 2
History = dict[date, float]
Features = dict[date, dict[str, float]]
Method = Callable[[History, Features, date], float | None]


def known(history: History, target: date) -> list[tuple[date, float]]:
    """Values that were complete when the forecast for `target` was made."""
    cutoff = target - timedelta(days=LEAD_DAYS)
    return sorted((d, v) for d, v in history.items() if d <= cutoff)


# 1. rules of thumb ------------------------------------------------------
def last_full_day(history: History, _f: Features, target: date) -> float | None:
    k = known(history, target)
    return k[-1][1] if k else None


def mean_7(history: History, _f: Features, target: date) -> float | None:
    k = known(history, target)[-7:]
    return float(np.mean([v for _, v in k])) if len(k) == 7 else None


def same_weekday(history: History, _f: Features, target: date) -> float | None:
    vals = [v for d, v in known(history, target) if d.weekday() == target.weekday()][-4:]
    return float(np.mean(vals)) if len(vals) >= 2 else None


RULES: dict[str, Method] = {
    "letzter_voller_tag": last_full_day,
    "mittel_7_tage": mean_7,
    "mittel_wochentag": same_weekday,
}


# 2. ridge regression ----------------------------------------------------
def calendar(d: date) -> list[float]:
    doy = d.timetuple().tm_yday
    return [
        math.sin(2 * math.pi * doy / 365.25),
        math.cos(2 * math.pi * doy / 365.25),
        1.0 if d.weekday() >= 5 else 0.0,
    ]


def feature_names(features: Features) -> list[str]:
    names = set()
    for f in features.values():
        names.update(f)
    return sorted(names)


def ridge(history: History, features: Features, target: date) -> float | None:
    """Ridge on calendar + features known in advance (e.g. weather forecast)."""
    names = feature_names(features)
    if names and not all(n in features.get(target, {}) for n in names):
        names = []  # target has no forecast features: calendar only
    rows, ys = [], []
    for d, v in known(history, target):
        f = features.get(d, {})
        if all(n in f for n in names):
            rows.append(calendar(d) + [f[n] for n in names])
            ys.append(v)
    if len(rows) < 21:
        return None
    model = make_pipeline(StandardScaler(), Ridge(alpha=1.0))
    model.fit(np.array(rows), np.array(ys))
    x = calendar(target) + [features[target][n] for n in names]
    return float(model.predict(np.array([x]))[0])


LADDER: dict[str, Method] = {**RULES, "ridge": ridge}
