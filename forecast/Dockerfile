# syntax=docker/dockerfile:1
# VibeDash forecasting service. Runs behind the VibeDash server; do not
# publish its port – only the Node server talks to it.
ARG PY_IMAGE=python:3.13-slim

FROM ${PY_IMAGE}
RUN pip install --no-cache-dir uv==0.11.32
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
COPY pyproject.toml uv.lock .python-version ./
RUN uv sync --locked --no-dev
COPY vibedash_forecast ./vibedash_forecast
RUN useradd --system --uid 10001 app && mkdir /data && chown app /data
USER app
ENV FORECAST_DB=/data/forecast.sqlite FORECAST_HOST=0.0.0.0 FORECAST_PORT=8090
EXPOSE 8090
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8090/gesund', timeout=3)"
CMD ["/app/.venv/bin/python", "-m", "vibedash_forecast"]
