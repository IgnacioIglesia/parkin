# Web

Sección del documento final. Describe lo que está implementado en `web/`. Lo pendiente está en la sección 8.

## 1. Responsabilidad

La web es el único cliente: conductores y propietarios usan la plataforma desde el navegador, en celular o computadora. Solo conoce al gateway; no sabe cuántos servicios ni réplicas hay detrás (transparencia).

| | |
|---|---|
| Framework | React 19 + Vite, JavaScript |
| Navegación | React Router |
| Estilos | Tailwind CSS 4, tipografías Barlow y Barlow Condensed servidas desde el propio sitio |
| Mapa | Leaflet con teselas de OpenStreetMap (sin API key) |
| Tiempo real | `socket.io-client` |
| Contenedor | build de Vite servido por nginx; también desplegable en Vercel |

## 2. Funcionalidades

| Funcionalidad (letra) | Pantallas |
|---|---|
| Registro y autenticación | Ingresar, Registrate (elegir uno o los dos roles), Perfil (datos, sumar rol, cerrar sesión, cerrar todas) |
| Alta y gestión de cocheras | Tus cocheras, Publicá una cochera (ubicación tocando el mapa), Horarios por día, Dar de baja |
| Búsqueda y reserva por franja | Mapa con tablero de resultados, Ficha de la cochera, Reservá esta franja |
| Pago y notificación | Detalle de la reserva con cuenta regresiva y Pagá; avisos en vivo por WebSocket |

## 3. Comunicación

- **REST** con Usuarios (`/api/usuarios`), Reservas (`/api/reservas`) y Pagos (`/api/pagos`).
- **GraphQL** con Cocheras (`/graphql`). Cada pantalla pide solo los campos que dibuja: el mapa, `id titulo precioHora tipoVehiculo ubicacionAproximada`; la ficha, además, horarios, fotos y dirección. Para la lista de reservas, todas las cocheras se piden en **una sola consulta** con un alias por id, en vez de una por fila.
- **WebSocket** (Socket.IO en `/ws`). El token viaja en el handshake y se renueva en cada reconexión. Se usa solo el transporte WebSocket, sin long-polling. Los eventos `reserva:confirmada`, `reserva:cancelada`, `reserva:expirada` y `pago:rechazado` muestran un aviso y recargan la reserva. El WebSocket solo acelera la noticia: la fuente de verdad es `GET /reservas/{id}`, que la pantalla consulta cada 5 segundos mientras la reserva espera el pago.

Cada servicio responde sus errores a su manera (Usuarios `{error}`, Reservas `{detail}`, GraphQL `errors[].extensions.code`, el gateway HTML). Un único cliente HTTP los traduce a un mismo formato y a mensajes en castellano.

## 4. Sesión

- El access token vive solo en memoria; el refresh token, en `localStorage` para sobrevivir recargas.
- Ante un `401`, el cliente refresca una vez y reintenta el pedido.
- El refresh token es de un solo uso: si dos pedidos o dos pestañas refrescaran a la vez, Usuarios lo tomaría como robo. Por eso hay **un solo refresh en vuelo por pestaña** y un **lock entre pestañas** (`navigator.locks`), y el token se relee adentro del lock.
- Cerrar sesión en una pestaña la cierra en las demás (evento `storage`).

## 5. Concurrencia y consistencia desde el cliente

- **Idempotencia.** Cada intento de reserva genera una `Idempotency-Key`. Si el pedido se reintenta (doble clic, error de red, timeout), se reusa la misma clave y Reservas devuelve la misma reserva. La clave se renueva solo ante una respuesta definitiva o al cambiar cochera o franja.
- **Conflicto.** Un `409` muestra «Esa franja acaba de ser reservada» y actualiza el tablero, porque la búsqueda pudo haber mostrado por unos segundos una franja ya tomada (consistencia eventual aceptada en la segunda entrega).
- **Retención.** El detalle muestra los minutos que quedan para pagar; al llegar a cero recarga y la reserva pasa a vencida cuando Reservas la expira.

## 6. Confidencialidad

La búsqueda y la ficha muestran una zona (círculo de 300 m) alrededor de la ubicación aproximada que entrega Cocheras. La dirección exacta y el punto exacto (`direccionExacta` y `ubicacion`) aparecen recién con la reserva confirmada, porque Cocheras los devuelve `null` hasta entonces; el propietario los ve siempre en sus cocheras. Por eso la ficha dibuja el punto solo a quien tiene derecho a verlo, y el propietario edita su cochera con la ubicación ya marcada.

## 7. Diseño

La interfaz toma la forma de un **tablero de partidas**. Códigos, precios, horarios y estados se muestran en celdas de paleta que giran carácter por carácter cuando cambian: al hacer otra búsqueda, cuando corre la cuenta regresiva o cuando una reserva pasa a confirmada. Los colores de estado son fijos en toda la app: ámbar para retenida y acción principal, verde para confirmada, rojo para cancelada o vencida. Se eligió entre cuatro direcciones visuales; el sistema está documentado en `web/DESIGN.md`.

- **Pensada para la demo.** Letras grandes y alto contraste para proyector, y en cada estado una sola acción principal.
- **Accesibilidad.** Etiquetas y errores asociados a cada campo, navegación por teclado, texto para lectores de pantalla en las celdas y en los íconos, y animaciones desactivadas con `prefers-reduced-motion`.
- **Responsive.** En celular el mapa va arriba y el tablero debajo, sin desborde horizontal.

## 8. Pruebas y pendientes

**Probado en Chrome contra los servicios reales** (26/10, con `docker compose up --build` desde cero, 40 cocheras sembradas con `scripts/sembrar-cocheras.mjs`). Las capturas están en `docs/capturas/web-*.png`:

1. Registro con los dos roles y búsqueda: el mapa de Pocitos muestra las cocheras libres de la franja (`web-03`).
2. Ficha y reserva: la reserva queda **Retenida** con la cuenta regresiva de 10 minutos (`web-04`, `web-05`).
3. Otra persona, desde otra sesión, intenta la misma franja y recibe «Esa franja acaba de ser reservada» (`web-06`).
4. **Pago aprobado:** «Pagá» abre la pasarela simulada en otra pestaña; al tocar «Aprobar», sin recargar, la reserva pasa a **Confirmada**, llega el aviso «Tu reserva está confirmada» por WebSocket y aparece la dirección exacta (`web-07`). Tarda alrededor de un segundo.
5. **Pago rechazado:** otra reserva, «Rechazar» en la pasarela: llega un solo aviso, «El pago fue rechazado», la reserva pasa a **Cancelada** y la pantalla dice que la franja se liberó (`web-08`). Pagos y Reservas mandan dos eventos para ese caso (`pago:rechazado` y `reserva:cancelada`); la web muestra solo el primero.
6. Mis reservas con los estados de cada una (`web-09`).
7. Panel del propietario: publicar tocando el mapa, horarios por día y la lista de cocheras (`web-10` a `web-12`). Al editar, la ubicación ya viene marcada y se guarda sin volver a tocar el mapa.
8. Perfil y la búsqueda en 390 px de ancho (`web-13`, `web-14`).

**Límites:**
- Los bloqueos de fechas puntuales no están en el contrato GraphQL.
- El refresh token vive en `localStorage`; una cookie `httpOnly` lo protegería mejor de un XSS (ver la defensa en `docs/defensa/usuarios-y-web.md`).
- La web no inicia trazas: en Jaeger el recorrido empieza en los servicios.
