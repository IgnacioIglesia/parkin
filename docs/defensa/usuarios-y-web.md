# Defensa: Usuarios y web

Guía para quien defiende esta parte: qué explicar, qué mostrar y qué preguntas esperar. Las respuestas salen de lo que el sistema hace hoy; lo que no está resuelto se dice tal cual.

## En tres minutos

1. **Usuarios es el único que conoce contraseñas y el único que firma tokens.** Registra cuentas con uno o los dos roles (propietario y conductor), guarda las contraseñas con bcrypt y emite un **JWT RS256 de 15 minutos** más un **refresh token opaco de un solo uso**. Los demás servicios nunca le preguntan nada: el gateway verifica los JWT con la clave pública.
2. **Las sesiones están protegidas contra robo.** Cada refresh token sirve una vez; si alguien presenta uno ya usado, se asume que fue robado y se cierran todas las sesiones de esa persona. Una ventana de gracia de 30 segundos evita cerrar sesiones por una simple recarga de página en mal momento.
3. **La web es el único cliente** y solo habla con el gateway. Usa tres de los cuatro mecanismos de comunicación del sistema: REST con Usuarios, Reservas y Pagos; GraphQL con Cocheras; y WebSocket para los avisos en vivo. El cuarto, RabbitMQ, lo usan solo los servicios entre sí: la web nunca habla con el broker. La confirmación de la reserva llega por WebSocket, pero la fuente de verdad es siempre `GET /reservas/{id}`.
4. **La web hace su parte de la consistencia:** cada intento de reserva y de pago lleva una `Idempotency-Key` que se reusa si el pedido se reintenta, así un doble clic o un timeout no crean dos reservas ni cobran dos veces; y un `409` se muestra como «esa franja acaba de ser reservada».

## Qué mostrar (y cómo)

| Qué | Cómo |
|---|---|
| Registro con los dos roles y login | `http://localhost:8081/registro`; después Perfil para mostrar los roles y sumar uno |
| Búsqueda y confidencialidad | Mapa: cada cochera se ve en una zona aproximada; la ficha no muestra la dirección hasta que la reserva se confirma |
| Reserva y pago en vivo | En la ficha, «Reservá esta franja»: aparece la cuenta regresiva de 10 minutos. «Pagá» abre la pasarela en otra pestaña; al aprobar, la reserva pasa sola a **Confirmada** en alrededor de un segundo y aparece la dirección exacta |
| Pago rechazado | Mismo recorrido, «Rechazar» en la pasarela: llega el aviso de pago rechazado y la franja se libera |
| Conflicto (409) | Dos navegadores (uno en ventana privada) con cuentas distintas reservan la misma franja: el segundo ve «Esa franja acaba de ser reservada» |
| Panel del propietario | Tus cocheras → Publicá una cochera (tocando el mapa) → horarios por día |
| Observabilidad de Usuarios | Grafana (`:3030`), fila «Usuarios»: ingresos correctos y fallidos, renovaciones de sesión (los tokens reutilizados en rojo) y latencia de login y refresh |

Antes de la defensa: `docker compose ps` con todo `healthy` y `node scripts/sembrar-cocheras.mjs` para que el mapa tenga cocheras.

## Preguntas probables

**¿Por qué RS256 y no HS256?**
Con HS256 la misma clave firma y verifica, así que el gateway y cualquier servicio que verifique tendrían el secreto con el que se pueden fabricar tokens. Con RS256 solo Usuarios tiene la clave privada; el gateway verifica con la pública, que no sirve para firmar. Además se publica en `/.well-known/jwks.json`.

**¿Dónde se guarda la contraseña?**
En ninguna parte: se guarda un hash bcrypt. El login compara contra un hash ficticio cuando el email no existe, para que la respuesta tarde lo mismo y no se pueda averiguar qué emails están registrados midiendo tiempos. El gateway además limita el login a 10 intentos por minuto por IP, y una alerta avisa si hay más de 30 logins fallidos en 5 minutos.

**¿Por qué dos tokens?**
El access token es corto (15 minutos) y se verifica sin consultar ninguna base: si se filtra, sirve poco tiempo. El refresh token es largo (7 días), pero se guarda en la base (solo su hash) y se puede revocar: cerrar sesión, o cerrarla en todos los dispositivos.

**¿Qué pasa si roban un refresh token?**
El ladrón y la persona legítima van a terminar usando el mismo token. El primero que lo use recibe uno nuevo; cuando el otro presente el viejo, Usuarios detecta el reuso y revoca todas las sesiones de esa cuenta, y la métrica `usuarios_refresh_total{resultado="reutilizado"}` dispara una alerta. Lo probamos con tests contra una base real.

**¿Para qué la ventana de gracia de 30 segundos?**
La encontramos probando la web: si el navegador recarga justo durante un refresh, el servidor ya rotó el token pero el navegador no llegó a guardar el nuevo. Al volver presenta el viejo y, sin la gracia, eso se veía como un robo y cerraba todas las sesiones. Dentro de los 30 segundos se acepta; fuera, sigue siendo robo. Cerrar sesión anula la gracia.

**¿Y con varias pestañas abiertas?**
Si dos pestañas refrescaran a la vez con el mismo token, la segunda dispararía la detección de robo. La web hace un solo refresh a la vez por pestaña y usa un lock entre pestañas (`navigator.locks`), releyendo el token dentro del lock. Cerrar sesión en una pestaña la cierra en las demás.

**¿Dónde guarda la web los tokens?**
El access token, solo en memoria. El refresh token, en `localStorage` para sobrevivir una recarga. Sabemos que una cookie `httpOnly` lo protegería mejor de un XSS; no lo hicimos porque el gateway y Usuarios trabajan con el token en el cuerpo, y la rotación con detección de reuso limita el daño de un robo. Lo declaramos como mejora.

**¿Por qué el gateway verifica el token y no Usuarios?**
Para no sumar una llamada a Usuarios en cada request y para que una caída de Usuarios no voltee al resto. La primera versión hacía eso (`auth_request` contra `GET /auth/verificar`); cuando el gateway pasó a verificar con njs y la clave pública, el endpoint quedó sin uso y lo borramos (decisión en `docs/arquitectura.md`). Usuarios vuelve a verificar el token en sus propias rutas, como defensa en profundidad.

**¿Cómo se generan las claves? ¿Funciona desde cero?**
El servicio `jwt-claves` del compose las genera la primera vez y no las toca si ya existen (así no invalida las sesiones). Al probar el arranque en frío encontramos que Docker crea una carpeta vacía con el nombre de la clave pública cuando el gateway monta el archivo antes de que exista; el generador la reemplaza por la clave. `docker compose up --build` funciona sin ningún paso previo.

**¿Qué hace la web para que no haya doble reserva?**
La garantía la da Reservas en la base de datos. La web evita los duplicados propios (la `Idempotency-Key` hace que un reintento devuelva la misma reserva) y muestra bien el conflicto: ante un `409` avisa y actualiza el tablero.

**¿Cómo llega la confirmación en tiempo real?**
Pagos publica `pago.aprobado`, Reservas confirma y publica `reserva.confirmada`, y Pagos avisa por WebSocket a la sala del conductor y del propietario. La web conecta con su token en el handshake y, si el token venció, refresca la sesión y reconecta. Si el aviso se pierde, la pantalla igual consulta la reserva cada 5 segundos mientras espera el pago.

**¿Por qué el WebSocket va sin long-polling?**
Porque al probarlo descubrimos que las conexiones por long-polling tiraban abajo a Pagos. La web usa solo WebSocket, que el gateway soporta en `/ws`; además evita requerir sticky sessions con varias réplicas.

**¿Cómo se protege la dirección del propietario?**
La búsqueda devuelve una ubicación corrida entre 100 y 300 metros de la real (la calcula Cocheras), y la web la dibuja como una zona, no como un punto. La dirección exacta la devuelve Cocheras solo al propietario y al conductor con la reserva confirmada.

**¿Qué observabilidad tiene Usuarios?**
Los tres pilares: logs JSON con `traceId` y `usuarioId` (sin contraseñas ni tokens) que van a Loki, métricas en Prometheus (ingresos, registros, renovaciones de sesión, latencia) y trazas OpenTelemetry en Jaeger. Hay cuatro alertas: errores 5xx, login o refresh lentos, posible fuerza bruta y refresh token reutilizado. `/metrics` no se expone por el gateway.

**¿Qué haría distinto con más tiempo?**
Refresh token en cookie `httpOnly`, recuperación de contraseña por email y que la web también inicie las trazas, para ver en Jaeger el recorrido desde el clic.

## Si algo falla durante la defensa

- **No se puede ingresar:** probar con una cuenta nueva desde Registrate; si el gateway responde `503 AUTH_NO_DISPONIBLE`, falta la clave pública: `docker compose up -d jwt-claves gateway`.
- **El aviso en vivo no aparece:** la reserva se confirma igual en unos segundos por la consulta periódica; seguir y explicar que el WebSocket solo acelera la noticia.
- **El mapa está vacío:** `node scripts/sembrar-cocheras.mjs`.
- **Falla la web entera:** mostrar las capturas `docs/capturas/web-*.png` y el flujo con `CONDUCTORES=20 node scripts/demo.mjs`.
