# Servicio de Pagos y Notificaciones

Sección del documento final. Describe lo que está implementado en `pagos/` y en la pasarela simulada `pasarela-mock/`. Lo provisorio o pendiente está en la sección 13.

## 1. Responsabilidad

Pagos cobra las reservas y avisa en tiempo real a conductores y propietarios. Inicia el cobro en la pasarela, recibe el resultado por webhook, publica `pago.aprobado` o `pago.rechazado` para que Reservas confirme o cancele, y devuelve la plata cuando se cobró algo que ya no corresponde. No decide sobre las reservas: solo Reservas cambia su estado.

| | |
|---|---|
| Lenguaje y framework | Node.js 20 + Express 4 |
| Base de datos | PostgreSQL (propia, `db-pagos`) |
| Acceso a datos | `pg` con pool, SQL explícito, migraciones `.sql` numeradas con `pg_advisory_lock` |
| Mensajería | RabbitMQ con `amqplib` |
| Tiempo real | Socket.IO con adaptador de Redis |
| Autenticación | Verifica el JWT RS256 de Usuarios con la clave pública (`jsonwebtoken`) |
| Logs, métricas y trazas | `pino` (JSON a stdout), `prom-client`, OpenTelemetry exportado a Jaeger |

## 2. API

Todo pasa por el gateway: el cliente llama `/api/pagos/...` y el servicio recibe `/pagos/...`.

| Método | Endpoint | Descripción |
|---|---|---|
| POST | `/pagos` | Inicia el pago de una reserva y devuelve la `checkoutUrl`. Exige JWT y header `Idempotency-Key` (UUID) |
| GET | `/pagos/{id}` | Estado del pago (solo su conductor); incluye `motivo` si fue rechazado y `reembolso` si corresponde |
| POST | `/pagos/webhook` | Resultado de la pasarela. Sin JWT: se autentica con firma HMAC |
| WS | `/ws` | Avisos en tiempo real (Socket.IO); el JWT va en el handshake |
| GET | `/health`, `/ready`, `/metrics` | Proceso vivo; base, consumidor y publicador conectados; métricas Prometheus |

El cliente manda solo `{ reservaId }`: **el monto no lo elige el cliente**. Se cobra el que calculó Reservas (precio por hora × duración), que llega en el evento `reserva.creada`.

| Código | `codigo` | Cuándo |
|---|---|---|
| `201` / `200` | — | Pago nuevo / pago que ya existía (misma clave, o un pendiente de la misma reserva) |
| `401` | `NO_AUTENTICADO`, `TOKEN_INVALIDO` | Sin token o token inválido |
| `403` | `NO_ES_TU_RESERVA`, `NO_ES_TU_PAGO` | La reserva o el pago son de otro usuario |
| `404` | `RESERVA_DESCONOCIDA` | Todavía no llegó `reserva.creada`; el front reintenta |
| `409` | `RESERVA_NO_PAGABLE`, `PAGO_EN_CURSO`, `IDEMPOTENCY_KEY_EN_USO` | La reserva ya no está pendiente o venció; ya hay un pago aprobado o en curso para esa reserva; la clave se usó para otra cosa |
| `422` | `DATOS_INVALIDOS` | Falta `reservaId` o `Idempotency-Key`, o no son UUID |
| `503` | `PASARELA_NO_DISPONIBLE` | La pasarela no respondió; la reserva se puede volver a pagar |

## 3. Datos

| Tabla | Contenido |
|---|---|
| `pago` | `id`, `reserva_id`, `usuario_id`, `monto`, `estado` (`PENDIENTE`, `APROBADO`, `RECHAZADO`), `id_externo` (UNIQUE, id de la orden en la pasarela), `idempotency_key` (UNIQUE), `checkout_url`, `motivo_rechazo`, datos del reembolso |
| `reserva_local` | Copia de las reservas armada con los eventos `reserva.*`: conductor, propietario, monto, estado y vencimiento |
| `evento_procesado` | `eventId` de cada evento consumido (idempotencia) |
| `evento_saliente` | Outbox: eventos `pago.*` esperando ser publicados |

**Database per service.** Pagos nunca consulta la base ni la API de Reservas. Todo lo que necesita para cobrar (quién es el conductor, cuánto cobrar, hasta cuándo) lo guarda en `reserva_local` a partir de los eventos. Por eso, si Reservas está caída, un conductor igual puede pagar una reserva que ya existe.

La copia local nunca retrocede: cada estado tiene un orden (`PENDIENTE_PAGO` < `CONFIRMADA` < `CANCELADA`/`EXPIRADA` < `FINALIZADA`) y el upsert solo actualiza si el estado nuevo es posterior. Un evento atrasado o repetido no puede revivir una reserva cancelada. `FINALIZADA` está prevista en el orden, pero Reservas todavía no publica `reserva.finalizada`, así que hoy Pagos nunca la recibe.

## 4. Flujo de un pago

```mermaid
sequenceDiagram
    participant C as Conductor (web)
    participant G as Gateway
    participant P as Pagos
    participant M as Pasarela
    participant Q as RabbitMQ
    participant R as Reservas

    R->>Q: reserva.creada (monto, conductor, expiraEn)
    Q->>P: copia en reserva_local
    C->>G: POST /api/pagos { reservaId } + Idempotency-Key
    G->>P: POST /pagos (JWT verificado)
    P->>M: crear orden (referencia = pagoId, monto)
    M-->>P: idExterno + checkoutUrl
    P-->>C: 201 { pagoId, checkoutUrl }
    C->>M: abre el checkout y paga
    M->>P: POST /pagos/webhook (firma HMAC)
    P->>P: pago APROBADO + pago.aprobado en el outbox (una transacción)
    P->>Q: pago.aprobado (publisher confirm)
    Q->>R: reserva CONFIRMADA
    R->>Q: reserva.confirmada
    Q->>P: aviso por WebSocket
    P-->>C: reserva:confirmada (conductor y propietario)
```

Es una **saga coreografiada**: no hay transacción que abarque los dos servicios. Si el pago se rechaza, Pagos publica `pago.rechazado` y Reservas compensa cancelando la reserva y liberando la franja. Si el conductor no paga en 10 minutos, Reservas expira la reserva y Pagos anula el pago pendiente.

## 5. No cobrar dos veces

El riesgo en Pagos es el espejo de la doble reserva: que una misma reserva termine con dos cobros. Puede pasar si el conductor toca dos veces "Pagar", si la red reintenta, o si se abren dos pestañas.

1. **Un pago vivo por reserva.** Dentro de la transacción de `POST /pagos` se toman dos `pg_advisory_xact_lock`: uno por la `Idempotency-Key` y otro por la reserva. Los pedidos simultáneos de una misma reserva hacen fila aunque traigan claves distintas. El primero crea el pago; los demás encuentran ese pago pendiente y devuelven **el mismo pago con la misma `checkoutUrl`** (`200`), en lugar de un error. Es lo que espera el front cuando el usuario cerró la pasarela y vuelve a tocar "Pagar".
2. **Red de seguridad en la base.** Un índice único parcial impide dos pagos vivos aunque fallara el bloqueo:
   ```sql
   CREATE UNIQUE INDEX pago_un_activo_por_reserva ON pago (reserva_id)
     WHERE estado IN ('PENDIENTE', 'APROBADO');
   ```
3. **`Idempotency-Key`.** Repetir la misma clave devuelve el mismo pago. Usarla para otra reserva u otro usuario da `409 IDEMPOTENCY_KEY_EN_USO`.
4. **La orden en la pasarela se crea fuera de la transacción.** Una llamada HTTP no puede quedar reteniendo locks de la base. Si la pasarela no responde, se anula solo ese intento (`503`, sin avisar a Reservas) y la reserva se puede volver a pagar. Si el front reintenta con la misma clave, el intento se reabre.

**Evidencia** (a través del gateway): 10 "Pagar" simultáneos con claves distintas sobre la misma reserva producen **un solo pago**: un `201` y nueve `200` con el mismo `pagoId`.

## 6. Webhook de la pasarela

**Autenticidad.** El webhook no lleva JWT: lo llama la pasarela, no una persona. La pasarela firma el **cuerpo crudo** con HMAC-SHA256 y un secreto compartido (`PASARELA_WEBHOOK_SECRET`), y manda la firma en `X-Firma`. Pagos lee el cuerpo como bytes antes de parsear el JSON, porque reformatearlo cambiaría la firma, y compara en tiempo constante (`timingSafeEqual`). Sin firma válida: `401 FIRMA_INVALIDA`, y el pago no se toca.

**Integridad.** Aunque la firma sea válida, el aviso tiene que coincidir con el pago registrado: mismo monto, misma moneda y misma orden. Si no coincide, se registra como error y no se cambia nada.

**Idempotencia.** Las pasarelas reintentan sus avisos. El pago se lee con `FOR UPDATE` y solo el primer aviso de un pago `PENDIENTE` cambia su estado y encola el evento; los siguientes devuelven `200 { resultado: "repetido" }` para que la pasarela deje de reintentar. El webhook responde `200` con el resultado (`aprobado`, `rechazado`, `repetido`, `reembolso`, `desconocido`, `no_coincide`) siempre que la firma sea válida.

**Outbox.** El cambio de estado del pago y el evento `pago.aprobado` o `pago.rechazado` se guardan en la **misma transacción**. Un publicador aparte lee `evento_saliente` y publica con *publisher confirms* y `mandatory`. Solo marca el evento como publicado cuando el broker lo confirma. Si RabbitMQ está caído, los eventos esperan y salen cuando vuelve. `FOR UPDATE SKIP LOCKED` permite varias réplicas publicando sin pisarse.

## 7. Reembolsos

Hay dos casos en los que se cobra algo que ya no corresponde, y en los dos se devuelve la plata:

| Caso | Qué pasa |
|---|---|
| **Cobro tardío.** El conductor paga después de que la reserva se canceló o expiró (la página de la pasarela seguía abierta) | El aviso aprobado llega con la reserva cerrada: el pago queda `RECHAZADO` con motivo `reserva_no_vigente`, se publica `pago.rechazado` y se pide el reembolso |
| **Cancelación después de pagar.** Llega `reserva.cancelada` de una reserva con pago aprobado | Se marca el pago como pendiente de reembolso y se pide a la pasarela |

El reembolso es idempotente en la pasarela. Si la pasarela falla, el pago queda con `reembolso_pendiente` y un proceso periódico (cada 30 s) lo reintenta. `GET /pagos/{id}` muestra `reembolso: { estado: "PENDIENTE" | "REEMBOLSADO" }`.

**Evidencia:** se pagó una reserva ya cancelada. El pago terminó con `reembolso: REEMBOLSADO` y la reserva siguió `CANCELADA`, sin revivir.

## 8. Eventos

| Evento | Dirección | Efecto en Pagos |
|---|---|---|
| `reserva.creada` | consume | Crea la copia local: desde ahí la reserva se puede pagar |
| `reserva.confirmada` | consume | Aviso `reserva:confirmada` al conductor y al propietario |
| `reserva.cancelada` | consume | Anula el pago pendiente o reembolsa el aprobado; aviso al conductor (y al propietario si estaba confirmada) |
| `reserva.expirada` | consume | Anula el pago pendiente; aviso al conductor |
| `pago.aprobado` | publica | Reservas confirma la reserva |
| `pago.rechazado` | publica | Reservas cancela la reserva y libera la franja (compensación de la saga) |

**Consumo idempotente.** Cola `pagos.reserva-eventos`, durable, *quorum*, ACK manual y prefetch 10. Cada evento se procesa en una transacción que primero registra su `eventId` en `evento_procesado`; si ya estaba, se descarta. Un error transitorio reencola el mensaje (`nack` con `requeue`), y tras 3 entregas va a la Dead Letter Queue `cocheras.dlq`. Un mensaje que nunca se va a poder procesar (JSON roto o fuera de contrato) va directo a la DLQ. Los avisos y los reembolsos se disparan después de confirmar la transacción, para no avisar algo que se deshizo.

El consumidor y el publicador se reconectan solos si RabbitMQ se cae, y `/ready` responde `503` mientras alguno esté desconectado.

## 9. Notificaciones en tiempo real

Socket.IO sobre WebSocket en `/ws`, a través del gateway.

- **Autenticación.** El token viaja en el handshake (`auth.token`), no en un header, así que lo verifica el propio Pagos al conectar con la clave pública de Usuarios. Sin token válido, la conexión se rechaza con `connect_error: TOKEN_INVALIDO` y el front refresca el token y reconecta.
- **Salas.** Cada socket entra a `user:{id}`. Los avisos se emiten a la sala del destinatario, así que un usuario nunca recibe avisos de reservas ajenas, y si tiene varias pestañas abiertas le llegan a todas.
- **Varias réplicas.** El adaptador de Redis reparte cada aviso entre réplicas: llega aunque el cliente esté conectado a otra instancia de Pagos.
- **Sin Redis.** Si Redis no responde al arrancar, Pagos espera 5 segundos y arranca igual sin el adaptador, con un `warn` en el log. Con una sola réplica los avisos llegan igual; con varias, solo les llegan a los clientes conectados a la misma réplica, y el resto se entera por la consulta de respaldo de la web. Antes, Pagos se quedaba esperando a Redis y nunca abría el puerto.
- **Best effort.** Si un aviso se pierde (el usuario estaba desconectado), no se pierde información: la fuente de verdad sigue siendo `GET /api/reservas/{id}`.

| Evento | Destinatarios | Payload |
|---|---|---|
| `reserva:confirmada` | conductor y propietario | `{ reservaId, cocheraId, desde, hasta }` |
| `reserva:cancelada` | conductor (y propietario si estaba confirmada) | `{ reservaId, cocheraId, motivo }` |
| `reserva:expirada` | conductor | `{ reservaId, cocheraId, motivo }` |
| `pago:rechazado` | conductor | `{ reservaId, pagoId, motivo }` |

**Evidencia** (a través del gateway): al aprobar un pago, `reserva:confirmada` llegó al conductor y al propietario. Al rechazar otro, `pago:rechazado` llegó al conductor con motivo `fondos_insuficientes`. Un token falso recibe `TOKEN_INVALIDO`.

## 10. Pasarela simulada

`pasarela-mock` imita el flujo de Mercado Pago para la demo, sin depender de internet ni de credenciales:

| Método | Endpoint | Quién lo usa |
|---|---|---|
| POST | `/ordenes` | Pagos, al iniciar el pago. Idempotente por `referencia` (el `pagoId`) |
| GET | `/checkout/{idExterno}` | El navegador: página con **Aprobar** y **Rechazar** |
| POST | `/checkout/{idExterno}/resultado` | La página o las pruebas: resuelve la orden una sola vez y llama al webhook firmado (4 intentos) |
| POST | `/ordenes/{idExterno}/reembolso` | Pagos, para devolver la plata. Idempotente |

Para usar Mercado Pago real se reemplaza solo `pagos/src/pasarela.js`, que crea la orden y reembolsa: las rutas, el webhook y la saga no cambian. El gateway publica únicamente la página de checkout (`/pasarela/checkout/...`); crear órdenes y reembolsar no se expone (`404`).

## 11. Observabilidad

**Logs.** JSON a stdout con `servicio`, `nivel` y `traceId`, más `reservaId`, `pagoId` y `usuarioId` donde corresponde. Se eliminan `authorization`, cookies, contraseñas, tokens y datos de tarjeta. El `traceId` viaja en el `traceparent` hacia la pasarela y dentro de cada evento `pago.*`.

**Métricas** (`GET /metrics`):

| Métrica | Qué mide |
|---|---|
| `pagos_creados_total`, `pagos_aprobados_total`, `pagos_rechazados_total{motivo}` | Embudo de pagos |
| `pagos_webhooks_total{resultado}` | Avisos de la pasarela: `aprobado`, `repetido`, `no_coincide`, etc. |
| `pagos_reembolsos_total{resultado}` | Reembolsos `ok` o `error` |
| `pagos_eventos_procesados_total{tipo,resultado}`, `pagos_eventos_publicados_total` | Eventos consumidos y publicados |
| `pagos_outbox_pendientes` | Eventos esperando ser publicados (crece si RabbitMQ está caído) |
| `pagos_sockets_conectados` | Conexiones WebSocket abiertas |
| `pagos_http_requests_total`, `pagos_http_request_duration_seconds` | Requests y latencia |

**Alertas** (`infra/prometheus/alertas.yml`): más del 2 % de respuestas `5xx`, más de 100 eventos atascados en el outbox, y más de 3 reembolsos fallidos en 10 minutos.

**Trazas.** OpenTelemetry exportado a Jaeger, con la misma receta que Cocheras y Usuarios (`src/telemetria.js`, cargado con `node --import`; sin `OTEL_EXPORTER_OTLP_ENDPOINT` no hace nada). Se instrumentan las requests, las consultas SQL hechas dentro de una request o de un evento, la llamada a la pasarela y los avisos por Socket.IO y Redis. Las consultas de la migración, el outbox vacío y el reintento de reembolsos cada 30 s no generan trazas.

Pagos es el punto donde la saga cambiaba de traza, por dos motivos, y los dos se resolvieron:

- **Los eventos traen el `traceId` en el cuerpo, no en headers AMQP.** Los spans `procesar reserva.*` y `publicar pago.*` se crean a mano (`src/trazas.js`), colgados de ese `traceId`, igual que en Cocheras. Por eso la instrumentación automática de `amqplib` está apagada.
- **El aviso de la pasarela llega sin `traceparent`**, mucho después y desde otro sistema. Al crear el pago se guarda el `traceId` de la request en `pago.trace_id`. Al llegar el webhook, el span `procesar aviso de la pasarela` y el evento `pago.aprobado` o `pago.rechazado` se cuelgan de ese `traceId`. Así lo que pasa después en Reservas, Cocheras y el WebSocket queda en la traza del "Pagar".

**Evidencia** (todo por el gateway, consultando la API de Jaeger):

| Traza | Spans por servicio |
|---|---|
| **Reservar** | Reservas: `POST /reservas`, consultas, `publicar reserva.creada`. Cocheras: la query GraphQL del precio. Pagos: `procesar reserva.creada` y sus consultas |
| **Pagar** | Pagos: `POST`, llamada a la pasarela, `procesar aviso de la pasarela`, `publicar pago.aprobado`, `procesar reserva.confirmada`, aviso por Socket.IO y Redis. Reservas: `procesar pago.aprobado`, `publicar reserva.confirmada`. Cocheras: `procesar reserva.confirmada` |

Son dos trazas porque son dos acciones del conductor: reservar y pagar. Cada una queda completa en todos los servicios que toca.

## 12. Pruebas

**Automáticas.** `npm test` corre 61 tests contra un PostgreSQL real, porque los bloqueos y los índices únicos son parte de lo que se prueba (`TEST_DATABASE_URL=postgres://app:app@localhost:5444/pagos_test npm test`). Cubren la API y sus errores, los pagos concurrentes, la firma HMAC, el webhook repetido y adulterado, los eventos fuera de orden y repetidos, el outbox y el WebSocket, también con Redis caído. Resultado: 61 de 61.

**De punta a punta** (todo el sistema con `docker compose up`, todo a través del gateway):

| Caso | Resultado |
|---|---|
| Pagar una reserva | `201`, monto calculado por Reservas (2 h × $80 = $160) |
| Pagar la reserva de otro | `403` |
| Volver a tocar "Pagar" | `200`, mismo pago y misma `checkoutUrl` |
| Aprobar en la pasarela | Reserva `CONFIRMADA`; aviso a conductor y propietario |
| Rechazar en la pasarela | Reserva `CANCELADA` (franja liberada); aviso `pago:rechazado` |
| Resolver dos veces en la pasarela | `409` |
| Pagar una reserva ya cancelada | Reembolso automático; la reserva no revive |
| 10 "Pagar" simultáneos | Un solo pago |
| Webhook sin firma | `401 FIRMA_INVALIDA` |
| WebSocket con token falso | `TOKEN_INVALIDO` |

### Capturas del flujo

Tomadas con el sistema levantado con `docker compose up`, en el front (`localhost:8081`), la pasarela simulada y Jaeger.

**1. El conductor tiene la reserva retenida y 10 minutos para pagar.**

![Reserva retenida con cuenta regresiva y botón Pagá](../capturas/pago-02-reserva-pendiente.png)

**2. La pasarela de prueba.** El monto lo calculó Reservas (2 h × $90; es otra cochera que la de la tabla de arriba); el conductor elige cómo termina el pago.

![Pasarela de prueba con Aprobar y Rechazar](../capturas/pago-01-pasarela-checkout.png)

**3. Pago aprobado: el aviso llega en vivo por WebSocket.** La reserva pasa a `CONFIRMADA` sin recargar la página, y recién ahí se muestra la dirección exacta.

![Aviso "Tu reserva está confirmada" y la dirección exacta](../capturas/pago-03-aviso-reserva-confirmada.png)

**4. Pago rechazado: la saga compensa.** Llegan los avisos `pago:rechazado` y `reserva:cancelada`, y la franja se libera.

![Avisos de pago rechazado y reserva cancelada](../capturas/pago-04-aviso-pago-rechazado.png)

**5. La pasarela no deja resolver dos veces la misma orden.**

![Orden ya rechazada en la pasarela](../capturas/pago-05-pasarela-resuelta.png)

**6. La saga completa en una sola traza de Jaeger.** Pagos recibe el "Pagar" y, cuando llega el aviso de la pasarela, publica `pago.aprobado`. Reservas lo procesa y publica `reserva.confirmada`. Pagos manda los avisos por WebSocket (`send`, vía Redis) y Cocheras invalida su caché. Son 3 servicios y 46 spans.

![Traza de la saga del pago en Jaeger](../capturas/pago-06-jaeger-saga-del-pago.png)

## 13. Provisorio o pendiente

- **Padre desconocido en Jaeger.** Los spans que se cuelgan de un `traceId` suelto (eventos y webhook) no conocen el span padre, porque solo viaja el `traceId`. Jaeger los muestra en la traza correcta con el aviso "invalid parent span", igual que en Cocheras y Reservas. Mandar el `traceparent` completo en los eventos lo resolvería, pero cambia el contrato de los tres servicios.
- **Pasarela simulada.** Guarda las órdenes en memoria (si se reinicia, se pierden), y quien conozca el id de una orden puede aprobarla o rechazarla desde la página. Es aceptable para una simulación. Con una pasarela real el resultado lo decide el proveedor y lo firma él.
- **Moneda única.** Todo se cobra en UYU, como lo calcula Reservas.
- **Redis que vuelve.** Si Pagos arrancó sin Redis, no suma el adaptador cuando Redis vuelve: hay que reiniciar Pagos. Con una sola réplica no cambia nada.
