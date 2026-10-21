# The Twelve-Factor App

Cómo aplicamos cada factor en parkIN. "Sí" quiere decir que está implementado en todos los servicios con código; "Parcial", que hay una diferencia que se explica.

| # | Factor | Aplicado | Cómo |
|---|---|---|---|
| I | Codebase | Sí | Un solo repositorio (monorepo) con una carpeta y una imagen por servicio. El mismo código se despliega en cualquier entorno; lo que cambia es la configuración. |
| II | Dependencies | Sí | Dependencias declaradas y con versión fija: `package-lock.json` (instaladas con `npm ci`) en los servicios Node y `requirements.txt` con versiones exactas en Reservas. Las imágenes no usan nada instalado en la máquina. |
| III | Config | Sí | Solo variables de entorno (`DATABASE_URL`, `RABBITMQ_URL`, `REDIS_URL`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `LOG_LEVEL`, ...), con un `.env.example` por servicio. `.env` y las claves `*.pem` están en `.gitignore`: no hay secretos en el repo. Las claves JWT se generan con `infra/jwt/generar-claves.sh`. |
| IV | Backing services | Sí | Postgres, RabbitMQ, Redis y Jaeger son recursos adjuntos que se ubican por URL: cambiar uno es cambiar una variable. Cocheras sigue funcionando sin Redis (sin caché). |
| V | Build, release, run | Sí | Build: un `Dockerfile` por servicio. Release: la imagen más la configuración del entorno (`docker-compose.yml`). Run: el contenedor. La imagen no cambia entre entornos. |
| VI | Processes | Sí | Los servicios no guardan estado en memoria entre requests: todo va a Postgres, Redis o RabbitMQ. La caché de búsquedas está en Redis, compartida entre réplicas. |
| VII | Port binding | Sí | Cada servicio es autónomo y expone su propio puerto HTTP (Cocheras 4000, Reservas 8000, Usuarios y Pagos 3000). El gateway los publica hacia afuera en el 8080. |
| VIII | Concurrency | Sí | Se escala agregando réplicas de un servicio. Las réplicas de un consumidor compiten por la misma cola de RabbitMQ (prefetch 10) y las migraciones usan un advisory lock para que varias réplicas puedan arrancar a la vez. |
| IX | Disposability | Sí | Arranque en segundos y apagado ordenado con `SIGTERM`: dejan de aceptar requests y cierran consumidor, caché y pool de conexiones. Con ACK manual, si un proceso muere a mitad de un mensaje, RabbitMQ lo reentrega. Los consumidores se reconectan solos si RabbitMQ se cae. |
| X | Dev/prod parity | Sí | `docker compose up` levanta los mismos backing services y versiones que producción (Postgres 16 con PostGIS, RabbitMQ 3.13, Redis 7). No se usan sustitutos como SQLite en desarrollo. |
| XI | Logs | Sí | Cada servicio escribe JSON a stdout y no maneja archivos de log. El entorno los recolecta: Alloy los lee de Docker y los manda a Loki (ver `observabilidad.md`). |
| XII | Admin processes | Parcial | Las migraciones son archivos SQL versionados en el repo y se aplican con el mismo código y la misma configuración que la app (tabla `schema_migrations`). La diferencia: se ejecutan al arrancar el servicio, no como un proceso aparte. Con una sola versión desplegada a la vez es suficiente; con despliegues graduales convendría separarlas. |
