# Defensa: Reservas e infraestructura

Guía para quien defiende esta parte: qué explicar, qué mostrar y qué preguntas esperar. Las respuestas salen de lo que el sistema hace hoy; lo que no está resuelto se dice sin rodeos, porque una respuesta honesta sobre un límite vale más que una floja sobre algo que no se probó.

## En tres minutos

1. **El problema central** es que dos conductores no puedan reservar la misma cochera a la misma hora, ni siquiera si lo intentan en el mismo instante y desde distintas réplicas del servicio.
2. **La solución** es poner esa regla donde todas las réplicas coinciden: la base de datos. Una restricción de exclusión de PostgreSQL (`EXCLUDE USING gist` sobre la cochera y el rango de tiempo) rechaza una reserva que se solape con otra activa. El servicio traduce ese rechazo a `409`.
3. **Reservar y pagar ocurre en servicios distintos**, así que no hay una transacción que los abarque. Se resuelve con una **saga coreografiada**: cada paso es una transacción local que publica un evento, y si algo falla se compensa (se cancela la reserva y se libera la franja).
4. **Nada se pierde si algo cae:** los eventos se guardan en la misma transacción que el cambio de estado (*outbox*) y se publican después con confirmación; los consumidores son idempotentes.

## Qué mostrar (y cómo)

| Qué | Cómo |
|---|---|
| La concurrencia: 20 conductores a la vez sobre la misma franja, entra uno solo | `CONDUCTORES=20 node scripts/demo.mjs` (usa el gateway; muestra 1 reserva y el resto con conflicto) |
| El flujo completo desde la web | `http://localhost:8081`: reservar, **Pagar**, aprobar en la pasarela, ver la confirmación en vivo |
| Una reserva que expira sin pago | Reservar y no pagar; a los 10 minutos pasa a `EXPIRADA` (para mostrarlo rápido, se puede forzar el vencimiento en la base) |
| Que nada se pierde si cae un servicio | `docker stop` de Pagos, reservar (funciona), `docker start` de Pagos, y pagar |
| La observabilidad | Grafana (`:3030`), una traza en Jaeger (`:16686`) y las métricas de Reservas (`reservas_conflictos_total`, `reservas_outbox_pendientes`) |

Antes de la defensa: `docker compose ps` con todo `healthy`, y `node scripts/sembrar-cocheras.mjs` para que la búsqueda tenga datos.

## Preguntas probables

**¿Cómo evitan la doble reserva?**
Con una restricción de exclusión en PostgreSQL. Verificar "¿está libre? entonces inserto" en el código falla con concurrencia, porque dos solicitudes pueden ver la franja libre a la vez, y un lock en memoria no sirve con varias réplicas. La base de datos es el único lugar que todas comparten. Se probó con 100 clientes simultáneos sobre la misma franja: una reserva y 99 conflictos. Sin la restricción, la misma prueba falla.

**Si ya tienen la restricción, ¿para qué el lock por cochera?**
Porque la restricción protege los datos, pero con PostgreSQL real dos `INSERT` simultáneos sobre la misma cochera podían esperarse mutuamente y la base abortaba uno por *deadlock*, que llegaba al cliente como un `500`. Nunca hubo doble reserva, pero el error era feo. Lo detectó Diego, lo reproducimos (34 de cada 600 intentos) y vimos que solo reintentar no alcanzaba, así que las altas de una misma cochera ahora hacen fila con un lock de aviso. Después, 0 errores en 3000 intentos.

**¿Qué pasa con dos réplicas de Reservas?**
El diseño lo soporta: no guarda estado en memoria, la restricción y el lock están en la base, y las tareas periódicas usan `SKIP LOCKED` para no pisarse. **Pero no lo probamos con más de una réplica**; está declarado como límite.

**¿Qué es el outbox y por qué lo usan?**
Si el servicio guardara la reserva y después publicara en RabbitMQ, un fallo entre los dos pasos dejaría una reserva sin evento (Pagos nunca cobra) o un evento de algo que se revirtió. El evento se guarda en la misma transacción que el cambio de estado, y un hilo aparte lo publica con confirmación del broker. Si RabbitMQ está caído, el evento espera en la tabla `outbox`; la métrica `reservas_outbox_pendientes` lo muestra.

**¿Y si el mismo evento llega dos veces?**
La entrega es *at-least-once*, así que puede pasar. Los consumidores guardan el `eventId` y descartan los repetidos, dentro de la misma transacción que aplica el cambio. Se probó con el mismo evento 10 veces en paralelo: se aplica una sola vez.

**¿Cómo funciona la saga y qué compensa?**
Reservar crea la reserva en `PENDIENTE_PAGO`. Si Pagos aprueba, la reserva pasa a `CONFIRMADA`. Si rechaza o pasan 10 minutos, se cancela o expira y se libera la franja. Si se cobra algo que ya no corresponde (por ejemplo, el pago llega después de que la reserva expiró), Pagos reembolsa automáticamente.

**¿Qué pasa si pagan justo cuando la reserva expira?**
Hay una carrera posible. El bloqueo de fila hace que la reserva termine `CONFIRMADA` o `EXPIRADA`, nunca las dos, con un solo evento de cierre. Si gana la expiración, el pago se reembolsa. Hay una prueba con 20 reservas en esa carrera.

**¿Por qué una reserva puede tardar hasta un minuto de más en liberarse?**
La expiración corre cada 60 segundos. Es una demora aceptada, y está documentada.

**¿Es CP o AP? ¿Qué consistencia ofrecen?**
Fuerte donde importa: al reservar (una sola gana, siempre) y en el pago. Eventual en la búsqueda de Cocheras: usa una caché de 30 segundos y puede mostrar una franja recién ocupada, pero el intento de reservarla recibe `409`, así que nunca hay un error de datos, solo una pantalla un poco vieja.

**¿Por qué Reservas está en Python y los demás en Node?**
Para mostrar la heterogeneidad que pide la materia: los servicios se hablan por protocolos estándar (HTTP, GraphQL, AMQP, WebSocket) y no importa en qué lenguaje estén. Los contratos están escritos en `docs/contratos.md`.

**¿Por qué el gateway valida el JWT él mismo y no le pregunta a Usuarios?**
Para no sumar una llamada a Usuarios en cada request, que es lo que planteaba la segunda entrega. Verifica la firma RS256 con la clave pública, rechaza `alg: none` y el cambio de algoritmo, y le pasa la identidad a los servicios en `X-User-Id` y `X-User-Roles`, pisando lo que mande el cliente. Probamos 11 tipos de tokens maliciosos. La primera versión consultaba a Usuarios con `auth_request`; ese endpoint (`/auth/verificar`) se borró cuando el gateway pasó a verificar localmente.

**¿Es seguro que Reservas confíe en `X-User-Id`?**
Solo si Reservas es accesible únicamente a través del gateway. En el compose de desarrollo publicamos algunos puertos para probar sin el gateway, y llamándolos directo se podría falsificar la identidad. Está declarado en `arquitectura.md`: en un despliegue real solo se publicaría el gateway.

**¿Qué pasa si cae RabbitMQ? ¿Y si cae Pagos?**
Reservas sigue creando reservas: los eventos esperan en el outbox, y cuando vuelve el broker salen. Si cae Pagos, los eventos esperan en su cola durable y los procesa al volver. Lo probamos apagando Pagos, reservando, y encendiéndolo.

**¿Cómo se despliega? ¿Escala?**
Con `docker compose up --build`. Los servicios son contenedores sin estado y se reinician solos. El diseño permite escalar horizontalmente, pero **solo probamos una réplica de cada uno**, y no hay orquestador ni autoescalado: eso quedó como evolución (ver "Despliegue en la nube" de la segunda entrega).

**¿Qué haría distinto con más tiempo?**
Probar varias réplicas, quitar los puertos de desarrollo, definir la política de cancelación con plazos, y reemplazar la pasarela simulada por una real.

## Si algo falla durante la defensa

- **El sistema no responde:** `docker compose ps`; si algo figura como `Created` o `Exited` (salvo `jwt-claves`), `docker compose up -d`.
- **No hay datos para mostrar:** `node scripts/sembrar-cocheras.mjs`.
- **Se cae el túnel:** seguir en `http://localhost:8081`.
- **Falla un servicio y no hay tiempo de arreglarlo:** mostrar las capturas o el video de respaldo, y explicar el diseño con el diagrama de `docs/arquitectura.md`.
