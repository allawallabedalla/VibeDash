#!/usr/bin/env bash
# Everything CI checks that runs on this machine – run it before every push (CLAUDE.md), so a pull request
# does not fail on formatting or a forgotten test. Usage: scripts/check.sh   (from anywhere in the repo)
set -euo pipefail
cd "$(dirname "$0")/.."
echo "== pnpm lint / check / test / build / budget"
# one command per line: with `set -e`, a failure early in an `a && b` chain does NOT stop the script
pnpm lint
pnpm check
pnpm test
pnpm build >/dev/null
pnpm budget
echo "== visual tests (pages, states: overflow, contrast, ≈ with n, touch targets)"
pnpm test:visual 2>&1 | tail -3   # pipefail (set -o pipefail above) keeps its exit code
echo "== forecast + modules + tools/grundriss (Python)"
if command -v uvx >/dev/null 2>&1; then
  (cd modules && uvx ruff@0.16.9 format --check . && uvx ruff@0.16.9 check .)
  (cd forecast && uv run ruff format --check . && uv run ruff check . && uv run pytest -q)
  (cd tools/grundriss && uv run ruff format --check . && uv run ruff check . && uv run pytest -q)
elif command -v ruff >/dev/null 2>&1; then
  (cd modules && ruff format --check . && ruff check .)
else
  echo "(ruff not installed here – CI checks the Python style)"
fi
(cd modules && python3 -W error::ResourceWarning -m unittest discover -s tests -t . 2>&1 | tail -3)
echo "all checks passed"
