#!/usr/bin/env bash
# Prueba el sistema con 2 réplicas de Reservas y 2 de Pagos, en un proyecto de compose aparte
# ("replicas"): no toca el sistema que esté corriendo ni publica puertos en el host.
#
# Qué comprueba:
#   1. 12 rondas de 25 reservas simultáneas sobre la misma franja: siempre entra una sola (1 x 201 y 24 x 409).
#   2. Un pago completo: la reserva termina CONFIRMADA aunque los eventos los consuma cualquiera de las réplicas.
#   3. 8 reservas sin pagar con retención de 1 minuto: todas expiran, y cada evento reserva.expirada sale una sola vez.
#   4. Los avisos por WebSocket llegan al cliente aunque esté conectado a la otra réplica de Pagos.
#   5. Las dos réplicas de Reservas reciben pedidos del gateway, y no hay eventos repetidos ni errores en los logs.
#
# Uso: scripts/probar-replicas.sh        (tarda unos 6 minutos; necesita Docker y conexión a internet)
# Variables: CONSERVAR=1 deja el sistema levantado al terminar (se baja con: docker compose -p replicas down -v).
set -u
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
P=replicas
TMP="$(mktemp -d)"
cd "$RAIZ" || exit 1
fallas=0

python3 - "$TMP/override.yml" <<'PY'
import re, sys
s = open('docker-compose.yml').read().split("\nvolumes:\n")[0]
servicios = re.findall(r'^  ([a-z0-9-]+):\n', s, re.M)
out = "services:\n"
for x in servicios:
    out += f"  {x}:\n    ports: !reset []\n"
    if x == "reservas":
        out += "    environment:\n      RETENCION_MINUTOS: \"1\"\n      EXPIRACION_INTERVALO_SEGUNDOS: \"10\"\n"
open(sys.argv[1], 'w').write(out)
PY
dc() { docker compose -p "$P" -f docker-compose.yml -f "$TMP/override.yml" "$@"; }
limpiar() { [ "${CONSERVAR:-0}" = 1 ] || dc down -v --remove-orphans >/dev/null 2>&1; rm -rf "$TMP"; }
trap limpiar EXIT

echo "== Levantando el sistema con 2 réplicas de Reservas y de Pagos"
dc up -d --build --scale reservas=2 --scale pagos=2 >/dev/null 2>&1 || { echo "No levantó"; exit 1; }
until [ -z "$(dc ps --format '{{.Status}}' | grep -E 'starting|unhealthy')" ]; do sleep 4; done
echo "   reservas: $(dc ps -q reservas | wc -l | tr -d ' ') contenedores; pagos: $(dc ps -q pagos | wc -l | tr -d ' ') contenedores"

echo; echo "== Fases 1 a 3: reservas simultáneas, pago completo y expiración"
PAG="$(dc ps -q pagos | head -1)"
docker cp scripts/replicas/rondas.mjs "$PAG:/tmp/rondas.mjs" >/dev/null
docker exec "$PAG" node /tmp/rondas.mjs 2>&1 | tee "$TMP/rondas.log" | grep -vE "^  ronda"
grep -c "ronda .*✔" "$TMP/rondas.log" | sed 's/^/   rondas correctas: /'
grep -q "FALL" "$TMP/rondas.log" && fallas=$((fallas + 1))

echo; echo "== Fase 4: avisos por WebSocket entre réplicas"
IPS="$(for c in $(dc ps -q pagos); do docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$c"; done | tr '\n' ' ')"
RED="$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}' "$PAG")"
docker run --rm --network "$RED" -v "$RAIZ/scripts/replicas/avisos.mjs:/app/avisos.mjs:ro" node:20-alpine \
  sh -c "mkdir -p /w && cp /app/avisos.mjs /w/ && cd /w && npm init -y >/dev/null 2>&1 && npm i socket.io-client >/dev/null 2>&1 && node avisos.mjs $IPS" 2>&1 | tee "$TMP/avisos.log"
grep -q "FALL" "$TMP/avisos.log" && fallas=$((fallas + 1))

echo; echo "== Fase 5: reparto de pedidos, eventos repetidos y errores"
echo "   pedidos a /api/reservas por réplica (access log del gateway):"
dc logs gateway --no-log-prefix 2>/dev/null | grep '"/api/reservas' | grep -o '"upstream":"[^"]*"' | sort | uniq -c | sed 's/^/     /'
n_upstreams="$(dc logs gateway --no-log-prefix 2>/dev/null | grep '"/api/reservas' | grep -o '"upstream":"[^"]*"' | sort -u | wc -l | tr -d ' ')"
[ "$n_upstreams" -ge 2 ] || { echo "   ✘ FALLÓ: el gateway solo usó $n_upstreams réplica(s)"; fallas=$((fallas + 1)); }
dup="$(dc exec -T db-reservas psql -U app -d reservas -tAc "select count(*) - count(distinct payload->'datos'->>'reservaId') from outbox where routing_key='reserva.expirada'" | tr -d ' \r')"
echo "   eventos reserva.expirada repetidos: $dup"; [ "$dup" = 0 ] || fallas=$((fallas + 1))
pend="$(dc exec -T db-reservas psql -U app -d reservas -tAc "select count(*) from outbox where publicada_en is null" | tr -d ' \r')"
echo "   eventos de Reservas sin publicar: $pend"; [ "$pend" = 0 ] || fallas=$((fallas + 1))
rep="$(dc exec -T db-pagos psql -U app -d pagos -tAc "select count(*) - count(distinct event_id) from evento_procesado" | tr -d ' \r')"
echo "   eventos repetidos en Pagos: $rep"; [ "$rep" = 0 ] || fallas=$((fallas + 1))
errores="$({ dc logs reservas --no-log-prefix; dc logs pagos --no-log-prefix; } 2>/dev/null | grep -ciE '"nivel": ?"error"|Traceback|deadlock')"
echo "   errores en los logs de Reservas y Pagos: $errores"; [ "$errores" = 0 ] || fallas=$((fallas + 1))

echo
if [ "$fallas" = 0 ]; then echo "TODO OK con 2 réplicas de Reservas y de Pagos"; else echo "HAY FALLAS ($fallas)"; fi
exit "$fallas"
