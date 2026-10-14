"""HTTP API of the forecasting service. It runs behind the VibeDash Node server
and listens on localhost only; the browser never talks to it directly."""

import os
from datetime import UTC, date, datetime, timedelta
from typing import Annotated, Literal

from fastapi import FastAPI, HTTPException, Path, Query
from pydantic import BaseModel, Field

from . import engine
from .methods import LEAD_DAYS
from .store import Reihe, Store

ID = r"^[a-z][a-z0-9_]{0,63}$"
SeriesId = Annotated[str, Path(pattern=ID)]


class ReiheIn(BaseModel):
    id: str = Field(pattern=ID)
    einheit: str = Field(min_length=1, max_length=20)
    takt: Literal["tag"] = "tag"
    ziel: Literal["wert"] = "wert"
    nichtnegativ: bool = True


class WertIn(BaseModel):
    tag: date
    wert: float = Field(allow_inf_nan=False)


class MerkmalIn(BaseModel):
    tag: date
    name: str = Field(pattern=r"^[a-z][a-z0-9_]{0,31}$")
    wert: float = Field(allow_inf_nan=False)
    stand: datetime


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

    def compute(rid: str):
        history = dict(db.werte(rid))
        features = db.merkmale(rid)
        bt = engine.backtest(history, features)
        return history, features, bt, engine.choose(bt)

    def scheduled_run(r: Reihe) -> list[engine.Forecast]:
        """Forecast today and tomorrow; the first stored run per day counts."""
        history, features, bt, choice = compute(r.id)
        if not history or engine.status(history, bt)["zustand"] == "sammelt":
            return []
        last = max(history)
        out = []
        for target in (last + timedelta(days=1), last + timedelta(days=LEAD_DAYS)):
            f = engine.forecast(history, features, target, bt, choice, r.nichtnegativ)
            if f is None:
                continue
            made = now()
            vorlauf = (datetime.combine(target, datetime.min.time(), UTC) - made).total_seconds()
            if vorlauf <= 0:
                continue  # the day has started: too late to count as a forecast
            db.put_prognose(r.id, target, made, vorlauf / 3600, (f.p10, f.p50, f.p90), f.verfahren)
            out.append(f)
        return out

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
        reihe_or_404(rid)
        history, features, bt, choice = compute(rid)
        live = [
            (p["p50"], history[date.fromisoformat(p["tag"])])
            for p in db.prognosen(rid)
            if date.fromisoformat(p["tag"]) in history
        ]
        return {
            "reihe": rid,
            **engine.guete(bt, choice, live),
            "modellkarte": engine.model_card(history, features, bt, choice),
        }

    @app.get("/reihen/{rid}/status")
    def get_status(rid: SeriesId) -> dict:
        reihe_or_404(rid)
        history, _f, bt, _c = compute(rid)
        return {"reihe": rid, **engine.status(history, bt)}

    return app
