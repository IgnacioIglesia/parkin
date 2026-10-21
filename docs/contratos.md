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

Cómo llegan las rutas a cada servicio (implementado en `gateway/nginx.conf`):

| El cliente llama | El servicio recibe |
|---|---|
| `/api/usuarios/auth/login` | `/auth/login` (se quita el prefijo) |
| `/api/reservas/{id}` | `/reservas/{id}` |
| `/api/pagos/webhook` | `/pagos/webhook` |
| `/graphql`, `/ws` | igual |

- El gateway genera el header `traceparent` si el cliente no lo manda, y responde con `X-Trace-Id`.
- Rate limiting: 10 intentos de login por minuto por IP; 20 requests por segundo por IP en general.
- `X-User-Id`: el gateway descarta el que mande el cliente. **Pendiente (Romi):** validar el JWT y poner ahí el id del usuario autenticado.
- `/cocheras/{id}/ocupacion` (Reservas) es interno: Cocheras lo llama directo a `reservas:8000`, no pasa por el gateway.

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
| POST | `/reservas` | Crea reserva en `PENDIENTE_PAGO`. Body: `{ cochera_id, desde, hasta }`. Requiere header `Idempotency-Key` (UUID) |
| GET | `/reservas/{id}` | Estado de una reserva (fuente de verdad) |
| GET | `/reservas?rol=conductor` | Reservas del usuario |
| POST | `/reservas/{id}/cancelar` | Cancela según la política |
| GET | `/cocheras/{id}/ocupacion?desde&hasta` | Franjas ocupadas, usada por la búsqueda |

Códigos: `201` reserva creada, `200` reintento con la misma `Idempotency-Key`, `404` la cochera no existe, `409` franja ocupada, `422` datos inválidos, `503` no se pudo consultar a Cocheras.

**El cliente no manda el propietario ni el monto.** Reservas los obtiene de Cocheras con la query `cochera(id: $id) { propietario { id } precioHora }` (síncrona, timeout de 3 s, propaga el `traceparent`) y calcula `monto = precioHora × horas de la franja`, con centavos (90 min a $100/h son $150). Si el body incluye `propietario_id` o `monto`, se ignoran. Un reintento con una `Idempotency-Key` ya usada devuelve la reserva existente sin consultar a Cocheras.

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
  ubicacion: Punto          # ubicación exacta; mismas reglas que direccionExacta
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

Tipos auxiliares:

```graphql
"Coordenadas WGS84 en grados decimales"
type Punto {
  lat: Float!
  lng: Float!
}

input PuntoInput {
  lat: Float!
  lng: Float!
}

"Tamaño máximo de vehículo que admite la cochera: MOTO < AUTO < CAMIONETA"
enum TipoVehiculo {
  MOTO
  AUTO
  CAMIONETA
}

"Franja semanal en hora de Montevideo. diaSemana: 1 = lunes ... 7 = domingo"
type Franja {
  diaSemana: Int!
  horaDesde: String!   # "HH:MM"
  horaHasta: String!   # "HH:MM"; "24:00" = fin del día
}

input FranjaInput {
  diaSemana: Int!
  horaDesde: String!
  horaHasta: String!
}

"Solo el id: los datos del usuario viven en Usuarios (database per service)"
type Propietario {
  id: ID!
}

input CocheraInput {
  titulo: String!
  precioHora: Float!          # en UYU
  tipoVehiculo: TipoVehiculo!
  direccionExacta: String!
  ubicacion: PuntoInput!      # ubicación exacta; la aproximada la calcula el servicio
  fotos: [String!]            # URLs de las fotos ya subidas
}
```

Reglas:
- `desde` y `hasta` de `buscarCocheras` van en ISO-8601 UTC. La búsqueda devuelve solo cocheras disponibles en toda la franja.
- `tipo` en `buscarCocheras` devuelve las cocheras donde entra ese vehículo (una `CAMIONETA` admite también `AUTO` y `MOTO`).
- `ubicacionAproximada` está desplazada entre 100 y 300 m de la real, fija para cada cochera. `direccionExacta` y `ubicacion` (el punto exacto) son `null` salvo para el propietario o un conductor con reserva confirmada. Así el propietario puede editar su cochera sin volver a marcar el punto en el mapa.
- Las horas de `Franja` van alineadas a :00 o :30, con `horaDesde < horaHasta`. Una franja no cruza la medianoche: 22:00 a 06:00 se carga como dos franjas.
- `definirDisponibilidad` reemplaza todas las franjas de la cochera. `actualizarCochera` reemplaza todos los campos del input.
- `crearCochera`, `actualizarCochera`, `definirDisponibilidad`, `eliminarCochera` y `misCocheras` exigen el rol `PROPIETARIO`. Solo el dueño puede modificar su cochera.

Límite de profundidad de query: 5.

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

### Payload de `datos` (propuesta de Reservas, a validar con Pagos y Cocheras)

Eventos `reserva.*` (los publica Reservas). Todos llevan la misma foto de la reserva:

```json
{
  "reservaId": "…", "cocheraId": "…", "conductorId": "…", "propietarioId": "…",
  "desde": "2026-10-22T14:00:00+00:00", "hasta": "2026-10-22T16:00:00+00:00",
  "monto": 180.0, "moneda": "UYU", "estado": "PENDIENTE_PAGO"
}
```

- `reserva.creada` agrega `expiraEn` (fin de la retención de 10 minutos).
- `reserva.cancelada` y `reserva.expirada` agregan `motivo`: `cancelada_por_usuario`, `pago_rechazado` o `plazo_vencido`.

Eventos `pago.*` (los publica Pagos). Reservas solo necesita `reservaId`; el resto es informativo:

```json
{ "reservaId": "…", "pagoId": "…", "monto": 180.0, "moneda": "UYU" }
```

`pago.rechazado` puede agregar `motivo`.

### Topología (la crea RabbitMQ al arrancar)

Definida en `infra/rabbitmq/definitions.json`. Los servicios **no declaran** colas: solo consumen de la suya. Si falta una, el consumidor reintenta hasta que exista.

| Cola | Consume | Routing keys |
|---|---|---|
| `reservas.pago-eventos` | Reservas | `pago.aprobado`, `pago.rechazado` |
| `pagos.reserva-eventos` | Pagos | `reserva.creada`, `reserva.confirmada`, `reserva.cancelada`, `reserva.expirada` |
| `cocheras.reserva-eventos` | Cocheras | `reserva.confirmada`, `reserva.cancelada` |
| `cocheras.dlq` | nadie (inspección manual) | recibe lo que supera 3 entregas, vía `cocheras.dlx` |

Las tres primeras son *quorum queues* con `x-delivery-limit: 3`. Un consumidor que falla debe hacer `nack` con `requeue=true`; si el mensaje es inválido y nunca se podrá procesar, `nack` con `requeue=false` lo manda directo a la DLQ.

### Garantías de Reservas

- Publica con *outbox transaccional*: el evento se guarda en la misma transacción que el cambio de estado y se envía después con publisher confirms y `mandatory`. Un mismo evento puede publicarse más de una vez.
- Cada consumidor debe ser idempotente por `eventId` (ver reglas arriba).

## 8. WebSocket (Pagos, `/ws`)

- El cliente se conecta con su JWT en el handshake y entra a la sala `user:{id}`.
- Eventos hacia el cliente: `reserva:confirmada`, `reserva:cancelada`, `reserva:expirada`, `pago:rechazado`.
- Si el cliente está desconectado no pierde nada: consulta `GET /reservas/{id}`.

## 9. Convenciones comunes

- `GET /health` (el proceso responde) y `GET /ready` (llega a su base y a RabbitMQ) en cada servicio.
- Trazabilidad: el gateway genera el `traceId`; se propaga en el header `traceparent` (W3C) y en el campo `traceId` de cada evento.
- Logs JSON a stdout con `nivel`, `servicio`, `traceId`, `reservaId`, `usuarioId`. Nunca datos de tarjeta ni contraseñas.
- Configuración solo por variables de entorno (ver `.env.example`).
