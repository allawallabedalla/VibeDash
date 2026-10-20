#!/usr/bin/env bash
# VibeDash-Stick bauen (BL-273, Weg 1): Debian-Netzinstallation + Antworten + Erststart-Dienst.
# Läuft am Laptop (Linux oder macOS; braucht xorriso, cpio, gzip, curl – macOS: brew install xorriso).
# Das Ergebnis ist persönlich: Es enthält Passwort und Einrichtungs-Code (stehen im Zugangszettel).
#
#   image/build.sh [--key ~/.ssh/id_ed25519.pub] [--iso debian.iso] [--branch main] [--out vibedash.iso]
#
# Ohne --iso lädt es die aktuelle Debian-Netzinstallation und prüft Prüfsumme (und, wenn gpg da ist,
# die Debian-Signatur). Den Stick schreibt danach balenaEtcher oder der Helfer.
set -euo pipefail
cd "$(dirname "$0")"
HIER=$(pwd)

ISO="" KEY="" BRANCH="main" OUT="vibedash.iso" DEBUG=0
REPO_URL="${VIBEDASH_REPO_URL:-https://github.com/allawallabedalla/VibeDash.git}"
while [ $# -gt 0 ]; do
  case "$1" in
    --iso) ISO=$2; shift 2 ;;
    --key) KEY=$2; shift 2 ;;
    --branch) BRANCH=$2; shift 2 ;;
    --out) OUT=$2; shift 2 ;;
    --debug) DEBUG=1; shift ;;          # serielle Konsole (nur für Tests in einer VM)
    *) echo "unbekannt: $1" >&2; exit 2 ;;
  esac
done
for p in xorriso cpio gzip curl; do
  command -v "$p" >/dev/null || { echo "Es fehlt: $p" >&2; exit 1; }
done
[ -z "$KEY" ] || [ -s "$KEY" ] || { echo "Schlüssel nicht gefunden: $KEY" >&2; exit 1; }

ARBEIT=$(mktemp -d)
trap 'rm -rf "$ARBEIT"' EXIT

# ── 1. Debian holen und prüfen ─────────────────────────────────────────────────────────────────────────
if [ -z "$ISO" ]; then
  BASIS=https://cdimage.debian.org/debian-cd/current/amd64/iso-cd
  curl -fsS "$BASIS/SHA512SUMS" -o "$ARBEIT/SHA512SUMS"
  NAME=$(awk '/debian-[0-9.]+-amd64-netinst.iso$/ {print $2}' "$ARBEIT/SHA512SUMS" | head -n 1)
  [ -n "$NAME" ] || { echo "Debian-Abbild nicht gefunden" >&2; exit 1; }
  ISO="$HIER/$NAME"
  [ -f "$ISO" ] || curl -fL --progress-bar "$BASIS/$NAME" -o "$ISO"
  SOLL=$(awk -v n="$NAME" '$2 == n {print $1}' "$ARBEIT/SHA512SUMS")
  IST=$( (sha512sum "$ISO" 2>/dev/null || shasum -a 512 "$ISO") | awk '{print $1}')
  [ "$SOLL" = "$IST" ] || { echo "Prüfsumme falsch – Datei gelöscht, bitte neu starten." >&2; rm -f "$ISO"; exit 1; }
  if command -v gpg >/dev/null; then
    curl -fsS "$BASIS/SHA512SUMS.sign" -o "$ARBEIT/SHA512SUMS.sign"
    gpg --keyserver hkps://keyring.debian.org --recv-keys DF9B9C49EAA9298432589D76DA87E80D6294BE9B >/dev/null 2>&1 || true
    gpg --verify "$ARBEIT/SHA512SUMS.sign" "$ARBEIT/SHA512SUMS" >/dev/null 2>&1 \
      || { echo "Debian-Signatur ungültig – Abbruch." >&2; exit 1; }
  fi
fi

# ── 2. Persönliche Zugangsdaten ────────────────────────────────────────────────────────────────────────
zufall() { LC_ALL=C tr -dc "$1" < /dev/urandom | head -c "$2"; }
PASSWORT=$(zufall 'A-HJ-NP-Za-km-z2-9' 16)
CODE=$(zufall '0-9' 6)

# ── 3. Antworten und Erststart in die Startdatei des Installers ────────────────────────────────────────
mkdir -p "$ARBEIT/initrd/vibedash"
sed "s/@@PASSWORT@@/${PASSWORT}/g" preseed.cfg > "$ARBEIT/initrd/preseed.cfg"
cp vibedash-platte.sh vibedash-danach.sh vibedash-erststart.sh vibedash-erststart.service "$ARBEIT/initrd/vibedash/"
{
  echo "VIBEDASH_REPO_URL=${REPO_URL}"
  echo "VIBEDASH_BRANCH=${BRANCH}"
  echo "VIBEDASH_SETUP_CODE=${CODE}"
} > "$ARBEIT/initrd/vibedash/abbild.env"
if [ -n "$KEY" ]; then cp "$KEY" "$ARBEIT/initrd/vibedash/authorized_keys"; else : > "$ARBEIT/initrd/vibedash/authorized_keys"; fi

xorriso -osirrox on -indev "$ISO" -extract /install.amd/initrd.gz "$ARBEIT/initrd.gz" >/dev/null 2>&1
chmod u+w "$ARBEIT/initrd.gz"
# ein zweites cpio-Archiv anhängen: der Kernel liest beide, der Installer findet /preseed.cfg von selbst
(cd "$ARBEIT/initrd" && find . | cpio -o -H newc 2>/dev/null | gzip -9) >> "$ARBEIT/initrd.gz"

# ── 4. Startmenü: VibeDash installieren nach 10 Sekunden ───────────────────────────────────────────────
KONSOLE=""
[ "$DEBUG" = 1 ] && KONSOLE="console=ttyS0,115200n8"
cat > "$ARBEIT/grub.cfg" <<EOF
set timeout=10
set default=0
menuentry 'VibeDash installieren  (LOESCHT die eingebaute Festplatte)' {
    linux    /install.amd/vmlinuz vga=788 priority=critical ${KONSOLE} --- quiet
    initrd   /install.amd/initrd.gz
}
menuentry 'VibeDash neu installieren  (auch wenn schon installiert)' {
    linux    /install.amd/vmlinuz vga=788 priority=critical vibedash/neu=1 ${KONSOLE} --- quiet
    initrd   /install.amd/initrd.gz
}
menuentry 'Nichts tun - ausschalten' {
    halt
}
EOF
cat > "$ARBEIT/isolinux.cfg" <<EOF
default vibedash
prompt 1
timeout 100
say VibeDash wird in 10 Sekunden installiert und LOESCHT die eingebaute Festplatte.
say Abbrechen: Rechner ausschalten.
label vibedash
	kernel /install.amd/vmlinuz
	append vga=788 initrd=/install.amd/initrd.gz priority=critical ${KONSOLE} --- quiet
label neu
	kernel /install.amd/vmlinuz
	append vga=788 initrd=/install.amd/initrd.gz priority=critical vibedash/neu=1 ${KONSOLE} --- quiet
EOF

# ── 5. Neues Abbild (Startfähigkeit BIOS + UEFI wie im Original) ──────────────────────────────────────
rm -f "$OUT"
xorriso -indev "$ISO" -outdev "$OUT" \
  -map "$ARBEIT/initrd.gz" /install.amd/initrd.gz \
  -map "$ARBEIT/grub.cfg" /boot/grub/grub.cfg \
  -map "$ARBEIT/isolinux.cfg" /isolinux/isolinux.cfg \
  -boot_image any replay >/dev/null 2>&1

ZETTEL="${OUT%.iso}-zugang.txt"
umask 077
cat > "$ZETTEL" <<EOF
VibeDash-Stick – Zugang (aufheben, nicht weitergeben)
  Adresse nach der Einrichtung:  http://vibedash.local:8095/#/einrichten
  Einrichtungs-Code:             ${CODE}
  Benutzer am Gerät:             vibedash
  Passwort:                      ${PASSWORT}
  SSH-Schlüssel hinterlegt:      $([ -n "$KEY" ] && echo ja || echo nein)
EOF
echo "Fertig: $OUT"
echo "Zugangszettel: $ZETTEL"
