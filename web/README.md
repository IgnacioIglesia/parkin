# ParkIN · web

Front de ParkIN: ingreso y registro, perfil con roles y búsqueda de cocheras en mapa.
React 19 + Vite, JavaScript, React Router, Tailwind CSS 4, Leaflet con teselas de OpenStreetMap.

- Responsable: Martina Berrutti.
- Desplegable en Vercel (`vercel.json` reescribe las rutas del SPA a `index.html`).

## Levantar en desarrollo

```bash
# desde la raíz del repo: claves JWT (una vez) y Usuarios con su base
bash infra/jwt/generar-claves.sh
docker compose up --build usuarios

# en otra terminal
cd web
npm install
npm run dev        # http://localhost:5173
```

El proxy de Vite imita al gateway: la web siempre llama a `/api/usuarios/...`, `/graphql` y `/ws`.
Sin gateway, `/api/usuarios` va directo a Usuarios (`localhost:3001`). Cuando el gateway esté listo,
poné `PROXY_GATEWAY=http://localhost:8080` en `web/.env.local` y todo pasa por ahí.

## Variables

| Variable | Default | Descripción |
|---|---|---|
| `VITE_API_URL` | vacío | Base de la API; vacío = mismo origen |
| `VITE_MOCK_COCHERAS` | `true` | Búsqueda con datos de ejemplo hasta integrar Cocheras |
| `PROXY_USUARIOS` | `http://localhost:3001` | Solo dev: destino del proxy de Usuarios |
| `PROXY_GATEWAY` | vacío | Solo dev: si tiene valor, todo va al gateway |

## Sesión

- El access token (15 min) vive solo en memoria; el refresh token en `localStorage` para sobrevivir recargas.
- Si un pedido da 401, se refresca una vez y se reintenta.
- El refresh token es de un solo uso (rotación con detección de reuso en Usuarios). Para no dispararla:
  un solo refresh en vuelo por pestaña, un lock entre pestañas (`navigator.locks`) y el token se relee
  adentro del lock. Usuarios además acepta un token recién rotado durante 30 s, por si la página se
  recarga justo durante el refresh.
- Cerrar sesión en una pestaña la cierra en las demás (evento `storage`).

## Búsqueda

`src/api/cocheras.js` pide a `/graphql` exactamente los campos del contrato
(`buscarCocheras` → `id titulo precioHora tipoVehiculo ubicacionAproximada { lat lng }`).
Mientras `VITE_MOCK_COCHERAS` no sea `false`, responde `src/mocks/cocheras.js`: datos sintéticos con
la misma forma, marcados en pantalla como «Datos de ejemplo».

El código corto de cada cochera (PO14) y el barrio se calculan en el front a partir del id y la
ubicación aproximada, así no hace falta agregar campos al contrato.

## Diseño

El mundo visual es un tablero de partidas: valores en celdas de paleta (`src/componentes/Celdas.jsx`)
que giran carácter por carácter cuando cambian, sobre negro paleta y acero. Ámbar = retenida y acción
primaria, verde = confirmada, rojo = cancelada o vencida. La decisión y el contrato de dirección están
en `.impeccable/`; el sistema documentado, en `DESIGN.md`.
