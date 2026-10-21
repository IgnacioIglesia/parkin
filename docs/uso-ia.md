# Uso de Inteligencia Artificial

La letra exige detallar cómo se usó la IA y enumerar las decisiones concretas en las que sirvió de apoyo. Ir completando durante el proyecto, no al final.

## Metodología

_Qué herramientas usamos y para qué tipo de tareas._

## Registro de decisiones

| Fecha | Quién | Herramienta | Qué se consultó / decidió | Qué se aceptó o cambió |
|---|---|---|---|---|
| 2026-10-21 | Ignacio | Claude Code | Estructura inicial del repo a partir de la letra y la preentrega | Esqueleto de carpetas, docker-compose, docs |
| 2026-10-21 | Diego | Claude Code | Tipos auxiliares del esquema GraphQL de Cocheras en `docs/contratos.md` | Se definieron Punto, Franja, TipoVehiculo, Propietario y CocheraInput respetando los nombres del contrato |
| 2026-10-21 | Diego | Claude Code | Esqueleto del servicio Cocheras: Express + Apollo, health/ready, logs JSON con traceId, Dockerfile y tests | Se aceptó; resolvers quedan como stubs hasta el paso de PostGIS |
| 2026-10-21 | Diego | Claude Code | Persistencia de Cocheras: esquema PostGIS, migraciones, resolvers, búsqueda por radio con disponibilidad y ocupación de Reservas, DataLoader | Se aceptó. Decisiones: ubicación aproximada fija a 100-300 m; si Reservas no responde la búsqueda degrada sin filtrar ocupación pero la baja se rechaza |
| 2026-10-21 | Diego | Claude Code | Consumidor RabbitMQ de Cocheras (idempotente, DLQ, reconexión) y caché de búsquedas en Redis con invalidación por versión | Se aceptó. Al probarlo se detectó que `infra/rabbitmq/definitions.json` no declara el vhost ni usuarios y RabbitMQ no arranca desde cero; se avisó a Ignacio |
| 2026-10-21 | Martina | Claude Code | Servicio Usuarios: Express 5, migraciones SQL con advisory lock, JWT RS256, refresh token opaco rotativo con detección de reuso | Se adoptó; se probó cada endpoint, incluidos los casos de error |
| 2026-10-21 | Martina | Claude Code | Bug encontrado al probar el front: recargar durante un refresh cerraba todas las sesiones por la detección de reuso. Se agregó una ventana de gracia de 30 s | Se adoptó; se probó la gracia, logout-todos y la detección fuera de la ventana |
| 2026-10-21 | Martina | Claude Code | Front web: React + Vite, sesión con refresh single-flight entre pestañas, búsqueda con mapa y mocks de Cocheras que respetan el contrato; dirección visual (tablero de partidas) elegida entre varias propuestas y revisada por un segundo agente | Se eligió la dirección visual; se probó en navegador en escritorio y celular; se aplicaron las 7 correcciones de la revisión |
| 2026-10-21 | Romina | Claude Code | Esqueleto del servicio Pagos: logs JSON con traceId, migraciones, esquema con índice único parcial, outbox y tabla de idempotencia. Diagnóstico de CRLF en scripts (exit 127) | Se aceptó, adaptado a la reestructura del repo (carpeta `pagos/`, `DATABASE_URL`) |
| 2026-10-21 | Romina | Claude Code | Propuesta de contrato de Pagos: `POST /pagos`, webhook firmado con HMAC, pasarela mock, payloads de eventos y de WebSocket | Pendiente de revisión del equipo en el PR |
| 2026-10-21 | Ignacio | Claude Code | Implementación del servicio de Pagos sobre el contrato de Romina y de la pasarela simulada: cobro con `Idempotency-Key`, webhook firmado, consumo de `reserva.*` con idempotencia, outbox hacia RabbitMQ, avisos por Socket.IO con Redis y reembolsos | Se adoptó; se probó de punta a punta por el gateway (flujo completo, rechazo, expiración con cobro tardío, seguridad, Pagos caído). Decisión: el pago tardío se resuelve con reembolso automático |
