"""Charge planning, stage A: plan and show – never switch (LADESTEUERUNG.md §3–6, M12).

Goal: the car gets as much solar power as possible without causing grid import –
also not indirectly, by leaving the home battery empty before the next sun.

- Load model (house without car): day level c0 + c1*HDD + c2*weekend by
  ordinary least squares (mean-faithful, no robust fit), plus the mean residual
  of the last 14 days; hourly shape a_h + b_h*HDD scaled to the day level.
  Scenarios: residuals of ~30 days with similar HDD, drawn without replacement.
- 300 pairings of PV x load scenarios, random but fixed per calendar day.
- Battery simulated per scenario and hour (limits, discharge floor, reserve).
- Greedy plan: a charging hour is only added if, in the cautious quantile
  alpha ~ 1/31 of the 300 scenarios, it causes no extra grid import now,
  tonight or tomorrow. Upper bound: car capacity minus charged today.
- Resolution: 1 hour (LADESTEUERUNG suggests 15 min; hours keep a run within
  seconds on a mini PC – stated in the model card).
"""

from dataclasses import dataclass
from datetime import date

import numpy as np

HDD_BASE = 18.0
ANALOG = 30
PAIRINGS = 300
ALPHA = 1 / 31
TOLERANCE_KWH = 0.01
VOLT = 230.0


@dataclass
class Battery:
    capacity_kwh: float
    max_charge_kw: float
    max_discharge_kw: float
    min_soc_pct: float = 5.0
    reserve_kwh: float = 2.0


@dataclass
class Car:
    capacity_kwh: float
    phases: int = 3
    min_a: int = 6
    max_a: int = 16
    charged_today_kwh: float = 0.0

    def levels_kw(self) -> list[float]:
        """Charging power options (kW), highest first."""
        amps = sorted({self.max_a, (self.min_a + self.max_a) // 2, self.min_a}, reverse=True)
        return [a * VOLT * self.phases / 1000 for a in amps]


# --- load model ----------------------------------------------------------
def hdd(mean_temp: float) -> float:
    return max(0.0, HDD_BASE - mean_temp)


@dataclass
class LoadModel:
    coef: np.ndarray  # c0, c1, c2
    level_fix: float
    shape_a: np.ndarray  # 24
    shape_b: np.ndarray  # 24
    residuals: list[tuple[float, np.ndarray]]  # (hdd, hourly residual profile kWh) per past day
    hdd_range: tuple[float, float]


def fit_load(days: list[tuple[date, float, np.ndarray]]) -> LoadModel | None:
    """days: (date, mean temperature, 24 hourly kWh of the house without car)."""
    if len(days) < 21:
        return None
    x = np.array([[1.0, hdd(t), 1.0 if d.weekday() >= 5 else 0.0] for d, t, _ in days])
    y = np.array([h.sum() for _, _, h in days])
    coef, *_ = np.linalg.lstsq(x, y, rcond=None)  # ordinary least squares: mean-faithful
    resid = y - x @ coef
    level_fix = float(resid[-14:].mean())
    shares = np.array([h / h.sum() if h.sum() > 0 else np.full(24, 1 / 24) for _, _, h in days])
    hd = np.array([hdd(t) for _, t, _ in days])
    a = np.zeros(24)
    b = np.zeros(24)
    for i in range(24):
        if hd.std() > 1e-6:
            b[i], a[i] = np.polyfit(hd, shares[:, i], 1)
        else:
            a[i] = shares[:, i].mean()
    profiles = []
    for (_d, t, h), pred_day in zip(days, x @ coef + level_fix, strict=True):
        profiles.append((hdd(t), h - shape(a, b, hdd(t)) * pred_day))
    return LoadModel(coef, level_fix, a, b, profiles, (float(hd.min()), float(hd.max())))


def shape(a: np.ndarray, b: np.ndarray, h: float) -> np.ndarray:
    s = np.maximum(a + b * h, 1e-4)
    return s / s.sum()


def load_scenarios(
    m: LoadModel, day: date, mean_temp: float, rng: np.random.Generator
) -> np.ndarray:
    """30 hourly load scenarios (30 x 24) for a day: forecast + residuals of similar days."""
    h = hdd(mean_temp)
    level = float(np.array([1.0, h, 1.0 if day.weekday() >= 5 else 0.0]) @ m.coef + m.level_fix)
    base = shape(m.shape_a, m.shape_b, h) * max(level, 0.0)
    similar = sorted(m.residuals, key=lambda r: abs(r[0] - h))[:ANALOG]
    picks = rng.choice(len(similar), size=min(ANALOG, len(similar)), replace=False)
    return np.array([np.maximum(base + similar[i][1], 0.0) for i in picks])


def load_untested(m: LoadModel, mean_temp: float) -> bool:
    """HDD outside the learned range, e.g. the first winter."""
    h = hdd(mean_temp)
    return h < m.hdd_range[0] - 2 or h > m.hdd_range[1] + 2


# --- scenarios and battery -----------------------------------------------
def day_rng(day: date, seed: int = 0) -> np.random.Generator:
    """Randomness fixed per calendar day: same inputs -> same plan."""
    return np.random.default_rng([day.toordinal(), seed])


def pair(pv: np.ndarray, load: np.ndarray, rng: np.random.Generator, n: int = PAIRINGS):
    """Fixed, reproducible pairings of PV (k x T) and load (m x T) scenarios."""
    i = rng.integers(0, pv.shape[0], size=n)
    j = rng.integers(0, load.shape[0], size=n)
    return pv[i], load[j]


def simulate(pv, load, car_kw, battery: Battery, soc0_kwh: float) -> np.ndarray:
    """Grid import per scenario (kWh) over the horizon. pv/load: (S x T) kWh per hour,
    car_kw: (T) planned car power."""
    floor = battery.capacity_kwh * battery.min_soc_pct / 100
    soc = np.full(pv.shape[0], soc0_kwh, dtype=float)
    imported = np.zeros(pv.shape[0])
    for t in range(pv.shape[1]):
        net = pv[:, t] - load[:, t] - car_kw[t]
        charge = np.clip(net, 0, None)
        charge = np.minimum(np.minimum(charge, battery.max_charge_kw), battery.capacity_kwh - soc)
        deficit = np.clip(-net, 0, None)
        discharge = np.minimum(
            np.minimum(deficit, battery.max_discharge_kw), np.clip(soc - floor, 0, None)
        )
        soc = soc + charge - discharge
        imported += deficit - discharge
    return imported


@dataclass
class Plan:
    car_kw: np.ndarray  # per hour of the horizon
    kwh: float
    reason: str  # none | sun | sunBattery | full (same codes as the browser)


def step_soc(soc: float, pv: float, load: float, car: float, b: Battery) -> float:
    """Battery state after one hour (kWh); the grid covers what the battery cannot."""
    floor = b.capacity_kwh * b.min_soc_pct / 100
    net = pv - load - car
    if net >= 0:
        return soc + min(net, b.max_charge_kw, b.capacity_kwh - soc)
    return soc - min(-net, b.max_discharge_kw, max(soc - floor, 0.0))


def planning_battery(b: Battery) -> Battery:
    """The reserve stays in the battery for planning: the car may never use it."""
    return Battery(
        b.capacity_kwh,
        b.max_charge_kw,
        b.max_discharge_kw,
        b.min_soc_pct + b.reserve_kwh / b.capacity_kwh * 100,
        0.0,
    )


def greedy_plan(
    pv: np.ndarray,
    load: np.ndarray,
    battery: Battery,
    soc0_kwh: float,
    car: Car,
    until: int | None = None,
) -> Plan:
    """Add charging hours (highest expected surplus first), each at the highest power that
    keeps the cautious quantile (1 - alpha) of extra grid import at zero - now, tonight and
    tomorrow. Extra import only grows with more car power, so an hour that fails at the
    lowest level is skipped. `until`: charging allowed only before this hour index."""
    t_len = pv.shape[1]
    car_kw = np.zeros(t_len)
    pb = planning_battery(battery)
    base = simulate(pv, load, car_kw, pb, soc0_kwh)
    surplus = np.median(pv, axis=0) - np.median(load, axis=0)
    order = sorted(range(t_len), key=lambda t: (-surplus[t], t))
    if until is not None:
        order = [t for t in order if t < until]
    budget = max(0.0, car.capacity_kwh - car.charged_today_kwh)
    levels = car.levels_kw()

    def ok(t: int, kw: float) -> bool:
        trial = car_kw.copy()
        trial[t] = kw
        extra = simulate(pv, load, trial, pb, soc0_kwh) - base
        return float(np.quantile(extra, 1 - ALPHA)) <= TOLERANCE_KWH

    for t in order:
        if budget <= 1e-9:
            break
        lowest = min(levels[-1], budget)
        if not ok(t, lowest):
            continue
        kw = next(x for x in (min(level, budget) for level in levels) if x <= lowest or ok(t, x))
        budget -= kw
        car_kw[t] = kw
    kwh = float(car_kw.sum())
    if kwh == 0:
        reason = "none"
    elif budget <= 1e-9:
        reason = "full"
    else:
        med = np.median(pv, axis=0)
        reason = (
            "sunBattery" if any(car_kw[t] > 0 and med[t] < 0.1 for t in range(t_len)) else "sun"
        )
    return Plan(car_kw, kwh, reason)


def plan_with_range(
    pv_lists: np.ndarray,
    load_lists: np.ndarray,
    battery: Battery,
    soc0_kwh: float,
    car: Car,
    day: date,
    singles: int = 10,
) -> tuple[Plan, tuple[float, float], tuple[np.ndarray, np.ndarray]]:
    """Main plan from 300 pairings; spread from small single plans (30 pairings each).
    Returns the plan, the 10-90 % range of planned kWh, and the pairing indices."""
    rng = day_rng(day)
    i = rng.integers(0, pv_lists.shape[0], size=PAIRINGS)
    j = rng.integers(0, load_lists.shape[0], size=PAIRINGS)
    main = greedy_plan(pv_lists[i], load_lists[j], battery, soc0_kwh, car)
    totals = []
    for s in range(1, singles + 1):
        ps, ls = pair(pv_lists, load_lists, day_rng(day, s), n=30)
        totals.append(greedy_plan(ps, ls, battery, soc0_kwh, car).kwh)
    return main, (float(np.quantile(totals, 0.1)), float(np.quantile(totals, 0.9))), (i, j)


def what_if(pv, load, battery: Battery, soc0_kwh: float, car_kw: np.ndarray, day: date) -> dict:
    """'What if I charge like this?' -> extra grid import over the horizon, with range."""
    p, ld = pair(pv, load, day_rng(day))
    extra = simulate(p, ld, car_kw, battery, soc0_kwh) - simulate(
        p, ld, np.zeros_like(car_kw), battery, soc0_kwh
    )
    return {
        "netz_kwh": [round(float(np.quantile(extra, q)), 2) for q in (0.1, 0.5, 0.9)],
        "anteil_szenarien_mit_netz": round(float(np.mean(extra > TOLERANCE_KWH)) * 100, 1),
        "n": len(extra),
    }
