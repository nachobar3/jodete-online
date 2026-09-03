# Deploy — Jodete online

Arquitectura de producción:

```
  Jugadores (internet)
        │  https / wss
        ▼
  Tailscale Funnel  ──►  omarchy.tailcb513b.ts.net  (TLS automático, sin abrir puertos)
        │  http / ws (localhost)
        ▼
  systemd: jodete.service  ──►  Colyseus en localhost:2567  (usuario 'jodete', sandbox)

  Client (SPA) ──► Vercel  ──►  VITE_SERVER_URL = wss://omarchy.tailcb513b.ts.net
```

- **Server**: corre en este desktop como servicio systemd endurecido. Escucha SOLO en
  `localhost:2567`; no hay puertos abiertos en el router.
- **Exposición**: Tailscale Funnel publica el `localhost:2567` en el hostname fijo
  `omarchy.tailcb513b.ts.net` con TLS. Estable entre reinicios.
- **Client**: estático en Vercel, redeploy automático en cada push a `main`.

## Puesta en marcha (una sola vez)

### 1. Server (systemd)
```bash
sudo bash deploy/setup.sh
```
Instala node/pnpm del sistema, crea el usuario `jodete`, clona el repo en `/srv/jodete`,
instala deps y habilita el servicio (arranca solo en cada boot).

### 2. Exponer con Tailscale Funnel
```bash
sudo tailscale funnel --bg 2567
```
La primera vez, si Funnel/HTTPS no están habilitados, el comando imprime un link al
admin console de Tailscale para activarlos. Verificar con:
```bash
tailscale funnel status
curl -I https://omarchy.tailcb513b.ts.net   # debería responder
```

### 3. Que no se suspenda
El juego está disponible solo si la PC está prendida. Desactivar el auto-suspend por
inactividad (ver nota en la raíz del repo / config de Hyprland).

## Actualización automática (recomendado)

El server se mantiene al día solo: un timer de systemd (`jodete-update.timer`)
corre cada minuto, hace un `git fetch` barato y, **solo si hay commits nuevos** en
`origin/master`, ejecuta pull + `pnpm install` + `systemctl restart jodete`. Así,
**cada push a master queda aplicado en ~1 min** sin correr nada a mano (igual que
el client, que Vercel redeploya solo).

Corre como root (el propio systemd), así que no hace falta ningún `sudo` en curso
ni reglas de sudoers: el único paso con privilegios es la activación única.

Activarlo (una sola vez):
```bash
# 1) traé los archivos nuevos al server
sudo bash /srv/jodete/deploy/update.sh
# 2) instalá y arrancá el timer
sudo bash /srv/jodete/deploy/enable-autoupdate.sh
```
(En instalaciones nuevas, `setup.sh` ya lo deja activado.)

Ver estado / logs del auto-update:
```bash
systemctl list-timers jodete-update.timer     # próximo disparo
journalctl -u jodete-update.service -f         # qué hizo en cada tick
```

## Actualizar el server a mano (forzado)
```bash
sudo bash /srv/jodete/deploy/update.sh
```
Fuerza pull + install + restart aunque no haya cambios. (El client se actualiza
solo en Vercel al hacer push.)

## Operación
```bash
systemctl status jodete           # estado
journalctl -u jodete -f           # logs en vivo
sudo systemctl restart jodete     # reiniciar
tailscale funnel status           # estado del túnel público
```
