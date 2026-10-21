# Servicio de Usuarios

Registro, login, refresh, perfiles y roles (**PROPIETARIO**, **CONDUCTOR**; un usuario puede tener ambos).
Emite el JWT RS256 que el gateway valida con la clave pública.

- Stack: Node.js + Express 5, PostgreSQL (`db-usuarios`), bcrypt, JWT RS256.
- Puerto interno: `3000` (`3001` en el host).
- Responsable: Martina Berrutti.

## Levantar

```bash
docker compose up --build usuarios
```

Las claves JWT las genera el servicio `jwt-claves` del compose (`src/generar-claves.js`) en
`infra/jwt/` si faltan; si existen, no las toca. Fuera de Docker: `node src/generar-claves.js ../infra/jwt`.

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
| GET | `/auth/verificar` | — | Para el gateway: 204 con `X-User-Id` y `X-User-Roles` · 204 sin identidad si no hay token · 401 |
| GET | `/users/me` | sí | 200 usuario |
| PATCH | `/users/me` | sí | 200 usuario · 422 |
| POST | `/users/me/roles` | sí | 200 `{ usuario, accessToken }` |
| GET | `/users/{id}` | sí | 200 `{ id, nombre }` · 404 |
| GET | `/.well-known/jwks.json` | no | JWKS con la clave pública |
| GET | `/auth/public-key` | no | Clave pública en PEM |
| GET | `/health`, `/ready` | no | 200 / 503 |
| GET | `/metrics` | no | Métricas Prometheus (interno; el gateway no lo expone) |

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

## Integración con el gateway (auth_request)

El NGINX de código abierto no valida JWT, así que el gateway le pregunta a Usuarios con
`auth_request` y reenvía la identidad a los servicios. Probado de punta a punta (ver
`docs/secciones/usuarios.md`). Cambios en `gateway/nginx.conf`:

```nginx
# 1) En el bloque server, en lugar de  proxy_set_header X-User-Id "";
set $usuario_id "";
set $usuario_roles "";
proxy_set_header X-User-Id $usuario_id;
proxy_set_header X-User-Roles $usuario_roles;

# 2) Ubicaciones nuevas
location = /_verificar {
    internal;
    # Variable propia: la subrequest comparte variables con el request principal,
    # y pisar $upstream mandaría el request original a Usuarios.
    set $upstream_verificar http://usuarios:3000/auth/verificar;
    proxy_pass $upstream_verificar;
    proxy_pass_request_body off;
    proxy_set_header Content-Length "";
    proxy_set_header Authorization $http_authorization;
    proxy_set_header traceparent $traceparent;
}

location = /api/usuarios/metrics {
    return 404;
}

# 3) Al principio de  location /api/reservas,  location /api/pagos  y  location /graphql
auth_request /_verificar;
auth_request_set $usuario_id $upstream_http_x_user_id;
auth_request_set $usuario_roles $upstream_http_x_user_roles;
```

Además, el healthcheck del gateway (`gateway/Dockerfile`) usa `http://localhost/health`: en Alpine
`localhost` resuelve a IPv6 y nginx escucha solo en IPv4, por eso figura `unhealthy` aunque funciona.
Con `http://127.0.0.1/health` se corrige.

## Tests

```bash
npm test                                                                  # sin base de datos
TEST_DATABASE_URL=postgres://app:app@localhost:5441/usuarios npm test     # + sesión contra Postgres
```

## Logs

JSON a stdout con `servicio`, `nivel`, `traceId` (tomado de `traceparent`, que pone el gateway) y
`usuarioId`. Nunca se loguean contraseñas ni tokens.
