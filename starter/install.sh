#!/usr/bin/env bash
# VibeDash Starter-Paket – Installer (ERSTEINRICHTUNG.md, Weg B: „eine Zeile einfügen“).
#
#   curl -fsSL https://raw.githubusercontent.com/allawallabedalla/VibeDash/main/starter/install.sh | sudo bash
#
# Was er tut (und nur das):
#   1. prüft: Ubuntu, 64 Bit, genug Platz – sonst Abbruch ohne Änderung
#   2. installiert Docker aus den Ubuntu-Paketen und automatische Sicherheitsupdates
#   3. holt VibeDash nach /opt/vibedash (oder nimmt VIBEDASH_DIR)
#   4. legt Zugangsdaten an (starter/.env, nur root lesbar) – beim zweiten Lauf bleiben sie
#   5. startet Datenbank (ohne Port nach außen), evcc (nur lesend, ohne Geräte) und VibeDash
#   6. sagt, welche Adresse im Browser zu öffnen ist
# Was er NIE tut: Geräte steuern, Portfreigaben im Router, Daten löschen, fremde Programme außer Docker.
# Mehrfach ausführen ist sicher (idempotent).
set -euo pipefail

REPO_URL="${VIBEDASH_REPO_URL:-https://github.com/allawallabedalla/VibeDash.git}"
DIR="${VIBEDASH_DIR:-/opt/vibedash}"
PORT="${VIBEDASH_PORT:-8095}"
SETUP_DEMO="${VIBEDASH_SETUP_DEMO:-off}"         # nur CI-Test: Demo-Geräte im Assistenten anbieten

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
stop() { printf '\n\033[1;31mAbbruch:\033[0m %s\nEs wurde nichts verändert.\n' "$*" >&2; exit 1; }
fail() { printf '\n\033[1;31mHakt:\033[0m %s\nNochmal starten ist sicher.\n' "$*" >&2; exit 1; }

# ── 1. Prüfen (noch keine Änderung) ────────────────────────────────────────────────────────────────────
[ "$(id -u)" -eq 0 ] || stop "Bitte mit sudo starten (siehe ERSTEINRICHTUNG.md)."
. /etc/os-release 2>/dev/null || true
[ "${ID:-}" = ubuntu ] || stop "Dieser Installer ist für Ubuntu Server LTS (gefunden: ${PRETTY_NAME:-unbekannt})."
case "$(uname -m)" in x86_64|aarch64) ;; *) stop "Nur 64-Bit-Rechner werden unterstützt." ;; esac
frei_gb=$(df -BG --output=avail / | tail -1 | tr -dc 0-9)
[ "${frei_gb:-0}" -ge 10 ] || stop "Zu wenig freier Speicher (${frei_gb} GB, nötig: 10 GB)."

say "Schritt 1 von 5: Prüfung ok (${PRETTY_NAME}, ${frei_gb} GB frei)."

# ── 2. Docker und automatische Sicherheitsupdates ──────────────────────────────────────────────────────
say "Schritt 2 von 5: Programme installieren (Docker, Sicherheitsupdates) …"
export DEBIAN_FRONTEND=noninteractive
if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  apt-get update -q
  apt-get install -y -q docker.io docker-compose-v2 git openssl unattended-upgrades
else
  apt-get install -y -q git openssl unattended-upgrades >/dev/null 2>&1 || true
fi
systemctl enable --now docker >/dev/null 2>&1 || true
dpkg-reconfigure -f noninteractive unattended-upgrades >/dev/null 2>&1 || true

# ── 3. VibeDash holen ──────────────────────────────────────────────────────────────────────────────────
say "Schritt 3 von 5: VibeDash holen nach ${DIR} …"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" pull --ff-only -q || say "Hinweis: Aktualisieren ging nicht – die vorhandene Fassung bleibt."
elif [ -f "$DIR/starter/compose.yaml" ]; then
  : # schon vorhanden (z. B. Testlauf aus einem Checkout)
else
  git clone -q --depth 1 "$REPO_URL" "$DIR"
fi
cd "$DIR/starter"

# ── 4. Zugangsdaten (einmal erzeugt, danach behalten) ─────────────────────────────────────────────────
say "Schritt 4 von 5: Zugangsdaten anlegen …"
umask 077
if [ ! -f .env ]; then
  pw() { openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | head -c 24; }
  ip=$(hostname -I 2>/dev/null | awk '{print $1}')
  name=$(hostname)
  {
    echo "# VibeDash Starter-Paket – Zugangsdaten (nur root). Nicht weitergeben."
    echo "INFLUX_ADMIN_PASSWORD=$(pw)"
    echo "INFLUX_EVCC_PASSWORD=$(pw)"
    echo "INFLUX_VIBEDASH_PASSWORD=$(pw)"
    echo "EVCC_ADMIN_PASSWORD=$(pw)"
    echo "SETUP_CODE=$(shuf -i 100000-999999 -n 1)"
    echo "VIBEDASH_PORT=${PORT}"
    echo "ALLOWED_HOSTS=${name},${name}.local,${name}.fritz.box${ip:+,${ip}}"
    echo "TZ=$(timedatectl show -p Timezone --value 2>/dev/null || echo Europe/Berlin)"
    # Heimnetz für die Gerätesuche des Assistenten (nur ein privates /24, sonst aus)
    if [ -n "${VIBEDASH_SCAN_CIDR+x}" ]; then echo "SCAN_CIDR=${VIBEDASH_SCAN_CIDR}"; else
      case "$ip" in
        10.*|192.168.*|172.1[6-9].*|172.2[0-9].*|172.3[01].*) echo "SCAN_CIDR=${ip%.*}.0/24" ;;
        *) echo "SCAN_CIDR=" ;;
      esac
    fi
  } > .env
fi
# ältere Installationen: fehlende Einträge ergänzen, vorhandene nie ändern
grep -q '^EVCC_ADMIN_PASSWORD=' .env || echo "EVCC_ADMIN_PASSWORD=$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | head -c 24)" >> .env
grep -q '^SETUP_CODE=' .env || echo "SETUP_CODE=$(shuf -i 100000-999999 -n 1)" >> .env
grep -q '^SCAN_CIDR=' .env || echo "SCAN_CIDR=" >> .env
chmod 600 .env
# evcc-Konfiguration: nur beim ersten Mal (danach gehört sie dem Agenten/Assistenten)
if [ ! -f evcc.yaml ]; then
  evcc_pw=$(grep '^INFLUX_EVCC_PASSWORD=' .env | cut -d= -f2)
  sed "s/EVCC_INFLUX_PASSWORT/${evcc_pw}/" evcc.vorlage.yaml > evcc.yaml
  chmod 600 evcc.yaml
fi
mkdir -p local
[ -f local/mapping.json ] || cp mapping.evcc.json local/mapping.json
chmod 644 local/mapping.json
chown -R 1000:1000 local 2>/dev/null || true

# ── 5. Starten ─────────────────────────────────────────────────────────────────────────────────────────
say "Schritt 5 von 5: Starten (beim ersten Mal einige Minuten) …"
SETUP_DEMO="$SETUP_DEMO" docker compose --env-file .env up -d --build
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
    host=$(hostname)
    if grep -q '"done"' local/setup.json 2>/dev/null; then
      say "Fertig. Dein Dashboard:  http://${host}:${PORT}"
      exit 0
    fi
    setup_code=$(grep '^SETUP_CODE=' .env | cut -d= -f2)
    say "Fertig. Jetzt im Browser öffnen:  http://${host}:${PORT}/#/einrichten"
    printf '\n   Dein Einrichtungs-Code:  \033[1m%s\033[0m   (aufschreiben oder abfotografieren)\n\n' "$setup_code"
    echo "Der Assistent im Browser verbindet Solaranlage, Akku und Netzzähler – nur mit Ja/Nein und einem Blick"
    echo "in deine Hersteller-App. Mit einem Agenten (Claude Code) geht es auch ohne Assistent (ERSTEINRICHTUNG.md)."
    exit 0
  fi
  sleep 5
done
fail "VibeDash antwortet nicht. Zeig deinem Helfer die Ausgabe von: docker compose -f ${DIR}/starter/compose.yaml ps"
