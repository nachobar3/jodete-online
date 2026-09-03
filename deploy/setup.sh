#!/usr/bin/env bash
#
# Setup del game-server de Jodete en esta máquina (Arch Linux).
# Instala node/pnpm del sistema, crea un usuario dedicado y sandboxeado,
# despliega el repo en /srv/jodete y levanta el servicio systemd.
#
# Uso:   sudo bash deploy/setup.sh
#
set -euo pipefail

REPO_URL="https://github.com/nachobar3/jodete-online.git"
APP_DIR="/srv/jodete"
SERVICE_USER="jodete"

if [[ $EUID -ne 0 ]]; then
  echo "Correlo con sudo:  sudo bash deploy/setup.sh" >&2
  exit 1
fi

echo "==> [1/6] Instalando node y pnpm del sistema (pacman)"
pacman -S --needed --noconfirm nodejs pnpm git

echo "==> [2/6] Creando usuario de sistema '$SERVICE_USER' (sin login)"
if ! id "$SERVICE_USER" &>/dev/null; then
  useradd --system --home-dir "$APP_DIR" --shell /usr/bin/nologin "$SERVICE_USER"
fi

echo "==> [3/6] Desplegando el repo en $APP_DIR"
git config --global --add safe.directory "$APP_DIR" 2>/dev/null || true
if [[ ! -d "$APP_DIR/.git" ]]; then
  git clone "$REPO_URL" "$APP_DIR"
else
  git -C "$APP_DIR" pull --ff-only
fi
chown -R "$SERVICE_USER:$SERVICE_USER" "$APP_DIR"

echo "==> [4/6] Instalando dependencias (como '$SERVICE_USER')"
# --ignore-scripts: pnpm 10+ frena en build-scripts no aprobados (esbuild, msgpackr-extract)
# y sale con código != 0. No los necesitamos: tsx resuelve el binario de esbuild por el
# paquete de plataforma y msgpackr usa fallback JS. Así el install es determinístico.
( cd "$APP_DIR" && sudo -u "$SERVICE_USER" env HOME="$APP_DIR" pnpm install --frozen-lockfile --ignore-scripts )

echo "==> [5/7] Instalando y habilitando el servicio systemd"
install -m0644 "$APP_DIR/deploy/jodete.service" /etc/systemd/system/jodete.service
systemctl daemon-reload
systemctl enable jodete
systemctl restart jodete

echo "==> [6/7] Activando auto-update (timer que hace pull+restart tras cada push)"
install -m0644 "$APP_DIR/deploy/jodete-update.service" /etc/systemd/system/jodete-update.service
install -m0644 "$APP_DIR/deploy/jodete-update.timer"   /etc/systemd/system/jodete-update.timer
systemctl daemon-reload
systemctl enable --now jodete-update.timer

echo "==> [7/7] Estado del servicio:"
sleep 1
systemctl --no-pager --full status jodete | head -14 || true

echo
echo "Listo. El server escucha en localhost:2567 y arranca solo en cada boot."
echo "Se auto-actualiza en ~1 min tras cada push a master (jodete-update.timer)."
echo "Siguiente paso: exponerlo con Tailscale Funnel ->  sudo tailscale funnel --bg 2567"
