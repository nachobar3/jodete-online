#!/usr/bin/env bash
#
# Activa el auto-update del server (una sola vez).
# Deja instalado y andando el timer que mantiene /srv/jodete al día con cada
# push a master, sin correr nada a mano.
#
# Uso:   sudo bash /srv/jodete/deploy/enable-autoupdate.sh
#
set -euo pipefail
APP_DIR="/srv/jodete"

if [[ $EUID -ne 0 ]]; then
  echo "Correlo con sudo:  sudo bash $APP_DIR/deploy/enable-autoupdate.sh" >&2
  exit 1
fi

echo "==> instalando unidades systemd"
install -m0644 "$APP_DIR/deploy/jodete-update.service" /etc/systemd/system/jodete-update.service
install -m0644 "$APP_DIR/deploy/jodete-update.timer"   /etc/systemd/system/jodete-update.timer
systemctl daemon-reload

echo "==> habilitando y arrancando el timer"
systemctl enable --now jodete-update.timer

echo "==> estado"
systemctl --no-pager list-timers jodete-update.timer || true
echo
echo "Listo. El server se auto-actualiza en ~1 min tras cada push a master."
echo "Logs:  journalctl -u jodete-update.service -f"
