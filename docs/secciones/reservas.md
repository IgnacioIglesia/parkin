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

> `FINALIZADA` existe en el modelo, pero todavía no hay un proceso que marque como finalizadas las reservas cuya franja terminó.

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

**Evidencia.** El test de concurrencia lanza 30 requests simultáneos sobre la misma cochera y franja: exactamente uno recibe `201` y los otros 29 reciben `409`, y la base queda con una sola reserva.

## 5. Idempotencia y control optimista

Las redes reintentan: el conductor puede tocar dos veces "Reservar", o la app reenviar por un timeout.

- **`Idempotency-Key`.** `POST /reservas` exige el header. Una segunda llamada con la misma clave devuelve la reserva ya creada (`200`) en lugar de crear otra. Si la clave pertenece a otro usuario, devuelve `409`. La columna tiene restricción `UNIQUE`, de modo que si dos requests con la misma clave llegan a la vez, gana el primero y el segundo recibe la misma reserva. Test: 20 requests simultáneos con la misma clave producen una sola reserva.
- **Control optimista.** Cada reserva tiene una columna `version`. Cancelar hace `UPDATE … WHERE id = ? AND version = ?`, así que si otra operación la cambió entre la lectura y la escritura, no se modifica nada. Test: 10 cancelaciones simultáneas de la misma reserva, una sola se aplica y las otras 9 reciben `409`.
- **Integridad.** Una reserva confirmada no se edita: solo puede pasar a `CANCELADA` o `FINALIZADA`, y siempre dejando historial.

## 6. Comunicación entre servicios

### 6.1 Eventos

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

### 6.2 Outbox transaccional

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

### 6.3 Consumo idempotente

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

## 8. Retención y expiración

Al crear la reserva, la franja queda retenida 10 minutos (`expira_en`). Un proceso interno corre al arrancar y luego cada 60 segundos: pasa a `EXPIRADA` las reservas vencidas sin pago y publica `reserva.expirada`. Así, quien abandona el checkout no bloquea la cochera indefinidamente.

- Con varias réplicas, `SKIP LOCKED` hace que cada una tome reservas distintas.
- Si justo llega un `pago.aprobado` para una reserva que se está expirando, el bloqueo de fila decide quién va primero: la reserva termina confirmada o expirada, nunca ambas y con un solo evento de cierre. Hay un test con 20 reservas en esa carrera.
- Como el proceso corre cada 60 segundos, una reserva puede seguir bloqueando la franja hasta un minuto después de su vencimiento. Es una demora aceptada.

## 9. Decisiones, límites y pendientes

Para ser honestos en la defensa, esto es lo que hoy **no** está resuelto o verificado:

| Tema | Estado |
|---|---|
| Identidad del usuario | Se lee del header `X-User-Id`, que debería poner el gateway tras validar el JWT. Falta confirmarlo con el responsable del gateway |
| Propietario y monto | Hoy los manda el cliente en el body del `POST`. Es provisorio: deben obtenerse de Cocheras, porque el cliente no debe poder fijar el precio |
| Política de cancelación | Se puede cancelar mientras la reserva esté activa y no haya comenzado; no hay plazos ni reembolsos |
| Pago tardío | Si llega `pago.aprobado` y la reserva ya estaba cancelada o expirada, se ignora con un aviso en el log, pero el cobro ya se hizo. Falta definir quién reembolsa |
| `FINALIZADA` | No hay proceso que finalice reservas |
| RabbitMQ y Docker | La lógica de mensajería está probada con la base real, pero la conexión con un broker real y la topología (`definitions.json`, DLQ) no se probaron todavía |
| Observabilidad | Los eventos llevan `traceId` (desde el header `traceparent`) y hay `/health` y `/ready`. Faltan logs en JSON, métricas de Prometheus y trazas con OpenTelemetry |

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

```bash
cd reservas
TEST_DATABASE_URL=postgres://app:app@localhost:5443/reservas_test pytest
```

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
