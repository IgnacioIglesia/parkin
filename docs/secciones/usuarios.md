# Servicio de Usuarios

Sección del documento final. Describe lo que está implementado en `usuarios/`. Lo provisorio o pendiente está en la sección 9.

## 1. Responsabilidad

Usuarios registra cuentas, autentica, emite los tokens de sesión y administra perfiles y roles (`PROPIETARIO`, `CONDUCTOR`; una misma cuenta puede tener los dos). Es el único servicio que conoce contraseñas y el único que firma JWT. No participa de eventos: los demás servicios confían en la identidad que les pasa el gateway después de validar el token.

| | |
|---|---|
| Lenguaje y framework | Node.js 24 + Express 5 |
| Base de datos | PostgreSQL (propia, `db-usuarios`) |
| Acceso a datos | `pg` con pool de conexiones, SQL explícito, migraciones `.sql` numeradas |
| Contraseñas | bcrypt (`bcryptjs`, 10 rondas) |
| Tokens | JWT RS256 (`jsonwebtoken`) + refresh token opaco |
| Validación | `zod` (errores → `422` con detalle por campo) |
| Logs y métricas | `pino` (JSON a stdout), `prom-client` |

## 2. API

| Método | Endpoint | Descripción |
|---|---|---|
| POST | `/auth/register` | Crea la cuenta con sus roles y devuelve la sesión |
| POST | `/auth/login` | Devuelve access token (15 min) y refresh token |
| POST | `/auth/refresh` | Rota el refresh token y devuelve una sesión nueva |
| POST | `/auth/logout` | Revoca ese refresh token |
| POST | `/auth/logout-todos` | Revoca todas las sesiones de la cuenta |
| GET / PATCH | `/users/me` | Perfil del usuario autenticado; actualiza nombre y teléfono |
| POST | `/users/me/roles` | Suma un rol y devuelve un access token con los roles nuevos |
| GET | `/users/{id}` | Perfil público mínimo (`id`, `nombre`) |
| GET | `/.well-known/jwks.json` | Clave pública en formato JWKS |
| GET | `/health`, `/ready`, `/metrics` | Proceso vivo, base alcanzable, métricas Prometheus |

Errores con un formato único: `{ "error": { "codigo", "mensaje", "detalles"? } }`. Códigos: `201` registro, `401` credenciales o token inválidos, `409` email en uso, `422` datos inválidos.

## 3. Datos

| Tabla | Contenido |
|---|---|
| `usuario` | `id` (UUID), `email` (UNIQUE, en minúsculas), `password_hash`, `nombre`, `telefono` |
| `usuario_rol` | (`usuario_id`, `rol`) con `CHECK` de los dos roles válidos |
| `refresh_token` | `token_hash` (UNIQUE), `expira_en`, `revocado`, `rotado_en` |

Las migraciones se aplican al arrancar. Toman un `pg_advisory_lock`, así que dos réplicas que arrancan al mismo tiempo no migran en paralelo.

## 4. Sesión: access token y refresh token

**Access token (JWT RS256, 15 minutos).** Lleva `sub` (id del usuario), `roles`, `email`, `iss` y en el header un `kid`. Se firma con la clave privada, que solo tiene Usuarios; cualquiera puede verificarlo con la pública. Con HS256 cada servicio que verifica necesitaría el mismo secreto que firma.

**Refresh token (opaco, 7 días).** Es un valor aleatorio de 32 bytes. En la base se guarda solo su SHA-256: si la base se filtra, los tokens no sirven.

**Rotación con detección de reuso.** Cada refresh token sirve una sola vez: al usarlo se revoca y se entrega uno nuevo. Si llega uno ya usado, se asume que fue robado y se revocan **todas** las sesiones de la cuenta (el ladrón y la víctima tienen que volver a ingresar).

**Ventana de gracia (30 s).** Al probar el front apareció un caso real: si el navegador recarga justo durante un refresh, el servidor ya rotó el token pero el navegador no llegó a guardar el nuevo; al volver, presenta el viejo y la detección cerraba todas las sesiones. Ahora un token rotado hace menos de `REFRESH_TOKEN_GRACIA_SEG` se acepta. Logout y logout-todos anulan la gracia. Pasada la ventana, el reuso se sigue tratando como robo (cubierto por tests).

## 5. Integración con el gateway

```mermaid
sequenceDiagram
    participant C as Cliente
    participant G as Gateway (NGINX + njs)
    participant R as Reservas / Pagos / Cocheras
    C->>G: POST /api/reservas (Authorization: Bearer …)
    Note over G: gateway/jwt.js verifica la firma RS256<br/>con la clave pública de Usuarios
    alt token válido
        G->>R: POST /reservas (X-User-Id, X-User-Roles)
        R-->>C: 201 / 409 / …
    else sin token o token inválido
        G-->>C: 401
    end
```

Usuarios firma los tokens y el gateway los verifica **por su cuenta**, sin llamar a Usuarios en cada request. El NGINX de código abierto no valida JWT (eso viene en NGINX Plus), así que el gateway lo hace con un script njs (`gateway/jwt.js`) que verifica la firma con la clave pública (`infra/jwt/jwt_public.pem`, montada solo de lectura) y controla `exp`, `nbf` y el emisor `parkin-usuarios`. Solo acepta RS256, así que rechaza `alg: none` y el cambio de algoritmo. Ese script corre en una location interna que NGINX consulta con `auth_request`, pero la consulta no sale del gateway.

- `/api/reservas`, `/api/pagos` y el resto de `/api/usuarios` exigen token. Sin token, o con uno inválido o vencido, responden `401` y el front refresca la sesión.
- En `/graphql` el token es opcional, porque buscar cocheras es público. Sin token la request sigue sin identidad; con un token inválido, `401`.
- Si el token es válido, el gateway pasa la identidad en `X-User-Id` y `X-User-Roles` (por ejemplo `PROPIETARIO,CONDUCTOR`). Siempre pisa los que mande el cliente, así que nadie puede hacerse pasar por otro.
- Si el gateway no puede leer la clave pública, falla cerrado: responde `503 AUTH_NO_DISPONIBLE` y no deja pasar nada.

**Por qué así y no consultando a Usuarios.** Antes de esta versión, el gateway usaba `auth_request` contra `GET /auth/verificar` de Usuarios, que hacía la misma verificación. Funcionaba, pero cada request protegido sumaba una llamada interna y, si Usuarios se caía, se caían también Reservas, Pagos y las mutaciones de Cocheras. Verificar con la clave pública en el gateway es lo que planteaba la segunda entrega: Usuarios es el único que firma, y verificar no necesita ningún secreto. Una vez que el gateway pasó a verificar solo, `GET /auth/verificar` quedó sin uso y se borró, junto con su métrica: un endpoint que nadie llama es código que hay que mantener y que nadie prueba.

**Evidencia** (prueba de punta a punta contra el gateway, hecha cuando validaba con `/auth/verificar`; el comportamiento hacia los servicios es el mismo): sin token, `401`; con `X-User-Id` falso y sin token, `401`; con token de conductor, `crearCochera` responde `FORBIDDEN` (los roles llegan a Cocheras); y **8 conductores reservando a la vez la misma franja: una reserva creada y 7 respuestas `409`**.

## 6. Seguridad

- Contraseñas con bcrypt; nunca se guardan ni se registran en texto plano.
- El login compara contra un hash ficticio cuando el email no existe: tarda lo mismo y no permite averiguar qué emails están registrados.
- El gateway limita el login a 10 intentos por minuto por IP.
- Las claves las genera el servicio `jwt-claves` del compose la primera vez que se levanta (si ya existen no las toca, para no invalidar las sesiones) y no se commitean (`*.pem` en `.gitignore`).
- `/metrics` es interno: lo que llega por el gateway trae `X-Forwarded-For` y Usuarios responde `404`; Prometheus lo lee directo por la red de Docker.

## 7. Observabilidad

**Logs.** JSON a stdout con `servicio`, `nivel`, `traceId` (tomado del `traceparent` del gateway) y `usuarioId`. Cada request deja una línea con método, ruta, estado y duración. `pino` elimina `password`, `accessToken` y `refreshToken` de cualquier log.

**Métricas** (`GET /metrics`, recogidas por Prometheus):

| Métrica | Qué mide |
|---|---|
| `usuarios_http_requests_total{metodo,ruta,estado}` | Requests (la ruta es la plantilla, `/users/:id`) |
| `usuarios_http_request_duration_seconds` | Latencia |
| `usuarios_registros_total` | Cuentas nuevas |
| `usuarios_logins_total{resultado}` | `ok` o `fallido`; un pico de fallidos indica fuerza bruta |
| `usuarios_refresh_total{resultado}` | `ok`, `gracia`, `invalido` o `reutilizado` (posible robo de sesión) |

## 8. Pruebas

`npm test` corre 14 tests sin base de datos: verificación de JWT (válido, firmado con otra clave, vencido, mal formado, anónimo), validación `422`, `401`, JWKS y métricas. Con `TEST_DATABASE_URL` corren además los de sesión contra Postgres: registro, email repetido, login, rotación, ventana de gracia, logout-todos y detección de reuso fuera de la ventana.

## 9. Provisorio o pendiente

Nada pendiente: todo lo descrito en esta sección está implementado en `main` y probado.
