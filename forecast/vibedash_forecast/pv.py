"""Hourly PV forecast (LADESTEUERUNG.md section 2, milestone M11).

1. Physics instead of a black box: generation(h) = sum_i k_i * GTI_i(h) over the
   roof planes. k_i >= 0 via non-negative least squares over the last ~45 days,
   refit for every forecast; an optional inverter cap.
2. Uncertainty from analog days: the ~30 past days whose *forecast* clearness
   index is most similar; their relative error (actual / forecast per hour) is
   applied to the new forecast -> 30 scenarios -> p10/p50/p90 per hour.
3. Day totals come from the scenario totals, not from summing hourly quantiles.

Honesty: a day is only forecast from days completed by the evening before
(same lead as the daily service), with GTI forecasts that were known before the
day began. The backtest uses exactly the same rules.
"""

from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

import numpy as np
from scipy.optimize import nnls

from .methods import LEAD_DAYS
from .solar import clear_sky_gti

FIT_DAYS = 45
ANALOG_DAYS = 30
MIN_DAYS = 14


@dataclass(frozen=True)
class Plane:
    name: str
    tilt: float
    azimuth: float  # Open-Meteo convention: 0 = south, -90 = east, 90 = west
    kwp: float


@dataclass
class Plant:
    lat: float
    lon: float
    tz: str
    planes: list[Plane]
    max_kw: float | None = None


@dataclass
class DayData:
    """One local day: 24 (23/25 on DST) hourly rows."""

    day: date
    hours: list[datetime]  # UTC hour starts
    actual: np.ndarray | None  # kWh per hour, None = unknown/incomplete
    gti: np.ndarray  # shape (hours, planes), W/m², forecast known before the day
    ci: float | None = None  # forecast clearness index, computed once


@dataclass
class PvForecast:
    day: date
    hours: list[datetime]
    p10: np.ndarray
    p50: np.ndarray
    p90: np.ndarray
    total: tuple[float, float, float]  # p10/p50/p90 of the day total, from scenarios
    n_fit: int
    n_analog: int
    factors: list[float] = field(default_factory=list)
    scenarios: np.ndarray | None = None  # analog days x hours, kWh per hour


def local_days(hours_utc: list[datetime], tz: str) -> dict[date, list[int]]:
    zone = ZoneInfo(tz)
    out: dict[date, list[int]] = {}
    for i, h in enumerate(hours_utc):
        out.setdefault(h.astimezone(zone).date(), []).append(i)
    return out


def clearness(d: DayData, plant: Plant) -> float:
    if d.ci is not None:
        return d.ci
    clear = sum(
        clear_sky_gti(h + timedelta(minutes=30), plant.lat, plant.lon, p.tilt, p.azimuth)
        for h in d.hours
        for p in plant.planes
    )
    d.ci = float(d.gti.sum() / clear) if clear > 0 else 0.0
    return d.ci


def fit_factors(train: list[DayData], plant: Plant) -> np.ndarray | None:
    rows = [d for d in train if d.actual is not None][-FIT_DAYS:]
    if len(rows) < MIN_DAYS:
        return None
    a = np.vstack([d.gti for d in rows]) / 1000.0  # kW/m² -> k in kWp-equivalent
    b = np.concatenate([d.actual for d in rows])  # type: ignore[arg-type]
    k, _ = nnls(a, b)
    return k


def physical(gti: np.ndarray, k: np.ndarray, plant: Plant) -> np.ndarray:
    p = (gti / 1000.0) @ k
    if plant.max_kw is not None:
        p = np.minimum(p, plant.max_kw)  # one hour at max_kw = max_kw kWh
    return np.maximum(p, 0.0)


def forecast_day(target: DayData, history: list[DayData], plant: Plant) -> PvForecast | None:
    """Forecast `target` from days completed by the evening before (<= target - 2)."""
    cutoff = target.day - timedelta(days=LEAD_DAYS)
    train = [d for d in history if d.day <= cutoff and d.actual is not None]
    k = fit_factors(train, plant)
    if k is None:
        return None
    base = physical(target.gti, k, plant)
    # Analog days: similar forecast clearness, their relative error per hour.
    ci = clearness(target, plant)
    scored = sorted(train, key=lambda d: abs(clearness(d, plant) - ci))[:ANALOG_DAYS]
    scenarios = []
    for d in scored:
        pred = physical(d.gti, k, plant)
        n = min(len(pred), len(base))
        ratio = np.ones(len(base))
        with np.errstate(divide="ignore", invalid="ignore"):
            r = np.where(pred[:n] > 0.05, d.actual[:n] / pred[:n], 1.0)  # type: ignore[index]
        ratio[:n] = np.clip(r, 0.0, 3.0)
        scenarios.append(base * ratio)
    s = np.array(scenarios)
    totals = s.sum(axis=1)
    return PvForecast(
        day=target.day,
        hours=target.hours,
        p10=np.quantile(s, 0.1, axis=0),
        p50=np.quantile(s, 0.5, axis=0),
        p90=np.quantile(s, 0.9, axis=0),
        total=(
            float(np.quantile(totals, 0.1)),
            float(np.quantile(totals, 0.5)),
            float(np.quantile(totals, 0.9)),
        ),
        n_fit=min(len(train), FIT_DAYS),
        n_analog=len(scored),
        factors=[float(x) for x in k],
        scenarios=s,
    )


def backtest(days: list[DayData], plant: Plant) -> list[tuple[date, float, float, float, float]]:
    """(day, actual total, p10, p50, p90) for every past day that could be forecast."""
    out = []
    for target in days:
        if target.actual is None:
            continue
        f = forecast_day(target, days, plant)
        if f is None:
            continue
        out.append((target.day, float(target.actual.sum()), *f.total))
    return out


def accuracy(bt: list[tuple[date, float, float, float, float]]) -> dict:
    """Day totals: 100 % - mean |error| %, band hit rate, rule of thumb for comparison."""
    if len(bt) < MIN_DAYS:
        return {"zustand": "offen", "n": len(bt)}
    act = np.array([b[1] for b in bt])
    p50 = np.array([b[3] for b in bt])
    mask = act > 0.1
    mape = float(np.mean(np.abs(p50[mask] - act[mask]) / act[mask])) * 100
    # Rule of thumb with the same lead: the last complete day (D - 2).
    rule_err = []
    for i in range(LEAD_DAYS, len(bt)):
        if bt[i][1] > 0.1 and (bt[i][0] - bt[i - LEAD_DAYS][0]).days == LEAD_DAYS:
            rule_err.append(abs(bt[i - LEAD_DAYS][1] - bt[i][1]) / bt[i][1])
    rule_mape = float(np.mean(rule_err)) * 100 if rule_err else None
    inside = float(np.mean([(b[2] <= b[1] <= b[4]) for b in bt])) * 100
    pct = max(0.0, 100 - mape)
    history = []
    for i in range(7, len(bt) + 1):
        a, p = act[i - 7 : i], p50[i - 7 : i]
        m = a > 0.1
        history.append(
            round(max(0.0, 100 - float(np.mean(np.abs(p[m] - a[m]) / a[m])) * 100), 1)
            if m.any()
            else None
        )
    return {
        "zustand": "bewertbar",
        "quelle": "rueckrechnung",
        "n": len(bt),
        "korrekt_pct": round(pct, 1),
        "verlauf": history,
        "stufe": "gut" if pct >= 75 else "maessig" if pct >= 50 else "schlecht",
        "im_band_pct": round(inside, 1),
        "schlaegt_faustregel_pct": (
            round(max(0.0, (rule_mape - mape) / rule_mape * 100), 1) if rule_mape else 0.0
        ),
        "richtung": "zu_hoch" if np.mean(p50 - act) > 0 else "zu_niedrig",
        "definition": "Tagessumme: 100 % minus mittlerer Betrag des Fehlers in % des Ist-Werts",
    }


def to_days(
    plant: Plant,
    hours_utc: list[datetime],
    actual_kwh: dict[datetime, float],
    gti: dict[tuple[datetime, str], float],
    now: datetime,
) -> list[DayData]:
    """Group hourly rows into local days; a day without full GTI is skipped, a day not yet
    over (or with missing hours) has no actual."""
    out = []
    zone = ZoneInfo(plant.tz)
    for day, idx in sorted(local_days(hours_utc, plant.tz).items()):
        hours = [hours_utc[i] for i in idx]
        start = datetime.combine(day, datetime.min.time(), zone)
        expected = int(
            (
                datetime.combine(day + timedelta(days=1), datetime.min.time(), zone) - start
            ).total_seconds()
            // 3600
        )
        if len(hours) != expected:
            continue  # weather does not cover the whole local day
        g = np.array([[gti.get((h, p.name), np.nan) for p in plant.planes] for h in hours])
        if np.isnan(g).any():
            continue
        end = datetime.combine(day + timedelta(days=1), datetime.min.time(), zone)
        complete = end <= now and all(h in actual_kwh for h in hours)
        act = np.array([actual_kwh[h] for h in hours]) if complete else None
        out.append(DayData(day, hours, act, g))
    return out


def hour_range(start: datetime, end: datetime) -> list[datetime]:
    h = start.astimezone(UTC).replace(minute=0, second=0, microsecond=0)
    out = []
    while h < end:
        out.append(h)
        h += timedelta(hours=1)
    return out
