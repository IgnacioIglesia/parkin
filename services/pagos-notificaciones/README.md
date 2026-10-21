# Servicio de Pagos y Notificaciones

Procesa el cobro de la reserva y confirma en tiempo real a ambas partes.

- Base de datos: `PAGOS_DB`
- Puerto: `PAGOS_PORT`
- Consume `reserva.creada`; publica `pago.confirmado` / `pago.fallido`.
- Pasarela de pago simulada (mock) para la demo.

## Responsable

_Asignar._

## Notas

- Consumidor idempotente: un mismo `reserva.creada` reentregado no debe cobrar dos veces.
