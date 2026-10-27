# Tecnologías

> Borrador para el documento final. Las versiones son las del `docker-compose.yml` y los `Dockerfile` de cada servicio.

Elegimos cada tecnología por lo que resuelve en su servicio, no por uniformidad. Los servicios solo se hablan por protocolos estándar (HTTP con JSON, GraphQL, AMQP y WebSocket), así que cada uno puede usar el lenguaje y la base que mejor le sirvan sin afectar a los demás. Esa es también la forma en que el proyecto muestra la **heterogeneidad**: Reservas está en Python y el resto en Node.js, y se integran sin problemas porque los contratos (endpoints, eventos y esquema GraphQL) se escribieron antes de implementar.

## Servicios

| Componente | Tecnología | Por qué |
|---|---|---|
| Web | React 19, Vite, Tailwind, Leaflet, Socket.IO (cliente) | React y Vite dan un cliente liviano que se sirve como archivos estáticos (desde un contenedor NGINX o desde Vercel). Leaflet dibuja el mapa de búsqueda con OpenStreetMap, sin claves de API ni costo. Socket.IO recibe los avisos en tiempo real |
| API Gateway | NGINX 1.27 con njs | NGINX es un proxy inverso probado, rápido y con rate limiting incorporado. El módulo njs (JavaScript dentro de NGINX) permite validar el JWT en el propio gateway, porque la versión de código abierto no lo trae |
| Usuarios | Node.js 24, Express, `bcryptjs`, `jsonwebtoken`, zod | Express es suficiente para una API REST chica. bcrypt (en su versión en JavaScript) guarda las contraseñas con un hash lento a propósito, y los tokens se firman con RS256 para que los demás puedan verificarlos solo con la clave pública |
| Cocheras | Node.js 24, Apollo Server (GraphQL), DataLoader | GraphQL porque cada pantalla necesita datos distintos de la misma cochera (el mapa, pocos campos de muchas; la ficha, muchos de una). DataLoader agrupa las consultas que se repiten dentro de un mismo pedido para evitar el problema N+1 |
| Reservas | Python 3.12, FastAPI, psycopg 3, pika | FastAPI valida la entrada con tipos (pydantic) y genera la documentación de la API. psycopg da control fino de las transacciones, que es lo que importa en el servicio que garantiza que no haya dobles reservas. Además, un lenguaje distinto muestra la heterogeneidad |
| Pagos y notificaciones | Node.js 20, Express, Socket.IO con adaptador de Redis | Socket.IO mantiene la conexión con la web y reconecta solo. El adaptador de Redis está pensado para que un aviso llegue al cliente aunque esté conectado a otra réplica (no lo probamos con más de una) |
| Pasarela simulada | Node.js 20, sin dependencias | Imita el flujo de Mercado Pago (orden, página de pago, webhook firmado) para poder demostrar el pago completo sin mover dinero real |

## Persistencia

La letra pide un sistema de ficheros o una base de datos. Usamos **bases de datos**, una por servicio (*database per service*): ningún servicio lee la base de otro, y las referencias entre servicios son solo IDs. Así cada servicio puede cambiar su esquema o caerse sin arrastrar a los demás.

| Servicio | Base | Por qué |
|---|---|---|
| Usuarios | PostgreSQL 16 | Datos relacionales simples (usuarios, roles, refresh tokens guardados como hash) con restricciones de unicidad, por ejemplo un solo usuario por email |
| Cocheras | PostgreSQL 16 con PostGIS 3.4 | La búsqueda es geográfica: «cocheras a menos de N metros de este punto, ordenadas por distancia». PostGIS lo resuelve con `ST_DWithin` y un índice GIST, sin calcular distancias a mano sobre toda la tabla |
| Reservas | PostgreSQL 16 | Tiene una **restricción de exclusión** (`EXCLUDE USING gist` sobre la cochera y el rango horario) que impide en la propia base que existan dos reservas activas solapadas, aunque lleguen en el mismo instante. También aporta *advisory locks*, `SKIP LOCKED` para las tareas periódicas, y transacciones para el *outbox* |
| Pagos | PostgreSQL 16 | Necesita transacciones y bloqueos de fila para que el webhook sea idempotente, y un índice único parcial para que haya un solo pago vivo por reserva |

**Por qué PostgreSQL y no una base NoSQL.** El problema central del proyecto es la concurrencia sobre datos que no pueden quedar inconsistentes (una franja, un pago). PostgreSQL ofrece transacciones ACID, restricciones que se cumplen aunque haya varias réplicas del servicio, y bloqueos explícitos. Usar el mismo motor en los cuatro servicios simplifica la operación (una sola imagen, las mismas herramientas), sin que compartan datos.

**Redis 7** se usa para dos cosas cuyos datos pueden perderse sin romper nada: la caché de búsquedas de Cocheras (30 segundos, invalidada por versión) y el adaptador de Socket.IO de Pagos. Si Redis se cae, la búsqueda va directo a la base. Pagos, en cambio, necesita Redis para arrancar.

**Ficheros.** El sistema no guarda archivos: las fotos de las cocheras se guardan como URLs. Subirlas pediría un almacenamiento de objetos compartido entre réplicas (por ejemplo, uno compatible con S3), y quedó como evolución.

## Mensajería

**RabbitMQ 3.13** coordina el flujo de reserva y pago por eventos (`reserva.creada`, `pago.aprobado`, `reserva.confirmada`, etc.) sobre un exchange de tipo *topic*. Lo elegimos frente a Kafka porque lo que necesitamos es repartir cada evento a las colas que lo escuchan, con confirmación por mensaje, reintentos y una cola de mensajes fallidos (*Dead Letter Queue*), y no un registro histórico de eventos ni un volumen alto. RabbitMQ trae todo eso incorporado y es más simple de operar. Las colas son durables: si un servicio cae, los mensajes lo esperan.

## Contenedores y despliegue

Cada componente tiene su `Dockerfile` y todo el sistema se levanta con **Docker Compose** (`docker compose up --build`): servicios, bases, broker, caché y observabilidad. Los contenedores aíslan las dependencias de cada servicio (Node 20 y 24, Python 3.12, NGINX), hacen que el entorno sea igual en las cuatro máquinas del equipo y en la de los docentes, y declaran en un solo archivo cómo se conectan las piezas. Los healthchecks y `restart` del compose reinician lo que se cae. Para varias máquinas y autoescalado, el paso siguiente sería un orquestador como Kubernetes; no lo usamos porque el alcance de la entrega es una sola máquina.

## Observabilidad

**OpenTelemetry** para las trazas (exportadas a **Jaeger**), **Prometheus** para las métricas y las alertas, **Loki** con **Alloy** para juntar los logs JSON de todos los contenedores, y **Grafana** para verlo todo en un tablero y saltar de un log a su traza. Son herramientas de código abierto, estándar en la industria e independientes del lenguaje: la misma configuración sirve para los servicios en Node y en Python. El detalle está en la sección de Observabilidad.

## Herramientas de desarrollo

- **Pruebas:** `node:test` en los servicios Node y pytest en Reservas, con pruebas de integración contra PostgreSQL, RabbitMQ y Redis reales.
- **Inteligencia artificial:** Claude Code (ver la sección de uso de IA en la Introducción).
- **Control de versiones:** Git y GitHub, con una rama por tarea y pull requests a `main`.
