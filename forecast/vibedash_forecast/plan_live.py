"""The charge plan from stored data (M12, stage A): scenarios for today's rest and
tomorrow, the live plan, and a backtest that replans hourly like live.

Only data known at the time is used: PV forecasts from days <= D-2 (pv.forecast_day),
the load model from days before D, weather stamped before the day (stored GTI)."""

from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

import numpy as np

from . import plan, pv

MIN_LOAD_DAYS = 21
REPLAN_FROM_HOUR = 8
BAD_KWH = 0.1


@dataclass
class Context:
    plant: pv.Plant
    pv_days: dict[date, pv.DayData]
    last: dict[datetime, float]  # house load without car, kWh per UTC hour
    soc: dict[datetime, float]  # battery %, at the hour start
    temp: dict[datetime, float]  # °C per UTC hour (forecast or archived forecast)
    battery: plan.Battery
    car: plan.Car


def battery_of(c: dict) -> plan.Battery:
    a = c["akku"]
    return plan.Battery(
        a["kapazitaet_kwh"],
        a["max_laden_kw"],
        a["max_entladen_kw"],
        a.get("min_soc_pct", 5.0),
        a.get("reserve_kwh", 2.0),
    )


def car_of(c: dict, charged: float = 0.0) -> plan.Car:
    a = c["auto"]
    return plan.Car(
        a["kapazitaet_kwh"], a.get("phasen", 3), a.get("min_a", 6), a.get("max_a", 16), charged
    )


def day_hours(day: date, tz: str) -> list[datetime]:
    zone = ZoneInfo(tz)
    start = datetime.combine(day, datetime.min.time(), zone).astimezone(UTC)
    end = datetime.combine(day + timedelta(days=1), datetime.min.time(), zone).astimezone(UTC)
    return pv.hour_range(start, end)


def rows(values: dict[datetime, float], hours: list[datetime]) -> np.ndarray | None:
    if not all(h in values for h in hours):
        return None
    return np.array([values[h] for h in hours])


def day_temp(ctx: Context, day: date) -> float | None:
    v = [ctx.temp[h] for h in day_hours(day, ctx.plant.tz) if h in ctx.temp]
    return float(np.mean(v)) if len(v) >= 20 else None


def load_days(ctx: Context, before: date) -> list[tuple[date, float, np.ndarray]]:
    zone = ZoneInfo(ctx.plant.tz)
    days = sorted(
        {h.astimezone(zone).date() for h in ctx.last if h.astimezone(zone).date() < before}
    )
    out = []
    for d in days:
        r = rows(ctx.last, day_hours(d, ctx.plant.tz))
        t = day_temp(ctx, d)
        if r is not None and t is not None:
            # 23/25-hour days (DST) as 24 local hour slots
            out.append((d, t, np.resize(r, 24) if len(r) != 24 else r))
    return out


def fit(values: np.ndarray, n: int) -> np.ndarray:
    """A 24-slot daily profile on a day with n hours (DST)."""
    return values[:, :n] if n <= 24 else np.concatenate([values, values[:, -1:]], axis=1)


@dataclass
class Lists:
    hours: list[datetime]
    pv: np.ndarray
    load: np.ndarray
    n_pv: int
    n_load: int
    untested: bool


def build_lists(ctx: Context, day: date, from_hour: datetime, seed: int = 0) -> Lists | str:
    """30 PV and 30 load lists from `from_hour` to the end of the next day, or the reason."""
    tz = ctx.plant.tz
    d0, d1 = day, day + timedelta(days=1)
    history = list(ctx.pv_days.values())
    fc = []
    for d in (d0, d1):
        dd = ctx.pv_days.get(d)
        f = pv.forecast_day(dd, history, ctx.plant) if dd else None
        if f is None or f.scenarios is None:
            return "pv"
        fc.append(f)
    ld = load_days(ctx, d0)
    model = plan.fit_load(ld) if len(ld) >= MIN_LOAD_DAYS else None
    if model is None:
        return "last"
    temps = [day_temp(ctx, d) for d in (d0, d1)]
    if any(t is None for t in temps):
        return "temperatur"
    rng = plan.day_rng(d0, 1000 + seed)
    h0, h1 = day_hours(d0, tz), day_hours(d1, tz)
    if from_hour not in h0:
        return "zeit"
    i0 = h0.index(from_hour)
    l0 = fit(plan.load_scenarios(model, d0, temps[0], rng), len(h0))
    l1 = fit(plan.load_scenarios(model, d1, temps[1], rng), len(h1))
    k = plan.ANALOG
    a, b = (
        rng.integers(0, fc[0].scenarios.shape[0], k),
        rng.integers(0, fc[1].scenarios.shape[0], k),
    )
    pv_lists = np.concatenate([fc[0].scenarios[a, i0:], fc[1].scenarios[b]], axis=1)
    a, b = rng.integers(0, l0.shape[0], k), rng.integers(0, l1.shape[0], k)
    load_lists = np.concatenate([l0[a, i0:], l1[b]], axis=1)
    untested = any(plan.load_untested(model, t) for t in temps)  # type: ignore[arg-type]
    return Lists(h0[i0:] + h1, pv_lists, load_lists, fc[0].n_analog, len(model.residuals), untested)


def live(ctx: Context, now: datetime, soc_kwh: float) -> dict:
    zone = ZoneInfo(ctx.plant.tz)
    day = now.astimezone(zone).date()
    from_hour = now.astimezone(UTC).replace(minute=0, second=0, microsecond=0)
    lists = build_lists(ctx, day, from_hour)
    if isinstance(lists, str):
        return {"zustand": "fehlt", "was": lists}
    p, rng_, (i, j) = plan.plan_with_range(lists.pv, lists.load, ctx.battery, soc_kwh, ctx.car, day)
    r2 = lambda m: [[round(float(x), 3) for x in row] for row in m]  # noqa: E731
    return {
        "zustand": "bereit",
        "stunden": [h.isoformat() for h in lists.hours],
        "auto_kw": [round(float(x), 3) for x in p.car_kw],
        "kwh": round(p.kwh, 2),
        "spanne": [round(rng_[0], 2), round(rng_[1], 2)],
        "grund": p.reason,
        "pv_listen": r2(lists.pv),
        "last_listen": r2(lists.load),
        "paar_pv": [int(x) for x in i],
        "paar_last": [int(x) for x in j],
        # the page replays the plan in the browser and needs the same battery and car
        "akku": {
            "kapazitaet_kwh": ctx.battery.capacity_kwh,
            "max_laden_kw": ctx.battery.max_charge_kw,
            "max_entladen_kw": ctx.battery.max_discharge_kw,
            "min_soc_pct": ctx.battery.min_soc_pct,
            "reserve_kwh": ctx.battery.reserve_kwh,
        },
        "auto": {
            "kapazitaet_kwh": ctx.car.capacity_kwh,
            "phasen": ctx.car.phases,
            "min_a": ctx.car.min_a,
            "max_a": ctx.car.max_a,
        },
        "soc_kwh": round(soc_kwh, 3),
        "geladen_kwh": round(ctx.car.charged_today_kwh, 3),
        "n_pv": lists.n_pv,
        "n_last": lists.n_load,
        "ungeprueft": lists.untested,
    }


def backtest_day(ctx: Context, day: date) -> dict | None:
    """Plan at 08:00 local from data known then, replan every hour until midnight with the
    battery from the replay, then replay the actual next day without charging."""
    tz = ctx.plant.tz
    d1 = day + timedelta(days=1)
    h0, h1 = day_hours(day, tz), day_hours(d1, tz)
    a0, a1 = ctx.pv_days.get(day), ctx.pv_days.get(d1)
    if not a0 or not a1 or a0.actual is None or a1.actual is None:
        return None
    l0, l1 = rows(ctx.last, h0), rows(ctx.last, h1)
    if l0 is None or l1 is None:
        return None
    zone = ZoneInfo(tz)
    start = next((h for h in h0 if h.astimezone(zone).hour == REPLAN_FROM_HOUR), None)
    if start is None or start not in ctx.soc:
        return None
    soc0 = ctx.soc[start] / 100 * ctx.battery.capacity_kwh
    lists = build_lists(ctx, day, start)
    if isinstance(lists, str):
        return None
    i0 = h0.index(start)
    act_pv = np.concatenate([a0.actual[i0:], a1.actual])[None, :]
    act_load = np.concatenate([l0[i0:], l1])[None, :]
    first, rng_, _ = plan.plan_with_range(lists.pv, lists.load, ctx.battery, soc0, ctx.car, day)
    today = len(h0) - i0
    car_kw = np.zeros(len(lists.hours))
    soc, charged = soc0, 0.0
    for k in range(today):
        if k == 0:
            kw = float(first.car_kw[0])
        else:
            p_, l_ = plan.pair(lists.pv[:, k:], lists.load[:, k:], plan.day_rng(day))
            car = plan.Car(
                ctx.car.capacity_kwh, ctx.car.phases, ctx.car.min_a, ctx.car.max_a, charged
            )
            kw = float(plan.greedy_plan(p_, l_, ctx.battery, soc, car).car_kw[0])
        car_kw[k] = kw
        charged += kw
        soc = plan.step_soc(soc, act_pv[0, k], act_load[0, k], kw, ctx.battery)
    grid = (
        plan.simulate(act_pv, act_load, car_kw, ctx.battery, soc0)[0]
        - plan.simulate(act_pv, act_load, np.zeros_like(car_kw), ctx.battery, soc0)[0]
    )
    possible = plan.greedy_plan(act_pv, act_load, ctx.battery, soc0, ctx.car, until=today).kwh
    return {
        "tag": day.isoformat(),
        "geplant_kwh": round(first.kwh, 2),
        "geladen_kwh": round(charged, 2),
        "moeglich_kwh": round(possible, 2),
        "netz_kwh": round(max(0.0, float(grid)), 3),
        "streuung_kwh": round(rng_[1] - rng_[0], 2),
    }


def summary(checks: list[dict]) -> dict:
    n = len(checks)
    bad = sum(1 for c in checks if c["netz_kwh"] > BAD_KWH)
    verlauf = []
    for i in range(0, n, 7):
        w = checks[i : i + 7]
        verlauf.append(
            None
            if len(w) < 3
            else round(sum(c["netz_kwh"] <= BAD_KWH for c in w) / len(w) * 100, 1)
        )
    return {
        "zustand": "offen" if n < 7 else "bewertbar",
        "n": n,
        "korrekt_pct": None if n < 7 else round((n - bad) / n * 100, 1),
        "netz_kwh": round(sum(c["netz_kwh"] for c in checks), 2),
        "tage_netz": bad,
        "geladen_kwh": round(sum(c["geladen_kwh"] for c in checks), 1),
        "moeglich_kwh": round(sum(c["moeglich_kwh"] for c in checks), 1),
        "streuung_kwh": round(float(np.median([c["streuung_kwh"] for c in checks])), 2)
        if n
        else None,
        "verlauf": verlauf,
    }
