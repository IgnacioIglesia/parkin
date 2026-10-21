# Servicio de Cocheras

Alta, edición y baja de cocheras, disponibilidad semanal y búsqueda por radio. Contrato en `docs/contratos.md` §6.

- Stack: Node.js 24 (ESM), Express 5 + Apollo Server 5, PostgreSQL + PostGIS (`pg`), DataLoader.
- Responsable: Diego Marin.

## Endpoints

| Ruta | Qué hace |
|---|---|
| `POST /graphql` | API GraphQL (profundidad máxima 5) |
| `GET /health` | El proceso responde |
| `GET /ready` | Llega a su base de datos (503 si no) |

## Identidad

El gateway valida el JWT y reenvía `X-User-Id` (UUID) y `X-User-Roles` (roles separados por coma). Sin `X-User-Id` la request es anónima: puede buscar y ver cocheras, pero no la dirección exacta. `misCocheras` y las mutaciones exigen el rol `PROPIETARIO`.

## Reglas que implementa

- **Ubicación aproximada:** al crear la cochera se guarda un punto al azar a 100-300 m del real, fijo. La búsqueda filtra y ordena por ese punto, así no revela la ubicación exacta.
- **Dirección exacta:** solo la ven el propietario y los conductores con reserva confirmada (tabla `acceso_direccion`, que llenará el consumidor de eventos).
- **Disponibilidad:** franjas semanales en hora de Montevideo. `buscarCocheras` devuelve solo cocheras cuya disponibilidad cubre toda la franja pedida.
- **Ocupación:** la búsqueda descarta las cocheras que Reservas informa ocupadas (`GET /cocheras/{id}/ocupacion`). Si Reservas no responde, la búsqueda sigue sin ese filtro: la regla definitiva contra dobles reservas es la restricción de exclusión de Reservas.
- **Baja lógica:** `eliminarCochera` falla con `CONFLICT` si hay reservas pendientes o confirmadas, y con `SERVICE_UNAVAILABLE` si no puede consultar a Reservas.
- **Sin N+1:** las franjas y los accesos a la dirección se cargan con DataLoader, una consulta por request.

## Base de datos

Las migraciones están en `migrations/` y se aplican solas al arrancar, en orden y una sola vez (tabla `schema_migrations`). Para agregar un cambio, crear `002_descripcion.sql`; nunca editar una migración ya aplicada.

## Variables de entorno

| Variable | Obligatoria | Por defecto |
|---|---|---|
| `DATABASE_URL` | Sí | |
| `RESERVAS_URL` | No | `http://reservas:8000` |
| `PORT` | No | `4000` |
| `LOG_LEVEL` | No | `info` |

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

Sin base, corren solo los tests unitarios. Los de integración necesitan un PostGIS y se activan con `TEST_DATABASE_URL`:

```bash
docker compose up -d db-cocheras
docker compose exec db-cocheras psql -U app -d cocheras -c 'CREATE DATABASE cocheras_test'
TEST_DATABASE_URL=postgres://app:app@localhost:5442/cocheras_test npm test
```
