"""Run with `uv run python -m vibedash_forecast` (localhost only by default)."""

import os

import uvicorn

from .app import create_app

uvicorn.run(
    create_app(),
    host=os.environ.get("FORECAST_HOST", "127.0.0.1"),
    port=int(os.environ.get("FORECAST_PORT", "8090")),
    log_level="info",
)
