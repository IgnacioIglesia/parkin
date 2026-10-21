# Uso de Inteligencia Artificial

La letra exige detallar cómo se usó la IA y enumerar las decisiones concretas en las que sirvió de apoyo. Ir completando durante el proyecto, no al final.

## Metodología

_Qué herramientas usamos y para qué tipo de tareas._

## Registro de decisiones

| Fecha | Quién | Herramienta | Qué se consultó / decidió | Qué se aceptó o cambió |
|---|---|---|---|---|
| 2026-10-21 | Ignacio | Claude Code | Estructura inicial del repo a partir de la letra y la preentrega | Esqueleto de carpetas, docker-compose, docs |
| 2026-10-21 | Romina | Claude Code | Esqueleto del servicio Pagos: logs JSON con traceId, migraciones, esquema con índice único parcial, outbox y tabla de idempotencia. Diagnóstico de CRLF en scripts (exit 127) | Se aceptó, adaptado a la reestructura del repo (carpeta `pagos/`, `DATABASE_URL`) |
| 2026-10-21 | Romina | Claude Code | Propuesta de contrato de Pagos: `POST /pagos`, webhook firmado con HMAC, pasarela mock, payloads de eventos y de WebSocket | Pendiente de revisión del equipo en el PR |
