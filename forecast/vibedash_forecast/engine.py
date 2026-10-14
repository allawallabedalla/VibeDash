"""Rolling backtest, method choice, forecast with range, status, accuracy, model card.

- Backtest: every day with enough history is predicted from days <= D - 2 only
  (same lead as live).
- Choice: the best rule of thumb wins unless Ridge beats it by >= 2 standard
  errors on the same days (paired). Simplest sufficient method wins.
- Range: empirical residuals of the chosen method (p10/p90), with n.
- Accuracy: 100 % - mean |error| in % (errors as magnitudes, never signed),
  direction (too high / too low) shown separately.
"""

from dataclasses import dataclass, field
from datetime import date, timedelta

import numpy as np

from .methods import LADDER, LEAD_DAYS, RULES, Features, History, known

MIN_HISTORY = 28  # complete days needed before forecasting
MIN_ASSESS = 14  # checked days before an accuracy number is shown
SE_FACTOR = 2.0


@dataclass
class Backtest:
    days: list[date] = field(default_factory=list)
    actual: list[float] = field(default_factory=list)
    preds: dict[str, list[float]] = field(default_factory=dict)

    @property
    def n(self) -> int:
        return len(self.days)


def backtest(history: History, features: Features) -> Backtest:
    """Predict every past day that had enough history, with all methods (paired)."""
    bt = Backtest(preds={m: [] for m in LADDER})
    for target in sorted(history):
        if len(known(history, target)) < MIN_HISTORY:
            continue
        preds = {m: f(history, features, target) for m, f in LADDER.items()}
        if any(p is None for p in preds.values()):
            continue
        bt.days.append(target)
        bt.actual.append(history[target])
        for m, p in preds.items():
            bt.preds[m].append(float(p))  # type: ignore[arg-type]
    return bt


def abs_errors(bt: Backtest, method: str) -> np.ndarray:
    return np.abs(np.array(bt.preds[method]) - np.array(bt.actual))


@dataclass
class Choice:
    method: str
    best_rule: str
    mae: dict[str, float]
    beats_rule_pct: float  # how much better than the best rule (0 if the rule is chosen)
    paired_diff: float
    paired_se: float


def choose(bt: Backtest) -> Choice:
    if bt.n == 0:
        return Choice("letzter_voller_tag", "letzter_voller_tag", {}, 0.0, 0.0, 0.0)
    mae = {m: float(abs_errors(bt, m).mean()) for m in LADDER}
    best_rule = min(RULES, key=lambda m: mae[m])
    d = abs_errors(bt, best_rule) - abs_errors(bt, "ridge")
    se = float(d.std(ddof=1) / np.sqrt(len(d))) if len(d) > 1 else float("inf")
    diff = float(d.mean())
    if len(d) > 1 and diff > SE_FACTOR * se:
        pct = diff / mae[best_rule] * 100 if mae[best_rule] > 0 else 0.0
        return Choice("ridge", best_rule, mae, pct, diff, se)
    return Choice(best_rule, best_rule, mae, 0.0, diff, se)


def correct_pct(pred: np.ndarray, actual: np.ndarray) -> float | None:
    """100 % - mean |error| in % of the actual value (days with actual > 0)."""
    mask = np.abs(actual) > 1e-9
    if not mask.any():
        return None
    mape = float(np.mean(np.abs(pred[mask] - actual[mask]) / np.abs(actual[mask]))) * 100
    return max(0.0, 100.0 - mape)


@dataclass
class Forecast:
    tag: date
    p10: float
    p50: float
    p90: float
    verfahren: str
    n: int


def forecast(
    history: History,
    features: Features,
    target: date,
    bt: Backtest,
    choice: Choice,
    nonnegative: bool,
) -> Forecast | None:
    p = LADDER[choice.method](history, features, target)
    if p is None or bt.n < 2:
        return None
    res = np.array(bt.actual) - np.array(bt.preds[choice.method])
    lo, hi = np.quantile(res, [0.1, 0.9])
    p10, p50, p90 = p + float(lo), p, p + float(hi)
    if nonnegative:
        p10, p50, p90 = max(0.0, p10), max(0.0, p50), max(0.0, p90)
    return Forecast(target, p10, p50, p90, choice.method, bt.n)


def season_untested(history: History, target: date) -> bool:
    """True if no learned day lies within +-20 days of the target's day of year."""
    if len(history) >= 365:
        return False
    doy = target.timetuple().tm_yday
    for d in history:
        delta = abs(d.timetuple().tm_yday - doy)
        if min(delta, 365 - delta) <= 20:
            return False
    return True


def status(history: History, bt: Backtest) -> dict:
    days = sorted(history)
    needed = MIN_HISTORY + LEAD_DAYS
    if len(days) < needed:
        eta = (days[-1] if days else date.today()) + timedelta(days=needed - len(days))
        return {
            "zustand": "sammelt",
            "tage": len(days),
            "benoetigt": needed,
            "ab_ca": eta.isoformat(),
        }
    if bt.n < MIN_ASSESS:
        return {"zustand": "offen", "n": bt.n}
    return {"zustand": "bewertbar", "n": bt.n}


def guete(bt: Backtest, choice: Choice, live: list[tuple[float, float]]) -> dict:
    """Accuracy from live forecasts once there are enough, otherwise from the backtest."""
    if len(live) >= MIN_ASSESS:
        pred = np.array([p for p, _ in live])
        act = np.array([a for _, a in live])
        source = "live"
    else:
        pred = np.array(bt.preds.get(choice.method, []))
        act = np.array(bt.actual)
        source = "rueckrechnung"
    n = len(act)
    if n < MIN_ASSESS:
        return {"zustand": "offen", "n": n, "quelle": source}
    pct = correct_pct(pred, act)
    history = []
    for i in range(7, n + 1):
        v = correct_pct(pred[i - 7 : i], act[i - 7 : i])
        history.append(None if v is None else round(v, 1))
    bias = float(np.mean(pred - act))
    level = (
        "offen" if pct is None else "gut" if pct >= 75 else "maessig" if pct >= 50 else "schlecht"
    )
    return {
        "zustand": "bewertbar",
        "quelle": source,
        "n": n,
        "korrekt_pct": None if pct is None else round(pct, 1),
        "verlauf": history,
        "stufe": level,
        "schlaegt_faustregel_pct": round(choice.beats_rule_pct, 1),
        "richtung": "zu_hoch" if bias > 0 else "zu_niedrig" if bias < 0 else "neutral",
        "mittlere_abweichung": round(bias, 3),
        "definition": "100 % minus mittlerer Betrag des Fehlers in % des Ist-Werts",
    }


def model_card(history: History, features: Features, bt: Backtest, choice: Choice) -> dict:
    days = sorted(history)
    names = sorted({n for f in features.values() for n in f})
    limits = [
        "Auswahl und Rückrechnung nutzen dieselben Tage (leicht optimistisch).",
        "Spanne aus Restfehlern bei 2 Tagen Vorlauf; längere Vorläufe sind ungeprüft.",
    ]
    if len(days) < 365:
        limits.append("Weniger als ein Jahr Daten: andere Jahreszeiten sind ungeprüft.")
    return {
        "verfahren": choice.method,
        "beste_faustregel": choice.best_rule,
        "mae_je_verfahren": {k: round(v, 3) for k, v in choice.mae.items()},
        "gepaarter_vorteil": round(choice.paired_diff, 3),
        "standardfehler": None if not np.isfinite(choice.paired_se) else round(choice.paired_se, 3),
        "merkmale": ["kalender"] + names if choice.method == "ridge" else [],
        "zeitraum": [days[0].isoformat(), days[-1].isoformat()] if days else None,
        "n_rueckrechnung": bt.n,
        "vorlauf_tage": LEAD_DAYS,
        "grenzen": limits,
    }
