# Defensa: Pagos, la saga y la comunicación

Guía para quien defiende esta parte: qué explicar, qué mostrar y qué preguntas esperar. Las respuestas salen de lo que el sistema hace hoy (`docs/secciones/pagos.md`, `docs/documento-final/04-comunicacion.md` y `docs/contratos.md`). Lo que no está resuelto se dice sin rodeos: una respuesta honesta sobre un límite vale más que una floja sobre algo que no se probó.

> Borrador escrito por Ignacio a pedido de Romina, que no llegaba a tiempo. **Romina: leelo en voz alta, cambiá lo que no suene a vos y verificá cada dato contra tu código antes de usarlo.**

Esta parte cubre las diapositivas 6 (comunicación), 11 (la saga), 12 (Pagos: no cobrar dos veces) y 16 (conclusión) del `guion-general.md`.

## En tres minutos

1. **Cuatro formas de comunicación, cada una por un motivo.** REST para operaciones simples; GraphQL para Cocheras, donde cada pantalla pide datos distintos; RabbitMQ entre servicios, para que si uno cae los mensajes esperen; y WebSocket para que el servidor avise la confirmación sin que el cliente pregunte. La regla es: **síncrono cuando el usuario necesita la respuesta ya** (el precio para reservar) **y asíncrono cuando no** (confirmar el pago).
2. **Reservar y pagar ocurre en servicios distintos, con bases distintas**, así que no hay una transacción que abarque los dos. Se resuelve con una **saga coreografiada**: cada paso es una transacción local que publica un evento, y si algo falla se compensa. Pago rechazado, se cancela la reserva y se libera la franja. Cobro tardío, se reembolsa.
3. **El riesgo de Pagos es el espejo de la doble reserva: cobrar dos veces.** Se evita con un pago vivo por reserva (un bloqueo más un índice único parcial), una clave de idempotencia, un webhook firmado con HMAC-SHA256 que solo cambia el estado una vez, y reembolso automático si se cobra algo que ya no corresponde.
4. **Nada se pierde si algo cae.** El evento se guarda en la misma transacción que el cambio de estado (*outbox*) y se publica con confirmación; los consumidores son idempotentes; lo que falla 3 veces va a una cola de mensajes fallidos.

**Tiempos del guion general:** comunicación 1:30, saga 1:30, Pagos 1:00, conclusión 0:45.

## Qué mostrar (y cómo)

| Qué | Cómo |
|---|---|
| El flujo completo de un pago | `http://localhost:8081`: reservar, **Pagá**, **Aprobar pago** en la pasarela, y ver cómo la reserva pasa a confirmada sola, por WebSocket |
| El rechazo y la compensación | Lo mismo, pero con **Rechazar**: llega el aviso de pago rechazado y la franja queda libre |
| La saga en una sola traza | Jaeger (`:16686`), buscar el servicio `pagos`: se ven Pagos, Reservas y Cocheras en una misma traza (captura `pago-06`) |
| Que nada se pierde si Pagos cae (opcional) | `docker compose stop pagos`, reservar desde la web (funciona), `docker compose start pagos` y pagar |
| Las colas de RabbitMQ | `http://localhost:15672` (guest / guest), pestaña **Queues**: `pagos.reserva-eventos`, `reservas.pago-eventos` y `cocheras.dlq` |

Antes de la defensa: `docker compose ps` con todo `healthy`, y `node scripts/sembrar-cocheras.mjs` para que la búsqueda tenga datos. Las capturas del flujo están en `docs/capturas/pago-01` a `pago-06`.

## Preguntas probables

### Comunicación

**¿Por qué usan cuatro formas de comunicación y no solo una?**
Porque cada una responde a un caso distinto. REST es simple y se monitorea por código HTTP. GraphQL le da a cada pantalla de Cocheras exactamente los campos que necesita. RabbitMQ desacopla a los servicios en el tiempo. WebSocket empuja avisos. Usar solo REST obligaría a los servicios a esperarse entre sí y al navegador a preguntar todo el tiempo.

**¿Cuándo usan síncrono y cuándo asíncrono?**
Síncrono cuando quien llama necesita la respuesta para seguir: Reservas le pregunta a Cocheras el precio y el propietario por GraphQL, porque el conductor espera. Asíncrono cuando no hace falta esperar: confirmar un pago viaja como evento. Lo asíncrono además amortigua picos y permite sumar consumidores.

**¿Por qué no comunicaron los servicios a través de una base de datos compartida?**
Porque acopla los esquemas: un cambio en una tabla rompe a otro servicio, y una base caída tira abajo a todos. Con una base por servicio, cada uno es dueño de sus datos y los demás se enteran por eventos o por su API. Pagos, por ejemplo, nunca consulta a Reservas: guarda una copia local de lo que necesita a partir de los eventos.

**¿Por qué RabbitMQ y no Kafka?**
Necesitamos repartir cada evento a las colas que lo escuchan, con confirmación por mensaje, reintentos y una cola de mensajes fallidos. No necesitamos un historial de eventos ni un volumen alto, y RabbitMQ es más simple de operar. Kafka sería razonable si quisiéramos reprocesar el historial.

**¿Por qué WebSocket y no consultar cada tanto (polling)?**
Con polling, el aviso tarda lo que tarde la próxima consulta y cada pestaña carga al servidor. Con WebSocket el aviso llega en el momento. Igual dejamos una consulta cada 5 segundos como respaldo mientras la reserva espera el pago, porque el aviso es *best effort*: la fuente de verdad es la reserva.

**¿Y si el aviso por WebSocket se pierde, o el usuario estaba desconectado?**
No se pierde información: la reserva se consulta por REST y la pantalla la actualiza igual con esa consulta periódica.

**¿Cómo se autentica un WebSocket?**
El navegador no puede mandar headers personalizados en un WebSocket, así que el token viaja en el *handshake* y Pagos lo verifica con la clave pública. Un token falso se rechaza con `TOKEN_INVALIDO`, y el front refresca el token y reconecta. Además, cada usuario entra a su sala y solo recibe avisos propios.

### La saga

**¿Qué es una saga y por qué la necesitan?**
Reservar y pagar ocurren en servicios con bases distintas, así que no existe una transacción que los abarque. Una saga hace la operación como una cadena de pasos locales, cada uno con su evento, y cada paso tiene una **compensación** por si algo falla más adelante.

**¿Es coreografiada u orquestada? ¿Por qué?**
Coreografiada: no hay un director central, cada servicio reacciona a los eventos que le interesan. Lo elegimos porque es más simple para tres servicios y no agrega un punto único de falla. El costo es que el flujo completo no está escrito en un solo lugar; por eso lo documentamos en un diagrama y se puede seguir en Jaeger con una sola traza.

**¿Qué compensaciones tienen?**
Pago rechazado: Reservas cancela la reserva y libera la franja. Pasan 10 minutos sin pagar: Reservas la expira y Pagos anula el pago pendiente. Se cobra algo que ya no corresponde: Pagos reembolsa.

**¿Qué pasa si el usuario paga justo cuando la reserva venció?**
Es el cobro tardío. La pasarela cobra, pero cuando el aviso llega la reserva ya está cerrada: el pago queda rechazado con el motivo `reserva_no_vigente`, se pide el reembolso y la reserva no revive. Se probó pagando una reserva ya cancelada: terminó con el reembolso hecho y la reserva seguía cancelada.

**¿Por qué reembolso automático y no dejar que el usuario lo pida?**
Porque el usuario no sabe que su pago llegó tarde: la pasarela le mostró «aprobado». Dejarlo con la plata cobrada y sin reserva es el peor resultado, y evitarlo no cuesta casi nada.

**¿Puede la reserva volver a un estado anterior si llega un evento atrasado?**
No. Cada estado tiene un orden (pendiente, confirmada, cancelada o expirada, finalizada) y la copia local solo se actualiza si el estado nuevo es posterior. Un evento atrasado o repetido no puede revivir una reserva cancelada.

### No cobrar dos veces

**¿Cómo evitan cobrar dos veces la misma reserva?**
Con varias capas. Dentro de la transacción de `POST /pagos` se toman dos bloqueos de aviso en PostgreSQL (uno por la `Idempotency-Key` y otro por la reserva), así los pedidos simultáneos hacen fila: el primero crea el pago y los demás devuelven ese mismo pago con la misma dirección de pago. Como red de seguridad, un índice único parcial impide dos pagos vivos por reserva aunque fallara el bloqueo. Se probó con 10 pedidos simultáneos con claves distintas: un solo pago, un `201` y nueve `200`.

**¿Qué pasa si el usuario toca dos veces «Pagar» o abre dos pestañas?**
Devuelve el mismo pago con la misma `checkoutUrl`, en lugar de un error. Es lo que espera la web cuando alguien cerró la pasarela y vuelve a intentar.

**¿Quién decide el monto?**
Nadie del lado del cliente. El cliente manda solo el `reservaId`; el monto lo calculó Reservas (precio por hora por duración) y llega en el evento `reserva.creada`.

**¿Cómo saben que el webhook lo mandó la pasarela y no un atacante?**
La pasarela firma el cuerpo con HMAC-SHA256 y un secreto compartido. Pagos lee el cuerpo crudo, antes de parsearlo, porque reformatearlo cambiaría la firma, y compara en tiempo constante. Sin firma válida responde `401` y no toca el pago. Aunque la firma sea válida, el aviso tiene que coincidir en monto, moneda y orden con el pago registrado.

**¿Y si la pasarela manda el mismo aviso dos veces?**
Las pasarelas reintentan. El pago se lee con bloqueo de fila y solo el primer aviso de un pago pendiente cambia su estado; los siguientes se responden con `200` y resultado `repetido`, para que dejen de reintentar.

**¿Por qué la orden en la pasarela se crea fuera de la transacción?**
Una llamada HTTP no puede quedar reteniendo bloqueos de la base. Si la pasarela no responde, se anula solo ese intento (`503`, sin avisar a Reservas) y la reserva se puede volver a pagar.

### Mensajería y tolerancia a fallos

**¿Qué pasa si Pagos cae? ¿Y si cae RabbitMQ?**
Si cae Pagos, Reservas sigue creando reservas y los eventos esperan en su cola durable; al volver, Pagos los procesa. Si cae RabbitMQ, los eventos quedan en el *outbox* y salen cuando vuelve; Pagos y Reservas se reconectan solos. Lo probamos apagando Pagos, reservando y encendiéndolo.

**¿Qué es el outbox y por qué lo usan?**
El evento se guarda en la misma transacción que el cambio de estado, en una tabla aparte, y otro proceso lo publica con confirmación del broker. Evita que el pago quede aprobado y el evento se pierda si algo falla en el medio.

**¿Se puede procesar dos veces un evento? ¿Y perderlo?**
Perderlo, no: outbox, confirmaciones, ACK manual y colas durables. Repetirse, sí: la entrega es *at-least-once*. Por eso cada consumidor registra el `eventId` que procesó y descarta los repetidos, en la misma transacción que aplica el cambio.

**¿Qué es la Dead Letter Queue?**
La cola de mensajes que fallaron 3 veces, o que están rotos y nunca se podrán procesar. No se pierden ni se reintentan para siempre: quedan para inspeccionarlos a mano, y hay una alerta cuando aparece alguno.

**¿Pagos funciona si Reservas está caída?**
Sí, para pagar una reserva que ya existe, porque tiene una copia local armada con los eventos. Lo que no puede es crear reservas nuevas.

### Seguridad y despliegue

**¿Por qué Pagos vuelve a verificar el token si el gateway ya lo hace?**
Defensa en profundidad, y además lo necesita igual: el WebSocket manda el token en el handshake y no en un header, así que no pasa por el mismo camino.

**¿Qué hay que cambiar para usar una pasarela real?**
Solo `pagos/src/pasarela.js`, que crea la orden y reembolsa. Las rutas, el webhook, la saga y los reembolsos no cambian. Con una real, el resultado lo decide y lo firma el proveedor.

**¿Cómo escala Pagos?**
Es un servicio sin estado. El adaptador de Redis de Socket.IO hace que un aviso llegue al cliente aunque esté conectado a otra réplica, y el publicador del outbox usa `SKIP LOCKED` para que varias réplicas no se pisen. **Pero solo lo probamos con una réplica.**

**¿Y si Redis se cae?**
Si Redis no responde al arrancar, Pagos espera 5 segundos y arranca igual sin el adaptador. Con una sola réplica los avisos llegan igual. Antes se quedaba esperando a Redis para siempre, sin abrir el puerto; lo encontró Diego revisando el código, y hay un test que lo cubre.

**¿Cómo lo probaron?**
61 pruebas automáticas contra PostgreSQL real (pagos concurrentes, firma, webhook repetido y adulterado, eventos fuera de orden, outbox y WebSocket, también con Redis caído), y una prueba de punta a punta por el gateway con todos los casos de la tabla de `pagos.md`.

## Límites (decilos antes de que pregunten)

- **La pasarela es simulada.** No se mueve dinero real, y guarda las órdenes en memoria.
- **Una sola réplica probada.** El diseño permite varias, pero no lo medimos.
- **Una sola moneda:** todo se cobra en pesos uruguayos, como lo calcula Reservas.
- **El estado «finalizada» está previsto en Pagos**, pero Reservas todavía no publica `reserva.finalizada`, así que hoy Pagos nunca lo recibe.
- **El contexto de traza viaja solo como `traceId` en los eventos**, y el gateway no figura como un tramo; en Jaeger algunos tramos muestran un aviso de padre desconocido.
- **La cancelación todavía no tiene plazos:** se reembolsa completo.

## Conclusión (diapositiva 16, 45 segundos)

parkIN muestra que las características de los sistemas distribuidos se vuelven concretas cuando hay un problema real detrás: **la concurrencia** es que una sola reserva gane; **la tolerancia a fallos** es que un pago no se pierda si cae un servicio; **la confidencialidad** es que nadie más que quien reservó sepa dónde vive el propietario. El sistema completo se levanta con un solo comando y cada una de esas garantías se puede demostrar en vivo. Como trabajo futuro: probar varias réplicas, una pasarela real y una política de cancelación con plazos.

## Si algo falla durante la defensa

- **El sistema no responde:** `docker compose ps`; si algo figura como `Created` o `Exited` (salvo `jwt-claves`), `docker compose up -d`.
- **No hay datos para mostrar:** `node scripts/sembrar-cocheras.mjs`.
- **La pasarela o el WebSocket no andan:** mostrar las capturas `pago-01` a `pago-06` de `docs/capturas/` y explicar el flujo con el diagrama de `docs/secciones/pagos.md`.
- **Se cae el túnel:** seguir en `http://localhost:8081`.
