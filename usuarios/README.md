# Servicio de Usuarios

Registro, login, refresh, perfiles y roles (**PROPIETARIO**, **CONDUCTOR**; un usuario puede tener ambos).
Emite el JWT RS256 que el gateway valida con la clave pública.

- Stack: Node.js + Express 5, PostgreSQL (`db-usuarios`), bcrypt, JWT RS256.
- Puerto interno: `3000` (`3001` en el host).
- Responsable: Martina Berrutti.

## Levantar

```bash
bash infra/jwt/generar-claves.sh     # una sola vez: crea infra/jwt/*.pem (no se commitean)
docker compose up --build usuarios
```

Las migraciones (`migrations/*.sql`) se aplican solas al arrancar, con un advisory lock de Postgres
para que dos réplicas que arrancan a la vez no migren en paralelo.

## Variables de entorno

| Variable | Obligatoria | Default | Descripción |
|---|---|---|---|
| `DATABASE_URL` | sí | | `postgres://user:pass@host:5432/db` |
| `JWT_PRIVATE_KEY_PATH` | sí | | PEM de la clave privada (la pública se deriva de ella) |
| `JWT_ISSUER` | no | `parkin-usuarios` | Claim `iss` |
| `PORT` | no | `3000` | |
| `ACCESS_TOKEN_TTL_SEG` | no | `900` | 15 min |
| `REFRESH_TOKEN_TTL_DIAS` | no | `7` | |
| `REFRESH_TOKEN_GRACIA_SEG` | no | `30` | Ventana en la que un token recién rotado todavía se acepta |
| `BCRYPT_ROUNDS` | no | `10` | |
| `LOG_LEVEL` | no | `info` | |

## Endpoints

Detrás del gateway llevan el prefijo `/api/usuarios` (ej: `/api/usuarios/auth/login`).
Errores: `{ "error": { "codigo": "...", "mensaje": "...", "detalles": [...] } }`.

| Método | Ruta | Auth | Respuesta |
|---|---|---|---|
| POST | `/auth/register` | no | 201 sesión · 409 `EMAIL_EN_USO` · 422 |
| POST | `/auth/login` | no | 200 sesión · 401 `CREDENCIALES_INVALIDAS` · 422 |
| POST | `/auth/refresh` | no | 200 sesión · 401 `TOKEN_INVALIDO` / `TOKEN_REUTILIZADO` |
| POST | `/auth/logout` | no | 204 (revoca ese refresh token) |
| POST | `/auth/logout-todos` | sí | 204 (revoca todas las sesiones) |
| GET | `/users/me` | sí | 200 usuario |
| PATCH | `/users/me` | sí | 200 usuario · 422 |
| POST | `/users/me/roles` | sí | 200 `{ usuario, accessToken }` |
| GET | `/users/{id}` | sí | 200 `{ id, nombre }` · 404 |
| GET | `/.well-known/jwks.json` | no | JWKS con la clave pública |
| GET | `/auth/public-key` | no | Clave pública en PEM |
| GET | `/health`, `/ready` | no | 200 / 503 |

Los cinco primeros de `docs/contratos.md` (sección 3) están implementados tal cual; el resto son
agregados que hay que proponer al contrato por PR.

**Register**: `{ "email", "password" (8-72), "nombre", "telefono"?, "roles"?: ["CONDUCTOR","PROPIETARIO"] }`
(por defecto `["CONDUCTOR"]`). **Login**: `{ "email", "password" }`. **Refresh / logout**: `{ "refreshToken" }`.
**PATCH /users/me**: `{ "nombre"?, "telefono"? }`. **POST /users/me/roles**: `{ "rol": "PROPIETARIO" }`.

**Sesión** (respuesta de register, login y refresh):

```json
{
  "accessToken": "eyJ...",
  "refreshToken": "opaco",
  "tokenType": "Bearer",
  "expiresIn": 900,
  "usuario": { "id": "uuid", "email": "...", "nombre": "...", "telefono": null,
               "roles": ["CONDUCTOR"], "creadoEn": "ISO-8601" }
}
```

El refresh token es opaco y se guarda hasheado. Se **rota**: cada uno sirve una sola vez y reusar uno
ya usado revoca todas las sesiones del usuario (posible robo). Excepción: dentro de los
`REFRESH_TOKEN_GRACIA_SEG` posteriores a su rotación se acepta, para el navegador que recarga justo
durante un refresh y no llega a guardar el nuevo. Logout y logout-todos no tienen gracia.

### JWT (access token)

RS256, header con `kid`. Claims (cumple los mínimos del contrato: `sub`, `roles`, `exp`):

```json
{ "sub": "<usuarioId>", "email": "...", "roles": ["CONDUCTOR", "PROPIETARIO"],
  "iss": "parkin-usuarios", "iat": 0, "exp": 0 }
```

El gateway verifica con `infra/jwt/jwt_public.pem` o con `GET /.well-known/jwks.json`.
Rutas públicas: `/auth/*` salvo `/auth/logout-todos`.

## Logs

JSON a stdout con `servicio`, `nivel`, `traceId` (tomado de `traceparent`, que pone el gateway) y
`usuarioId`. Nunca se loguean contraseñas ni tokens.
