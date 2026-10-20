#!/bin/sh
# Läuft im Debian-Installer vor dem Partitionieren (busybox sh). Wählt die eingebaute Platte:
# nie das Startmedium, nie USB, nie Wechseldatenträger. Steht dort schon VibeDash, hält es an –
# außer beim Menüpunkt „Neu installieren“ (vibedash/neu=1).
log() { echo "vibedash-platte: $*" >> /var/log/syslog; }
# Halt statt Fehlermeldung: dort könnte „Weiter“ doch noch partitionieren. Aus = für jeden sichtbar,
# auch ohne Bildschirm; die Anleitung sagt: „Ist das Gerät aus: Stick abziehen, wieder einschalten.“
aus() {
  log "$1"
  echo "$1" > /dev/console
  sleep 20
  poweroff -f 2>/dev/null || echo o > /proc/sysrq-trigger
  sleep 60
  exit 1
}

# Startmedium, z. B. /dev/sdb1 oder /dev/sr0 – jede Platte, deren Name der Anfang davon ist, ist der Stick
quelle=$(awk '$2 == "/cdrom" { print $1 }' /proc/mounts | head -n 1)
log "Startmedium: ${quelle:-unbekannt}"

ziel=""
for d in $(list-devices disk); do
  b=${d#/dev/}
  case "$quelle" in "$d"*) log "$d ist das Startmedium – übersprungen"; continue ;; esac
  case "$(readlink -f "/sys/block/$b")" in */usb*) log "$d ist USB – übersprungen"; continue ;; esac
  [ "$(cat "/sys/block/$b/removable" 2>/dev/null)" = 1 ] && { log "$d ist wechselbar – übersprungen"; continue; }
  ziel=$d
  break
done

if [ -z "$ziel" ]; then
  aus "Keine eingebaute Festplatte gefunden – es wird nichts gelöscht. Das Gerät schaltet sich aus."
fi

if ! grep -q 'vibedash/neu=1' /proc/cmdline; then
  mkdir -p /tmp/vd
  # der Treiber ist zu diesem Zeitpunkt oft noch nicht geladen (VM-Test 20.10.: Schutz griff nicht)
  modprobe ext4 2>/dev/null || true
  for p in "$ziel"*; do
    [ "$p" = "$ziel" ] && continue
    if mount -t ext4 -o ro "$p" /tmp/vd 2>>/var/log/syslog; then
      log "$p gelesen"
      if [ -f /tmp/vd/etc/vibedash-abbild ]; then
        umount /tmp/vd
        aus "VibeDash ist schon installiert ($ziel) – nichts gelöscht. Das Gerät schaltet sich aus: Stick abziehen, wieder einschalten."
      fi
      umount /tmp/vd
    fi
  done
fi

log "Zielplatte: $ziel"
debconf-set partman-auto/disk "$ziel"
debconf-set grub-installer/bootdev "$ziel"
