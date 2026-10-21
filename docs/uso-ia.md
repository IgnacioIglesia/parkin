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
