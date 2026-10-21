#!/usr/bin/env bash
# Demo remoto de parkIN: expone el sistema en una URL pública con un túnel de Cloudflare.
#
#   bash infra/demo-remoto.sh                 # un túnel a la web (recomendado): una sola URL para todo
#   bash infra/demo-remoto.sh --modo gateway  # un túnel al gateway, para usar el front desplegado en Vercel
#   bash infra/demo-remoto.sh --sin-levantar  # no ejecuta docker compose up (el sistema ya está corriendo)
#
# Qué hace: levanta el sistema si hace falta, abre el túnel, espera a que la URL responda, reinicia
# la pasarela de prueba para que su página de pago salga por esa URL y te muestra qué abrir.
# Al terminar (Ctrl+C) cierra el túnel y deja la pasarela como estaba. Los túneles gratuitos
# (trycloudflare.com) cambian de URL cada vez y duran mientras el script esté corriendo.
set -euo pipefail

REPO="${DEMO_REPO:-$(cd "$(dirname "$0")/.." && pwd)}"
PUERTO_WEB="${DEMO_PUERTO_WEB:-8081}"
PUERTO_GATEWAY="${DEMO_PUERTO_GATEWAY:-8080}"
MODO="web"
LEVANTAR=1
SERVICIOS="gateway web usuarios cocheras reservas pagos pasarela-mock"

while [ $# -gt 0 ]; do
  case "$1" in
    --modo) MODO="${2:-}"; shift 2 ;;
    --sin-levantar) LEVANTAR=0; shift ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "Opción desconocida: $1 (ver --help)" >&2; exit 2 ;;
  esac
done
case "$MODO" in web) DESTINO="http://localhost:$PUERTO_WEB" ;; gateway) DESTINO="http://localhost:$PUERTO_GATEWAY" ;;
  *) echo "--modo debe ser web o gateway" >&2; exit 2 ;; esac

paso() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }
falla() { printf '\033[31m✘ %s\033[0m\n' "$1" >&2; exit 1; }
compose() { docker compose --project-directory "$REPO" -f "$REPO/docker-compose.yml" "$@"; }

for comando in docker cloudflared curl; do
  command -v "$comando" >/dev/null || falla "Falta '$comando'. Docker Desktop: brew install --cask docker · cloudflared: brew install cloudflared"
done
docker info >/dev/null 2>&1 || falla "Docker no está corriendo. Abrí Docker Desktop y probá de nuevo."
[ -f "$REPO/infra/jwt/jwt_public.pem" ] || echo "Aviso: todavía no existe infra/jwt/jwt_public.pem; el servicio jwt-claves lo genera al levantar el sistema."

LOG="$(mktemp -t parkin-tunel.XXXXXX)"
TUNEL_PID=""
LIMPIO=0
limpiar() {
  [ "$LIMPIO" = 1 ] && return; LIMPIO=1
  printf '\n'; paso "Cerrando el demo"
  [ -n "$TUNEL_PID" ] && kill "$TUNEL_PID" 2>/dev/null && echo "Túnel cerrado."
  echo "Dejo la pasarela de prueba con su URL local (http://localhost:8090)…"
  compose up -d pasarela-mock >/dev/null 2>&1 || echo "No pude reiniciar la pasarela: corré 'docker compose up -d pasarela-mock'."
  rm -f "$LOG"
}
trap limpiar EXIT
trap 'exit 130' INT TERM HUP

# --- 1. El sistema ---------------------------------------------------------------------------
if [ "$LEVANTAR" = 1 ]; then
  paso "Levantando el sistema (docker compose up --build -d)"
  compose up --build -d >/dev/null 2>&1 || falla "docker compose up falló; corré 'docker compose up --build' para ver el error."
fi
paso "Esperando a que los servicios estén sanos"
for intento in $(seq 1 90); do
  faltan=""
  for sv in $SERVICIOS; do
    estado="$(compose ps --format '{{.Service}} {{.Status}}' "$sv" 2>/dev/null | head -1)"
    case "$estado" in *"(healthy)"*) ;; *) faltan="$faltan $sv" ;; esac
  done
  [ -z "$faltan" ] && break
  [ "$intento" = 90 ] && falla "Siguen sin estar 'healthy':$faltan. Mirá 'docker compose ps' y 'docker compose logs <servicio>'."
  sleep 2
done
curl -sf "http://localhost:$PUERTO_GATEWAY/health" >/dev/null || falla "El gateway no responde en el puerto $PUERTO_GATEWAY."
curl -sf "$DESTINO/" >/dev/null || falla "No responde $DESTINO (¿el servicio ${MODO} está arriba?)."
echo "Todo sano."

# --- 2. El túnel -----------------------------------------------------------------------------
paso "Abriendo el túnel hacia $DESTINO"
cloudflared tunnel --no-autoupdate --url "$DESTINO" >"$LOG" 2>&1 &
TUNEL_PID=$!
URL=""
for intento in $(seq 1 40); do
  URL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | head -1 || true)"
  [ -n "$URL" ] && break
  kill -0 "$TUNEL_PID" 2>/dev/null || { cat "$LOG" >&2; falla "cloudflared se cerró antes de dar una URL."; }
  sleep 1
done
[ -n "$URL" ] || { cat "$LOG" >&2; falla "cloudflared no mostró ninguna URL en 40 segundos (¿hay internet?)."; }
echo "URL pública: $URL"

paso "Esperando a que la URL responda (al principio da el error 1033 de Cloudflare)"
LISTA=0
for intento in $(seq 1 60); do
  if curl -sf "$URL/api/usuarios/.well-known/jwks.json" >/dev/null 2>&1; then LISTA=1; break; fi
  kill -0 "$TUNEL_PID" 2>/dev/null || falla "El túnel se cerró."
  sleep 2
done
[ "$LISTA" = 1 ] || falla "La URL no respondió en 2 minutos."
echo "Responde."

# --- 3. La pasarela de prueba ----------------------------------------------------------------
paso "Reiniciando la pasarela de prueba para que su página de pago salga por $URL/pasarela"
PASARELA_PUBLIC_URL="$URL/pasarela" compose up -d pasarela-mock >/dev/null 2>&1
for intento in $(seq 1 30); do
  estado="$(compose ps --format '{{.Status}}' pasarela-mock 2>/dev/null | head -1)"
  case "$estado" in *"(healthy)"*) break ;; esac
  [ "$intento" = 30 ] && falla "La pasarela no volvió a estar sana."
  sleep 1
done
echo "Lista. (Las órdenes de pago que estuvieran abiertas se pierden: la pasarela guarda todo en memoria.)"

# --- 4. Qué hacer ----------------------------------------------------------------------------
paso "Demo remoto listo"
if [ "$MODO" = web ]; then
  cat <<TXT

  Abrí esta URL desde cualquier dispositivo:

      $URL

  La web, la API, el WebSocket y la página de pago salen todos por esa URL (mismo origen).
TXT
else
  cat <<TXT

  El gateway está en:  $URL

  Para usar el front de Vercel:
    1. Vercel → tu proyecto → Settings → Environment Variables:  VITE_API_URL = $URL   (sin barra final)
    2. Deployments → ⋯ → Redeploy   (la variable se aplica al construir)
    3. Abrí el sitio de Vercel.

  El gateway acepta pedidos de los sitios *.vercel.app (CORS). La URL cambia cada vez que corrés
  este script, así que hay que repetir los pasos 1 y 2.
TXT
fi
cat <<TXT

  Para probar el pago: reservá una cochera y tocá «Pagar»; se abre la pasarela de prueba en
  $URL/pasarela/… con los botones Aprobar y Rechazar.

  Dejá esta terminal abierta. Ctrl+C cierra el túnel.
TXT

wait "$TUNEL_PID" || true
echo "El túnel terminó."
