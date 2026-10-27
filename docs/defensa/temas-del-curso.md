# Temas del curso aplicados a parkIN

Guía para responder cualquier pregunta teórica de la defensa. Cada tema del curso tiene:
- la definición tal como se dio en clase;
- dónde aparece en parkIN;
- las preguntas probables, con su respuesta.

Los nombres de los conceptos son los de las diapositivas (Van Steen y Tanenbaum, Coulouris, Kleppmann). Conviene usarlos tal cual en la defensa.

---

## Tema 1. Qué es un sistema distribuido

| Concepto | Definición de clase | En parkIN |
|---|---|---|
| Sistema distribuido | Colección de elementos de cómputo autónomos que se presenta a sus usuarios como un único sistema coherente | Cuatro servicios con su propia base, que se ven como una sola app detrás del gateway |
| Descentralizado y distribuido | En un sistema descentralizado los recursos están *necesariamente* repartidos; en uno distribuido, *suficientemente* repartidos (por elección de diseño) | Es **distribuido**: podría ser un monolito, pero se repartió para escalar, aislar fallas y desplegar por separado |
| Áreas de estudio | Organización, procesos, comunicación, coordinación, nomenclatura, consistencia y replicación, tolerancia a fallos, seguridad | Ver la tabla de abajo |

| Área | Dónde aparece en parkIN |
|---|---|
| Organización | Microservicios, publicación-suscripción y cliente-servidor |
| Procesos | Un contenedor por servicio |
| Comunicación | REST, GraphQL, AMQP y WebSocket |
| Coordinación | Lock por cochera y saga |
| Nomenclatura | Los servicios se ubican por nombre en la red de Docker, y el gateway vuelve a resolverlos cada 10 s |
| Consistencia y replicación | Fuerte al reservar, eventual en la caché |
| Tolerancia a fallos | Outbox, reintentos, DLQ y compensaciones |
| Seguridad | JWT, HMAC y confidencialidad de la ubicación |

**«¿Por qué parkIN es un sistema distribuido y no una aplicación web común?»**
Porque sus partes son procesos autónomos, con su propia base, que se comunican por red y pueden fallar por separado. Aun así, el usuario ve una sola aplicación. El problema central también es distribuido: varios clientes, contra varias réplicas, tienen que ver un estado consistente de la misma franja.

---

## Tema 1.2. Objetivos de diseño (Van Steen)

Los seis objetivos son: acceso fácil a recursos, transparencia, apertura, confiabilidad, seguridad y escalabilidad.

### Transparencia: los 7 tipos

| Tipo | Qué oculta | En parkIN |
|---|---|---|
| Acceso | Diferencias en cómo se representan y acceden los datos | La web usa HTTP con JSON o GraphQL, sin importar que detrás haya Node o Python |
| Ubicación | Dónde está el recurso | Una sola URL, la del gateway; los servicios se encuentran por nombre |
| Reubicación | Que el recurso se mueva mientras se usa | El gateway vuelve a resolver los nombres cada 10 s, así que un contenedor recreado con otra dirección sigue siendo alcanzable |
| Migración | Que el recurso se mueva a otro lugar | Los servicios no tienen estado en memoria, así que pueden levantarse en otro lado |
| Replicación | Que haya copias | La caché de búsquedas; las réplicas de un servicio comparten cola y caché |
| Concurrencia | Que otros usan el mismo recurso | Cada conductor reserva como si estuviera solo; si pierde, ve «franja ocupada» |
| Fallo | La falla y la recuperación | El outbox, las colas durables y las compensaciones: si Pagos cae, se sigue reservando |

**Grado de transparencia.** No todo se puede ni conviene ocultar, por costo o porque es imposible (no se distingue un nodo lento de uno caído). En parkIN quedan a la vista a propósito tres cosas:
- la latencia del pago: la confirmación llega unos segundos después y la reserva queda «retenida»;
- la consistencia eventual de la búsqueda (30 s);
- que sin Cocheras no se puede reservar (`503`).

### Apertura

- **Interfaces completas y neutras:** `docs/contratos.md` define endpoints, eventos y esquema antes de implementar.
- **Interoperabilidad:** Python y Node sin adaptadores.
- **Portabilidad:** contenedores.
- **Extensibilidad:** nuevos suscriptores de eventos.
- **Políticas y mecanismos separados:** el tiempo de caché, el plazo de retención y los umbrales de las alertas son configuración, no código.

### Confiabilidad (*dependability*)

- **Disponibilidad:** funciona en un instante dado.
- **Fiabilidad:** funciona sin fallar durante un intervalo.
- **Safety:** no pasa nada catastrófico.
- **Mantenibilidad:** qué tan fácil se arregla.
- **Métricas:** MTTF (tiempo medio hasta la falla), MTTR (tiempo medio de reparación) y MTBF = MTTF + MTTR.
- **Tipos de falla:**
  - transitoria: ocurre una vez (un deadlock, un timeout); se cubre con reintento;
  - intermitente: va y viene (un broker que se cae y vuelve); se cubre con reconexión y outbox;
  - permanente: no se arregla sola (un mensaje mal formado); se cubre con la DLQ.

**«¿Midieron MTTF o MTTR?»**
No formalmente. Lo que sí tenemos es lo que baja el MTTR: reinicio automático de los contenedores, alertas que detectan la falla en 1 minuto, y trazas y logs con el `traceId` para encontrar la causa rápido.

### Seguridad

Tiene cuatro aspectos:
- **Confidencialidad:** la ubicación aproximada, y la dirección exacta solo para las partes de la reserva y hasta que termina la franja.
- **Integridad:** el precio sale del servidor, los cambios de estado son condicionales y el webhook va firmado con HMAC.
- **Autenticación:** JWT RS256 y refresh de un solo uso.
- **Autorización:** roles, y que solo el dueño toque su cochera.

### Escalabilidad

**Tipos:**
- **En tamaño:** más usuarios y recursos. Es la que apunta parkIN.
- **Geográfica:** nodos lejanos. No se aborda.
- **Administrativa:** varias organizaciones. No se aborda.

**Técnicas:**
- **Ocultar latencias** con comunicación asincrónica: el pago se confirma por eventos y el conductor no espera a la pasarela.
- **Particionar y distribuir:** una base por servicio.
- **Replicar:** la caché en Redis y réplicas de servicios sin estado.

**La replicación trae inconsistencia.** La aceptamos solo en la búsqueda (30 s de caché), nunca en la reserva ni en el pago.

**«¿Qué cuello de botella tendría parkIN si crece mucho?»**
La consulta de ocupación de Cocheras a Reservas: hoy es una por cochera candidata. La solución es una consulta por lote. Y la base de Reservas: como toda reserva pasa por ella, se podría particionar por cochera o por zona.

---

## Tema 1.3. Características según Coulouris

| Característica | Definición | En parkIN |
|---|---|---|
| Heterogeneidad | Funcionar pese a diferencias de red, hardware, sistema operativo, lenguaje e implementación. El **middleware** la enmascara | Node y Python; gateway y RabbitMQ como middleware; web *responsive* para cualquier dispositivo |
| Extensibilidad | Agregar o reemplazar componentes sin reestructurar | Exchange *topic*: un servicio nuevo se suscribe sin tocar a quien publica. La pasarela se cambia en un solo archivo |
| Seguridad | Confidencialidad, integridad, disponibilidad | Ver el tema 1.2 |
| Escalabilidad | Métricas: *throughput* y tiempo de respuesta | Requests por segundo y latencia p95 en Grafana |
| Tolerancia a fallos | Técnicas: detección, enmascaramiento, tolerancia, recuperación, redundancia | Ver la tabla de abajo |
| Concurrencia | Recursos accedidos a la vez sin perder coherencia. Hay dos criterios: **linealizable** (como si cada operación ocurriera en un instante, en orden real) y **serializable** (equivalente a alguna ejecución en serie) | Las altas sobre una misma cochera son serializables: el lock las pone en fila. La restricción de exclusión garantiza el resultado |
| Transparencia | Los 7 tipos | Ver el tema 1.2 |
| Calidad de servicio | Cumplir niveles de tiempo de respuesta, disponibilidad y fiabilidad | Alertas si la p95 de búsqueda o login supera 500 ms, o la de crear una reserva supera 800 ms |

| Técnica de tolerancia a fallos | En parkIN |
|---|---|
| Detección | Healthchecks, `/ready` y alertas |
| Enmascaramiento | Reintento ante *deadlock* y reentrega de mensajes |
| Tolerancia | Degradación: sin Redis o sin Reservas, la búsqueda sigue |
| Recuperación | Compensaciones de la saga y reembolsos |
| Redundancia | El evento se guarda en el outbox y en una cola durable |

**«¿Linealizable o serializable?»**
Para la franja nos importa que el resultado sea equivalente a una ejecución en serie (serializable): de todas las reservas que compiten, gana una, como si hubieran llegado de a una. No necesitamos que gane la que llegó primero en tiempo real, sino que gane una sola.

---

## Tema 2. Buenas prácticas: 12-Factor y Clean Code

| Factor | Qué pide | En parkIN |
|---|---|---|
| I. Código base | Uno por aplicación, muchos despliegues | Un repositorio, con una carpeta y una imagen por servicio |
| II. Dependencias | Declararlas y aislarlas | `package-lock.json` y `requirements.txt` con versión fija; nada instalado en la máquina |
| III. Configuración | En variables de entorno, no en el código | `DATABASE_URL`, `RABBITMQ_URL`, `REDIS_URL`, etc., declaradas en el compose (hay `.env.example` en Cocheras, Reservas y la web). En el repo solo hay credenciales de desarrollo |
| IV. Servicios de respaldo | Recursos conectables, intercambiables sin cambiar código | PostgreSQL, RabbitMQ, Redis y Jaeger por URL |
| V. Construir, distribuir, ejecutar | Etapas separadas | Dockerfile (build), imagen más compose (release), contenedor (run) |
| VI. Procesos | Sin estado, *share-nothing* | El estado va a PostgreSQL, Redis o RabbitMQ |
| VII. Asignación de puertos | El servicio exporta su propio puerto | Cada uno expone su puerto HTTP; el gateway enruta |
| VIII. Concurrencia | Escalar con más procesos | Réplicas que compiten por la misma cola |
| IX. Desechabilidad | Arranque rápido, apagado ordenado | `SIGTERM` cierra consumidor y pool; con ACK manual, un mensaje a medias se reentrega |
| X. Paridad desarrollo/producción | Mismos servicios de respaldo y versiones | Compose con PostgreSQL 16, RabbitMQ 3.13 y Redis 7, sin SQLite |
| XI. Logs | Flujo de eventos a stdout | JSON a stdout; Alloy los lleva a Loki |
| XII. Procesos de administración | En el mismo entorno | **Parcial:** las migraciones corren al arrancar el servicio, no como proceso aparte |

**Clean Code aplicado a SD:**
- **Nombres claros:** los contratos y los eventos usan los mismos nombres en todos los servicios.
- **Funciones pequeñas:** servicios de una sola responsabilidad.
- **Manejo de errores:** códigos `extensions.code` en GraphQL; errores internos sin detalle al cliente, pero completos en el log con su `traceId`.

**«¿Por qué el XII es parcial?»**
Porque las migraciones se aplican cuando arranca el servicio, no como un proceso separado. Con una sola versión desplegada a la vez alcanza, y un lock evita que dos réplicas las corran juntas. Con despliegues graduales convendría separarlas.

---

## Tema 3.0. Docker

| Concepto | En parkIN |
|---|---|
| Imagen y Dockerfile | Un Dockerfile por servicio; multi-stage en la web (build con Node, servida con NGINX) |
| Contenedor | Un proceso aislado por servicio, con su propio sistema de archivos y red, que comparte el kernel |
| Volúmenes | Los datos de las 4 bases y de RabbitMQ sobreviven a un reinicio |
| Docker Compose | Un archivo declara servicios, redes, volúmenes, healthchecks y el orden de arranque (`depends_on` con `condition`) |
| Beneficios | Portabilidad, consistencia («en mi máquina funciona») y base para escalar con Kubernetes |

**«¿Por qué no usaron Kubernetes?»**
El alcance de la entrega es una sola máquina, y Compose alcanza para declarar todo el sistema. Kubernetes sería el paso siguiente para varias máquinas, autoescalado y réplicas. El diseño ya lo permite, porque los servicios no tienen estado y tienen healthchecks.

---

## Tema 3.1. Arquitectura

| Concepto | En parkIN |
|---|---|
| Organización lógica y física | La lógica es el diagrama general sin tecnologías (sección 2 del documento). La física es el compose: un contenedor por servicio en una máquina |
| Centralizada, descentralizada, híbrida | Híbrida: cada servicio es un servidor central de su dominio, pero el sistema está repartido entre varios |
| AOD (*Architecture Overview Diagram*) | Alto nivel y sin tecnologías, para comunicar a todos los interesados: es el diagrama de la sección 2 |
| Estilo en capas | Dentro de cada servicio: rutas o resolvers, lógica y acceso a datos |
| Orientado a servicios y microservicios | Procesos separados, desplegables por separado, **cada uno con su base** (sin base compartida, a diferencia de una SOA clásica con un bus central) |
| Publicación-suscripción | Exchange *topic* de RabbitMQ: desacoplado por referencia (quien publica no conoce a quien escucha) y, con colas durables, también en el tiempo |
| Cliente-servidor | La web y el gateway; Reservas pidiéndole el precio a Cocheras |
| Event Driven Architecture | Productores (Reservas, Pagos), enrutador (el exchange) y consumidores (Reservas, Pagos, Cocheras) |

**Matriz de acoplamiento de publicación-suscripción:**

| | Acoplado en el tiempo | Desacoplado en el tiempo |
|---|---|---|
| **Acoplado por referencia** | Directo: REST y GraphQL | Buzón |
| **Desacoplado por referencia** | Basado en eventos | Espacio de datos compartido |

parkIN usa REST y GraphQL directos (acoplados en las dos dimensiones) y eventos por RabbitMQ con colas durables. Las colas durables lo acercan al cuadrante desacoplado en las dos dimensiones, porque el consumidor no necesita estar vivo cuando se publica.

**«¿Qué ventajas y desventajas tienen los microservicios en su caso?»**
- **Ventajas:** cada servicio escala y falla por separado (si Pagos cae, se sigue reservando); la regla crítica vive en un solo lugar; se extiende por eventos sin tocar lo que existe.
- **Desventajas:**
  - más piezas que operar: 4 bases, el broker y la caché;
  - no hay transacciones entre servicios (hay que usar saga);
  - quedan dependencias síncronas entre Reservas y Cocheras.

---

## Tema 4.1. Comunicación

| Modo de flujo de datos (Kleppmann) | Respuesta | Bloqueante | En parkIN |
|---|---|---|---|
| A través de la base de datos | No | No | No se usa entre servicios: *database per service* |
| A través de servicios (REST, GraphQL, RPC) | Sí | Sí, síncrono | Web y servicios; Reservas con Cocheras |
| Paso de mensajes asíncrono | Opcional | No | RabbitMQ entre Reservas, Pagos y Cocheras |

**Síncrono frente a asíncrono.**
- **Síncrono:** acopla en el tiempo (los dos tienen que estar vivos) y encadena latencias.
- **Asíncrono:** la cola amortigua los picos y se pueden sumar consumidores.
- **Regla que seguimos:** síncrono cuando el usuario necesita la respuesta ya (el precio para crear la reserva), asíncrono cuando no (confirmar el pago).

**«¿Por qué no usaron una base compartida para comunicar los servicios?»**
Porque acopla los esquemas: un cambio en una tabla rompe a otro servicio, y una base caída tira abajo a todos. Con una base por servicio, cada uno es dueño de sus datos y los demás se enteran por eventos o por su API.

---

## Tema 4.2. REST

| Concepto | En parkIN |
|---|---|
| Recursos con sustantivos | `/reservas`, `/pagos/{id}`, `/users/{id}`, sin verbos en la URL |
| Propiedades de los métodos | GET es seguro e idempotente; POST no es idempotente, por eso `POST /reservas` y `POST /pagos` exigen `Idempotency-Key` |
| Sin estado | El JWT viaja en `Authorization` en cada request; el servidor no guarda sesión |
| 201 | Reserva o pago creados |
| 400 y 422 | Datos con formato inválido (422 `DATOS_INVALIDOS` en Pagos) |
| 401 y 403 | 401: sin token o inválido (autenticación). 403: token válido pero sin permiso (autorización), como `NO_ES_TU_RESERVA` |
| 404 | Recurso inexistente |
| 409 | Conflicto: franja ocupada, o clave de idempotencia reutilizada |
| 429 | Rate limiting del gateway |
| 502 | El gateway no llega al servicio |
| 503 y `Retry-After` | Dependencia caída, o reintentos de transacción agotados en Reservas |
| Degradación | Si Reservas no responde, la búsqueda devuelve resultados sin filtrar en vez de fallar |
| Reintentos | La pasarela manda el webhook hasta 4 veces, con espera creciente (*backoff*: 400, 800 y 1600 ms); una transacción abortada se intenta hasta 3 veces en total |

**«¿Por qué `POST /reservas` necesita `Idempotency-Key` y `GET` no?»**
GET es idempotente por definición: repetirlo no cambia nada. POST no lo es: si la respuesta se pierde y el cliente reintenta, sin la clave se crearían dos reservas. Con la clave, el segundo intento devuelve la reserva ya creada.

---

## Tema 4.3. GraphQL

| Concepto | En parkIN |
|---|---|
| El cliente define la forma de la respuesta | El mapa pide 5 campos; la ficha pide horarios, fotos y dirección |
| Un solo endpoint, por POST | `POST /graphql` en Cocheras |
| Schema, Query, Mutation | `buscarCocheras`, `cochera` y `misCocheras`; `crearCochera`, `actualizarCochera`, `definirDisponibilidad` y `eliminarCochera` |
| Problema N+1 y DataLoader | Sin DataLoader, 50 cocheras con su disponibilidad serían 1 consulta más 50; con él, 1 más 1. Hay un test que lo verifica contando las consultas (con 5 cocheras) |
| Errores con HTTP 200 | Por eso se mide cada operación con su resultado (`ok`, `error_cliente`, `error_interno`) y hay una alerta |
| Queries maliciosas | Profundidad máxima 5 |
| Difícil de cachear por HTTP | La caché se hace en el servidor, en Redis, con los argumentos de la búsqueda como clave |
| Subscription | No se usa: los avisos en tiempo real van por Socket.IO desde Pagos |

**«¿Por qué GraphQL solo en Cocheras?»**
Porque es el único servicio con vistas que necesitan datos muy distintos de la misma entidad: el mapa, la ficha y el panel del propietario. Con REST habría que elegir entre traer de más (*over-fetching*), traer de menos y hacer más llamadas (*under-fetching*), o crear un endpoint por pantalla. Reservas y Pagos son operaciones simples, y REST es más fácil de cachear y monitorear.

---

## Tema 4.4. RabbitMQ

| Concepto | En parkIN |
|---|---|
| Productor, exchange, cola, consumidor, *routing key* | Reservas y Pagos publican en el exchange `cocheras.eventos` con claves como `reserva.confirmada` o `pago.aprobado` |
| Tipos de exchange: direct, topic, fanout, headers | **Topic**: cada cola se suscribe a las claves que le interesan, y un mismo evento llega a varias colas (por ejemplo, `reserva.confirmada` a Pagos y a Cocheras). Hoy los *bindings* son claves exactas; el tipo topic permite que un suscriptor nuevo use patrones como `reserva.*` |
| ACK manual | El mensaje se confirma recién después de guardar el cambio; si el proceso muere antes, se reentrega |
| Entrega at-most-once, at-least-once o exactly-once | **At-least-once**, y por eso los consumidores son idempotentes (descartan el `eventId` repetido). Exactly-once es caro; lo emulamos con at-least-once más idempotencia |
| Durabilidad y *publisher confirms* | Colas durables de tipo *quorum*; el publicador marca el evento como enviado recién cuando el broker lo confirma |
| Prefetch | 10 mensajes por consumidor |
| Consumidores que compiten | Varias réplicas de un servicio leen de la misma cola y se reparten los mensajes |
| DLQ | `cocheras.dlq`: los mensajes inválidos van directo, y los que fallan varias veces, al superar el límite de entregas |

**«¿Por qué RabbitMQ y no Kafka?»**
Necesitamos repartir cada evento a las colas interesadas, con confirmación por mensaje, reintentos y DLQ. RabbitMQ lo trae incorporado. Kafka está pensado para un registro histórico de eventos y volúmenes muy altos, que no es nuestro caso.

**«¿Qué pasa si RabbitMQ se cae?»**
Reservas y Pagos siguen funcionando: los eventos quedan en su tabla outbox y salen cuando vuelve el broker. Los consumidores se reconectan solos, y `/ready` responde `503` mientras tanto.

---

## Tema 4.5. WebSockets

| Concepto | En parkIN |
|---|---|
| Bidireccional y persistente, frente al request-response de HTTP | Pagos empuja la confirmación a la web apenas llega `reserva.confirmada` |
| Alternativas: polling, long polling, SSE | Solo con polling, el aviso tarda lo que tarde la próxima consulta y cada pestaña carga al servidor. Usamos WebSocket para el aviso inmediato y dejamos una consulta cada 5 s como respaldo mientras la reserva espera el pago. SSE alcanzaría para avisos de un solo sentido, pero Socket.IO trae reconexión y salas por usuario |
| Handshake (`Upgrade`, 101 Switching Protocols) | Lo hace Socket.IO a través del gateway, que deja pasar el `Upgrade` |
| Heartbeat (ping/pong) y reconexión | Socket.IO los maneja solo |
| Conexión con estado y escalado horizontal difícil | **Adaptador de Redis** (el Pub/Sub compartido de la clase): está pensado para que un aviso llegue aunque el cliente esté conectado a otra réplica de Pagos. No lo probamos con más de una réplica |
| Autenticación | El JWT va en el handshake (`auth.token`) y se verifica al conectar |

**«¿Y si el aviso por WebSocket se pierde?»**
No se pierde información: el aviso es un servicio de «mejor esfuerzo». La fuente de verdad es `GET /reservas/{id}`, y la pantalla de la reserva la consulta cada 5 segundos mientras espera el pago. El WebSocket solo acelera la noticia.

---

## Tema 6. Coordinación

| Concepto | En parkIN |
|---|---|
| Exclusión mutua distribuida | Reservar una franja es la sección crítica |
| Algoritmos: servidor central, anillo, Ricart y Agrawala | **Servidor central**: la base de Reservas coordina con un lock por cochera más la restricción de exclusión |
| Propiedades: seguridad y pervivencia | **Seguridad:** nunca dos reservas solapadas. **Pervivencia:** el lock se libera al terminar la transacción, aunque el proceso muera, y una transacción abortada se intenta hasta 3 veces en total antes de responder `503` |
| Problemas del servidor central | Cuello de botella y punto único de falla. Es aceptable: si la base de Reservas no está, no hay reservas que proteger. El lock es por cochera, así que cocheras distintas no se bloquean entre sí |
| Relojes físicos, deriva, NTP | Todo se guarda en UTC. La tarea que expira reservas compara con la hora de la base (`now()`), así que sus réplicas no discrepan. Pero el plazo lo calcula Reservas con su reloj y Pagos compara con el suyo: en el compose comparten el reloj del host; con varias máquinas haría falta NTP. Un desfase de segundos queda cubierto: un cobro de una reserva vencida se reembolsa |
| Relojes lógicos de Lamport («sucede antes») | El orden de los eventos no se deduce de su hora. Se garantiza con el estado: cada cambio es condicional al estado actual, y la copia local de Pagos nunca retrocede de estado |
| Elección de líder | No hace falta: no hay un nodo especial. Las réplicas compiten por la cola, y las tareas periódicas usan `SKIP LOCKED` para no pisarse |
| Consenso | Entre servicios no se usa un protocolo de acuerdo: la saga lo reemplaza con transacciones locales y compensaciones. Pero sí hay consenso adentro de una herramienta: las colas *quorum* de RabbitMQ replican cada mensaje con Raft (con un solo nodo, como en el compose, no hay réplicas; en un clúster de 3, un mensaje se confirma cuando lo guardó la mayoría) |
| ZooKeeper | No hace falta: el único recurso con exclusión mutua es la franja, y su dueño natural (la base de Reservas) ya ofrece locks y restricciones |

**«¿Por qué no usan *two-phase commit* entre Reservas y Pagos?»**
Porque bloquea recursos de los dos servicios mientras se espera al otro, y si el coordinador cae, los participantes quedan trabados. Además, la pasarela externa no participaría. La saga deja cada paso como una transacción local y corrige con compensaciones: el resultado es consistencia eventual, sin bloqueos entre servicios.

**«¿Qué pasa si dos réplicas de Reservas intentan expirar la misma reserva?»**
La tarea periódica toma las filas con `FOR UPDATE SKIP LOCKED`: cada réplica procesa filas distintas y ninguna espera a la otra.

---

## Tema 7. Observabilidad

| Concepto | En parkIN |
|---|---|
| Observabilidad y monitoreo | La observabilidad es la propiedad de entender el estado interno por lo que el sistema emite; el monitoreo es usarla (tablero y alertas) |
| Logs | JSON a stdout con `traceId`, recogidos por Alloy y guardados en Loki |
| Métricas | Prometheus lee `/metrics` cada 15 s (*pull*) |
| Trazas | OpenTelemetry a Jaeger; el `traceId` nace en el gateway y viaja por HTTP y dentro de cada evento |
| Visualización y alertas | Grafana y 18 alertas de Prometheus |
| Beneficios | Análisis de causa raíz: así se encontró el *deadlock* de Reservas |
| Desafíos | Monitorear microservicios y contenedores: lo resolvimos con el mismo formato de nombres y etiquetas de métricas en todos los servicios. Volumen de datos: no se registran los healthchecks |

**«¿Qué diferencia hay entre métricas y logs?»**
- **Las métricas** son números agregados, baratos de guardar y consultar, y sirven para alertar: dicen *que* algo anda mal.
- **Los logs** son eventos individuales con detalle: dicen *por qué*.
- **Las trazas** muestran *dónde*, porque desglosan el tiempo de un pedido por servicio.

---

## Temas que pueden preguntar aunque parkIN no los use directamente

### Relojes lógicos

- **Lamport:** cada proceso lleva un contador. Lo incrementa en cada evento, lo manda en cada mensaje y, al recibir uno, toma el máximo más uno. Garantiza que si A sucede antes que B, la marca de A es menor. Lo contrario no vale: con marcas distintas no se sabe si dos eventos son concurrentes.
- **Relojes vectoriales:** cada proceso lleva un contador por proceso. Sirven para detectar si dos eventos son concurrentes.
- **En parkIN no hacen falta**, porque cada dato tiene un único dueño que ordena sus cambios (Reservas, para la reserva) y los consumidores son idempotentes y condicionales al estado.

### Sincronización de relojes físicos

- **Cristian:** un servidor de tiempo; el cliente ajusta a la hora recibida más la mitad del tiempo de ida y vuelta. Problema: punto único de falla.
- **Berkeley:** un maestro consulta a todos, promedia y le manda a cada uno su ajuste (sincronización interna).
- **NTP:** jerarquía de estratos sincronizada con UTC por internet.
- **En parkIN**, el sistema operativo de la máquina se sincroniza con NTP y los contenedores usan ese reloj.

### Algoritmos de exclusión mutua

| Algoritmo | Mensajes por entrada | Problema | En parkIN |
|---|---|---|---|
| Servidor central | 3: pedir, conceder y liberar | Cuello de botella y punto único de falla | **El que usamos**: la base de Reservas es el coordinador, y ya es persistente y compartida |
| Anillo con token | Variable: el token circula aunque nadie lo pida | Si se pierde el token, hay que regenerarlo | — |
| Ricart y Agrawala | 2(n-1) | Si cualquier proceso cae, nadie más entra | — |

### Elección de líder

- **Bully:** gana el proceso de mayor id que responde.
- **Anillo:** el mensaje de elección recorre el anillo juntando ids y gana el mayor.
- **En parkIN no hay líder:** las réplicas compiten por la cola, y las tareas periódicas se reparten las filas con `SKIP LOCKED`.

### Consenso

- **Paxos y Raft:** un líder propone y se acepta cuando lo confirma la mayoría. Toleran la caída de una minoría.
- **FLP:** en un sistema asíncrono, si un solo proceso puede fallar, no hay algoritmo determinista que garantice llegar al consenso. Por eso, en la práctica, se usan timeouts.
- **En parkIN:** las colas *quorum* de RabbitMQ usan Raft.

### Modelos de falla (Coulouris)

| Falla | Qué es | En parkIN |
|---|---|---|
| Caída (*crash*) | El proceso se detiene | Healthchecks y reinicio automático; los mensajes sin ACK se reentregan |
| Omisión | Se pierde un mensaje | ACK manual, reentrega y outbox |
| Temporización | La respuesta llega tarde | Timeouts (2 s en la consulta de ocupación) y alertas de latencia |
| Arbitraria (bizantina) | Respuestas incorrectas o maliciosas | No se tolera en general. Se acota validando la entrada, la firma HMAC del webhook y el JWT |

**Sistema síncrono o asíncrono.** El nuestro es asíncrono: no hay un límite garantizado para la respuesta. Por eso no se puede distinguir un servicio lento de uno caído, y usamos timeouts.

### Evolución de contratos (Kleppmann)

- **Compatibilidad hacia atrás:** el código nuevo lee datos viejos.
- **Compatibilidad hacia adelante:** el código viejo lee datos nuevos.
- **En parkIN:** los eventos van en JSON y cada consumidor lee solo los campos que necesita, así que sumar un campo no rompe a nadie. Un ejemplo real: para que la dirección exacta venza, Cocheras empezó a guardar el fin de la franja. Las filas anteriores, sin ese dato, siguen funcionando: es compatibilidad hacia atrás.

### Modelo de madurez de Richardson (REST)

Va del nivel 0 (un solo endpoint, estilo RPC) al 1 (recursos), al 2 (verbos y códigos HTTP) y al 3 (HATEOAS: la respuesta trae los enlaces a las acciones posibles). parkIN está en el **nivel 2**. No usa HATEOAS porque el único cliente es nuestra web, que ya conoce las rutas por el contrato.

### Observabilidad: métodos y objetivos

- **RED** (*Rate, Errors, Duration*) por servicio es lo que muestra el tablero: requests por segundo, errores 5xx y latencia p95.
- **Golden signals** de Google: latencia, tráfico, errores y saturación. La saturación son los eventos pendientes en el outbox y en las colas.
- **SLI, SLO y SLA:**
  - el SLI es, por ejemplo, la p95 de la búsqueda;
  - el SLO implícito son 500 ms (la alerta);
  - no hay SLA, porque no hay un compromiso con clientes.
- **Lo conocido y lo desconocido:** el monitoreo cubre lo que ya sabemos preguntar (lo que tiene alerta). La observabilidad permite investigar lo que no sabíamos que iba a pasar, como el *deadlock*, siguiendo el `traceId`.

### Docker: contenedor y máquina virtual

- **Contenedor y máquina virtual:** un contenedor comparte el kernel del host, arranca en segundos y pesa poco. Una máquina virtual emula hardware y trae su propio sistema operativo.
- **Capas de la imagen:** cada instrucción del Dockerfile es una capa cacheada. Por eso los Dockerfiles copian primero `package.json` e instalan las dependencias, y recién después copian el código: un cambio de código no reinstala todo.

### P2P y distribución vertical u horizontal

- **P2P:** no lo usamos, porque la franja y el pago necesitan una autoridad que decida.
- **Distribución vertical:** repartir por función. Son nuestros microservicios.
- **Distribución horizontal:** repartir el mismo servicio en réplicas o particiones. El diseño lo permite, pero no se probó.

## Preguntas transversales que suelen aparecer

**«¿Es CP o AP?»**
Depende de la operación.
- **Al reservar y pagar, elegimos consistencia:** si la base de Reservas no responde, se rechaza la reserva antes que arriesgar una doble reserva.
- **En la búsqueda, elegimos disponibilidad:** si Reservas o Redis no responden, se devuelven resultados, aunque puedan estar un poco viejos.

**«¿Qué pasa si se cae cada componente?»**

| Cae | Efecto |
|---|---|
| Gateway | No entra nada: es el punto único de entrada (alerta `GatewayCaido`). En producción iría replicado detrás de un balanceador |
| Usuarios | No se puede iniciar sesión ni renovarla; los que ya tienen token siguen operando hasta 15 minutos, porque el gateway valida solo |
| Cocheras | No hay búsqueda, y no se puede reservar (`503`, falta el precio) |
| Reservas | No se reserva; la búsqueda sigue, sin filtrar por ocupación |
| Pagos | Se sigue reservando; los eventos esperan en la cola. No se puede pagar hasta que vuelva |
| RabbitMQ | Los eventos esperan en el outbox; se publican cuando vuelve |
| Redis | La búsqueda va directo a la base (probado). Si Pagos arranca sin Redis, espera 5 segundos y sigue sin el adaptador de Socket.IO: con una réplica los avisos llegan igual (probado en Docker). Si Redis vuelve, Pagos no suma el adaptador hasta reiniciarse, lo que solo importa con varias réplicas |

**«¿Qué cambiarían para producción?»**
- Varias réplicas probadas, con un orquestador.
- Solo el gateway publicado, sin los puertos de desarrollo.
- Secretos reales, una pasarela real.
- Autenticación en Grafana, y un canal para recibir las alertas.
