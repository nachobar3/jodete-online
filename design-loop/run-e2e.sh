#!/usr/bin/env bash
# Corre tests e2e contra servers en puertos dedicados (5273/2577), en UNA sola invocación
# (los daemons no sobreviven al sandbox). Uso: design-loop/run-e2e.sh [archivo-o-patrón]
# Ej: design-loop/run-e2e.sh guidelines.spec.ts
set -uo pipefail
cd "$(dirname "$0")/.."

CLIENT_PORT="${JODETE_CLIENT_PORT:-5273}"
SERVER_PORT="${JODETE_SERVER_PORT:-2577}"
export JODETE_URL="http://localhost:${CLIENT_PORT}"
export JODETE_EXTERNAL_SERVER=1   # que Playwright no arranque su propio dev server

pkill -f "jodete/server" 2>/dev/null; pkill -f "vite.*${CLIENT_PORT}" 2>/dev/null; sleep 1

PORT="$SERVER_PORT" JODETE_TEST=1 JODETE_PERMANENCIA_MS=900 JODETE_TURN_TIMEOUT_MS=60000 JODETE_BOT_DELAY_MS=300 \
  pnpm --filter @jodete/server dev >/tmp/jodete-server.log 2>&1 &
SRV=$!
VITE_SERVER_URL="ws://localhost:${SERVER_PORT}" \
  pnpm --filter @jodete/client exec vite --port "$CLIENT_PORT" --strictPort >/tmp/jodete-client.log 2>&1 &
CLI=$!
cleanup() { kill "$SRV" "$CLI" 2>/dev/null; pkill -P "$SRV" 2>/dev/null; pkill -P "$CLI" 2>/dev/null; }
trap cleanup EXIT

echo "· esperando servers (client :$CLIENT_PORT, server :$SERVER_PORT)…"
for i in $(seq 1 90); do
  if curl -s -m2 -o /dev/null "http://localhost:${CLIENT_PORT}/" && (exec 3<>"/dev/tcp/localhost/${SERVER_PORT}") 2>/dev/null; then READY=1; break; fi
  sleep 1
done
if [ "${READY:-0}" != "1" ]; then echo "✗ servers no levantaron"; tail -15 /tmp/jodete-server.log; tail -15 /tmp/jodete-client.log; exit 1; fi
sleep 1
echo "· servers listos, corriendo e2e…"

pnpm exec playwright test "$@"
