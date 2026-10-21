# Cómo trabajamos

## Ramas

- `main`: siempre estable y demostrable. No se pushea directo.
- `feat/<servicio>-<descripcion>`, `fix/...`, `docs/...`: una rama por tarea, salen de `main`.

## Flujo

1. Tomar una issue (o crearla) y asignársela.
2. `git switch -c feat/reservas-bloqueo-horario`
3. Commits chicos y descriptivos (ej: `reservas: agrega exclusion constraint por franja`).
4. Abrir PR hacia `main`. Requiere **1 aprobación** de otro integrante.
5. Squash & merge, borrar la rama.

## Reglas

- Cada servicio vive en `services/<nombre>` y tiene su propio README, Dockerfile y tests.
- Los servicios no comparten base de datos: se hablan por REST o por eventos en RabbitMQ.
- Configuración solo por variables de entorno (ver `.env.example`). Nunca commitear secretos.
- Decisiones técnicas relevantes: un archivo en `docs/decisiones/` (copiar `0000-plantilla.md`).
- Si usás IA para algo relevante, anotalo en `docs/uso-ia.md` (la letra lo exige).

## Reparto sugerido (ajustar entre ustedes)

| Integrante | Servicio principal | Apoyo |
|---|---|---|
| Martina | Usuarios | Docs |
| Ignacio | Reservas | Infra |
| Romina | Cocheras | Observabilidad |
| Diego | Pagos y Notificaciones | Mensajería |
