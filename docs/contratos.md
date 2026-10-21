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
| GET | `/pagos/{id}` | Estado de un pago (solo el conductor que lo inició) |
| POST | `/pagos/webhook` | Resultado de la pasarela (firma verificada; idempotente por `id_externo`) |

Pagos no consulta a Reservas: arma su copia local de la reserva a partir del evento `reserva.creada` (monto, conductor, vencimiento). Todos los IDs son UUID.

### `POST /pagos`

Requiere `Authorization: Bearer <token>` y header `Idempotency-Key` (UUID). Repetir la misma clave devuelve el mismo pago sin cobrar de nuevo.

```json
{ "reservaId": "2b9f6c0e-8d1a-4c3e-9f5b-7a1d2e3f4a5b" }
```

Respuesta `201` (o `200` si la `Idempotency-Key` ya se había usado):

```json
{
  "pagoId": "5e2d8a7c-1b3f-4d6e-8a9b-0c1d2e3f4a5b",
  "reservaId": "2b9f6c0e-8d1a-4c3e-9f5b-7a1d2e3f4a5b",
  "estado": "PENDIENTE",
  "monto": 180.0,
  "moneda": "UYU",
  "checkoutUrl": "http://localhost:8090/checkout/mock-5e2d8a7c"
}
```

| Código | `error` | Cuándo |
|---|---|---|
| 401 | `NO_AUTENTICADO` | Falta el token o no es válido |
| 403 | `NO_ES_TU_RESERVA` | El `sub` del token no es el conductor de la reserva |
| 404 | `RESERVA_DESCONOCIDA` | Pagos todavía no recibió `reserva.creada`; el front reintenta en unos segundos |
| 409 | `RESERVA_EXPIRADA` | Ya pasó `expiraEn` o llegó `reserva.expirada` / `reserva.cancelada` |
| 409 | `PAGO_EN_CURSO` | Ya hay un pago pendiente o aprobado para esa reserva |
| 422 | `DATOS_INVALIDOS` | Falta `reservaId`, no es UUID o falta `Idempotency-Key` |

Los errores siempre tienen la forma `{ "error": "CODIGO", "mensaje": "...", "traceId": "..." }`.

### `GET /pagos/{id}`

Devuelve el mismo cuerpo que `POST /pagos`, con `estado` en `PENDIENTE`, `APROBADO` o `RECHAZADO`. Si está rechazado, agrega `motivo`.

### `POST /pagos/webhook` (lo llama la pasarela, no el front)

No usa JWT. La pasarela firma el cuerpo con HMAC-SHA256 usando `PASARELA_WEBHOOK_SECRET` y manda la firma en hex en el header `X-Firma`.

```json
{
  "idExterno": "mock-5e2d8a7c",
  "referencia": "5e2d8a7c-1b3f-4d6e-8a9b-0c1d2e3f4a5b",
  "estado": "approved",
  "motivo": null,
  "monto": 180.0,
  "moneda": "UYU"
}
```

- `referencia` es el `pagoId`. `estado` es `approved` o `rejected`. Si es `rejected`, `motivo` explica por qué (por ejemplo, `fondos_insuficientes`).
- `200` si la firma es válida, aunque sea un aviso repetido: la pasarela no debe reintentar. Solo el primer aviso por `idExterno` cambia el estado y publica `pago.aprobado` o `pago.rechazado`.
- `401` si la firma no coincide; `422` si el cuerpo no tiene el formato esperado.

### Pasarela simulada (demo)

Contenedor `pasarela-mock` (puerto 8090) que imita a Mercado Pago. La `checkoutUrl` abre una página con los botones **Aprobar** y **Rechazar**; al elegir, la pasarela llama al webhook. Para pruebas automáticas: `POST /checkout/{idExterno}/resultado` con `{ "estado": "approved" | "rejected" }`.

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

### Payload de `datos` por evento

> Propuesta de Pagos; falta que Reservas la confirme en el PR.

Fechas en ISO-8601 con zona horaria; montos como número con dos decimales.

| Routing key | `datos` |
|---|---|
| `reserva.creada` | `reservaId`, `cocheraId`, `conductorId`, `propietarioId`, `inicio`, `fin`, `monto`, `moneda`, `expiraEn` |
| `pago.aprobado` | `reservaId`, `pagoId`, `monto`, `moneda` |
| `pago.rechazado` | `reservaId`, `pagoId`, `motivo` |
| `reserva.confirmada` | `reservaId`, `cocheraId`, `conductorId`, `propietarioId`, `inicio`, `fin` |
| `reserva.cancelada` | `reservaId`, `cocheraId`, `conductorId`, `propietarioId`, `motivo` (`PAGO_RECHAZADO` \| `CANCELADA_POR_CONDUCTOR` \| `CANCELADA_POR_PROPIETARIO`) |
| `reserva.expirada` | `reservaId`, `cocheraId`, `conductorId` |

- El `monto` lo calcula Reservas al crear la reserva (precio por hora × duración) y viaja en `reserva.creada`. Pagos cobra ese monto y no lo recalcula.
- Los eventos de reserva llevan `conductorId` y `propietarioId` para que Pagos sepa a qué salas de WebSocket avisar sin consultar a otro servicio. Los que consume Cocheras llevan `cocheraId` para invalidar la caché.

Ejemplo de `reserva.creada`:

```json
{
  "eventId": "0c4e7a1b-2d3f-4a5b-8c9d-1e2f3a4b5c6d",
  "tipo": "reserva.creada",
  "ocurridoEn": "2026-10-21T14:00:05Z",
  "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
  "datos": {
    "reservaId": "2b9f6c0e-8d1a-4c3e-9f5b-7a1d2e3f4a5b",
    "cocheraId": "9a8b7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d",
    "conductorId": "1f2e3d4c-5b6a-4987-8a7b-6c5d4e3f2a1b",
    "propietarioId": "7d6c5b4a-3e2f-4109-8a7b-6c5d4e3f2a1b",
    "inicio": "2026-10-22T09:00:00-03:00",
    "fin": "2026-10-22T12:00:00-03:00",
    "monto": 180.0,
    "moneda": "UYU",
    "expiraEn": "2026-10-21T14:10:05Z"
  }
}
```

## 8. WebSocket (Pagos, `/ws`)

- El cliente se conecta con su JWT en el handshake y entra a la sala `user:{id}`.
- Eventos hacia el cliente: `reserva:confirmada`, `reserva:cancelada`, `reserva:expirada`, `pago:rechazado`.
- Si el cliente está desconectado no pierde nada: consulta `GET /reservas/{id}`.

Conexión desde el front (Socket.IO v4):

```js
import { io } from 'socket.io-client';

const socket = io(GATEWAY_URL, { path: '/ws', auth: { token: accessToken } });
socket.on('connect_error', (err) => { /* err.message === 'NO_AUTENTICADO' → refrescar token y reconectar */ });
socket.on('reserva:confirmada', (datos) => { /* ... */ });
```

| Evento | Lo dispara | Destinatarios | Payload |
|---|---|---|---|
| `reserva:confirmada` | `reserva.confirmada` | conductor y propietario | `{ reservaId, cocheraId, inicio, fin }` |
| `reserva:cancelada` | `reserva.cancelada` | conductor y propietario | `{ reservaId, cocheraId, motivo }` |
| `reserva:expirada` | `reserva.expirada` | conductor | `{ reservaId, cocheraId }` |
| `pago:rechazado` | `pago.rechazado` | conductor | `{ reservaId, pagoId, motivo }` |

- Los avisos son "best effort": si un mensaje se pierde, la fuente de verdad sigue siendo `GET /reservas/{id}`.
- Con varias réplicas de Pagos, el adaptador Redis de Socket.IO hace que el aviso llegue sin importar a qué réplica esté conectado el cliente.

## 9. Convenciones comunes

- `GET /health` (el proceso responde) y `GET /ready` (llega a su base y a RabbitMQ) en cada servicio.
- Trazabilidad: el gateway genera el `traceId`; se propaga en el header `traceparent` (W3C) y en el campo `traceId` de cada evento.
- Logs JSON a stdout con `nivel`, `servicio`, `traceId`, `reservaId`, `usuarioId`. Nunca datos de tarjeta ni contraseñas.
- Configuración solo por variables de entorno (ver `.env.example`).
