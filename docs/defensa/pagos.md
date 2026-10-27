# Defensa: comunicación, saga y Pagos

Guía para quien defiende esta parte: qué decir en cada diapositiva, qué mostrar y qué preguntas esperar. Las respuestas salen de lo que el sistema hace hoy. Lo que no está resuelto se dice sin rodeos, porque una respuesta honesta sobre un límite vale más que una floja sobre algo que no se probó.

El detalle está en el capítulo `docs/documento-final/04-comunicacion.md` y en las secciones `docs/secciones/pagos.md` y `docs/secciones/gateway.md`.

## Las cuatro diapositivas (4:45 en total)

### 6. Comunicación: cuatro mecanismos y por qué (1:30)

1. **Abrir con la regla:** «Síncrono cuando el usuario necesita la respuesta ya; asíncrono cuando no».
2. **REST** con Usuarios, Reservas y Pagos: operaciones simples que se monitorean por código HTTP. `POST /reservas` y `POST /pagos` llevan `Idempotency-Key`, porque POST no es idempotente.
3. **GraphQL** con Cocheras: el mapa pide 5 campos de muchas cocheras y la ficha muchos de una. Cada pantalla pide lo que dibuja. DataLoader contra el N+1 y profundidad máxima 5.
4. **RabbitMQ** entre Reservas, Pagos y Cocheras: si un servicio cae, los mensajes lo esperan en su cola.
5. **WebSocket** de Pagos a la web: la confirmación llega apenas ocurre. La pantalla igual consulta cada 5 segundos como respaldo.
6. **Pase:** «Martina les cuenta cómo se identifica quien hace cada uno de estos pedidos».

### 11. La saga de reserva y pago (1:30)

1. **El problema:** reservar y pagar ocurre en dos servicios con bases distintas. No hay una transacción que abarque a los dos.
2. **Saga coreografiada:** cada paso es una transacción local que publica un evento, sin un coordinador central. Reservas crea la reserva `PENDIENTE_PAGO` y publica `reserva.creada`. Pagos cobra y publica `pago.aprobado`. Reservas confirma y publica `reserva.confirmada`.
3. **Compensaciones:** si el pago se rechaza o pasan 10 minutos, la reserva se cancela o expira y la franja se libera. Si se cobró algo que ya no corresponde, Pagos reembolsa.
4. **Outbox:** el evento se guarda en la misma transacción que el cambio. No hay cambio sin evento ni evento sin cambio.
5. **Idempotencia:** la entrega es *at-least-once*; cada consumidor descarta el `eventId` repetido.

### 12. Pagos: no cobrar dos veces (1:00)

1. **Un solo pago vivo por reserva:** un lock por reserva en PostgreSQL más un índice único parcial como red de seguridad. Probado: 20 «Pagar» simultáneos crean un solo pago.
2. **El monto no lo manda el cliente:** se cobra el que calculó Reservas, que llega en el evento.
3. **El webhook está firmado** con HMAC-SHA256 sobre el cuerpo exacto. Un aviso sin firma, adulterado o repetido no cambia nada.
4. **Reembolso automático:** si la pasarela cobra una reserva que ya venció o se canceló, o se cancela una ya pagada. Si la pasarela falla al devolver, se reintenta cada 30 segundos sin devolver dos veces.

### 16. Conclusión y trabajo futuro (0:45)

1. **Lo que se logró:** cuatro funcionalidades de punta a punta, cuatro formas de comunicación y los tres pilares de observabilidad. La garantía central se probó: 20 conductores a la vez, entra uno.
2. **Lo que aprendimos:** la consistencia se pone donde todos coinciden (la base de datos), y sin transacciones entre servicios hay que diseñar cada falla.
3. **Límites y trabajo futuro:** probar varias réplicas y un orquestador, una pasarela real (Mercado Pago, aislada en un solo archivo), y una política de cancelación con plazos.
4. **Pase:** «Preguntas».

## Qué mostrar (demo 5, opcional, si sobra tiempo)

| Paso | Comando o acción | Qué decir |
|---|---|---|
| 1 | `docker compose stop pagos` | «Apagamos Pagos» |
| 2 | Reservar desde la web | «Se puede reservar igual: `reserva.creada` queda esperando en la cola de Pagos» |
| 3 | `docker compose start pagos` | «Pagos vuelve y procesa lo pendiente» |
| 4 | «Pagá» y Aprobar en la pasarela | «Nada se perdió: la confirmación llega por WebSocket» |

Si no hay tiempo de demo, la captura `pago-06-jaeger-saga-del-pago.png` muestra la saga completa en una sola traza: 3 servicios y 46 spans.

## Preguntas probables

### Comunicación

**¿Por qué usaron cuatro formas de comunicación y no una sola?**
Porque cada una resuelve un caso distinto. REST para operaciones simples; GraphQL donde las pantallas piden datos muy distintos de la misma entidad; RabbitMQ para coordinar servicios sin que tengan que estar vivos a la vez; WebSocket para que el servidor avise sin que el cliente pregunte. Usar una sola habría obligado a forzarla en los casos donde no encaja.

**¿Por qué GraphQL solo en Cocheras?**
Es el único servicio con vistas que necesitan datos muy distintos de la misma entidad: el mapa, la ficha y el panel del propietario. Con REST habría que traer de más, hacer varias llamadas o crear un endpoint por pantalla. Reservas y Pagos son operaciones simples, y REST es más fácil de cachear y de monitorear por código HTTP.

**¿Qué problemas trae GraphQL y cómo los resolvieron?**
El N+1 (DataLoader, con un test que cuenta las consultas), las queries anidadas maliciosas (profundidad máxima 5), los errores que vuelven con HTTP 200 (se mide cada operación con su resultado y hay una alerta) y que no se puede cachear por HTTP (la caché está en Redis, en el servidor).

**¿Cuándo síncrono y cuándo asíncrono?**
Síncrono cuando el usuario necesita la respuesta ya: para crear la reserva hace falta el precio, así que Reservas se lo pide a Cocheras y espera, con un límite de 3 segundos. Asíncrono cuando no: la confirmación del pago puede tardar unos segundos y no hace falta que Reservas y Pagos estén vivos al mismo tiempo.

**¿Por qué no se comunican por una base de datos compartida?**
Porque acopla los esquemas (un cambio en una tabla rompe a otro servicio) y una base caída tira abajo a todos. Cada servicio es dueño de sus datos y los demás se enteran por eventos o por su API. Pagos, por ejemplo, guarda su propia copia de la reserva a partir de los eventos, y puede cobrar aunque Reservas esté caído.

**¿Por qué RabbitMQ y no Kafka?**
Necesitamos repartir cada evento a las colas interesadas, con confirmación por mensaje, reintentos y una cola de fallidos. RabbitMQ lo trae incorporado. Kafka está pensado para un registro histórico y volúmenes muy altos, que no es nuestro caso.

**¿Qué tipo de exchange usan y por qué?**
*Topic*. Cada cola se suscribe solo a las claves que le interesan, y un mismo evento llega a varias: `reserva.confirmada` va a Pagos y a Cocheras. Un servicio nuevo, por ejemplo uno de calificaciones, se suscribe sin tocar a quien publica.

**¿Por qué WebSocket y no polling? ¿Y SSE?**
Con polling el aviso tarda lo que tarde la próxima consulta, y cada pestaña le pega al servidor aunque no haya novedades. SSE alcanzaría para avisos en un solo sentido, pero Socket.IO trae reconexión, salas por usuario y el adaptador para varias réplicas. Igual dejamos una consulta cada 5 segundos como respaldo.

**¿Cómo se autentica el WebSocket si no lleva header `Authorization`?**
El JWT va en el *handshake* (`auth.token`) y Pagos lo verifica con la clave pública al conectar. Sin token válido, la conexión se rechaza con `TOKEN_INVALIDO`, y la web refresca el token y reconecta. Cada conexión entra a la sala de su usuario, así que nadie recibe avisos ajenos.

**¿Qué pasa si el aviso por WebSocket se pierde?**
No se pierde información: el aviso es de mejor esfuerzo. La fuente de verdad es `GET /reservas/{id}`, que la pantalla consulta cada 5 segundos mientras espera el pago.

**¿Cómo funciona el WebSocket con varias réplicas de Pagos?**
El adaptador de Redis de Socket.IO reparte cada aviso entre las réplicas, para que llegue aunque el cliente esté conectado a otra. **Solo lo probamos con una réplica.** Si Redis no responde al arrancar, Pagos arranca igual sin el adaptador: con una réplica no cambia nada.

### Saga

**¿Por qué una saga y no un commit en dos fases?**
El commit en dos fases bloquea los recursos de todos mientras espera al coordinador, y si el coordinador cae los deja trabados. Con la saga, cada paso es una transacción local que termina enseguida, y si algo falla se compensa. El costo es la consistencia eventual: durante unos segundos la reserva está `PENDIENTE_PAGO` aunque el pago ya se aprobó.

**¿Por qué coreografiada y no orquestada?**
Son tres pasos y dos servicios principales: un orquestador sería una pieza más que operar y un punto de falla. Cada servicio sabe qué hacer cuando le llega un evento. Si el flujo creciera mucho (más pasos, más servicios), un orquestador haría más fácil seguirlo; hoy lo resolvemos con las trazas, que muestran la saga entera en Jaeger.

**¿Qué es el outbox y qué problema resuelve?**
Si el servicio guardara el cambio y después publicara, una caída entre los dos pasos dejaría un pago aprobado sin evento (la reserva nunca se confirma) o un evento de algo que se revirtió. Con el outbox el evento se guarda en la misma transacción, y un publicador aparte lo envía con *publisher confirms*. Solo se marca como enviado cuando el broker lo confirma. Si RabbitMQ está caído, el evento espera, y la métrica `pagos_outbox_pendientes` lo muestra.

**¿Y si el mismo evento llega dos veces?**
Puede pasar, porque la entrega es *at-least-once*. Cada consumidor guarda el `eventId` en la misma transacción que aplica el cambio y descarta los repetidos. Está probado con el mismo evento 10 veces en paralelo: se aplica una vez.

**¿Y si los eventos llegan fuera de orden?**
Ningún consumidor confía en la hora del evento, porque los relojes de distintas máquinas no coinciden. Cada estado tiene un orden y nunca retrocede: una `reserva.confirmada` atrasada no revive una reserva cancelada. Está probado.

**¿Qué pasa con un mensaje que no se puede procesar nunca?**
Las colas tienen un límite de 3 entregas. Lo que lo supera, o es inválido desde el principio, va a `cocheras.dlq`, y una alerta avisa. Así no se reintenta para siempre ni frena a los demás.

**¿Qué pasa si el pago llega justo cuando la reserva vence?**
El bloqueo de fila en Reservas hace que termine `CONFIRMADA` o `EXPIRADA`, nunca las dos. Si gana la expiración, Pagos recibe `reserva.expirada`, y si la pasarela ya había cobrado, reembolsa. Hay pruebas de esa carrera en los dos servicios.

### Pagos

**¿Cómo garantizan que no se cobra dos veces?**
En tres capas:
1. **La misma `Idempotency-Key`** devuelve el mismo pago.
2. **Con otra clave**, un lock por reserva (`pg_advisory_xact_lock`) hace que los pedidos simultáneos de la misma reserva hagan fila. Si ya hay un pago pendiente, se devuelve ese mismo, con su link de pago.
3. **Un índice único parcial** impide dos pagos vivos de la misma reserva, aunque el lock fallara.

Probado: 20 pedidos simultáneos dan un solo pago y una sola orden en la pasarela.

**¿Qué impide que alguien llame al webhook y apruebe su propio pago?**
La firma HMAC-SHA256 del cuerpo, con un secreto que solo conocen Pagos y la pasarela. Se calcula sobre el cuerpo exacto que llegó, no sobre el JSON ya interpretado, y se compara en tiempo constante. Sin firma, o con el cuerpo adulterado, la respuesta es `401` y no cambia nada. Además se verifica que el monto, la moneda y la orden coincidan con el pago.

**¿Y si la pasarela manda el mismo aviso varias veces?**
El primero cambia el estado y los demás responden `200` sin tocar nada ni publicar otra vez. Un aviso contradictorio posterior también se ignora: manda el primero.

**¿Cuándo reembolsan?**
Cuando la pasarela cobra una reserva que ya venció o se canceló (pago tardío), y cuando se cancela una reserva ya pagada. Si la pasarela falla al reembolsar, el reembolso queda pendiente y se reintenta cada 30 segundos, sin devolver dos veces.

**¿Por qué el monto no lo manda el cliente?**
Porque se podría falsificar. Lo calcula Reservas (precio por hora × duración) con el precio que le da Cocheras, y llega a Pagos en el evento `reserva.creada`.

**¿Qué pasa si la pasarela no responde?**
Después de 5 segundos, Pagos responde `503 PASARELA_NO_DISPONIBLE`, anula ese intento sin avisar a Reservas y la reserva se puede volver a pagar mientras no venza.

**¿Por qué la pasarela es simulada?**
Para demostrar el flujo completo sin mover dinero real. Imita a Mercado Pago: orden, página de pago y webhook firmado. Está aislada en un solo archivo de Pagos, así que cambiarla por la real no toca la saga. Guarda las órdenes en memoria, y quien conozca el id de una orden puede resolverla desde la página: es aceptable para una simulación.

**¿Cómo siguen un pago en las trazas si el webhook llega sin contexto?**
Pagos guarda el `traceId` al crear el pago, y cuando llega el aviso de la pasarela continúa esa misma traza. En Jaeger se ve el «Pagar» de punta a punta: Pagos, Reservas y Cocheras. Los spans que cuelgan de un evento muestran el aviso «invalid parent span», porque en el evento solo viaja el `traceId`; quedan en la traza correcta.

### Gateway (por si preguntan, aunque lo presenta Martina)

**¿Por qué el gateway verifica el JWT él mismo?**
Para no llamar a Usuarios en cada request ni depender de que esté vivo. Verifica la firma RS256 con la clave pública, con njs, porque el NGINX de código abierto no lo trae. La primera versión consultaba a Usuarios con `auth_request`; ese endpoint se borró el 26/10.

**¿Qué ve el gateway en la observabilidad?**
Un log JSON por request con `traceId` y `usuarioId`, el log de errores con nivel en Loki, y sus contadores en Prometheus a través de `nginx-prometheus-exporter`, con la alerta `GatewayCaido`.

## Si algo falla durante la defensa

- **Pagos no responde:** `docker compose ps`; si figura `Exited`, `docker compose up -d pagos`. Mientras tanto, seguir con la captura `pago-06`.
- **La confirmación no llega por WebSocket:** esperar 5 segundos (la pantalla consulta sola) y decirlo: «el WebSocket es el camino rápido; la consulta es el respaldo».
- **La pasarela no abre:** mostrar las capturas `pago-01` a `pago-05` en orden.
