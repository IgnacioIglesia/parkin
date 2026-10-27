# Checklist de la letra

Entrega: **15/11/2026 23:59** (documento + zip o GitHub). Defensa oral la semana siguiente. Vale 30% del curso.

## Requisitos

- [x] 1. Idea: problemática, solución y alcance → [`documento-final/01-introduccion.md`](documento-final/01-introduccion.md)
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

- [x] Introducción: idea, relevancia, uso de IA → [`documento-final/01-introduccion.md`](documento-final/01-introduccion.md) (borrador para revisar entre todos)
- [x] Diseño: características de SD, arquitectura + diagrama, 12F
- [x] Tecnologías y motivos (incluye la base de datos) → [`documento-final/03-tecnologias.md`](documento-final/03-tecnologias.md); falta confirmar entre todos los motivos de RabbitMQ frente a Kafka y de PostgreSQL frente a NoSQL
- [x] Comunicación: tipos, motivo y caso de uso → [`documento-final/04-comunicacion.md`](documento-final/04-comunicacion.md)
- [x] Producto: capturas de las funcionalidades → [`documento-final/05-producto.md`](documento-final/05-producto.md)
- [x] Observabilidad → [`documento-final/06-observabilidad.md`](documento-final/06-observabilidad.md), con las capturas de `docs/capturas/`
- [x] Conclusión → [`documento-final/07-conclusion.md`](documento-final/07-conclusion.md)

## Defensa

- [ ] Demo ensayada con `docker compose up` desde cero (el arranque en frío y el recorrido de punta a punta se verificaron el 27/10 sobre `main` y desde un zip; falta el ensayo cronometrado de los cuatro, previsto el 13/11)
- [x] Guion con el reparto de tiempos → [`defensa/guion-general.md`](defensa/guion-general.md), con una guía por integrante en `docs/defensa/`
- [x] Cada integrante preparó preguntas probables de su servicio (una guía por parte en `docs/defensa/`; el guion de Pagos lo escribió Ignacio y falta que Romina lo revise)
- [ ] Plan B por si falla el túnel: sistema local en `http://localhost:8081` (descrito en el guion general); **falta grabar el video de respaldo** de las demos 1 a 4
- [ ] Datos de demo cargados antes (`node scripts/sembrar-cocheras.mjs`)

## Entrega

- [x] El repositorio es público (los docentes pueden verlo sin permisos) y no contiene secretos: se revisó el historial en busca de claves privadas, tokens y archivos `.env`, y `.gitignore` excluye `.env` y `*.pem`. **Repetir la revisión justo antes de la entrega**
- [ ] Decidir el formato: enlace de GitHub, zip o ambos
- [ ] Dejar una etiqueta de versión en el commit que se entrega: `git tag entrega-final && git push origin entrega-final`
- [ ] Si se entrega un zip, generarlo desde la etiqueta (sin `node_modules` ni claves): `git archive --format=zip --prefix=parkin/ -o parkin-entrega.zip entrega-final`
- [ ] Probar el zip o el enlace en una carpeta limpia: `docker compose up --build` y el recorrido completo (ensayado el 27/10 con un zip hecho desde `main`: 9 MB, sin claves ni `node_modules`, y el recorrido dio 10 de 10; repetirlo con el commit final)
- [ ] Generar el PDF final con la fecha de entrega: `FECHA=14/11/2026 node scripts/documento-final.mjs` (sale en `docs/documento-final/salida/`)
- [ ] Subir el documento y el zip o el enlace **antes del 15/11 a las 23:59** (idealmente el 13 o el 14)
