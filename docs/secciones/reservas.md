# Servicio de Reservas

Sección del documento final. Describe lo que está implementado en `reservas/`. Lo que todavía no se verificó o es provisorio está marcado en la sección 9.

## 1. Responsabilidad

Reservas crea reservas, retiene la franja horaria mientras se paga, confirma, cancela y expira. Es el único dueño de la regla central del sistema: **una cochera no puede tener dos reservas activas con franjas que se solapen**. Ningún otro servicio escribe en su base; se comunica con Pagos y Cocheras solo por API o por eventos.

| | |
|---|---|
| Lenguaje y framework | Python 3.12 + FastAPI |
| Base de datos | PostgreSQL (propia, `db_reservas`) |
| Acceso a datos | psycopg 3 con pool de conexiones, SQL explícito |
| Mensajería | RabbitMQ con `pika` |
| Contenedor | Dockerfile propio (`python:3.12-slim`, uvicorn) |

## 2. API

| Método | Endpoint | Descripción |
|---|---|---|
| POST | `/reservas` | Crea la reserva en `PENDIENTE_PAGO`. Exige header `Idempotency-Key` |
| GET | `/reservas/{id}` | Estado de una reserva; solo la ven su conductor y su propietario |
| GET | `/reservas?rol=conductor\|propietario` | Reservas del usuario según su rol |
| POST | `/reservas/{id}/cancelar` | Cancela una reserva activa que todavía no empezó |
| GET | `/cocheras/{id}/ocupacion?desde&hasta` | Franjas ocupadas, para la búsqueda de Cocheras. No expone datos de personas |
| GET | `/health`, `/ready` | Proceso vivo; base (y RabbitMQ, si está configurado) alcanzables |

Códigos: `201` reserva creada, `200` al repetir una `Idempotency-Key`, `409` franja ocupada o transición inválida, `422` datos inválidos, `404` reserva inexistente o ajena.

## 3. Ciclo de vida de una reserva

```mermaid
stateDiagram-v2
    [*] --> PENDIENTE_PAGO: POST /reservas
    PENDIENTE_PAGO --> CONFIRMADA: pago.aprobado
    PENDIENTE_PAGO --> CANCELADA: pago.rechazado o cancelación del usuario
    PENDIENTE_PAGO --> EXPIRADA: 10 minutos sin pago
    CONFIRMADA --> CANCELADA: cancelación del usuario
    CONFIRMADA --> FINALIZADA: terminó la franja
```

Solo las reservas en `PENDIENTE_PAGO` y `CONFIRMADA` ocupan la franja. Cualquier otra transición se rechaza. Cada cambio de estado queda registrado en la tabla `reserva_historial`, como auditoría.

> `FINALIZADA` la marca el mismo proceso periódico de la sección 8, una vez que termina la franja de una reserva confirmada. No publica evento: `reserva.finalizada` se agregará junto con su primer consumidor (las calificaciones), porque sin una cola enlazada el mensaje no tendría a dónde ir.

## 4. Concurrencia: por qué no puede haber una doble reserva

**El problema.** Verificar en código "¿está libre? entonces inserto" falla con concurrencia: dos requests consultan al mismo tiempo, las dos ven la franja libre y las dos insertan. Un lock en memoria tampoco sirve, porque con varias réplicas del servicio cada una tiene su propia memoria.

**La solución.** La regla vive en el único lugar que todas las réplicas comparten, la base de datos, como una restricción de exclusión de PostgreSQL:

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE reserva (
    id           UUID PRIMARY KEY,
    cochera_id   UUID NOT NULL,
    franja       TSTZRANGE NOT NULL,
    estado       TEXT NOT NULL,
    -- ...
    EXCLUDE USING gist (cochera_id WITH =, franja WITH &&)
        WHERE (estado IN ('PENDIENTE_PAGO', 'CONFIRMADA'))
);
```

Si dos conductores insertan reservas solapadas al mismo tiempo, la base acepta la primera y rechaza la segunda. El servicio traduce ese error a `409 Conflict`. Las reservas canceladas o expiradas quedan fuera de la restricción, así que liberan la franja automáticamente. Las franjas son rangos semiabiertos `[desde, hasta)`: una reserva de 14 a 16 y otra de 16 a 18 no se solapan.

**Altas simultáneas de una misma cochera.** La restricción de exclusión garantiza que no haya doble reserva, pero con PostgreSQL real tenía un efecto colateral: dos `INSERT` concurrentes sobre la misma cochera pueden esperarse mutuamente mientras verifican la restricción, y la base aborta uno por *deadlock*. La reserva nunca se duplicaba, pero el cliente recibía un `500` (con 10 solicitudes simultáneas se vio hasta en 9 de 10). Se resolvió en dos capas:

1. **Lock por cochera** (`pg_advisory_xact_lock` sobre el id de la cochera, dentro de la transacción de alta). Las altas de una misma cochera hacen fila: la primera confirma y las demás reciben la violación de exclusión (`409`), sin esperarse en cruz. Las cocheras distintas no se bloquean entre sí.
2. **Reintento** de la transacción completa ante `DeadlockDetected` o `SerializationFailure` (hasta 3 veces, con una pequeña espera aleatoria). En el reintento el ganador ya confirmó, y la solicitud recibe `409`. Si se agotan los intentos responde `503` con `Retry-After: 1`. Se cuenta en `reservas_reintentos_transaccion_total`.

Con solo el reintento no alcanzaba: en una prueba contra PostgreSQL 16, de 250 solicitudes 18 igual terminaron en `503`, porque las víctimas que reintentan juntas vuelven a chocar. Con el lock, en 3000 solicitudes (300 rondas de 10 simultáneas) y 2400 (60 rondas de 40) hubo exactamente un `201` por ronda y ningún `500` ni `503`, sin necesitar reintentos.

**Evidencia.** El test de concurrencia lanza 30 requests simultáneos sobre la misma cochera y franja: exactamente uno recibe `201` y los otros 29 reciben `409`, y la base queda con una sola reserva.

## 5. Idempotencia y control optimista

Las redes reintentan: el conductor puede tocar dos veces "Reservar", o la app reenviar por un timeout.

- **`Idempotency-Key`.** `POST /reservas` exige el header. Una segunda llamada con la misma clave devuelve la reserva ya creada (`200`) en lugar de crear otra. Si la clave pertenece a otro usuario, devuelve `409`. La columna tiene restricción `UNIQUE`, de modo que si dos requests con la misma clave llegan a la vez, gana el primero y el segundo recibe la misma reserva. Test: 20 requests simultáneos con la misma clave producen una sola reserva.
- **Control optimista.** Cada reserva tiene una columna `version`. Cancelar hace `UPDATE … WHERE id = ? AND version = ?`, así que si otra operación la cambió entre la lectura y la escritura, no se modifica nada. Test: 10 cancelaciones simultáneas de la misma reserva, una sola se aplica y las otras 9 reciben `409`.
- **Integridad.** Una reserva confirmada no se edita: solo puede pasar a `CANCELADA` o `FINALIZADA`, y siempre dejando historial.

## 6. Comunicación entre servicios

### 6.1 Consulta síncrona a Cocheras

Para crear una reserva, Reservas necesita dos datos que **no** puede aceptar del cliente: el propietario y el precio. Los pide a Cocheras con una query GraphQL (`cochera(id) { propietario { id } precioHora }`) y calcula el monto como `precioHora × horas de la franja`. Es una llamada síncrona porque el conductor espera la respuesta y la reserva no puede crearse sin esos datos; por eso tiene timeout de 3 segundos.

- Si la cochera no existe, responde `404`; si Cocheras no responde o devuelve un error, `503` y no se crea nada.
- Un reintento con la misma `Idempotency-Key` no consulta a Cocheras, así que sigue funcionando aunque esté caída.
- Hay una dependencia en las dos direcciones: Cocheras consulta la ocupación a Reservas (y tolera que falle, devolviendo la búsqueda sin filtrar), mientras que Reservas **no** puede crear reservas sin Cocheras.

### 6.2 Eventos

Reservas publica y consume eventos en el exchange `topic` `cocheras.eventos`.

| Evento | Dirección | Efecto |
|---|---|---|
| `reserva.creada` | publica | Pagos queda listo para cobrar |
| `reserva.confirmada` | publica | Aviso en tiempo real; Cocheras invalida su caché |
| `reserva.cancelada` | publica | Reembolso si corresponde; aviso; caché. Con `motivo`: `cancelada_por_usuario` o `pago_rechazado` |
| `reserva.expirada` | publica | Aviso al conductor. `motivo`: `plazo_vencido` |
| `pago.aprobado` | consume | La reserva pasa a `CONFIRMADA` |
| `pago.rechazado` | consume | La reserva pasa a `CANCELADA` y libera la franja |

El formato de cada mensaje y su payload están en [`contratos.md`](../contratos.md).

### 6.3 Outbox transaccional

**El problema.** Si el servicio guarda la reserva en la base y después publica en RabbitMQ, un fallo entre los dos pasos deja un estado inconsistente: una reserva sin evento (Pagos nunca cobra) o un evento de una transacción que se revirtió.

**La solución.** El evento se escribe en la tabla `outbox` **en la misma transacción** que el cambio de estado. Un hilo aparte lee el outbox y publica con *publisher confirms*; solo marca el evento como publicado cuando el broker lo confirma.

```mermaid
flowchart LR
    API[POST /reservas] -->|una transacción| DB[(reserva + outbox)]
    DB --> PUB[Publicador]
    PUB -->|publisher confirm| MQ[(RabbitMQ)]
    MQ --> PAG[Pagos]
    PAG -->|pago.aprobado / rechazado| MQ
    MQ --> CON[Consumidor]
    CON -->|una transacción| DB
```

- Si RabbitMQ está caído, los eventos esperan en el outbox y salen cuando vuelve.
- Se publica con `mandatory`: si ninguna cola recibe el mensaje, se reintenta en lugar de perderlo en silencio.
- Con varias réplicas, `SELECT … FOR UPDATE SKIP LOCKED` evita que dos publicadores tomen el mismo evento.
- La entrega es *at-least-once*: un evento puede publicarse más de una vez, por eso todos los consumidores son idempotentes.

### 6.4 Consumo idempotente

Al recibir `pago.aprobado` o `pago.rechazado`, el consumidor hace en **una sola transacción**: registrar el `eventId` en `evento_procesado`, cambiar el estado, anotar el historial y encolar el evento de salida. Si el `eventId` ya estaba registrado, el mensaje se descarta. Si algo falla, nada queda a medias y el reintento vuelve a procesarlo completo.

Garantías configuradas: cola durable, ACK manual, prefetch 10, cola *quorum* con `x-delivery-limit: 3` y Dead Letter Queue `cocheras.dlq`. Un error transitorio reencola el mensaje; un mensaje inválido va directo a la DLQ. La topología se crea al arrancar RabbitMQ desde `infra/rabbitmq/definitions.json`.

## 7. Saga de reserva y pago

Reserva y pago viven en servicios y bases distintas, por lo que no hay una transacción ACID que los abarque. Se usa una **saga coreografiada**: cada paso es una transacción local que publica un evento, y si un paso falla se ejecuta una acción compensatoria (cancelar la reserva y liberar la franja).

```mermaid
sequenceDiagram
    participant C as Conductor
    participant R as Reservas
    participant Q as RabbitMQ
    participant P as Pagos

    C->>R: POST /reservas (Idempotency-Key)
    R->>R: Inserta PENDIENTE_PAGO (restricción de exclusión)
    R-->>C: 201
    R->>Q: reserva.creada
    Q->>P: reserva.creada
    alt Pago aprobado
        P->>Q: pago.aprobado
        Q->>R: pago.aprobado
        R->>R: CONFIRMADA
        R->>Q: reserva.confirmada
    else Pago rechazado (compensación)
        P->>Q: pago.rechazado
        Q->>R: pago.rechazado
        R->>R: CANCELADA, la franja queda libre
        R->>Q: reserva.cancelada
    else Plazo vencido (compensación)
        R->>R: EXPIRADA a los 10 minutos
        R->>Q: reserva.expirada
    end
```

Un conflicto al reservar (`409`) se corta antes de publicar nada, así que no hay nada que deshacer.

## 8. Retención, expiración y finalización

Al crear la reserva, la franja queda retenida 10 minutos (`expira_en`). Un proceso interno corre al arrancar y luego cada 60 segundos: pasa a `EXPIRADA` las reservas vencidas sin pago y publica `reserva.expirada`. Así, quien abandona el checkout no bloquea la cochera indefinidamente.

- Con varias réplicas, `SKIP LOCKED` hace que cada una tome reservas distintas.
- Si justo llega un `pago.aprobado` para una reserva que se está expirando, el bloqueo de fila decide quién va primero: la reserva termina confirmada o expirada, nunca ambas y con un solo evento de cierre. Hay un test con 20 reservas en esa carrera.
- El mismo proceso pasa a `FINALIZADA` las reservas `CONFIRMADA` cuya franja ya terminó. Una reserva confirmada no puede cancelarse una vez comenzada, por lo que esa transición no compite con la cancelación.
- No se aceptan reservas con `desde` en el pasado (`422`).
- Como el proceso corre cada 60 segundos, una reserva puede seguir bloqueando la franja hasta un minuto después de su vencimiento. Es una demora aceptada.

## 9. Decisiones, límites y estado de lo que estaba pendiente

Para ser honestos en la defensa, esto es lo que se resolvió desde la primera versión y lo que sigue siendo un límite:

| Tema | Estado |
|---|---|
| Identidad del usuario | **Resuelto.** El gateway valida el JWT (RS256, con la clave pública) y pone `X-User-Id`, que siempre pisa lo que mande el cliente. Reservas confía en ese header. **Límite:** por eso Reservas solo debe ser accesible a través del gateway; el compose publica su puerto 8000 para desarrollo, y llamándolo directo se podría hacer pasar por otro usuario |
| Pago tardío | **Resuelto.** Si llega `pago.aprobado` cuando la reserva ya estaba cancelada o expirada, Reservas lo ignora, y Pagos reembolsa automáticamente (ver `contratos.md`) |
| RabbitMQ y Docker | **Resuelto.** Probado con un broker real en Docker: la topología (`definitions.json`), el límite de 3 entregas con envío a la DLQ, la idempotencia de los consumidores, y el flujo completo reservar, pagar y confirmar con Pagos real (incluso con Pagos caído: los eventos esperan en la cola) |
| Observabilidad | **Resuelto.** Logs JSON con `traceId`, métricas de Prometheus con alertas, y trazas OpenTelemetry a Jaeger que continúan en Cocheras. **Límite:** Pagos todavía no exporta trazas, así que la traza se corta ahí |
| Propietario y monto | **Resuelto.** Salen de Cocheras, no del cliente |
| `FINALIZADA` | **Resuelto.** El mismo proceso periódico finaliza las reservas confirmadas cuya franja terminó |
| Política de cancelación | **Límite.** Se puede cancelar mientras la reserva esté activa y no haya comenzado, y se reembolsa completo; no hay plazos |
| Dependencia de Cocheras | **Límite, a propósito.** Sin Cocheras no se pueden crear reservas (`503`). No hay caché ni valores por defecto: el precio debe ser el vigente |
| Varias réplicas | **Probado con 2.** El diseño lo permite (sin estado en memoria, `SKIP LOCKED` en las tareas periódicas, lock por cochera) y se probó con 2 réplicas de Reservas y de Pagos (ver «Prueba con 2 réplicas»). **Límite:** no se probó con más de 2, con carga sostenida ni en varias máquinas |

## 10. Pruebas

La suite del servicio tiene 51 tests de integración contra un PostgreSQL real, porque lo que se prueba es la restricción de exclusión y no puede simularse. Los más relevantes para la defensa:

| Prueba | Resultado esperado |
|---|---|
| 30 conductores reservan la misma franja a la vez | 1 reserva creada, 29 reciben `409` |
| 20 requests con la misma `Idempotency-Key` | Una sola reserva |
| 10 cancelaciones simultáneas | Una se aplica, 9 reciben `409` |
| El mismo evento de pago llega 10 veces en paralelo | Se aplica una sola vez |
| Expiración en 4 réplicas a la vez | Cada reserva expira una sola vez |
| `pago.aprobado` y expiración en carrera | Cada reserva termina confirmada o expirada, nunca ambas |
| Broker caído | El evento queda en el outbox y se reintenta |

### Prueba con 2 réplicas

Se levantó el sistema con `docker compose up --scale reservas=2 --scale pagos=2` en un proyecto aparte (con los puertos del host sin publicar, porque dos réplicas no pueden compartir el 8000) y se corrió `scripts/probar-replicas.sh`. El gateway reparte los pedidos entre las dos réplicas porque resuelve el nombre del servicio en cada pedido (`resolver 127.0.0.11`).

| Prueba | Resultado |
|---|---|
| 12 rondas de 25 conductores reservando la misma franja a la vez (300 pedidos) | Siempre 1 reserva creada y 24 `409`; ningún `500` |
| Reparto de pedidos a `/api/reservas` en el gateway | Las dos réplicas recibieron pedidos (186 y 144 en la corrida) |
| Un pago completo, con los eventos repartidos entre las réplicas | Reserva `CONFIRMADA` |
| 8 reservas sin pagar y 12 más sin pagar, con la expiración corriendo en las dos réplicas | Todas `EXPIRADA`, y cada una con un solo evento `reserva.expirada` (sin repetidos) |
| Avisos por WebSocket con el conductor conectado a una réplica de Pagos y el propietario a la otra | 10 de 10 avisos `reserva:confirmada` en cada uno |
| Eventos repetidos en Pagos o sin publicar en el *outbox*; errores en los logs | Ninguno |

**Qué no se probó:** más de 2 réplicas, Cocheras o Usuarios replicados, carga sostenida, varias máquinas y un orquestador. La prueba valida que el diseño no depende de que haya una sola instancia, no su rendimiento.

```bash
cd reservas
TEST_DATABASE_URL=postgres://app:app@localhost:5443/reservas_test pytest
```

### Prueba de carga contra el servicio en ejecución

`reservas/scripts/carga.py` (sin dependencias) dispara cientos de requests que arrancan juntos contra el servicio levantado y verifica la regla central desde afuera, usando solo la API:

```bash
python3 reservas/scripts/carga.py --clientes 100
```

| Escenario | Verificación |
|---|---|
| 100 conductores, misma cochera y franja | 1 × `201` y 99 × `409`; la cochera queda con una sola franja ocupada |
| 1 conductor, misma `Idempotency-Key` 100 veces | Todas devuelven la misma reserva; se creó una sola |
| 100 conductores, 100 cocheras distintas | Las 100 se crean: no hay bloqueos innecesarios |
| 60 franjas de 2 h desplazadas 30 min sobre una cochera | Ninguna franja ocupada se solapa con otra y **todo rechazo se solapa con una reserva aceptada** (no hay rechazos injustos) |

Al final imprime la diferencia de las métricas (`reservas_creadas_total`, `reservas_conflictos_total`) durante la prueba y termina con código 1 si alguna verificación falla.

Resultado en una corrida local con 100 clientes: 12 de 12 verificaciones correctas, con latencia p95 menor a 100 ms. Como control, al borrar a propósito la restricción de exclusión de la base, la misma prueba falla: los 50 conductores del primer escenario obtienen `201` sobre la misma franja. Es decir, la garantía de no doble reserva la da la restricción y no el código de la aplicación. Medido con un solo servicio y la base en la misma máquina; no representa la latencia de un despliegue real.

## 11. Factores 12-Factor aplicados a este servicio

| Factor | Cómo |
|---|---|
| Configuración | `DATABASE_URL`, `RABBITMQ_URL`, `RETENCION_MINUTOS` y `EXPIRACION_INTERVALO_SEGUNDOS` por variables de entorno |
| Servicios de respaldo | PostgreSQL y RabbitMQ se tratan como recursos conectables por URL; sin `RABBITMQ_URL` el servicio corre sin mensajería |
| Procesos sin estado | No se guarda estado en memoria entre requests; todo está en la base, por eso se puede escalar con réplicas |
| Concurrencia | Se escala agregando réplicas; el outbox y la expiración están diseñados para que varias convivan |
| Desechabilidad | Al apagarse, los hilos de publicación, consumo y expiración se detienen ordenadamente; los mensajes no confirmados vuelven a la cola |
| Dependencias | Declaradas en `requirements.txt` e instaladas dentro de la imagen |
| Logs | Salen por stdout |
