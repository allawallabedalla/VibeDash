#!/usr/bin/env bash
# Build the checked-out commit into its own release folder and switch the live
# service to it in one step (symlink swap + restart). The development folder is
# never served directly (Audit01 C-04). Config stays outside the release:
#   $VIBEDASH_CONFIG (default ~/.config/vibedash): .env and local/mapping.json
#   $VIBEDASH_HOME   (default ~/.local/share/vibedash): releases/<commit>, current -> release
# Usage: scripts/release.sh            build + switch + restart
#        scripts/release.sh rollback   switch back to the previous release
set -euo pipefail

HOME_DIR="${VIBEDASH_HOME:-$HOME/.local/share/vibedash}"
SERVICE="${VIBEDASH_SERVICE:-vibedash}"
KEEP="${VIBEDASH_KEEP:-5}"
mkdir -p "$HOME_DIR/releases"

switch() { # atomic: new symlink next to the old one, then rename over it
  ln -sfn "$1" "$HOME_DIR/current.tmp"
  mv -T "$HOME_DIR/current.tmp" "$HOME_DIR/current"
  systemctl --user restart "$SERVICE"
  sleep 2
  systemctl --user is-active --quiet "$SERVICE" || { echo "service not active" >&2; exit 1; }
  echo "live: $(basename "$(readlink -f "$HOME_DIR/current")")"
}

if [ "${1:-}" = rollback ]; then
  now="$(readlink -f "$HOME_DIR/current")"
  prev="$(ls -1dt "$HOME_DIR"/releases/*/ | sed 's#/$##' | grep -vx "$now" | head -1)"
  [ -n "$prev" ] || { echo "no earlier release" >&2; exit 1; }
  switch "$prev"
  exit 0
fi

cd "$(dirname "$0")/.."
[ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "uncommitted changes – commit first" >&2; exit 1; }
id="$(git rev-parse --short HEAD)-$(date +%Y%m%d%H%M%S)"
tmp="$(mktemp -d "$HOME_DIR/releases/.build-XXXXXX")"
pnpm build >/dev/null
# vite writes dist/ and dist-server/ in the checkout; the release gets its own copy
cp -a dist "$tmp/dist"
cp -a dist-server "$tmp/dist-server"
git rev-parse HEAD > "$tmp/COMMIT"
chmod -R a-w "$tmp"
mv "$tmp" "$HOME_DIR/releases/$id"
switch "$HOME_DIR/releases/$id"
# keep the newest $KEEP releases
ls -1dt "$HOME_DIR"/releases/*/ | tail -n +$((KEEP + 1)) | while read -r old; do
  chmod -R u+w "$old" && rm -rf "$old"
done
