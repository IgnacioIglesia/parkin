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
- **WebSocket** (Socket.IO en `/ws`). El token viaja en el handshake y se renueva en cada reconexión. Los eventos `reserva:confirmada`, `reserva:cancelada`, `reserva:expirada` y `pago:rechazado` muestran un aviso y recargan la reserva. El WebSocket solo acelera la noticia: la fuente de verdad es `GET /reservas/{id}`, que la pantalla consulta cada 5 segundos mientras la reserva espera el pago.

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

La búsqueda y la ficha muestran una zona (círculo de 300 m) alrededor de la ubicación aproximada que entrega Cocheras. La dirección exacta aparece recién con la reserva confirmada, porque Cocheras la devuelve `null` hasta entonces. El navegador nunca recibe la ubicación exacta: el propietario la marca al publicar y la vuelve a marcar si edita los datos.

## 7. Diseño

La interfaz toma la forma de un **tablero de partidas**. Códigos, precios, horarios y estados se muestran en celdas de paleta que giran carácter por carácter cuando cambian: al hacer otra búsqueda, cuando corre la cuenta regresiva o cuando una reserva pasa a confirmada. Los colores de estado son fijos en toda la app: ámbar para retenida y acción principal, verde para confirmada, rojo para cancelada o vencida. Se eligió entre cuatro direcciones visuales; el sistema está documentado en `web/DESIGN.md`.

- **Pensada para la demo.** Letras grandes y alto contraste para proyector, y en cada estado una sola acción principal.
- **Accesibilidad.** Etiquetas y errores asociados a cada campo, navegación por teclado, texto para lectores de pantalla en las celdas y en los íconos, y animaciones desactivadas con `prefers-reduced-motion`.
- **Responsive.** En celular el mapa va arriba y el tablero debajo, sin desborde horizontal.

## 8. Pruebas y pendientes

**Probado en navegador contra los servicios reales:**
1. Una propietaria publica una cochera y define sus horarios.
2. Un conductor la encuentra en la búsqueda, abre la ficha y reserva: la reserva queda retenida, con la cuenta regresiva.
3. Otra persona intenta la misma franja y recibe «Esa franja acaba de ser reservada».
4. La propietaria ve la reserva en «En tus cocheras».
5. El conductor cancela y la franja se libera: la segunda persona ya puede reservarla.

También se probó en 390 px de ancho.

**Pendiente:**
- El pago sigue el contrato de Pagos: `POST /api/pagos { reservaId }` con su propia `Idempotency-Key` (reusada si se reintenta), reintento automático ante `404 RESERVA_DESCONOCIDA` (Pagos todavía no recibió `reserva.creada`) y el checkout en otra pestaña, mientras la reserva se actualiza sola al confirmarse. Probado con respuestas simuladas según el contrato; falta probarlo con el servicio de Pagos real.
- Los bloqueos de fechas puntuales no están en el contrato GraphQL.
