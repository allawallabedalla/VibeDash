#!/bin/sh
# Läuft im Debian-Installer ganz am Ende (busybox sh), das neue System liegt unter /target.
# Legt den Erststart-Dienst an, der beim ersten Hochfahren VibeDash holt und einrichtet.
set -e
t=/target
mkdir -p "$t/etc/vibedash" "$t/var/lib/vibedash"
cp /vibedash/abbild.env "$t/etc/vibedash/abbild.env"
chmod 600 "$t/etc/vibedash/abbild.env"
cp /vibedash/vibedash-erststart.sh "$t/usr/local/sbin/vibedash-erststart"
chmod 755 "$t/usr/local/sbin/vibedash-erststart"
cp /vibedash/vibedash-erststart.service "$t/etc/systemd/system/vibedash-erststart.service"
date -u +%FT%TZ > "$t/etc/vibedash-abbild"

# Zugang für den Helfer (Claude Code am Laptop), falls beim Bauen ein Schlüssel mitgegeben wurde
if [ -s /vibedash/authorized_keys ]; then
  mkdir -p "$t/home/vibedash/.ssh"
  cp /vibedash/authorized_keys "$t/home/vibedash/.ssh/authorized_keys"
  chmod 700 "$t/home/vibedash/.ssh"
  chmod 600 "$t/home/vibedash/.ssh/authorized_keys"
  in-target chown -R vibedash:vibedash /home/vibedash/.ssh
  # mit Schlüssel: der Helfer braucht kein Passwort für sudo (er kann keins eintippen), dafür ist die
  # Anmeldung per Passwort über das Netz aus – rein kommt nur, wer den Schlüssel hat (Fremdtest 2, 23)
  echo 'vibedash ALL=(ALL) NOPASSWD:ALL' > "$t/etc/sudoers.d/vibedash"
  chmod 440 "$t/etc/sudoers.d/vibedash"
  mkdir -p "$t/etc/ssh/sshd_config.d"
  printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\n' > "$t/etc/ssh/sshd_config.d/vibedash.conf"
fi

in-target systemctl enable vibedash-erststart.service
in-target usermod -aG docker vibedash || true
