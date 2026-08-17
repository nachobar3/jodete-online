#!/usr/bin/env bash
# Corre una iteración del design-loop en UNA sola invocación: levanta client+server
# de jodete en puertos dedicados, espera a que estén listos, captura, y limpia.
# En este entorno los daemons no sobreviven a la invocación de Bash, así que todo
# vive dentro de este proceso. Uso: design-loop/run.sh <N> [--run <runId>]
set -uo pipefail
cd "$(dirname "$0")/.."

CLIENT_PORT="${JODETE_CLIENT_PORT:-5273}"
SERVER_PORT="${JODETE_SERVER_PORT:-2577}"
export JODETE_URL="http://localhost:${CLIENT_PORT}"
export JODETE_NO_SPAWN=1

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
  # client: vite responde HTTP. server: Colyseus es WS-only, chequeamos TCP abierto.
  if curl -s -m2 -o /dev/null "http://localhost:${CLIENT_PORT}/" && (exec 3<>"/dev/tcp/localhost/${SERVER_PORT}") 2>/dev/null; then
    READY=1; break
  fi
  sleep 1
done
if [ "${READY:-0}" != "1" ]; then echo "✗ servers no levantaron"; echo "--- server.log ---"; tail -15 /tmp/jodete-server.log; echo "--- client.log ---"; tail -15 /tmp/jodete-client.log; exit 1; fi
sleep 1
echo "· servers listos, capturando…"

node design-loop/harness/run-iteration.ts "$@"
