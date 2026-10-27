# Checklist de la letra

Entrega: **15/11/2026 23:59** (documento + zip o GitHub). Defensa oral la semana siguiente. Vale 30% del curso.

## Requisitos

- [ ] 1. Idea: problemática, solución y alcance
- [x] 2. Características de SD y cómo se abordan → [`caracteristicas-sd.md`](caracteristicas-sd.md)
- [x] 3. Arquitectura con diagrama y justificación → [`arquitectura.md`](arquitectura.md)
- [x] 4. **Mínimo 4 funcionalidades** operativas y demostrables
  - [x] Registro y autenticación
  - [x] Alta y gestión de cocheras
  - [x] Búsqueda y reserva por franja
  - [x] Pago y notificación
- [x] 5. **Mínimo 2 formas de comunicación** (REST, GraphQL, RabbitMQ y WebSocket) con justificación → [`contratos.md`](contratos.md)
- [x] 6. Persistencia (Postgres)
- [x] 7. 12-Factor → [`12-factor.md`](12-factor.md)
- [x] 8. Observabilidad (≥ 1 pilar) → [`observabilidad.md`](observabilidad.md)
- [x] 9. Uso de IA → [`uso-ia.md`](uso-ia.md) (borrador; cada integrante revisa su parte)

## Estructura del documento

- [ ] Introducción: idea, relevancia, uso de IA (hay un borrador en `docs/documento-final/01-introduccion.md`)
- [x] Diseño: características de SD, arquitectura + diagrama, 12F
- [ ] Tecnologías y motivos (incluye la base de datos)
- [x] Comunicación (base escrita en `contratos.md` y `arquitectura.md`; falta pasarla al documento): tipos, motivo y caso de uso
- [ ] Producto: screenshots de las funcionalidades (**pendiente**: registro, cocheras, búsqueda y reserva, pago y avisos)
- [ ] Observabilidad (base en `observabilidad.md`; faltan las capturas de Grafana y Jaeger)
- [ ] Conclusión

## Defensa

- [ ] Demo ensayada con `docker compose up` desde cero (el arranque en frío se verificó el 26/10; falta el ensayo completo)
- [ ] Guion con el reparto de tiempos (hay una guía para Reservas e infraestructura en `docs/defensa/`; faltan las de los demás)
- [ ] Cada integrante preparó preguntas probables de su servicio
- [ ] Plan B por si falla el túnel: sistema local en `http://localhost:8081`, y capturas o un video de respaldo
- [ ] Datos de demo cargados antes (`node scripts/sembrar-cocheras.mjs`)

## Entrega

- [x] El repositorio es público (los docentes pueden verlo sin permisos) y no contiene secretos: se revisaron los 63 commits en busca de claves privadas, tokens y archivos `.env`, y `.gitignore` excluye `.env` y `*.pem`
- [ ] Decidir el formato: enlace de GitHub, zip o ambos
- [ ] Dejar una etiqueta de versión en el commit que se entrega: `git tag entrega-final && git push origin entrega-final`
- [ ] Si se entrega un zip, generarlo desde la etiqueta (sin `node_modules` ni claves): `git archive --format=zip --prefix=parkin/ -o parkin-entrega.zip entrega-final`
- [ ] Probar el zip o el enlace en una carpeta limpia: `docker compose up --build` y el recorrido completo
- [ ] Subir el documento y el zip o el enlace **antes del 15/11 a las 23:59** (idealmente el 13 o el 14)
