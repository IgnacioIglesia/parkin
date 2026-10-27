# Servicio de Cocheras

Sección del documento final. Describe lo que está implementado en `cocheras/`. Las decisiones discutibles, los límites y lo que no se hizo están en la sección 10.

## 1. Responsabilidad

Cocheras administra el catálogo: alta, edición y baja de cocheras, su disponibilidad semanal y la búsqueda por cercanía y franja horaria. También decide quién puede ver la ubicación exacta de cada cochera. No crea reservas ni decide si una franja está ocupada: eso es de Reservas. Cocheras consulta la ocupación para filtrar la búsqueda y escucha los eventos de reservas para saber a quién mostrarle la dirección.

| | |
|---|---|
| Lenguaje y framework | Node.js 24 (ESM) + Express 5 + Apollo Server 5 (GraphQL) |
| Base de datos | PostgreSQL 16 con PostGIS (propia, `db-cocheras`) |
| Acceso a datos | `pg` con pool de conexiones, SQL explícito, migraciones `.sql` numeradas |
| Caché | Redis (resultados de búsqueda) |
| Mensajería | RabbitMQ con `amqplib` (solo consume) |
| Logs, métricas y trazas | `pino` (JSON a stdout), `prom-client`, OpenTelemetry |

## 2. API

Una sola ruta, `POST /graphql`, publicada por el gateway. El esquema completo está en [`contratos.md`](../contratos.md) §6.

| Operación | Tipo | Quién | Qué hace |
|---|---|---|---|
| `buscarCocheras(cerca, radioMetros, desde, hasta, tipo)` | Query | Cualquiera, sin login | Cocheras cercanas libres durante toda la franja |
| `cochera(id)` | Query | Cualquiera | Una cochera. La dirección y la ubicación exactas solo si corresponde (sección 5) |
| `misCocheras` | Query | `PROPIETARIO` | Las cocheras del usuario |
| `crearCochera(input)` | Mutation | `PROPIETARIO` | Alta |
| `actualizarCochera(id, input)` | Mutation | El dueño | Edición completa |
| `definirDisponibilidad(id, franjas)` | Mutation | El dueño | Reemplaza la disponibilidad semanal |
| `eliminarCochera(id)` | Mutation | El dueño | Baja lógica |

Además, `GET /health` (proceso vivo), `GET /ready` (llega a la base y está consumiendo de RabbitMQ) y `GET /metrics` (Prometheus, solo red interna).

Los errores vuelven en `errors[].extensions.code`: `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `BAD_USER_INPUT`, `CONFLICT`, `SERVICE_UNAVAILABLE` o `INTERNAL_SERVER_ERROR`. Los errores internos llegan al cliente como "Error interno", sin detalles de SQL ni de red, y se registran completos en el log con su `traceId`.

**Por qué GraphQL.** El mapa necesita pocos datos de muchas cocheras y la ficha necesita muchos datos de una; el panel del propietario, otros distintos. Con GraphQL cada pantalla pide exactamente los campos que usa, en una sola request, y el contrato es un esquema tipado que el front puede validar. Para que eso no se convierta en un riesgo:

- **Profundidad máxima 5**: una consulta más anidada se rechaza antes de ejecutarse.
- **DataLoader** contra el problema N+1: si una búsqueda devuelve 50 cocheras y se pide la disponibilidad de cada una, se hace una sola consulta a la base, no 50. Hay un test que lo verifica contando las consultas.

## 3. Modelo de datos

```sql
CREATE TABLE cochera (
    id                   UUID PRIMARY KEY,
    propietario_id       UUID NOT NULL,          -- referencia a Usuarios, sin FK
    titulo               TEXT NOT NULL,
    precio_hora          NUMERIC(10,2) NOT NULL CHECK (precio_hora > 0),
    tipo_vehiculo        TEXT NOT NULL,          -- MOTO, AUTO o CAMIONETA
    direccion_exacta     TEXT NOT NULL,
    ubicacion            GEOGRAPHY(Point, 4326) NOT NULL,
    ubicacion_aproximada GEOGRAPHY(Point, 4326) NOT NULL,
    fotos                TEXT[] NOT NULL DEFAULT '{}',
    eliminada_en         TIMESTAMPTZ             -- baja lógica
);
CREATE INDEX ON cochera USING gist (ubicacion_aproximada) WHERE eliminada_en IS NULL;

CREATE TABLE franja_disponible (
    cochera_id UUID REFERENCES cochera (id),
    dia_semana SMALLINT,                         -- 1 = lunes ... 7 = domingo
    desde_min  SMALLINT, hasta_min SMALLINT,     -- minutos desde la medianoche
    EXCLUDE USING gist (cochera_id WITH =, dia_semana WITH =,
                        int4range(desde_min, hasta_min) WITH &&)
);

CREATE TABLE acceso_direccion (reserva_id UUID PRIMARY KEY, cochera_id UUID,
                               conductor_id UUID, hasta TIMESTAMPTZ, revocado BOOLEAN);
CREATE TABLE evento_procesado (event_id UUID PRIMARY KEY, procesado_en TIMESTAMPTZ);
```

- **`GEOGRAPHY` y no `GEOMETRY`**: las distancias se calculan en metros sobre el elipsoide, sin proyecciones. El índice GIST hace que buscar en un radio no recorra toda la tabla.
- **Database per service**: `propietario_id` y los ids de reservas son solo UUID, sin claves foráneas hacia otras bases.
- **Dos franjas del mismo día no pueden solaparse**: lo garantiza la base con una restricción de exclusión, además de la validación de la API.
- Las migraciones están en `cocheras/migrations/` y se aplican solas al arrancar, en orden y una sola vez (tabla `schema_migrations`, con un advisory lock para que varias réplicas no las corran a la vez).

## 4. Búsqueda

```mermaid
flowchart TD
    Q[buscarCocheras] --> C{¿Está en Redis?}
    C -- sí --> R[Resultado]
    C -- no --> G[PostGIS: ubicación aproximada dentro del radio<br/>y tipo de vehículo, ordenadas por distancia]
    G --> D[Disponibilidad semanal:<br/>¿cubre toda la franja en hora de Montevideo?]
    D --> O[Reservas: ocupación de cada candidata]
    O --> F[Descarta las ocupadas]
    F --> S[Guarda en Redis 30 s] --> R
```

1. **Geografía.** `ST_DWithin` sobre la ubicación aproximada, con radio de 1 a 10 000 m y como máximo 100 candidatas, ordenadas por distancia.
2. **Tipo de vehículo.** El tipo de una cochera es el tamaño máximo que admite (`MOTO` < `AUTO` < `CAMIONETA`): buscar `AUTO` devuelve también las de camioneta.
3. **Disponibilidad semanal.** Las franjas se cargan en hora de Montevideo (por ejemplo, lunes de 08:00 a 20:00). Una búsqueda de mañana de 14:00 a 16:00 se convierte a hora local, se parte en la medianoche si la cruza, y cada tramo tiene que quedar cubierto sin huecos por las franjas de ese día. Las fechas tienen que venir con zona horaria; si no, se rechazan para no adivinar.
4. **Ocupación.** Para las candidatas que quedan, Cocheras le pide a Reservas las franjas ocupadas (`GET /cocheras/{id}/ocupacion`, en paralelo, timeout de 2 s) y descarta las que tengan alguna.
5. **Caché.** El resultado se guarda en Redis (sección 7).

**Si Reservas no responde**, la búsqueda devuelve las cocheras sin el filtro de ocupación, en lugar de fallar. Es una decisión a propósito: la búsqueda es orientativa, y la garantía contra la doble reserva está en la restricción de exclusión de Reservas, que igual responde `409` al intentar reservar. Ese resultado incompleto no se guarda en la caché, y queda registrado en el log y en la métrica `cocheras_consultas_reservas_total{resultado="error"}`.

## 5. Confidencialidad: ubicación aproximada y exacta

La dirección de una cochera suele ser la casa del propietario. Por eso hay dos ubicaciones:

- **Aproximada**, visible para todos. Se calcula una sola vez, al crear la cochera, como un punto al azar a 100-300 m de la real, y queda fija. Si cambiara en cada consulta, promediando muchas búsquedas se podría reconstruir el punto real. Solo se recalcula si el dueño cambia la ubicación.
- **Exacta** (`direccionExacta` y `ubicacion`), visible solo para el dueño y para el conductor con una reserva **confirmada** de esa cochera, **hasta que termina la franja reservada**. Para cualquier otro, o cuando la reserva ya terminó, llega `null`.

La búsqueda filtra **y ordena** por la ubicación aproximada, y nunca por la real. Si filtrara por la real, alguien podría ir achicando el radio y triangular el punto exacto.

**Cómo sabe Cocheras quién tiene una reserva confirmada.** Cocheras no consulta a Reservas en cada request: escucha `reserva.confirmada` y guarda el acceso en `acceso_direccion`, junto con el fin de la franja (`hasta`, que viene en el evento). Con `reserva.cancelada`, lo revoca. Cuando la franja termina, el acceso vence solo: la consulta compara `hasta` con la hora de la base, así que no hace falta que Reservas publique un evento de fin.

## 6. Eventos

Cocheras solo consume, de la cola `cocheras.reserva-eventos` (creada por `infra/rabbitmq/definitions.json`).

| Evento | Efecto |
|---|---|
| `reserva.confirmada` | El conductor pasa a ver la ubicación exacta. Invalida la caché de búsquedas |
| `reserva.cancelada` | Revoca ese acceso. Invalida la caché |

- **At-least-once, con ACK manual y prefetch 10.** El mensaje se confirma recién después de guardar el cambio. Si el proceso muere antes, RabbitMQ lo reentrega.
- **Idempotencia.** El `eventId` se guarda en `evento_procesado` en la misma transacción que el cambio. Si el mismo evento llega dos veces, la segunda se descarta.
- **Desorden.** Los eventos no traen orden garantizado. Si la cancelación llega antes que la confirmación, la fila queda marcada como revocada y la confirmación tardía no la reabre.
- **Errores.** Un mensaje que nunca se va a poder procesar (JSON roto, ids faltantes, tipo desconocido) va directo a la Dead Letter Queue `cocheras.dlq`. Un error transitorio (la base caída) se reencola, y después de 3 entregas la cola lo manda a la DLQ. Hay una alerta de Prometheus si la DLQ tiene mensajes.
- **Reconexión.** Si RabbitMQ se cae, el consumidor reintenta cada 3 s y `/ready` responde `503` mientras tanto.

## 7. Caché de búsquedas

Las búsquedas son la operación más frecuente y la más cara: geografía, disponibilidad y una consulta a Reservas por candidata. Su resultado se guarda en Redis 30 segundos.

**Invalidación por versión.** Cada clave incluye un número de versión. Cualquier cambio (alta, edición, disponibilidad, baja o un evento de reserva) incrementa ese número, y así quedan invalidadas todas las búsquedas guardadas de una vez, sin tener que buscar cuáles incluían la cochera modificada. Las claves viejas vencen solas por TTL.

**Redis es opcional.** Si no responde, la búsqueda va directo a la base. El cliente de Redis no encola comandos mientras está desconectado, para que una caída no deje requests esperando.

## 8. Seguridad y permisos

- El gateway valida el JWT y pasa la identidad en `X-User-Id` y `X-User-Roles`, que siempre pisa aunque el cliente los mande. Cocheras confía en esos headers.
- `misCocheras` y todas las mutaciones exigen el rol `PROPIETARIO`. Sobre una cochera existente, solo opera su dueño: otro propietario recibe `FORBIDDEN`, y una cochera inexistente o eliminada da `NOT_FOUND`.
- Validación de entrada: título de 1 a 120 caracteres, precio entre 0 y 100 000, coordenadas en rango, hasta 8 fotos con URL `http(s)`, horas `HH:MM` alineadas a :00 o :30 y sin solapamientos.
- La baja es lógica y se rechaza con `CONFLICT` si la cochera tiene reservas pendientes o confirmadas, para no dejar reservas apuntando a una cochera que ya no existe. Si Reservas no responde, la baja se rechaza con `SERVICE_UNAVAILABLE`: ante la duda no se borra.
- Los logs ocultan los headers `Authorization` y `Cookie`.

## 9. Observabilidad

Detalle completo en [`observabilidad.md`](../observabilidad.md). En resumen:

- **Logs** JSON con `nivel`, `servicio`, `mensaje` y `traceId`.
- **Métricas** de requests y latencia, de cada operación GraphQL con su resultado (`ok`, `error_cliente` o `error_interno`, porque GraphQL responde 200 aunque falle), de aciertos de caché, de eventos consumidos, de consultas a Reservas y del estado de RabbitMQ y Redis.
- **Trazas** con OpenTelemetry a Jaeger. Continúan el `traceparent` del gateway, se propagan a Reservas, y al consumir un evento se cuelgan del `traceId` que viene en el mensaje. Así, una reserva se sigue en una sola traza desde la búsqueda hasta la dirección habilitada.

## 10. Decisiones, límites y pendientes

| Tema | Estado |
|---|---|
| Ocupación consultada a Reservas | **Decisión.** Cocheras no copia las reservas; le pregunta a Reservas, que es la dueña del dato. **Límite:** una búsqueda hace una consulta por candidata (hasta 100, en paralelo). La caché lo amortigua, pero con mucho tráfico convendría un endpoint de ocupación por lote |
| Caché eventual | **Límite.** Una búsqueda guardada puede mostrar hasta 30 s una cochera que acaban de reservar, porque Cocheras no escucha `reserva.creada`. No genera dobles reservas: el intento recibe `409` |
| Fotos | **Límite (decidido el 27/10).** Se guardan como URLs que manda el cliente; no hay subida de archivos. Subirlas pediría un almacenamiento de objetos compartido entre réplicas (por ejemplo, un bucket compatible con S3), con su propio control de acceso y tamaño, y no aporta a lo que el proyecto quiere demostrar. Queda como evolución |
| Bloqueos puntuales | **Fuera de alcance (decidido el 27/10).** El dueño no puede marcar un día concreto como no disponible sin cambiar su disponibilidad semanal. Estaba en la descripción funcional original, pero implementarlo cambia el contrato GraphQL, la búsqueda y el front, y la disponibilidad semanal ya cubre el caso principal. Para un día puntual, hoy el dueño tiene que quitar ese día de su disponibilidad semanal y volver a agregarlo después |
| Zona horaria | **Límite.** El cálculo usa `America/Montevideo` y asume días de 24 h, que es lo que pasa en Uruguay (sin horario de verano desde 2015) |
| Acceso directo al servicio | **Límite.** Cocheras confía en los headers de identidad del gateway, así que solo debe ser accesible a través de él. El compose publica el puerto 4000 para desarrollo; llamándolo directo se podría hacer pasar por otro usuario |
| Varias réplicas | **Límite.** El diseño lo permite (sin estado en memoria, caché compartida en Redis, consumidores que compiten por la misma cola), pero no se probó con más de una réplica |

## 11. Pruebas

51 tests. 20 son unitarios y corren sin infraestructura. Los otros 31 corren contra PostGIS, RabbitMQ y Redis reales, y se activan con variables de entorno. Los más relevantes:

| Prueba | Resultado esperado |
|---|---|
| Crear una cochera | La ubicación aproximada queda a 100-300 m de la real |
| Buscar con radio, tipo y franja | Devuelve solo las cercanas, del tamaño adecuado y disponibles toda la franja |
| Disponibilidad en hora local | Una franja de 14 a 15 en Montevideo coincide con 17 a 18 UTC, no con 14 a 15 UTC; cruzar la medianoche une franjas de dos días |
| Reservas informa ocupación | La cochera ocupada no aparece |
| Reservas no responde | La búsqueda sigue funcionando |
| Dirección y ubicación exactas | `null` para anónimos y otros conductores; visibles para el dueño y para el conductor con reserva confirmada, y otra vez `null` cuando su reserva terminó |
| DataLoader | Una búsqueda que pide la disponibilidad de 5 cocheras hace una sola consulta de franjas |
| Caché | La segunda búsqueda igual no consulta a Reservas; una edición la invalida |
| Evento repetido | Se aplica una sola vez |
| Cancelación antes que confirmación | El acceso queda revocado |
| Mensaje inválido publicado en RabbitMQ | Termina en `cocheras.dlq` |
| Redis caído | La caché se comporta como vacía, sin errores |
| Error de base en GraphQL | El cliente recibe "Error interno", sin el detalle |

```bash
cd cocheras
npm test                                   # unitarios
TEST_DATABASE_URL=postgres://app:app@localhost:5442/cocheras_test \
TEST_RABBITMQ_URL=amqp://guest:guest@localhost:5672 \
TEST_REDIS_URL=redis://localhost:6379 \
npm test                                   # todos
```

Además, `scripts/demo.mjs` recorre el sistema completo a través del gateway: un propietario publica una cochera, un visitante la busca, varios conductores la reservan a la vez (entra uno solo), el ganador paga en la pasarela simulada y solo él pasa a ver la dirección.

## 12. Factores 12-Factor aplicados a este servicio

| Factor | Cómo |
|---|---|
| Configuración | `DATABASE_URL`, `RABBITMQ_URL`, `REDIS_URL`, `RESERVAS_URL`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `PORT` y `LOG_LEVEL` por variables de entorno |
| Servicios de respaldo | PostgreSQL, RabbitMQ, Redis y Jaeger se ubican por URL. Sin `REDIS_URL` funciona sin caché, y sin `OTEL_EXPORTER_OTLP_ENDPOINT`, sin trazas |
| Procesos sin estado | Nada queda en memoria entre requests; la caché está en Redis |
| Desechabilidad | Arranca en segundos y con `SIGTERM` deja de aceptar requests, cierra el consumidor, Redis y el pool, y envía las trazas pendientes |
| Logs | JSON a stdout; Alloy los lleva a Loki |
| Procesos de administración | Las migraciones se versionan en el repo y se aplican al arrancar |
