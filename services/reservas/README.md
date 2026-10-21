# Servicio de Reservas

Búsqueda y matching conductor–cochera, y bloqueo de la franja horaria para evitar conflictos de concurrencia.

- Base de datos: `RESERVAS_DB` (requiere `btree_gist`, ya habilitado en `infra/postgres/init.sh`)
- Puerto: `RESERVAS_PORT`
- Estados: `PENDIENTE_PAGO` → `CONFIRMADA` | `CANCELADA` | `EXPIRADA`
- Publica `reserva.creada`; consume `pago.confirmado` / `pago.fallido`.

## Responsable

_Asignar._

## Endpoints previstos

- `POST /reservas`
- `GET /reservas/{id}`
- `DELETE /reservas/{id}`
