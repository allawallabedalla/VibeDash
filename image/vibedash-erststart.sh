#!/bin/bash
# Erster Start nach der Installation vom VibeDash-Stick (BL-273): wartet aufs Netz, holt VibeDash
# und führt den normalen Installer aus (starter/install.sh). Schlägt etwas fehl, versucht systemd es
# alle 5 Minuten neu; danach meldet sich der Dienst ab. Der Stand steht auf dem Bildschirm
# (falls einer dran ist) und in /var/log/vibedash-erststart.log.
set -uo pipefail
# shellcheck source=/dev/null
. /etc/vibedash/abbild.env           # VIBEDASH_REPO_URL, VIBEDASH_BRANCH, VIBEDASH_SETUP_CODE
exec >>/var/log/vibedash-erststart.log 2>&1
echo "== $(date -Is) Erststart"

zeige() {
  mkdir -p /etc/issue.d
  printf '\n  VibeDash: %s\n\n' "$*" > /etc/issue.d/vibedash.issue
  agetty --reload 2>/dev/null || true
}

zeige "wird eingerichtet (beim ersten Mal bis zu 30 Minuten) …"

for _ in $(seq 1 60); do
  getent hosts github.com >/dev/null && break
  sleep 5
done

DIR=/opt/vibedash
if [ ! -d "$DIR/.git" ]; then
  git clone -q --depth 1 -b "${VIBEDASH_BRANCH:-main}" "${VIBEDASH_REPO_URL}" "$DIR" || {
    zeige "kein Internet? Neuer Versuch in 5 Minuten."
    exit 1
  }
fi

if VIBEDASH_DIR="$DIR" VIBEDASH_SETUP_CODE="${VIBEDASH_SETUP_CODE:-}" bash "$DIR/starter/install.sh"; then
  ip=$(hostname -I | awk '{print $1}')
  zeige "läuft. Im Browser: http://$(hostname).local:8095/#/einrichten  (oder http://${ip}:8095)"
  mkdir -p /var/lib/vibedash
  date -Is > /var/lib/vibedash/erststart.fertig
  systemctl disable vibedash-erststart.service
  exit 0
fi
zeige "hakt noch – neuer Versuch in 5 Minuten (Protokoll: /var/log/vibedash-erststart.log)."
exit 1
