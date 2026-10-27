# Defensa: guion general

Reparto de las diapositivas, qué dice cada uno y qué demos se muestran. El detalle de cada parte (preguntas probables y plan B) está en los guiones individuales de esta carpeta:
- `reservas-e-infraestructura.md`;
- `usuarios-y-web.md`;
- `cocheras-y-observabilidad.md`;
- `pagos.md`.

Para repasar los conceptos del curso aplicados a parkIN: `temas-del-curso.md`.

**Duración supuesta: 20 minutos de presentación más preguntas.** La letra no la fija. Las diapositivas suman 17 minutos y la demo 3 (la demo 5 es opcional y solo va si sobra tiempo). Si los docentes confirman menos tiempo, se recortan primero las diapositivas 13 y 15.

**Partes que cada uno defiende sin haberlas hecho.** Romina presenta la saga, que también involucra a Reservas (Ignacio), y la comunicación, que incluye el GraphQL de Cocheras (Diego). Martina presenta la verificación del JWT en el gateway. En el ensayo, cada uno repasa esas partes con quien las hizo.

## Reparto

| # | Diapositiva | Quién | Tiempo |
|---|---|---|---|
| 1 | Portada | Ignacio | 0:15 |
| 2 | El problema | Ignacio | 1:00 |
| 3 | La solución y su alcance | Ignacio | 0:45 |
| 4 | Arquitectura | Ignacio | 1:30 |
| 5 | Características de los sistemas distribuidos | Diego | 1:30 |
| 6 | Comunicación: cuatro mecanismos y por qué | Romina | 1:30 |
| 7 | Usuarios: identidad y sesiones | Martina | 1:30 |
| 8 | La web | Martina | 1:00 |
| 9 | Cocheras: GraphQL, búsqueda y confidencialidad | Diego | 1:30 |
| 10 | Reservas: una sola reserva gana | Ignacio | 1:30 |
| 11 | La saga de reserva y pago | Romina | 1:30 |
| 12 | Pagos: no cobrar dos veces | Romina | 1:00 |
| 13 | Observabilidad | Diego | 1:00 |
| 14 | Demo en vivo | Martina, Ignacio y Diego (Romina, si sobra tiempo) | 3:00 |
| 15 | 12-Factor y uso de IA | Ignacio | 0:45 |
| 16 | Conclusión y trabajo futuro | Romina | 0:45 |
| 17 | Preguntas | todos | — |

Tiempo por persona: Ignacio 5:45, Diego 4:00 más la demo, Romina 4:45, Martina 2:30 más la demo (es quien maneja la web).

## Qué dice cada uno

### 1 a 4. Ignacio: problema, solución y arquitectura

- **El problema:** encontrar estacionamiento genera congestión, y a la vez hay cocheras privadas vacías durante horas. El corazón técnico es la **concurrencia**: dos conductores no pueden reservar la misma cochera a la misma hora (doble reserva), ni el sistema puede mostrar libre una cochera tomada (cochera fantasma).
- **La solución:** una plataforma de microservicios donde los propietarios publican y los conductores buscan, reservan por franja y pagan, con confirmación en tiempo real para los dos.
- **La arquitectura:** cuatro servicios de negocio, cada uno con su base de datos (Usuarios, Cocheras, Reservas y Pagos), un **gateway** como único punto de entrada y un **bus de eventos** (RabbitMQ) para el flujo de reserva y pago. Combina tres estilos del curso: microservicios, publicación-suscripción y cliente-servidor.
- **Frase de cierre:** «Cada servicio puede caerse o escalar por separado; vamos a mostrar cómo eso no rompe las garantías».

### 5. Diego: características de los sistemas distribuidos

- **Por qué es un sistema distribuido:** nodos autónomos que se ven como un único sistema coherente (Van Steen).
- **Concurrencia:** consistencia fuerte al reservar y pagar; eventual en la búsqueda.
- **Seguridad:** autenticación, autorización, confidencialidad e integridad.
- **Tolerancia a fallos:** detección, enmascaramiento, recuperación y redundancia.
- **Transparencia** de acceso, ubicación, concurrencia y fallo, y qué no se oculta a propósito: la latencia del pago y los 30 segundos de caché.
- **Heterogeneidad:** Python y Node, con el gateway y RabbitMQ como middleware.
- **Escalabilidad:** servicios sin estado, una base por servicio y caché.

### 6. Romina: comunicación

- **REST** con Usuarios, Reservas y Pagos: operaciones simples que se monitorean por código HTTP.
- **GraphQL** con Cocheras: cada pantalla pide exactamente sus campos.
- **RabbitMQ** entre Reservas, Pagos y Cocheras: desacoplamiento temporal; si un servicio cae, los mensajes esperan.
- **WebSocket** de Pagos a la web: el servidor empuja la confirmación apenas ocurre, sin esperar a que el cliente pregunte. La pantalla igual consulta la reserva cada 5 segundos como respaldo.
- **La idea a transmitir:** síncrono cuando el usuario necesita la respuesta ya (el precio para reservar), y asíncrono cuando no (confirmar el pago).

### 7 y 8. Martina: Usuarios y la web

- **El JWT:** Usuarios es el único que conoce contraseñas y firma tokens: JWT RS256 de 15 minutos más refresh de un solo uso. Si se reutiliza un refresh pasados 30 segundos de gracia, se asume robo y se cierran todas las sesiones.
- **El gateway** verifica el JWT con la clave pública, sin preguntarle a Usuarios en cada request.
- **La web** es el único cliente y usa tres de los cuatro mecanismos: REST, GraphQL y WebSocket. RabbitMQ queda entre servicios.
- **La web hace su parte de la consistencia:** `Idempotency-Key` en cada reserva y pago, así un doble clic no crea dos.

### 9. Diego: Cocheras

- GraphQL, con profundidad máxima 5 y DataLoader contra el problema N+1.
- Búsqueda geográfica con PostGIS y caché de 30 segundos en Redis, invalidada por versión.
- **Confidencialidad:** todos ven una ubicación aproximada, fija, a 100-300 m de la real, y la búsqueda filtra por ella. La dirección exacta solo la ven el dueño y quien tiene la reserva confirmada, hasta que termina su franja.

### 10. Ignacio: Reservas

- **La regla vive en la base**, el único lugar que comparten todas las réplicas: una restricción de exclusión de PostgreSQL rechaza dos reservas solapadas, aunque lleguen en el mismo instante.
- **El lock por cochera** evita *deadlocks* entre inserciones simultáneas. Es exclusión mutua con servidor central: la base es el coordinador.
- **Probado:** 300 rondas de 10 reservas simultáneas y 60 de 40, siempre con una sola aceptada; en la demo, 20 conductores dan 1 reserva y 19 conflictos.

### 11 y 12. Romina: saga y Pagos

- **Saga coreografiada:** cada paso es una transacción local que publica un evento. Si el pago se rechaza o vence, Reservas compensa cancelando y liberando la franja.
- **Outbox:** el evento se guarda en la misma transacción que el cambio, así no hay cambio sin evento ni evento sin cambio.
- **Idempotencia:** los consumidores descartan eventos repetidos por `eventId`.
- **No cobrar dos veces:**
  - un pago vivo por reserva, garantizado con un lock y un índice único parcial;
  - el webhook firmado con HMAC;
  - reembolso automático si se cobra algo que ya no corresponde.

### 13. Diego: observabilidad

- Los tres pilares, unidos por un mismo `traceId` que nace en el gateway.
- **Métricas** dicen *que* algo anda mal; **trazas**, *dónde*; **logs**, *por qué*.
- Encontró un error real: respuestas `500` por *deadlock* con reservas simultáneas, que se corrigió.

### 15 y 16. Ignacio y Romina: cierre

- **12-Factor:** configuración por entorno, procesos sin estado, logs a stdout y servicios de respaldo intercambiables. Todo se levanta con un comando.
- **Uso de IA:** la IA implementó y documentó; el equipo decidió la arquitectura y entre alternativas, y todo se verificó corriendo.
- **Límites y trabajo futuro:**
  - probar varias réplicas y desplegarlo con un orquestador;
  - una pasarela real;
  - una política de cancelación con plazos.

## Demos (diapositiva 14, 3 minutos)

Van en este orden, porque cada una se apoya en la anterior:

| # | Quién | Qué se muestra | Cómo | Qué decir |
|---|---|---|---|---|
| 1 | Martina | Búsqueda y confidencialidad | `http://localhost:8081`, buscar en Pocitos; abrir una ficha | «La placa está en la zona aproximada, y la ficha no muestra la dirección» |
| 2 | Martina | Reservar y pagar en vivo | «Reservá esta franja» (cuenta regresiva de 10 minutos), «Pagá», Aprobar en la pasarela | «La confirmación llega sola por WebSocket, y recién ahí aparece la dirección exacta» |
| 3 | Ignacio | Concurrencia | `CONDUCTORES=20 node scripts/demo.mjs` | «20 conductores reservan la misma franja a la vez: entra 1 y 19 reciben "franja ocupada"» |
| 4 | Diego | Observabilidad | El link de Jaeger que imprime el script, y Grafana (`:3030`) con los 409 y la caché | «Un mismo `traceId` recorre todos los servicios; acá se ve la reserva ganadora de punta a punta» |
| 5 (opcional) | Romina | Tolerancia a fallos | `docker compose stop pagos`, reservar desde la web (funciona), `docker compose start pagos`, pagar | «Pagos estaba caído y no se perdió nada: los eventos lo esperaron en la cola» |

## Antes de la defensa

1. **La noche anterior:** `docker compose up -d --build` en la máquina que se va a usar, y recorrer las 5 demos una vez.
2. **Una hora antes:** `docker compose ps` con todo `healthy` (salvo `jwt-claves`, que termina solo).
3. **Datos:** `node scripts/sembrar-cocheras.mjs`, para que la búsqueda tenga datos.
4. **Pestañas abiertas en orden:**
   - web, iniciada con un conductor;
   - pasarela;
   - Grafana;
   - Jaeger;
   - una terminal en la raíz del repo.
5. **Si se presenta desde otro dispositivo:** levantar el túnel (`docs/demo-remoto.md`) y probarlo.
6. **Tener a mano** el PDF del documento y las capturas de `docs/capturas/`.

## Plan B

- **Se cae el túnel:** seguir en `http://localhost:8081` en la máquina que tiene el sistema.
- **Un servicio no responde:** `docker compose up -d`; mientras tanto sigue el siguiente en el guion.
- **No hay forma de levantar el sistema:** mostrar las capturas en este orden:
  - `web-03`, `web-05` y `web-07`;
  - `reservas-02`;
  - `pago-06`;
  - `cocheras-04`;
  - `infra-01`.

  Conviene grabar un video de 3 minutos de las demos 1 a 4 durante el ensayo del 13/11.

## Ensayo (13/11)

- Cronometrado, con el sistema levantado desde cero.
- Cada uno trae las 5 preguntas más difíciles de su parte, y otro integrante las responde. En la defensa pueden preguntarle a cualquiera sobre cualquier parte.
- Repasar las transiciones: quién le pasa la palabra a quién.
