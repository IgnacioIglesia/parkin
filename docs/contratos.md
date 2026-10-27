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
| `/pasarela/checkout/{idExterno}` y `/pasarela/checkout/{idExterno}/resultado` | `/checkout/{idExterno}` y `/checkout/{idExterno}/resultado` de `pasarela-mock` (solo demo; ver abajo) |
| `/graphql`, `/ws` | igual |

- El gateway genera el header `traceparent` si el cliente no lo manda, y responde con `X-Trace-Id`.
- **CORS:** el gateway responde los preflight (`OPTIONS` → 204) y agrega `Access-Control-Allow-Origin` solo para `https://*.vercel.app` y `localhost`/`127.0.0.1` (cualquier puerto); un origen distinto no recibe el header y el navegador lo bloquea. Métodos permitidos: GET, POST, PATCH, PUT, DELETE. Headers permitidos: `Authorization`, `Content-Type`, `Idempotency-Key`, `traceparent`. Expone `X-Trace-Id`. Los servicios **no deben** mandar sus propios headers de CORS (el gateway los descarta). Para permitir otro dominio, agregar una línea al `map $http_origin` de `gateway/nginx.conf`.
- `X-Trace-Id` sale una sola vez, con el traceId del `traceparent` (el del cliente o el generado).
- Rate limiting: 10 intentos de login por minuto por IP; 20 requests por segundo por IP en general.
- **Autenticación en el gateway** (`gateway/jwt.js`, njs): verifica el JWT localmente (firma RS256 con la clave pública de Usuarios, `exp`, `nbf` y emisor `parkin-usuarios`) sin llamar a Usuarios en cada request. Solo acepta RS256 (rechaza `alg: none` y el cambio de algoritmo). Si es válido, pasa la identidad a los servicios en dos headers; **los servicios deben confiar solo en estos y nunca en lo que mande el cliente**, porque el gateway siempre pisa los que traiga el request:
  - `X-User-Id`: el `sub` del token (UUID).
  - `X-User-Roles`: los roles del token, solo `PROPIETARIO` y/o `CONDUCTOR`, separados por coma.
- **Qué rutas exigen token:**

| Ruta | Token |
|---|---|
| `/api/usuarios/auth/*`, `/api/usuarios/.well-known/*` | No (registro, login, refresh) |
| `/api/usuarios/*` (el resto: perfil, etc.) | Obligatorio |
| `/api/reservas/*`, `/api/pagos/*` | Obligatorio |
| `/api/pagos/webhook` | No: lo llama la pasarela y se valida con la firma HMAC |
| `/graphql` | Opcional: sin token la request es anónima (buscar cocheras); con un token inválido o vencido, 401 |
| `/ws` | No en el gateway: el token va en el handshake (`auth.token`) y lo valida Pagos |
| `/pasarela/checkout/*` | No: es la página de pago de la pasarela de prueba, que abre el navegador (solo demo) |

- **Pasarela de prueba por el gateway (solo demo):** para que el checkout se abra desde un navegador remoto (por ejemplo con un túnel público hacia el gateway, o desde el front en Vercel) sin exponer el puerto de `pasarela-mock`, el gateway publica **únicamente** la página de pago y el botón que decide el resultado. `/ordenes` (crear órdenes y reembolsar) es de Pagos y **no se expone**: da `404`, igual que cualquier otra ruta de la pasarela, `/health` o los intentos de recorrer rutas. Para que la `checkoutUrl` que devuelve Pagos use esta ruta, `pasarela-mock` se levanta con `PASARELA_PUBLIC_URL=<URL pública del gateway>/pasarela`; por ejemplo, `PASARELA_PUBLIC_URL=https://algo.trycloudflare.com/pasarela docker compose up -d pasarela-mock`. La ruta no necesita token (el usuario llega desde la pasarela, no desde la app) y quien conozca el id de una orden puede aprobarla o rechazarla: es aceptable para una simulación, y es una de las cosas que cambia al usar una pasarela real, donde el aviso lo firma el proveedor.
- **Errores del gateway:** token ausente, inválido o vencido → `401` con `{"codigo":"NO_AUTENTICADO", ...}` y `WWW-Authenticate: Bearer`. Si el gateway no tiene la clave pública → `503` con `{"codigo":"AUTH_NO_DISPONIBLE", ...}` (falla cerrado: no deja pasar a nadie). El front, ante un 401, refresca el token una vez y reintenta.
- **Clave pública:** el gateway lee `/etc/nginx/jwt_public.pem` (en `docker-compose.yml`, montada desde `infra/jwt/jwt_public.pem`; la genera el servicio `jwt-claves` del compose si falta, o a mano `infra/jwt/generar-claves.sh`). Solo la pública: la privada no debe estar en el gateway. Si se rotan las claves, hay que reiniciar el gateway.
- Los servicios igual pueden volver a verificar el token (defensa en profundidad), como hace Usuarios.
- `/cocheras/{id}/ocupacion` (Reservas) es interno: Cocheras lo llama directo a `reservas:8000`, no pasa por el gateway.

## 3. REST: Usuarios (`/api/usuarios`)

| Método | Endpoint | Token | Descripción |
|---|---|---|---|
| POST | `/auth/register` | No | Crea un usuario con sus roles y devuelve la sesión |
| POST | `/auth/login` | No | Devuelve access token y refresh token |
| POST | `/auth/refresh` | No | Rota el refresh token y devuelve una sesión nueva |
| POST | `/auth/logout` | No | Revoca ese refresh token |
| POST | `/auth/logout-todos` | Sí (lo verifica Usuarios) | Revoca todas las sesiones del usuario |
| GET | `/users/me` | Sí | Perfil del usuario autenticado |
| PATCH | `/users/me` | Sí | Actualiza nombre y teléfono |
| POST | `/users/me/roles` | Sí | Suma un rol y devuelve un access token con los roles nuevos |
| GET | `/users/{id}` | Sí | Perfil público mínimo: `{ id, nombre }` |
| GET | `/.well-known/jwks.json` | No | Clave pública en formato JWKS (`kid`, `alg: RS256`) |

Cuerpos:

- `POST /auth/register`: `{ "email", "password" (8 a 72 caracteres), "nombre", "telefono"?, "roles"?: ["CONDUCTOR", "PROPIETARIO"] }`. Sin `roles`, `["CONDUCTOR"]`. El email se guarda en minúsculas.
- `POST /auth/login`: `{ "email", "password" }`.
- `POST /auth/refresh` y `POST /auth/logout`: `{ "refreshToken" }`.
- `PATCH /users/me`: `{ "nombre"?, "telefono"? }` (al menos uno; `telefono: null` lo borra).
- `POST /users/me/roles`: `{ "rol": "PROPIETARIO" | "CONDUCTOR" }` → `{ "usuario", "accessToken" }`.

Sesión (respuesta de register, login y refresh):

```json
{
  "accessToken": "eyJ...",
  "refreshToken": "opaco",
  "tokenType": "Bearer",
  "expiresIn": 900,
  "usuario": { "id": "uuid", "email": "...", "nombre": "...", "telefono": null, "roles": ["CONDUCTOR"], "creadoEn": "ISO-8601" }
}
```

- El access token es un JWT RS256 con `sub`, `roles`, `email`, `iss: "parkin-usuarios"`, `iat`, `exp` y `kid` en el header.
- El refresh token es opaco, dura 7 días y sirve **una sola vez**: `/auth/refresh` lo revoca y entrega otro. Si llega uno ya usado, se toma como robo y se revocan todas las sesiones (`401 TOKEN_REUTILIZADO`). Excepción: dentro de los 30 s posteriores a su rotación se acepta, por si el navegador recargó justo durante el refresh. `logout` y `logout-todos` no tienen esa gracia.
- Clientes con varias pestañas: hacer un solo refresh a la vez, o el segundo se toma como reuso.

Errores: `{ "error": { "codigo", "mensaje", "detalles"? } }`.

| Código HTTP | `codigo` | Cuándo |
|---|---|---|
| 401 | `CREDENCIALES_INVALIDAS` | Login con email o contraseña incorrectos (mismo mensaje en los dos casos) |
| 401 | `NO_AUTENTICADO`, `TOKEN_INVALIDO` | Falta el token, o el access o refresh token no es válido o venció |
| 401 | `TOKEN_REUTILIZADO` | Refresh token ya usado fuera de la ventana de gracia |
| 404 | `NO_ENCONTRADO` | Usuario o ruta inexistente |
| 409 | `EMAIL_EN_USO` | Registro con un email existente |
| 422 | `DATOS_INVALIDOS` | Validación; `detalles` trae `[{ campo, mensaje }]` |

`GET /health`, `GET /ready` y `GET /metrics` son internos. `/metrics` responde `404` a lo que llega por el gateway (trae `X-Forwarded-For`); Prometheus lo lee directo.

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
| 409 | `PAGO_EN_CURSO` | La reserva ya tiene un pago **aprobado**. Si hay uno pendiente, no es error: se devuelve ese mismo pago con `200` y su `checkoutUrl` (el usuario cerró la pasarela y volvió a tocar «Pagar») |
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

### Pagos tardíos y reembolsos (implementado)

El contrato original no decía qué pasa si se cobra algo que ya no corresponde. Pagos lo resuelve devolviendo la plata, siempre completa (la política de cancelación todavía no define plazos):

| Situación | Qué hace Pagos |
|---|---|
| La reserva se cancela o expira mientras el pago está `PENDIENTE` | Lo cierra como `RECHAZADO` con `motivo` `reserva_cancelada` o `reserva_expirada` (no publica nada: Reservas ya cerró la reserva) |
| La pasarela aprueba cuando la reserva ya está cancelada, expirada o finalizada | Lo deja `RECHAZADO` con `motivo: reserva_no_vigente`, publica `pago.rechazado` y **reembolsa** |
| La pasarela aprueba un pago que Pagos ya había cerrado por `reserva_cancelada` o `reserva_expirada` (cobro tardío) | **Reembolsa** |
| Se cancela una reserva ya pagada, o expira justo después de que se aprobó el pago | El pago sigue `APROBADO` y se **reembolsa** |

- El reembolso es idempotente por orden. Si la pasarela falla, queda pendiente y Pagos lo reintenta cada 30 s.
- `GET /pagos/{id}` agrega `reembolso: { "estado": "PENDIENTE" | "REEMBOLSADO" }` cuando corresponde.
- Códigos de error que se suman a la tabla de `POST /pagos`: `409 IDEMPOTENCY_KEY_EN_USO` (esa clave ya se usó para otro pago u otra reserva) y `503 PASARELA_NO_DISPONIBLE` (el intento se anula sin avisar a Reservas y la reserva se puede volver a pagar: con **la misma** `Idempotency-Key` el intento se reabre y devuelve el checkout, que es lo que hace el front al reintentar; con otra clave se crea uno nuevo). En `GET /pagos/{id}`: `404 PAGO_NO_ENCONTRADO` y `403 NO_ES_TU_PAGO`. En el webhook: `401 FIRMA_INVALIDA`.
- El webhook devuelve `200 { "resultado": ... }` con `aprobado`, `rechazado`, `repetido`, `reembolso`, `desconocido` (referencia que no existe) o `no_coincide` (monto, moneda u orden distintos a los del pago; no se toca el pago).
- Un pago por reserva: como máximo uno `PENDIENTE` o `APROBADO` a la vez (índice único parcial). Los pedidos de pago de una misma reserva se serializan, así que 20 clics simultáneos, aunque lleven claves distintas, crean un solo pago y una sola orden en la pasarela.

### Avisos por WebSocket: a quién (implementado)

Igual que en la tabla de la sección 8, con una precisión: `reserva:cancelada` le llega al propietario **solo si la reserva había llegado a confirmarse** (si nunca se confirmó, el propietario no sabía de ella). El payload de `reserva:cancelada` y `reserva:expirada` lleva `motivo` tal como lo publica Reservas.

### Pasarela simulada: API (implementado)

Servicio `pasarela-mock` (`PORT`, por defecto 8090). Sin dependencias; el estado vive en memoria.

| Método | Ruta | Qué hace |
|---|---|---|
| POST | `/ordenes` | `{ referencia, monto, moneda, webhookUrl }` → `{ idExterno, checkoutUrl }`. Idempotente por `referencia` |
| GET | `/checkout/{idExterno}` | Página con los botones **Aprobar** y **Rechazar** |
| POST | `/checkout/{idExterno}/resultado` | `{ estado: "approved" \| "rejected", motivo? }`: resuelve la orden (una sola vez; después `409`) y llama al webhook firmado, con 4 intentos |
| POST | `/ordenes/{idExterno}/reembolso` | Idempotente; solo órdenes aprobadas |

- Variables: `PASARELA_WEBHOOK_SECRET` (el mismo en Pagos y en la pasarela) y `PASARELA_PUBLIC_URL`, la URL que ve el **navegador** para abrir el checkout (por defecto `http://localhost:8090`).
- Variables de Pagos: `JWT_PUBLIC_KEY_PATH` (clave pública para verificar los tokens), `PASARELA_URL`, `PASARELA_WEBHOOK_SECRET`, `PAGOS_WEBHOOK_URL`, `RABBITMQ_URL` y `REDIS_URL`.
- Pagos verifica el JWT por su cuenta (no solo confía en el gateway), porque el WebSocket manda el token en el handshake.

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

### Payload de `datos` (propuesta de Reservas; Pagos de acuerdo, falta Cocheras)

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
