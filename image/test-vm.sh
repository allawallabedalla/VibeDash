#!/usr/bin/env bash
# VibeDash-Stick in einer VM prüfen (für Entwickler, nicht für Laien): baut den Stick mit einem Wegwerf-Schlüssel,
# installiert in QEMU (UEFI), startet ohne Stick, wartet auf den Erststart und prüft Dienste und Zugang. Danach
# einmal mit Stick auf der fertigen Platte: Das Gerät muss sich ausschalten, ohne etwas zu löschen.
#   image/test-vm.sh [Arbeitsordner] [Branch]      braucht: qemu-system-x86, ovmf, xorriso, cpio, ssh-keygen
# Dauer etwa 20–40 Minuten. Die VM bekommt 2 Kerne und 2 GB, niedrige Priorität.
set -euo pipefail
HIER=$(cd "$(dirname "$0")" && pwd)
W=${1:-$HOME/.cache/vibedash-abbild}; BRANCH=${2:-main}
mkdir -p "$W"; cd "$W"
[ -r /dev/kvm ] && [ -w /dev/kvm ] && SUDO="" || SUDO="sudo"
OVMF=/usr/share/OVMF
rm -f key key.pub; ssh-keygen -q -t ed25519 -N '' -f key
bash "$HIER/build.sh" --key key.pub --branch "$BRANCH" --out "$W/test.iso" >/dev/null
vm() {  # $1 = mit|ohne Stick
  local cd=()
  [ "$1" = mit ] && cd=(-drive file=test.iso,media=cdrom,readonly=on,if=none,id=cd -device ide-cd,drive=cd,bootindex=0)
  $SUDO nice -n 15 qemu-system-x86_64 -enable-kvm -machine q35 -cpu host -smp 2 -m 2048 \
    -drive if=pflash,format=raw,readonly=on,file=$OVMF/OVMF_CODE_4M.fd -drive if=pflash,format=raw,file=vars.fd \
    -drive file=vm.qcow2,if=none,id=hd -device virtio-blk-pci,drive=hd,bootindex=1 "${cd[@]}" \
    -netdev user,id=n,hostfwd=tcp:127.0.0.1:2222-:22,hostfwd=tcp:127.0.0.1:18095-:8095 -device virtio-net-pci,netdev=n \
    -display none -no-reboot
}
ssh_() { ssh -q -i key -p 2222 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=5 \
  -o BatchMode=yes vibedash@127.0.0.1 "$@"; }
rm -f vm.qcow2; qemu-img create -q -f qcow2 vm.qcow2 24G; cp $OVMF/OVMF_VARS_4M.fd vars.fd
t=$(date +%s); vm mit; echo "1 Installation bis aus: $(( $(date +%s)-t )) s"
vm ohne & t=$(date +%s)
for _ in $(seq 1 120); do ssh_ 'test -f /var/lib/vibedash/erststart.fertig' 2>/dev/null && break; sleep 15; done
echo "2 Erststart: $(( $(date +%s)-t )) s"
ssh_ 'sudo -n true && echo "3 sudo ohne Passwort: ja"; sudo -n sshd -T | grep "^passwordauthentication";
      sudo -n docker ps --format "{{.Names}} {{.Status}}"'
curl -fsS -m 10 -H 'Host: vibedash.local:8095' http://127.0.0.1:18095/api/health >/dev/null && echo "4 VibeDash antwortet"
ssh_ 'sudo -n poweroff' || true; wait
a=$(md5sum < vm.qcow2); t=$(date +%s); vm mit
[ "$a" = "$(md5sum < vm.qcow2)" ] && echo "5 Stick vergessen: aus nach $(( $(date +%s)-t )) s, Platte unverändert" \
  || { echo "5 FEHLER: Platte verändert"; exit 1; }
