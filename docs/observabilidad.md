# Observabilidad

La letra pide al menos uno de los pilares (logs, métricas, trazas). Completar con lo implementado.

- **Pilar elegido:** _por definir_
- **Cómo se implementó:** _por definir_
- **Beneficios / qué permitió detectar:** _por definir_

Ideas: logs estructurados (JSON) con `request_id` propagado entre servicios; métricas Prometheus + Grafana (reservas/min, tasa de pagos fallidos, latencia); health endpoints por servicio.

## Reservas (implementado)

Tres señales, todas con el mismo `traceId`.

**Logs.** JSON a stdout, una línea por evento, con `timestamp`, `nivel`, `servicio`, `logger`, `mensaje` y, cuando corresponde, `traceId`, `usuarioId`, `reservaId` y `cocheraId`. Cada request deja una línea con método, ruta, estado y duración (`duracionMs`); `/health`, `/ready` y `/metrics` no se registran porque los llaman Docker y Prometheus cada pocos segundos. Nunca se registran datos de tarjeta ni contraseñas. Nivel configurable con `LOG_LEVEL`.

**Métricas.** `GET /metrics` en formato Prometheus (es interno: el gateway no lo expone).

| Métrica | Qué mide |
|---|---|
| `reservas_http_requests_total{metodo,ruta,estado}` | Requests; la ruta es la plantilla (`/reservas/{reserva_id}`), no el id |
| `reservas_http_request_duration_seconds` | Latencia (histograma, con bucket en 0.8 s) |
| `reservas_creadas_total`, `reservas_confirmadas_total`, `reservas_expiradas_total`, `reservas_finalizadas_total` | Flujo de negocio |
| `reservas_consultas_cocheras_total{resultado}` | Consultas a Cocheras: `ok`, `no_encontrada` o `error` |
| `reservas_canceladas_total{motivo}` | `cancelada_por_usuario` o `pago_rechazado` |
| `reservas_conflictos_total` | Intentos rechazados por franja ocupada (409) |
| `reservas_eventos_procesados_total{tipo,resultado}` | `aplicado`, `duplicado`, `ignorado` o `invalido` |
| `reservas_eventos_publicados_total{routing_key}` | Eventos enviados a RabbitMQ |
| `reservas_outbox_pendientes` | Eventos esperando publicarse (sube si RabbitMQ cae) |

Prometheus las recoge desde `infra/prometheus/prometheus.yml` y evalúa las alertas de `infra/prometheus/alertas.yml`: errores 5xx > 2 %, p95 de `POST /reservas` > 800 ms, outbox acumulado y exceso de expiraciones.

**Trazabilidad.** El gateway genera el `traceId` (header W3C `traceparent`); Reservas lo toma, lo devuelve en el header `X-Trace-Id`, lo escribe en cada log y lo copia al campo `traceId` de cada evento que publica. Para seguir una reserva: buscar su `traceId` en los logs de los servicios. Todavía no se exportan trazas a Jaeger.

**Qué permite detectar.** Un pico de `reservas_conflictos_total` indica competencia por las mismas cocheras; `reservas_outbox_pendientes` creciendo, un problema con RabbitMQ aunque la API siga respondiendo bien; muchas expiraciones, un problema con Pagos.

## Usuarios (implementado)

**Logs.** JSON a stdout (`pino`) con `servicio`, `nivel`, `traceId` (del `traceparent` del gateway) y `usuarioId`; una línea por request con método, ruta, estado y `duracionMs`. No se registran `/health`, `/ready`, `/metrics` ni `/auth/verificar` (los llaman Docker, Prometheus y el gateway en cada request). Contraseñas y tokens se eliminan de cualquier log.

**Métricas.** `GET /metrics`, recogido por Prometheus (job `usuarios`). Interno: el gateway responde 404 en `/api/usuarios/metrics`.

| Métrica | Qué mide |
|---|---|
| `usuarios_http_requests_total{metodo,ruta,estado}` | Requests; la ruta es la plantilla (`/users/:id`) |
| `usuarios_http_request_duration_seconds` | Latencia (histograma, con bucket en 0.8 s) |
| `usuarios_registros_total` | Cuentas nuevas |
| `usuarios_logins_total{resultado}` | `ok` o `fallido` |
| `usuarios_refresh_total{resultado}` | `ok`, `gracia`, `invalido` o `reutilizado` |
| `usuarios_verificaciones_total{resultado}` | Verificaciones de JWT del gateway: `ok`, `anonimo`, `invalido` |

**Qué permite detectar.** Un pico de `usuarios_logins_total{resultado="fallido"}` indica un ataque de fuerza bruta (además del rate limiting del gateway); cualquier `usuarios_refresh_total{resultado="reutilizado"}` es una sesión posiblemente robada; muchas verificaciones `invalido` apuntan a un front con tokens vencidos que no refresca.
