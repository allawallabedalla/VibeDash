"""Rolling backtest, method choice, forecast with range, status, accuracy, model card.

- Backtest: every day with enough history is predicted from days <= D - 2 only
  (same lead as live). Learning methods are refit weekly on data before that
  week; rules every day.
- Choice (ladder): the best rule of thumb wins; a rung above (Ridge, then
  Boosting) only takes over if it beats the current winner by >= 2 standard
  errors on the same days (paired). Simplest sufficient method wins.
- Range: empirical residuals of the chosen method (p10/p90), with n.
  Yes/no targets get a probability, never a hard yes/no.
- Accuracy: 100 % minus the mean size of the error (never signed);
  direction (too high / too low) shown separately.
"""

from dataclasses import dataclass, field
from datetime import date, timedelta

import numpy as np

from .methods import (
    LADDER,
    LEAD_DAYS,
    LEARNERS,
    RULES,
    RUNGS,
    Features,
    History,
    Predictor,
    cutoff_for,
    known,
    predict_one,
)

MIN_HISTORY = 28  # complete days needed before forecasting
MIN_ASSESS = 14  # checked days before an accuracy number is shown
SE_FACTOR = 2.0
GLITCH_FACTOR = 20.0


@dataclass
class Backtest:
    days: list[date] = field(default_factory=list)
    actual: list[float] = field(default_factory=list)
    preds: dict[str, list[float]] = field(default_factory=dict)

    @property
    def n(self) -> int:
        return len(self.days)


def backtest(history: History, features: Features, ziel: str = "wert") -> Backtest:
    """Predict every past day that had enough history, with all methods (paired)."""
    bt = Backtest(preds={m: [] for m in LADDER})
    days = sorted(history)
    if not days:
        return bt
    first = days[0]
    fitted: dict[tuple[str, date], Predictor] = {}
    for target in days:
        if len(known(history, target)) < MIN_HISTORY:
            continue
        cutoff = cutoff_for(target)
        preds = {}
        for m, fit in LADDER.items():
            if m in LEARNERS:
                week = cutoff - timedelta(days=(cutoff - first).days % 7)
                key = (m, week)
                if key not in fitted:
                    fitted[key] = fit(history, features, week, ziel)
                preds[m] = fitted[key](target)
            else:
                preds[m] = fit(history, features, cutoff, ziel)(target)
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
    steps: list[dict] = field(default_factory=list)


def _paired(bt: Backtest, current: str, challenger: str) -> tuple[float, float]:
    d = abs_errors(bt, current) - abs_errors(bt, challenger)
    se = float(d.std(ddof=1) / np.sqrt(len(d))) if len(d) > 1 else float("inf")
    return float(d.mean()), se


def choose(bt: Backtest) -> Choice:
    if bt.n == 0:
        return Choice("letzter_voller_tag", "letzter_voller_tag", {}, 0.0, 0.0, float("inf"))
    mae = {m: float(abs_errors(bt, m).mean()) for m in LADDER}
    best_rule = min(RULES, key=lambda m: mae[m])
    winner, diff_w, se_w = best_rule, 0.0, float("inf")
    steps = []
    for rung in RUNGS:
        diff, se = _paired(bt, winner, rung)
        taken = bt.n > 1 and diff > SE_FACTOR * se
        steps.append(
            {
                "gegen": winner,
                "verfahren": rung,
                "vorteil": round(diff, 3),
                "standardfehler": None if not np.isfinite(se) else round(se, 3),
                "genommen": taken,
            }
        )
        if taken:
            winner, diff_w, se_w = rung, diff, se
    pct = (mae[best_rule] - mae[winner]) / mae[best_rule] * 100 if mae[best_rule] > 0 else 0.0
    return Choice(winner, best_rule, mae, max(0.0, pct), diff_w, se_w, steps)


def correct_pct(pred: np.ndarray, actual: np.ndarray, ziel: str = "wert") -> float | None:
    """wert: 100 % - mean |error| in % of the actual; janein: 100 % - mean |p - y| x 100."""
    if len(actual) == 0:
        return None
    if ziel == "janein":
        return max(0.0, 100.0 - float(np.mean(np.abs(pred - actual))) * 100)
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
    ziel: str = "wert",
) -> Forecast | None:
    p = predict_one(choice.method, history, features, target, ziel)
    if p is None or bt.n < 2:
        return None
    if ziel == "janein":
        p = min(1.0, max(0.0, p))
        return Forecast(target, p, p, p, choice.method, bt.n)
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


def data_doubts(history: History, nonnegative: bool, ziel: str) -> list[str]:
    """Reasons to say "data base being checked" instead of showing a number."""
    vals = np.array(list(history.values()))
    if len(vals) == 0:
        return []
    out = []
    if ziel == "janein" and not np.all(np.isin(vals, [0.0, 1.0])):
        out.append("ja/nein-Reihe enthält andere Werte als 0 und 1")
    if nonnegative and np.any(vals < 0):
        out.append("negative Werte in einer Reihe, die nicht negativ sein kann")
    pos = vals[vals > 0]
    if ziel == "wert" and len(pos) >= 7 and np.any(vals > GLITCH_FACTOR * np.median(pos)):
        out.append(f"einzelne Werte über dem {GLITCH_FACTOR:.0f}-fachen des Medians")
    return out


def status(history: History, bt: Backtest, nonnegative: bool = True, ziel: str = "wert") -> dict:
    days = sorted(history)
    needed = MIN_HISTORY + LEAD_DAYS
    doubts = data_doubts(history, nonnegative, ziel)
    if doubts:
        return {"zustand": "pruefung", "gruende": doubts}
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


def guete(
    bt: Backtest, choice: Choice, live: list[tuple[float, float]], ziel: str = "wert"
) -> dict:
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
    pct = correct_pct(pred, act, ziel)
    history = []
    for i in range(7, n + 1):
        v = correct_pct(pred[i - 7 : i], act[i - 7 : i], ziel)
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
        "definition": (
            "100 % minus mittlerer Betrag (Wahrscheinlichkeit − Ist)"
            if ziel == "janein"
            else "100 % minus mittlerer Betrag des Fehlers in % des Ist-Werts"
        ),
    }


def model_card(
    history: History, features: Features, bt: Backtest, choice: Choice, ziel: str = "wert"
) -> dict:
    days = sorted(history)
    names = sorted({n for f in features.values() for n in f})
    limits = [
        "Auswahl und Rückrechnung nutzen dieselben Tage (leicht optimistisch).",
        "Spanne aus Restfehlern bei 2 Tagen Vorlauf; längere Vorläufe sind ungeprüft.",
    ]
    if len(days) < 365:
        limits.append("Weniger als ein Jahr Daten: andere Jahreszeiten sind ungeprüft.")
    if choice.method == "boosting":
        limits.append("Bäume rechnen nicht über den gelernten Bereich hinaus (neue Jahreszeit).")
    return {
        "verfahren": choice.method,
        "ziel": ziel,
        "beste_faustregel": choice.best_rule,
        "mae_je_verfahren": {k: round(v, 3) for k, v in choice.mae.items()},
        "leiter": choice.steps,
        "gepaarter_vorteil": round(choice.paired_diff, 3),
        "standardfehler": None if not np.isfinite(choice.paired_se) else round(choice.paired_se, 3),
        "merkmale": ["kalender", *names] if choice.method in LEARNERS else [],
        "zeitraum": [days[0].isoformat(), days[-1].isoformat()] if days else None,
        "n_rueckrechnung": bt.n,
        "vorlauf_tage": LEAD_DAYS,
        "grenzen": limits,
    }
