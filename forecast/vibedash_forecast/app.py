"""HTTP API of the forecasting service. It runs behind the VibeDash Node server
and listens on localhost only; the browser never talks to it directly."""

import os
from datetime import UTC, date, datetime, timedelta
from typing import Annotated, Literal
from zoneinfo import ZoneInfo

from fastapi import FastAPI, HTTPException, Path, Query
from pydantic import BaseModel, Field

from . import engine, plan_live, pv
from .methods import LEAD_DAYS
from .plan_store import PlanStore
from .pv_store import PvStore
from .store import Reihe, Store

ID = r"^[a-z][a-z0-9_]{0,63}$"
SeriesId = Annotated[str, Path(pattern=ID)]


class ReiheIn(BaseModel):
    id: str = Field(pattern=ID)
    einheit: str = Field(min_length=1, max_length=20)
    takt: Literal["tag"] = "tag"
    ziel: Literal["wert", "janein"] = "wert"
    nichtnegativ: bool = True


class WertIn(BaseModel):
    tag: date
    wert: float = Field(allow_inf_nan=False)


class MerkmalIn(BaseModel):
    tag: date
    name: str = Field(pattern=r"^[a-z][a-z0-9_]{0,31}$")
    wert: float = Field(allow_inf_nan=False)
    stand: datetime


class FlaecheIn(BaseModel):
    name: str = Field(pattern=r"^[a-z][a-z0-9_]{0,31}$")
    neigung: float = Field(ge=0, le=90)
    azimut: float = Field(ge=-180, le=180)  # 0 = south, -90 = east, 90 = west
    kwp: float = Field(gt=0, le=1000)


class AnlageIn(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    tz: str = Field(min_length=1, max_length=64)
    flaechen: list[FlaecheIn] = Field(min_length=1, max_length=8)
    max_kw: float | None = Field(default=None, gt=0)


class StundeIn(BaseModel):
    zeit: datetime
    wert: float = Field(allow_inf_nan=False, ge=0)


class TempIn(BaseModel):
    zeit: datetime
    wert: float = Field(allow_inf_nan=False, ge=-60, le=60)


class GtiIn(BaseModel):
    zeit: datetime
    flaeche: str = Field(pattern=r"^[a-z][a-z0-9_]{0,31}$")
    wert: float = Field(allow_inf_nan=False, ge=0)
    stand: datetime


class PvDatenIn(BaseModel):
    stunden: list[StundeIn] = Field(default_factory=list, max_length=20000)
    gti: list[GtiIn] = Field(default_factory=list, max_length=80000)


class AkkuIn(BaseModel):
    kapazitaet_kwh: float = Field(gt=0, le=1000)
    max_laden_kw: float = Field(gt=0, le=1000)
    max_entladen_kw: float = Field(gt=0, le=1000)
    min_soc_pct: float = Field(default=5.0, ge=0, le=100)
    reserve_kwh: float = Field(default=2.0, ge=0, le=1000)


class AutoIn(BaseModel):
    kapazitaet_kwh: float = Field(gt=0, le=300)
    phasen: Literal[1, 3] = 3
    min_a: int = Field(default=6, ge=6, le=32)
    max_a: int = Field(default=16, ge=6, le=32)


class PlanIn(BaseModel):
    pv: str = Field(pattern=ID)
    akku: AkkuIn
    auto: AutoIn


class PlanDatenIn(BaseModel):
    last: list[StundeIn] = Field(default_factory=list, max_length=20000)
    soc: list[StundeIn] = Field(default_factory=list, max_length=20000)
    temp: list[TempIn] = Field(default_factory=list, max_length=20000)


class WerteIn(BaseModel):
    werte: list[WertIn] = Field(max_length=5000)
    merkmale: list[MerkmalIn] = Field(default_factory=list, max_length=20000)


def create_app(store: Store | None = None, now=lambda: datetime.now(UTC)) -> FastAPI:
    db = store or Store(os.environ.get("FORECAST_DB", "forecast.sqlite"))
    app = FastAPI(title="VibeDash forecast", docs_url=None, redoc_url=None)

    def reihe_or_404(rid: str) -> Reihe:
        r = db.get_reihe(rid)
        if not r:
            raise HTTPException(404, "unbekannte Reihe")
        return r

    cache: dict[str, tuple[tuple, tuple]] = {}

    def compute(rid: str):
        """Backtest + choice, cached until the stored data changes."""
        r = reihe_or_404(rid)
        history = dict(db.werte(rid))
        features = db.merkmale(rid)
        key = (
            r.ziel,
            len(history),
            max(history, default=None),
            sum(history.values()),
            sum(len(f) for f in features.values()),
        )
        hit = cache.get(rid)
        if hit and hit[0] == key:
            return hit[1]
        bt = engine.backtest(history, features, r.ziel)
        result = (history, features, bt, engine.choose(bt))
        cache[rid] = (key, result)
        return result

    def scheduled_run(r: Reihe) -> list[engine.Forecast]:
        """Forecast today and tomorrow; the first stored run per day counts."""
        history, features, bt, choice = compute(r.id)
        if not history or engine.status(history, bt, r.nichtnegativ, r.ziel)["zustand"] in (
            "sammelt",
            "pruefung",
        ):
            return []
        last = max(history)
        out = []
        for target in (last + timedelta(days=1), last + timedelta(days=LEAD_DAYS)):
            f = engine.forecast(history, features, target, bt, choice, r.nichtnegativ, r.ziel)
            if f is None:
                continue
            made = now()
            vorlauf = (datetime.combine(target, datetime.min.time(), UTC) - made).total_seconds()
            if vorlauf <= 0:
                continue  # the day has started: too late to count as a forecast
            db.put_prognose(r.id, target, made, vorlauf / 3600, (f.p10, f.p50, f.p90), f.verfahren)
            out.append(f)
        return out

    pv_db = PvStore(db.db)

    def plant_or_404(pid: str) -> pv.Plant:
        c = pv_db.plant(pid)
        if not c:
            raise HTTPException(404, "unbekannte Anlage")
        return pv.Plant(
            c["lat"],
            c["lon"],
            c["tz"],
            [pv.Plane(f["name"], f["neigung"], f["azimut"], f["kwp"]) for f in c["flaechen"]],
            c.get("max_kw"),
        )

    def pv_days(pid: str, plant: pv.Plant) -> list[pv.DayData]:
        actual = pv_db.hours(pid)
        gti = pv_db.gti(pid)
        times = sorted({t for t, _ in gti})
        return pv.to_days(plant, times, actual, gti, now())

    @app.put("/pv/{pid}/anlage")
    def put_plant(pid: SeriesId, body: AnlageIn) -> dict:
        pv_db.put_plant(pid, body.model_dump())
        return {"id": pid}

    @app.put("/pv/{pid}/daten")
    def put_pv_data(pid: SeriesId, body: PvDatenIn) -> dict:
        plant = plant_or_404(pid)
        names = {p.name for p in plant.planes}
        pv_db.put_hours(pid, [(s.zeit.astimezone(UTC), s.wert) for s in body.stunden])
        accepted = pv_db.put_gti(
            pid,
            plant.tz,
            [
                (g.zeit.astimezone(UTC), g.flaeche, g.wert, g.stand.astimezone(UTC))
                for g in body.gti
                if g.flaeche in names
            ],
        )
        return {"stunden": len(body.stunden), "gti_angenommen": accepted}

    @app.get("/pv/{pid}/prognose")
    def get_pv_forecast(pid: SeriesId) -> dict:
        plant = plant_or_404(pid)
        days = pv_days(pid, plant)
        made = now()
        out = []
        for d in days:
            if d.actual is not None:
                continue  # already over
            f = pv.forecast_day(d, days, plant)
            if f is None:
                continue
            start = d.hours[0]
            lead_h = (start - made).total_seconds() / 3600
            if lead_h > 0:
                pv_db.put_forecast(pid, d.day, made, lead_h, f.total)
            out.append(
                {
                    "tag": d.day.isoformat(),
                    "stunden": [h.isoformat() for h in f.hours],
                    "p10": [round(float(x), 3) for x in f.p10],
                    "p50": [round(float(x), 3) for x in f.p50],
                    "p90": [round(float(x), 3) for x in f.p90],
                    "summe": [round(x, 2) for x in f.total],
                    "n_analog": f.n_analog,
                    "n_fit": f.n_fit,
                    "hinweis": "ungeprüft: noch keine Daten aus dieser Jahreszeit"
                    if engine.season_untested(
                        {x.day: 0.0 for x in days if x.actual is not None}, d.day
                    )
                    else None,
                }
            )
        return {"anlage": pid, "einheit": "kWh je Stunde", "prognosen": out}

    @app.get("/pv/{pid}/guete")
    def get_pv_accuracy(pid: SeriesId) -> dict:
        plant = plant_or_404(pid)
        days = pv_days(pid, plant)
        acc = pv.accuracy(pv.backtest(days, plant))
        train = [d for d in days if d.actual is not None]
        k = pv.fit_factors(train, plant)
        return {
            "anlage": pid,
            **acc,
            "modellkarte": {
                "verfahren": "physik_gti_nnls_analogtage",
                "flaechen": [p.name for p in plant.planes],
                "faktoren": None if k is None else [round(float(x), 3) for x in k],
                "fit_tage": pv.FIT_DAYS,
                "analogtage": pv.ANALOG_DAYS,
                "vorlauf_tage": LEAD_DAYS,
                "tage_mit_daten": len(train),
                "grenzen": [
                    "Güte begrenzt das Eingangswetter, nicht das Verfahren.",
                    "Faktoren je Fläche aus 45 Tagen; Verschattung und Schnee nicht modelliert.",
                ],
            },
        }

    @app.get("/pv/{pid}/status")
    def get_pv_status(pid: SeriesId) -> dict:
        plant = plant_or_404(pid)
        days = [d for d in pv_days(pid, plant) if d.actual is not None]
        needed = pv.MIN_DAYS + LEAD_DAYS
        if len(days) < needed:
            return {"anlage": pid, "zustand": "sammelt", "tage": len(days), "benoetigt": needed}
        return {"anlage": pid, "zustand": "bereit", "tage": len(days)}

    plan_db = PlanStore(db.db)
    PLAN_BATCH = 10  # backtest days computed per request (bounded time)

    def plan_context(pid: str, charged: float = 0.0) -> plan_live.Context:
        c = plan_db.config(pid)
        if not c:
            raise HTTPException(404, "unbekannter Plan")
        plant = plant_or_404(c["pv"])
        return plan_live.Context(
            plant=plant,
            pv_days={d.day: d for d in pv_days(c["pv"], plant)},
            last=plan_db.hours(pid, "last"),
            soc=plan_db.hours(pid, "soc"),
            temp=plan_db.hours(pid, "temp"),
            battery=plan_live.battery_of(c),
            car=plan_live.car_of(c, charged),
        )

    @app.put("/plan/{pid}/anlage")
    def put_plan(pid: SeriesId, body: PlanIn) -> dict:
        if body.auto.min_a > body.auto.max_a:
            raise HTTPException(422, "min_a > max_a")
        if plan_db.config(pid) != body.model_dump():
            plan_db.put_config(pid, body.model_dump())
        return {"id": pid}

    @app.put("/plan/{pid}/daten")
    def put_plan_data(pid: SeriesId, body: PlanDatenIn) -> dict:
        if not plan_db.config(pid):
            raise HTTPException(404, "unbekannter Plan")
        for kind, rows in (("last", body.last), ("soc", body.soc), ("temp", body.temp)):
            plan_db.put_hours(pid, kind, [(r.zeit.astimezone(UTC), r.wert) for r in rows])
        return {"last": len(body.last), "soc": len(body.soc), "temp": len(body.temp)}

    @app.get("/plan/{pid}")
    def get_plan(
        pid: SeriesId,
        soc_kwh: Annotated[float, Query(ge=0, le=1000)],
        geladen_kwh: Annotated[float, Query(ge=0, le=300)] = 0.0,
    ) -> dict:
        ctx = plan_context(pid, geladen_kwh)
        days = len(plan_live.load_days(ctx, now().astimezone(ZoneInfo(ctx.plant.tz)).date()))
        if days < plan_live.MIN_LOAD_DAYS:
            return {
                "plan": pid,
                "zustand": "sammelt",
                "tage": days,
                "benoetigt": plan_live.MIN_LOAD_DAYS,
            }
        soc = min(soc_kwh, ctx.battery.capacity_kwh)
        return {"plan": pid, **plan_live.live(ctx, now(), soc)}

    @app.get("/plan/{pid}/guete")
    def get_plan_accuracy(pid: SeriesId) -> dict:
        ctx = plan_context(pid)
        today = now().astimezone(ZoneInfo(ctx.plant.tz)).date()
        candidates = sorted(d for d in ctx.pv_days if d + timedelta(days=1) < today)
        checks, pending, budget = [], 0, PLAN_BATCH
        for d in candidates:
            hit = plan_db.check(pid, d, "v1")
            if hit is None and budget > 0:
                budget -= 1
                hit = plan_live.backtest_day(ctx, d) or {"leer": True}
                plan_db.put_check(pid, d, "v1", hit)
            elif hit is None:
                pending += 1
                continue
            if not hit.get("leer"):
                checks.append(hit)
        return {
            "plan": pid,
            **plan_live.summary(checks),
            "rechnet_noch": pending,
            "modellkarte": {
                "verfahren": "szenarien_300_vorsichtiges_quantil",
                "alpha": "1/31",
                "neuplanung": "stündlich ab 8 Uhr",
                "aufloesung": "1 Stunde",
                "grenzen": [
                    "Stundenraster statt 15 min: schneller, etwas gröber.",
                    "Heute bereits Gesehenes fließt nur über den Akkustand ein.",
                ],
            },
        }

    @app.get("/gesund")
    def health() -> dict:
        return {"ok": True}

    @app.post("/reihen", status_code=201)
    def put_reihe(body: ReiheIn) -> dict:
        db.put_reihe(Reihe(body.id, body.einheit, body.takt, body.ziel, body.nichtnegativ))
        return {"id": body.id}

    @app.put("/reihen/{rid}/werte")
    def put_werte(rid: SeriesId, body: WerteIn) -> dict:
        r = reihe_or_404(rid)
        db.put_werte(rid, [(w.tag.isoformat(), w.wert) for w in body.werte])
        accepted = sum(
            db.put_merkmal(rid, m.tag.isoformat(), m.name, m.wert, m.stand) for m in body.merkmale
        )
        scheduled_run(r)
        return {"werte": len(body.werte), "merkmale_angenommen": accepted}

    @app.get("/reihen/{rid}/prognose")
    def get_forecast(rid: SeriesId, bis: Annotated[date | None, Query()] = None) -> dict:
        r = reihe_or_404(rid)
        scheduled_run(r)
        history = dict(db.werte(rid))
        rows = [
            p
            for p in db.prognosen(rid)
            if not history or date.fromisoformat(p["tag"]) > max(history)
        ]
        if bis:
            rows = [p for p in rows if date.fromisoformat(p["tag"]) <= bis]
        for p in rows:
            p["hinweis"] = (
                "ungeprüft: noch keine Daten aus dieser Jahreszeit"
                if engine.season_untested(history, date.fromisoformat(p["tag"]))
                else None
            )
        return {"reihe": rid, "einheit": r.einheit, "prognosen": rows}

    @app.get("/reihen/{rid}/guete")
    def get_accuracy(rid: SeriesId) -> dict:
        r = reihe_or_404(rid)
        history, features, bt, choice = compute(rid)
        doubts = engine.data_doubts(history, r.nichtnegativ, r.ziel)
        if doubts:
            return {"reihe": rid, "zustand": "pruefung", "gruende": doubts}
        live = [
            (p["p50"], history[date.fromisoformat(p["tag"])])
            for p in db.prognosen(rid)
            if date.fromisoformat(p["tag"]) in history
        ]
        return {
            "reihe": rid,
            **engine.guete(bt, choice, live, r.ziel),
            "modellkarte": engine.model_card(history, features, bt, choice, r.ziel),
        }

    @app.get("/reihen/{rid}/status")
    def get_status(rid: SeriesId) -> dict:
        r = reihe_or_404(rid)
        history, _f, bt, _c = compute(rid)
        return {"reihe": rid, **engine.status(history, bt, r.nichtnegativ, r.ziel)}

    return app
