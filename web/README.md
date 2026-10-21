# ParkIN · web

Front de ParkIN: ingreso y registro, búsqueda en mapa, ficha de cochera, reserva con cuenta
regresiva y pago, mis reservas, y el panel del propietario (publicar cocheras, horarios, baja).
React 19 + Vite, JavaScript, React Router, Tailwind CSS 4, Leaflet con teselas de OpenStreetMap,
Socket.IO para los avisos en vivo.

- Responsable: Martina Berrutti.
- Descripción completa para el documento: `docs/secciones/web.md`.

## Levantar

**Con Docker (como en la demo):** `docker compose up --build` desde la raíz y abrir
http://localhost:8081. nginx sirve el build y manda `/api`, `/graphql` y `/ws` al gateway.

**En desarrollo, con recarga en caliente:**

```bash
# desde la raíz del repo, con el backend levantado
bash infra/jwt/generar-claves.sh     # una sola vez
docker compose up --build -d

cd web
npm install
npm run dev        # http://localhost:5173
```

El proxy de Vite manda `/api`, `/graphql` y `/ws` al gateway (`localhost:8080`), igual que en producción.

## Variables

| Variable | Default | Descripción |
|---|---|---|
| `VITE_API_URL` | vacío | Base de la API; vacío = mismo origen. En Vercel, la URL pública del gateway |
| `VITE_MOCK_COCHERAS` | `false` | `true` = búsqueda con datos de ejemplo, para trabajar sin backend |
| `PROXY_GATEWAY` | `http://localhost:8080` | Solo dev: destino del proxy de Vite |

## Rutas

| Ruta | Pantalla |
|---|---|
| `/ingresar`, `/registro` | Acceso |
| `/buscar` | Mapa y tablero de cocheras libres para una franja |
| `/cocheras/:id` | Ficha: zona, horarios, fotos y reserva |
| `/reservas`, `/reservas/:id` | Reservas hechas y en tus cocheras; detalle con pago y cancelación |
| `/mis-cocheras`, `/mis-cocheras/nueva`, `/mis-cocheras/:id` | Panel del propietario (requiere el rol) |
| `/perfil` | Datos, roles y sesión |

## Sesión

- El access token (15 min) vive solo en memoria; el refresh token en `localStorage` para sobrevivir recargas.
- Si un pedido da 401, se refresca una vez y se reintenta.
- El refresh token es de un solo uso. Para no disparar la detección de reuso de Usuarios: un solo
  refresh en vuelo por pestaña, un lock entre pestañas (`navigator.locks`) y el token se relee adentro
  del lock.
- Cerrar sesión en una pestaña la cierra en las demás.

## Diseño

Tablero de partidas: valores en celdas de paleta (`src/componentes/Celdas.jsx`) que giran carácter por
carácter cuando cambian. Ámbar = retenida y acción principal, verde = confirmada, rojo = cancelada o
vencida. Sistema documentado en `DESIGN.md`; decisión y contrato de dirección en `.impeccable/`.
