# Contratos entre servicios

Fuente: segunda entrega. **Cualquier cambio acá se hace por PR y se avisa al equipo.** Si tu servicio depende de otro que no está listo, usá un mock que respete este contrato.

## 1. Autenticación

- Usuarios emite JWT firmado con RS256 (clave privada). Gateway y servicios verifican con la clave pública.
- Access token: 15 min. Refresh token: aparte, almacenado hasheado.
- Claims mínimos: `sub` (usuarioId), `roles` (`["PROPIETARIO", "CONDUCTOR"]`), `exp`.
- Header: `Authorization: Bearer <token>`. Sin token válido, el gateway responde 401.
- Para WebSocket el token viaja en el handshake.

## 2. Rutas del gateway

| Ruta | Servicio |
|---|---|
| `/api/usuarios` | usuarios |
| `/graphql` | cocheras |
| `/api/reservas` | reservas |
| `/api/pagos` | pagos |
| `/ws` | pagos (Socket.IO, sticky sessions) |

## 3. REST: Usuarios (`/api/usuarios`)

| Método | Endpoint | Descripción |
|---|---|---|
| POST | `/auth/register` | Crea un usuario con su rol |
| POST | `/auth/login` | Devuelve access token y refresh token |
| POST | `/auth/refresh` | Renueva el access token |
| GET | `/users/me` | Perfil del usuario autenticado |
| PATCH | `/users/me` | Actualiza datos de contacto |

## 4. REST: Reservas (`/api/reservas`)

| Método | Endpoint | Descripción |
|---|---|---|
| POST | `/reservas` | Crea reserva en `PENDIENTE_PAGO`. Requiere header `Idempotency-Key` (UUID) |
| GET | `/reservas/{id}` | Estado de una reserva (fuente de verdad) |
| GET | `/reservas?rol=conductor` | Reservas del usuario |
| POST | `/reservas/{id}/cancelar` | Cancela según la política |
| GET | `/cocheras/{id}/ocupacion?desde&hasta` | Franjas ocupadas, usada por la búsqueda |

Códigos: `201` reserva creada, `409` franja ocupada, `422` datos inválidos.

Estados: `PENDIENTE_PAGO` → `CONFIRMADA` | `CANCELADA` | `EXPIRADA`; `CONFIRMADA` → `FINALIZADA`.

## 5. REST: Pagos (`/api/pagos`)

| Método | Endpoint | Descripción |
|---|---|---|
| POST | `/pagos` | Crea la orden de pago para una reserva y devuelve la URL de checkout |
| POST | `/pagos/webhook` | Resultado de la pasarela (firma verificada; idempotente por `id_externo`) |

## 6. GraphQL: Cocheras (`/graphql`)

```graphql
type Cochera {
  id: ID!
  titulo: String!
  precioHora: Float!
  tipoVehiculo: TipoVehiculo!
  ubicacionAproximada: Punto!
  direccionExacta: String   # solo con reserva confirmada
  fotos: [String!]!
  propietario: Propietario!
  disponibilidad: [Franja!]!
}

type Query {
  buscarCocheras(cerca: PuntoInput!, radioMetros: Int!, desde: String!, hasta: String!, tipo: TipoVehiculo): [Cochera!]!
  cochera(id: ID!): Cochera
  misCocheras: [Cochera!]!
}

type Mutation {
  crearCochera(input: CocheraInput!): Cochera!
  actualizarCochera(id: ID!, input: CocheraInput!): Cochera!
  definirDisponibilidad(id: ID!, franjas: [FranjaInput!]!): Cochera!
  eliminarCochera(id: ID!): Boolean!
}
```

Los tipos auxiliares (`Punto`, `PuntoInput`, `Franja`, `FranjaInput`, `TipoVehiculo`, `Propietario`, `CocheraInput`) quedan por definir por el responsable de Cocheras y se agregan acá por PR. Límite de profundidad de query: 5.

## 7. Eventos (RabbitMQ)

Exchange `topic` durable: `cocheras.eventos`. Dead letter queue: `cocheras.dlq` (tras 3 reintentos).

| Routing key | Publica | Consumen | Efecto |
|---|---|---|---|
| `reserva.creada` | Reservas | Pagos | Pagos queda listo para cobrar esa reserva |
| `pago.aprobado` | Pagos | Reservas | Reserva pasa a `CONFIRMADA` |
| `pago.rechazado` | Pagos | Reservas | Reserva pasa a `CANCELADA` y libera la franja |
| `reserva.confirmada` | Reservas | Pagos, Cocheras | Aviso en tiempo real a ambas partes; Cocheras invalida caché |
| `reserva.cancelada` | Reservas | Pagos, Cocheras | Reembolso si corresponde, aviso, invalidación de caché |
| `reserva.expirada` | Reservas | Pagos | Aviso al conductor de que venció el plazo |

Formato del mensaje:

```json
{
  "eventId": "7f9c2b1e-...",
  "tipo": "pago.aprobado",
  "ocurridoEn": "2026-10-21T14:03:22Z",
  "traceId": "4bf92f3577b34da6...",
  "datos": { "reservaId": "r-1042", "pagoId": "p-883", "monto": 180.0, "moneda": "UYU" }
}
```

Reglas para todos los consumidores:
- Mensajes y colas durables; el productor usa publisher confirms.
- ACK manual (entrega at-least-once) y prefetch 10.
- Idempotencia: guardar `eventId` procesado en `evento_procesado` y descartar repetidos.

> El payload de `datos` de cada evento, salvo `pago.aprobado`, queda por completar entre Reservas y Pagos.

## 8. WebSocket (Pagos, `/ws`)

- El cliente se conecta con su JWT en el handshake y entra a la sala `user:{id}`.
- Eventos hacia el cliente: `reserva:confirmada`, `reserva:cancelada`, `reserva:expirada`, `pago:rechazado`.
- Si el cliente está desconectado no pierde nada: consulta `GET /reservas/{id}`.

## 9. Convenciones comunes

- `GET /health` (el proceso responde) y `GET /ready` (llega a su base y a RabbitMQ) en cada servicio.
- Trazabilidad: el gateway genera el `traceId`; se propaga en el header `traceparent` (W3C) y en el campo `traceId` de cada evento.
- Logs JSON a stdout con `nivel`, `servicio`, `traceId`, `reservaId`, `usuarioId`. Nunca datos de tarjeta ni contraseñas.
- Configuración solo por variables de entorno (ver `.env.example`).
