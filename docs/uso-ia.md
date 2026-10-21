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
| 2026-10-21 | Martina | Claude Code | Integración del gateway con Usuarios: endpoint `/auth/verificar` para `auth_request` de NGINX (el NGINX libre no valida JWT), con `X-User-Id` y `X-User-Roles`; métricas Prometheus y tests | Se adoptó `auth_request` frente a OpenResty por simplicidad; se probó de punta a punta, incluida la concurrencia (8 reservas simultáneas: 1 creada, 7 en conflicto). La configuración del gateway se le pasa a Romina |
| 2026-10-21 | Martina | Claude Code | Front conectado a los servicios reales: ficha, reserva con `Idempotency-Key` y cuenta regresiva, mis reservas, panel del propietario, avisos por WebSocket, imagen Docker con nginx | Se probó el flujo completo en navegador (publicar, reservar, 409, cancelar y volver a reservar). Pago pendiente del servicio de Pagos |
