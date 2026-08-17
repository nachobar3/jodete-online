#!/usr/bin/env bash
#
# Actualiza el server a la última versión del repo y reinicia el servicio.
# Uso:   sudo bash /srv/jodete/deploy/update.sh
#
set -euo pipefail
APP_DIR="/srv/jodete"
SERVICE_USER="jodete"

if [[ $EUID -ne 0 ]]; then
  echo "Correlo con sudo:  sudo bash $APP_DIR/deploy/update.sh" >&2
  exit 1
fi

echo "==> git pull"
git -C "$APP_DIR" pull --ff-only
chown -R "$SERVICE_USER:$SERVICE_USER" "$APP_DIR"

echo "==> pnpm install"
( cd "$APP_DIR" && sudo -u "$SERVICE_USER" env HOME="$APP_DIR" pnpm install --frozen-lockfile )

echo "==> reiniciando servicio"
systemctl restart jodete
sleep 1
systemctl --no-pager status jodete | head -8
