# ParkIN

Plataforma distribuida de alquiler de cocheras por franja horaria. Proyecto de Sistemas
Distribuidos, Universidad de Montevideo (2026).

## Levantar todo

```bash
docker compose up --build
```

Con eso alcanza, también la primera vez: el servicio `jwt-claves` genera las claves de los JWT en
`infra/jwt/` si faltan (no se commitean). Para regenerarlas, borrá `infra/jwt/*.pem` y volvé a levantar.

| Qué | Dónde |
|---|---|
| Web | http://localhost:8081 |
| API Gateway | http://localhost:8080 |
| RabbitMQ (gestión) | http://localhost:15672 (guest / guest) |
| Grafana | http://localhost:3030 |
| Prometheus | http://localhost:9090 |
| Jaeger | http://localhost:16686 |

Los servicios con `profiles: ["pendiente"]` en `docker-compose.yml` todavía no tienen código; se
levantan con `docker compose --profile pendiente up --build`.

## Estructura

| Carpeta | Servicio | Responsable |
|---|---|---|
| `gateway/` | API Gateway (NGINX) | Romina Lubniski |
| `usuarios/` | Registro, login, JWT, perfiles y roles | Martina Berrutti |
| `cocheras/` | Cocheras, disponibilidad y búsqueda (GraphQL) | Diego Marin |
| `reservas/` | Reservas y control de concurrencia | Ignacio Iglesia |
| `pagos/` | Pagos y notificaciones en tiempo real | Romina Lubniski |
| `web/` | Front (React) | Martina Berrutti |
| `infra/` | RabbitMQ, Prometheus, claves JWT | Ignacio Iglesia |

Contratos entre servicios: [`docs/contratos.md`](docs/contratos.md). Cada servicio tiene su README
con variables de entorno y cómo correrlo solo.
