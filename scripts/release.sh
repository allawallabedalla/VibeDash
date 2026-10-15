#!/usr/bin/env bash
# Build the checked-out commit into its own release folder and switch the live
# service to it (symlink swap + restart). The development folder is never
# served directly (Audit01 C-04). Config stays outside the release:
#   $VIBEDASH_CONFIG (default ~/.config/vibedash): .env and local/mapping.json
#   $VIBEDASH_HOME   (default ~/.local/share/vibedash): releases/<commit>, current -> release
#
# Safe switching (Audit02 B-01):
#   - before switching, the new build checks .env and the mapping (`--check`)
#   - each release keeps a copy of the mapping it went live with
#   - after the restart /api/health must answer ok within 30 s, otherwise the
#     previous release (and, if needed, its mapping) comes back automatically
#
# Usage: scripts/release.sh                     build + check + switch
#        scripts/release.sh rollback            back to the previous release
#        scripts/release.sh check <mapping>     would the live release accept this mapping?
set -euo pipefail

HOME_DIR="${VIBEDASH_HOME:-$HOME/.local/share/vibedash}"
CONFIG="${VIBEDASH_CONFIG:-$HOME/.config/vibedash}"
SERVICE="${VIBEDASH_SERVICE:-vibedash}"
KEEP="${VIBEDASH_KEEP:-5}"
NODE="${NODE:-$(command -v node || echo "$HOME/.local/opt/node/bin/node")}"
MAPPING="$CONFIG/local/mapping.json"
mkdir -p "$HOME_DIR/releases"

port() { # PORT from the service's .env, else the server default
  local p
  p="$(sed -n 's/^PORT=//p' "$CONFIG/.env" 2>/dev/null | tail -1 | tr -d '"'"'"' ')"
  echo "${p:-8080}"
}

# check <release dir> [mapping file]: does that build accept .env and the mapping?
check() {
  # releases from before `--check` would just start a server: assume yes
  grep -q 'check ok' "$1/dist-server/main.js" 2>/dev/null || return 0
  (cd "$CONFIG" && MAPPING_PATH="${2:-local/mapping.json}" "$NODE" "$1/dist-server/main.js" --check >/dev/null)
}

healthy() { # /api/health answers ok within 30 s
  local url="http://127.0.0.1:$(port)/api/health"
  for _ in $(seq 1 30); do
    sleep 1
    systemctl --user is-active --quiet "$SERVICE" || continue
    curl -fsS --max-time 3 "$url" 2>/dev/null | grep -q '"ok":true' && return 0
  done
  return 1
}

# put a release's own mapping copy back in place (current one kept aside)
restore_mapping() {
  [ -f "$1/mapping.json" ] || return 1
  cp -p "$MAPPING" "$MAPPING.before-$(date +%Y%m%d%H%M%S)"
  cp "$1/mapping.json" "$MAPPING.tmp" && mv "$MAPPING.tmp" "$MAPPING"
  echo "mapping: restored the copy of $(basename "$1")"
}

point_to() { # atomic: new symlink next to the old one, then rename over it
  ln -sfn "$1" "$HOME_DIR/current.tmp"
  mv -T "$HOME_DIR/current.tmp" "$HOME_DIR/current"
  # a unit stopped by its start limit must be reset before it starts again
  systemctl --user reset-failed "$SERVICE" 2>/dev/null || true
  systemctl --user restart "$SERVICE" 2>/dev/null || true
}

# switch <target> <fallback>: go live, and back to the fallback if unhealthy
switch() {
  local target="$1" fallback="${2:-}"
  point_to "$target"
  if healthy; then
    echo "live: $(basename "$target")"
    return 0
  fi
  echo "not healthy: $(basename "$target")" >&2
  if [ -n "$fallback" ]; then
    check "$fallback" || restore_mapping "$fallback" || true
    point_to "$fallback"
    healthy && echo "back on: $(basename "$fallback")" >&2 || echo "fallback not healthy either" >&2
  fi
  exit 1
}

now="$(readlink -f "$HOME_DIR/current" 2>/dev/null || true)"

case "${1:-}" in
  check)
    [ -n "${2:-}" ] || { echo "usage: release.sh check <mapping.json>" >&2; exit 2; }
    check "$now" "$(readlink -f "$2")" && echo "ok: $(basename "$now") accepts $2"
    exit $?
    ;;
  rollback)
    prev="$(ls -1dt "$HOME_DIR"/releases/*/ | sed 's#/$##' | grep -vx "$now" | head -1)"
    [ -n "$prev" ] || { echo "no earlier release" >&2; exit 1; }
    # an older build may reject newer mapping keys: then use its own copy
    if ! check "$prev"; then
      restore_mapping "$prev" || { echo "$(basename "$prev") rejects the mapping and has no copy" >&2; exit 1; }
    fi
    switch "$prev" "$now"
    exit 0
    ;;
esac

cd "$(dirname "$0")/.."
[ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "uncommitted changes – commit first" >&2; exit 1; }
id="$(git rev-parse --short HEAD)-$(date +%Y%m%d%H%M%S)"
tmp="$(mktemp -d "$HOME_DIR/releases/.build-XXXXXX")"
trap 'rm -rf "$tmp"' EXIT
pnpm build >/dev/null
# vite writes dist/ and dist-server/ in the checkout; the release gets its own copy
cp -a dist "$tmp/dist"
cp -a dist-server "$tmp/dist-server"
git rev-parse HEAD > "$tmp/COMMIT"
check "$tmp" || { echo "the new build rejects .env or the mapping – not switched" >&2; exit 1; }
[ -f "$MAPPING" ] && install -m 600 "$MAPPING" "$tmp/mapping.json"
chmod -R a-w "$tmp"
mv "$tmp" "$HOME_DIR/releases/$id"
trap - EXIT
switch "$HOME_DIR/releases/$id" "$now"
# keep the newest $KEEP releases
ls -1dt "$HOME_DIR"/releases/*/ | tail -n +$((KEEP + 1)) | while read -r old; do
  chmod -R u+w "$old" && rm -rf "$old"
done
