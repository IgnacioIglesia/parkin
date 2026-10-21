# Servicio de Cocheras

Alta, edición y baja de cocheras, disponibilidad semanal y búsqueda por radio. Contrato en `docs/contratos.md` §6.

- Stack: Node.js 24 (ESM), Express 5 + Apollo Server 5, PostgreSQL + PostGIS (`pg`), DataLoader, RabbitMQ (`amqplib`), Redis (`redis`).
- Responsable: Diego Marin.

## Endpoints

| Ruta | Qué hace |
|---|---|
| `POST /graphql` | API GraphQL (profundidad máxima 5) |
| `GET /health` | El proceso responde |
| `GET /ready` | Llega a su base y está consumiendo de RabbitMQ (503 si no). Redis no cuenta |
| `GET /metrics` | Métricas para Prometheus (solo red interna) |

## Identidad

El gateway valida el JWT y reenvía `X-User-Id` (UUID) y `X-User-Roles` (roles separados por coma). Sin `X-User-Id` la request es anónima: puede buscar y ver cocheras, pero no la dirección exacta. `misCocheras` y las mutaciones exigen el rol `PROPIETARIO`.

## Reglas que implementa

- **Ubicación aproximada:** al crear la cochera se guarda un punto al azar a 100-300 m del real, fijo. La búsqueda filtra y ordena por ese punto, así no revela la ubicación exacta.
- **Dirección exacta:** solo la ven el propietario y los conductores con reserva confirmada (tabla `acceso_direccion`).
- **Disponibilidad:** franjas semanales en hora de Montevideo. `buscarCocheras` devuelve solo cocheras cuya disponibilidad cubre toda la franja pedida.
- **Ocupación:** la búsqueda descarta las cocheras que Reservas informa ocupadas (`GET /cocheras/{id}/ocupacion`). Si Reservas no responde, la búsqueda sigue sin ese filtro: la regla definitiva contra dobles reservas es la restricción de exclusión de Reservas.
- **Baja lógica:** `eliminarCochera` falla con `CONFLICT` si hay reservas pendientes o confirmadas, y con `SERVICE_UNAVAILABLE` si no puede consultar a Reservas.
- **Sin N+1:** las franjas y los accesos a la dirección se cargan con DataLoader, una consulta por request.

## Eventos (RabbitMQ)

Consume de la cola `cocheras.reserva-eventos` (la crea `infra/rabbitmq/definitions.json`) con ACK manual y prefetch 10.

| Evento | Efecto |
|---|---|
| `reserva.confirmada` | El conductor pasa a ver la dirección exacta. Invalida la caché de búsquedas |
| `reserva.cancelada` | Revoca ese acceso. Invalida la caché de búsquedas |

- **Idempotencia:** cada `eventId` se guarda en `evento_procesado` en la misma transacción que el cambio; un evento repetido se descarta.
- **Orden:** si la cancelación llega antes que la confirmación, la confirmación tardía no reabre el acceso.
- **Errores:** un mensaje inválido (JSON roto, ids faltantes, tipo desconocido) va directo a `cocheras.dlq`. Un error transitorio (por ejemplo, la base caída) se reencola, y después de 3 entregas la cola lo manda a la DLQ.
- **Reconexión:** si RabbitMQ se cae, el consumidor reintenta cada 3 s y `/ready` responde 503 mientras tanto.

## Caché (Redis)

`buscarCocheras` guarda cada resultado 30 s. Cualquier mutación o evento incrementa un número de versión que forma parte de la clave, así que todas las búsquedas viejas quedan invalidadas de una vez. Un resultado calculado sin poder consultar a Reservas no se guarda. Si Redis no responde, la búsqueda va directo a la base.

## Observabilidad

Logs JSON con `traceId`, métricas en `/metrics` y trazas a Jaeger con OpenTelemetry (`src/telemetria.js`). Detalle de cada métrica en `docs/observabilidad.md`.

## Base de datos

Las migraciones están en `migrations/` y se aplican solas al arrancar, en orden y una sola vez (tabla `schema_migrations`). Para agregar un cambio, crear `002_descripcion.sql`; nunca editar una migración ya aplicada.

## Variables de entorno

| Variable | Obligatoria | Por defecto |
|---|---|---|
| `DATABASE_URL` | Sí | |
| `RABBITMQ_URL` | Sí | |
| `REDIS_URL` | No | Sin caché |
| `RESERVAS_URL` | No | `http://reservas:8000` |
| `PORT` | No | `4000` |
| `LOG_LEVEL` | No | `info` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | No | Sin trazas. En Compose: `http://jaeger:4318` |
| `OTEL_SERVICE_NAME` | No | `cocheras` |

## Correrlo

Con Docker, desde la raíz del repo:

```bash
docker compose up --build cocheras
```

Sin Docker, desde `cocheras/` (necesita `db-cocheras` levantada):

```bash
cp .env.example .env
npm install
npm run dev
```

## Tests

```bash
npm test
```

Sin infraestructura corren solo los tests unitarios. Los de integración se activan con variables de entorno: `TEST_DATABASE_URL` (PostGIS) y, para el consumidor y la caché, también `TEST_RABBITMQ_URL` y `TEST_REDIS_URL`. Los archivos de test corren en serie porque comparten la base.

```bash
docker compose up -d db-cocheras rabbitmq redis
docker compose exec db-cocheras psql -U app -d cocheras -c 'CREATE DATABASE cocheras_test'
TEST_DATABASE_URL=postgres://app:app@localhost:5442/cocheras_test \
TEST_RABBITMQ_URL=amqp://guest:guest@localhost:5672 \
TEST_REDIS_URL=redis://localhost:6379 \
npm test
```

Los tests de RabbitMQ vacían las colas `cocheras.reserva-eventos` y `cocheras.dlq`.
