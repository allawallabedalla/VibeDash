"""HTTP API of the forecasting service. It runs behind the VibeDash Node server
and listens on localhost only; the browser never talks to it directly."""

import os
from datetime import UTC, date, datetime, timedelta
from typing import Annotated, Literal

from fastapi import FastAPI, HTTPException, Path, Query
from pydantic import BaseModel, Field

from . import engine, pv
from .methods import LEAD_DAYS
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


class GtiIn(BaseModel):
    zeit: datetime
    flaeche: str = Field(pattern=r"^[a-z][a-z0-9_]{0,31}$")
    wert: float = Field(allow_inf_nan=False, ge=0)
    stand: datetime


class PvDatenIn(BaseModel):
    stunden: list[StundeIn] = Field(default_factory=list, max_length=20000)
    gti: list[GtiIn] = Field(default_factory=list, max_length=80000)


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
