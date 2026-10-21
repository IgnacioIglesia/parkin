# Servicio de Cocheras

Alta, edición y baja de cocheras, disponibilidad semanal y búsqueda por radio. Contrato en `docs/contratos.md` §6.

- Stack: Node.js 24 (ESM), Express 5 + Apollo Server 5, PostgreSQL + PostGIS (`pg`).
- Responsable: Diego Marin.

## Endpoints

| Ruta | Qué hace |
|---|---|
| `POST /graphql` | API GraphQL (profundidad máxima 5) |
| `GET /health` | El proceso responde |
| `GET /ready` | Llega a su base de datos (503 si no) |

## Variables de entorno

| Variable | Obligatoria | Por defecto |
|---|---|---|
| `DATABASE_URL` | Sí | |
| `PORT` | No | `4000` |
| `LOG_LEVEL` | No | `info` |

## Correrlo

Con Docker, desde la raíz del repo:

```bash
docker compose up --build cocheras
```

Sin Docker, desde `cocheras/` (necesita la base `db-cocheras` levantada):

```bash
cp .env.example .env
npm install
npm run dev
```

Tests:

```bash
npm test
```
