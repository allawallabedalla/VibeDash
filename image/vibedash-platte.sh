#!/bin/sh
# Läuft im Debian-Installer vor dem Partitionieren (busybox sh). Wählt die eingebaute Platte:
# nie das Startmedium, nie USB, nie Wechseldatenträger. Steht dort schon VibeDash, hält es an –
# außer beim Menüpunkt „Neu installieren“ (vibedash/neu=1).
log() { echo "vibedash-platte: $*" >> /var/log/syslog; }

quelle=$(awk '$2 == "/cdrom" { print $1 }' /proc/mounts | head -n 1)
quelle=$(echo "$quelle" | sed 's#p\?[0-9]*$##')
log "Startmedium: ${quelle:-unbekannt}"

ziel=""
for d in $(list-devices disk); do
  b=${d#/dev/}
  [ "$d" = "$quelle" ] && continue
  case "$(readlink -f "/sys/block/$b")" in */usb*) log "$d ist USB – übersprungen"; continue ;; esac
  [ "$(cat "/sys/block/$b/removable" 2>/dev/null)" = 1 ] && { log "$d ist wechselbar – übersprungen"; continue; }
  ziel=$d
  break
done

if [ -z "$ziel" ]; then
  log "keine eingebaute Platte gefunden"
  echo "Keine eingebaute Festplatte gefunden – es wird nichts gelöscht." > /dev/console
  exit 1
fi

if ! grep -q 'vibedash/neu=1' /proc/cmdline; then
  mkdir -p /tmp/vd
  for p in "$ziel"*; do
    [ "$p" = "$ziel" ] && continue
    if mount -o ro "$p" /tmp/vd 2>/dev/null; then
      if [ -f /tmp/vd/etc/vibedash-abbild ]; then
        umount /tmp/vd
        log "VibeDash ist auf $ziel schon installiert – Abbruch ohne Löschen"
        echo "VibeDash ist schon installiert. Bitte den USB-Stick abziehen und neu starten." > /dev/console
        exit 1
      fi
      umount /tmp/vd
    fi
  done
fi

log "Zielplatte: $ziel"
debconf-set partman-auto/disk "$ziel"
debconf-set grub-installer/bootdev "$ziel"
