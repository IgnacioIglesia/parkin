# parkIN

Plataforma distribuida de alquiler y gestión de cocheras en tiempo real.
Proyecto de Sistemas Distribuidos — Universidad de Montevideo (docentes: Daniel Canoniero, Josefina Gallinal).

**Equipo:** Martina Berrutti · Ignacio Iglesia · Romina Lubniski · Diego Marin

## Problema

Encontrar estacionamiento genera congestión en zonas densas, mientras que muchas cocheras privadas quedan sin uso durante horas.
No hay un mecanismo confiable para gestionar reservas concurrentes y validar disponibilidad en tiempo real sin dobles reservas ni "cocheras fantasma".

## Solución

Sistema de microservicios donde los propietarios publican cocheras y los conductores buscan, reservan por franja horaria y pagan con confirmación inmediata.

## Microservicios

| Servicio | Carpeta | Responsabilidad |
|---|---|---|
| Usuarios | [`services/usuarios`](services/usuarios) | Registro, login y perfiles (propietario / conductor) |
| Cocheras | [`services/cocheras`](services/cocheras) | Alta, edición, ubicación, precio y disponibilidad |
| Reservas | [`services/reservas`](services/reservas) | Búsqueda, matching y bloqueo de horarios (concurrencia) |
| Pagos y Notificaciones | [`services/pagos-notificaciones`](services/pagos-notificaciones) | Cobro y confirmación en tiempo real a ambas partes |

Ver [`docs/arquitectura.md`](docs/arquitectura.md).

## Estructura

```
parkIN/
├── services/            # un directorio por microservicio (código + Dockerfile + README)
├── infra/               # init de bases de datos, config de observabilidad
├── docs/                # documentación que alimenta el informe final
│   └── decisiones/      # ADRs (una decisión técnica por archivo)
├── .github/             # plantilla de PR
├── docker-compose.yml   # infraestructura local (Postgres, RabbitMQ)
└── .env.example
```

## Arrancar el entorno local

```bash
cp .env.example .env
docker compose up -d      # Postgres + RabbitMQ
```

- Postgres: `localhost:5432` (una base por servicio, ver `infra/postgres/init.sql`)
- RabbitMQ: `localhost:5672`, consola en http://localhost:15672

## Cómo trabajamos

Ver [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Entregables y fechas

| Hito | Fecha |
|---|---|
| Preentrega (integrantes, tema, arquitectura) | 06/09/2026 ✅ |
| **Entrega final** (documento + repo/zip), antes de las 23:59 | **15/11/2026** |
| Defensa oral | semana siguiente (a confirmar) |

El checklist de requisitos de la letra está en [`docs/checklist-entrega.md`](docs/checklist-entrega.md).
