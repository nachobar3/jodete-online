#!/usr/bin/env bash
#
# Actualiza el server a la última versión del repo y reinicia el servicio.
#
# Uso:
#   sudo bash /srv/jodete/deploy/update.sh              # actualiza siempre (fuerza pull + install + restart)
#   sudo bash /srv/jodete/deploy/update.sh --if-changed # solo actualiza si el remoto trae commits nuevos
#
# El modo --if-changed es el que usa el timer de auto-update (jodete-update.timer):
# hace un fetch barato y, si ya está al día, sale sin reiniciar nada.
#
set -euo pipefail
APP_DIR="/srv/jodete"
SERVICE_USER="jodete"
BRANCH="master"

IF_CHANGED=0
if [[ "${1:-}" == "--if-changed" ]]; then
  IF_CHANGED=1
fi

if [[ $EUID -ne 0 ]]; then
  echo "Correlo con sudo:  sudo bash $APP_DIR/deploy/update.sh" >&2
  exit 1
fi

git config --global --add safe.directory "$APP_DIR" 2>/dev/null || true

echo "==> git fetch"
git -C "$APP_DIR" fetch --quiet origin "$BRANCH"

LOCAL="$(git -C "$APP_DIR" rev-parse HEAD)"
REMOTE="$(git -C "$APP_DIR" rev-parse "origin/$BRANCH")"

if [[ "$IF_CHANGED" == "1" && "$LOCAL" == "$REMOTE" ]]; then
  echo "==> ya está al día ($LOCAL). Nada que hacer."
  exit 0
fi

echo "==> git pull  ($LOCAL -> $REMOTE)"
git -C "$APP_DIR" pull --ff-only origin "$BRANCH"
chown -R "$SERVICE_USER:$SERVICE_USER" "$APP_DIR"

echo "==> pnpm install"
( cd "$APP_DIR" && sudo -u "$SERVICE_USER" env HOME="$APP_DIR" pnpm install --frozen-lockfile --ignore-scripts )

echo "==> reiniciando servicio"
systemctl restart jodete
sleep 1
systemctl --no-pager status jodete | head -8
