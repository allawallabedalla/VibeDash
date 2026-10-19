# syntax=docker/dockerfile:1
# VibeDash modules (maintenance plan, …). Python standard library only – nothing to install.
# Runs behind the VibeDash server; do not publish its port – only the Node server talks to it.
ARG PY_IMAGE=python:3.13-slim

FROM ${PY_IMAGE}
WORKDIR /app
COPY vibedash_modules ./vibedash_modules
COPY templates ./templates
# uid 1000 like the VibeDash container, so both may share local/ (starter/install.sh)
RUN useradd --system --uid 1000 app && mkdir -p /data && chown app /data
USER app
ENV MODULES_DIR=/data MODULES_HOST=0.0.0.0 MODULES_PORT=8091 PYTHONDONTWRITEBYTECODE=1
EXPOSE 8091
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8091/gesund', timeout=3)"
CMD ["python", "-m", "vibedash_modules"]
