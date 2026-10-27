# Defensa: Cocheras y observabilidad

Guía para quien defiende esta parte: qué explicar, qué mostrar y qué preguntas esperar. Las respuestas salen de lo que el sistema hace hoy; lo que no está resuelto se dice tal cual.

## En tres minutos

1. **Cocheras es el catálogo:** alta, edición y baja de cocheras, su disponibilidad semanal y la búsqueda por cercanía y franja horaria. No decide si una franja está ocupada (eso es de Reservas): le pregunta a Reservas para filtrar la búsqueda, y la garantía contra la doble reserva queda en la base de Reservas.
2. **Habla GraphQL** porque cada pantalla necesita datos distintos de la misma cochera: el mapa, pocos campos de muchas; la ficha, muchos de una. Los riesgos de GraphQL están acotados: profundidad máxima 5 y **DataLoader** contra el problema N+1.
3. **Protege la casa del propietario.** Todos ven una ubicación aproximada, fija, a 100-300 m de la real, y la búsqueda filtra y ordena por ella. La dirección exacta solo la ven el dueño y el conductor con una reserva confirmada, y Cocheras se entera de esa reserva por un evento de RabbitMQ.
4. **La búsqueda es geográfica y está en caché:** PostGIS resuelve «a menos de N metros» con un índice GIST, y el resultado queda 30 s en Redis. Es consistencia eventual a propósito: una pantalla puede quedar un poco vieja, pero nunca se generan datos incorrectos.
5. **Observabilidad:** logs, métricas y trazas unidos por un mismo `traceId`, con Grafana como punto único. Encontró un error real (500 por deadlock con reservas simultáneas) que se corrigió.

## Qué mostrar (y cómo)

| Qué | Cómo |
|---|---|
| La búsqueda en el mapa, con la ubicación aproximada | `http://localhost:8081`, buscar en un barrio con cocheras sembradas. Cada placa está en la ubicación aproximada, no en la casa; el círculo es el radio de búsqueda |
| Que la dirección exacta solo la ve quien reservó | `node scripts/demo.mjs`: al final imprime la dirección que ve el ganador, la del conductor que perdió (`null`) y la de un visitante (`null`) |
| GraphQL pidiendo solo lo necesario | DevTools del navegador, pestaña Red: la consulta del mapa trae `id titulo precioHora tipoVehiculo ubicacionAproximada`; la de la ficha trae además horarios, fotos y dirección |
| La caché de Redis | Buscar dos veces lo mismo y ver en Grafana (`:3030`), fila de Cocheras, el `miss` y después el `hit` |
| Una traza completa | La URL de Jaeger que imprime `scripts/demo.mjs` al final: Reservas consulta a Cocheras dentro de la misma traza, y la confirmación por evento aparece colgada de ella |
| Seguir un pedido en todos los servicios | La consulta de Loki que imprime el mismo script: `{servicio=~".+"} \|= "<traceId>"` |
| Las alertas | `http://localhost:9090/alerts` |
| Degradación controlada | `docker compose stop reservas`, buscar en el mapa (funciona, sin el filtro de ocupación), `docker compose start reservas`. No apagar Redis en vivo: Pagos lo necesita para arrancar si se reinicia |

Antes de la defensa: `docker compose ps` con todo `healthy`, `node scripts/sembrar-cocheras.mjs` para que la búsqueda tenga datos, y una corrida de `CONDUCTORES=20 node scripts/demo.mjs` para que el tablero tenga tráfico.

## Preguntas probables

### Cocheras

**¿Por qué GraphQL en Cocheras y REST en los demás?**
Porque Cocheras es el único servicio con vistas que piden datos muy distintos de la misma entidad: el mapa, el detalle, el panel del propietario. Con REST habría que elegir entre endpoints a medida para cada pantalla o respuestas con todo (sobrecarga). Con GraphQL cada pantalla pide exactamente sus campos en una sola request, y el esquema tipado es el contrato. Reservas y Pagos son operaciones simples (crear, consultar estado), y ahí REST es más simple y se monitorea por código HTTP.

**¿Qué riesgos tiene GraphQL y cómo los manejan?**
Tres. Una consulta muy anidada puede ser cara: se rechaza si pasa de profundidad 5. El problema N+1: lo resuelve DataLoader. Y GraphQL responde `200` aunque haya errores, así que el código HTTP no sirve para monitorear: medimos cada operación con su resultado (`ok`, `error_cliente`, `error_interno`) y hay una alerta sobre los errores internos.

**¿Qué es el problema N+1 y qué hace DataLoader?**
Si una búsqueda devuelve 50 cocheras y se pide la disponibilidad de cada una, un resolver ingenuo hace 1 consulta para las cocheras y 50 más, una por cada una. DataLoader junta todos los pedidos que se hacen dentro de un mismo request y los resuelve en una sola consulta. Hay un test que lo verifica contando las consultas: 5 cocheras, 1 sola consulta de franjas.

**¿Cómo protegen la dirección del propietario?**
Con dos ubicaciones. La aproximada se calcula al crear la cochera, a 100-300 m de la real, y queda fija; solo se recalcula si el dueño mueve la cochera. La exacta llega `null` para cualquiera que no sea el dueño o el conductor con reserva confirmada, y vuelve a llegar `null` cuando su franja terminó.

**¿Qué pasa con la dirección cuando la reserva termina?**
Deja de verse. Al recibir `reserva.confirmada`, Cocheras guarda también el fin de la franja (`hasta`, que viene en el evento), y la consulta compara esa hora con la de la base. No hace falta un evento de fin: el acceso vence solo. Hay tests para los dos casos, vigente y terminada.

**¿Por qué la ubicación aproximada es fija y no cambia en cada consulta?**
Porque si cambiara, promediando muchas búsquedas se podría reconstruir el punto real. Por lo mismo, la búsqueda filtra y ordena por la aproximada: si filtrara por la real, alguien podría ir achicando el radio y triangular la casa.

**¿Cómo sabe Cocheras quién tiene una reserva confirmada, si Reservas es la dueña del dato?**
Escucha `reserva.confirmada` por RabbitMQ y guarda el acceso; con `reserva.cancelada`, lo revoca. Así no consulta a Reservas en cada pedido de la ficha. Los eventos pueden llegar repetidos (se descartan por `eventId`, en la misma transacción) o desordenados: si la cancelación llega antes que la confirmación, el acceso queda revocado y la confirmación tardía no lo reabre.

**¿Por qué PostGIS y `GEOGRAPHY`?**
La búsqueda es «cocheras a menos de N metros de este punto, ordenadas por distancia». PostGIS lo resuelve con `ST_DWithin` y un índice GIST, sin recorrer toda la tabla. `GEOGRAPHY` calcula en metros sobre el elipsoide terrestre, sin tener que elegir una proyección.

**La caché, ¿no muestra datos viejos?**
Sí, hasta 30 segundos: es consistencia eventual, elegida a propósito. Puede mostrar como libre una cochera que alguien acaba de reservar, pero el intento de reservarla recibe `409` por la restricción de Reservas. Nunca hay doble reserva, solo una pantalla un poco vieja. Ante un cambio en una cochera (alta, edición, disponibilidad o baja) o una reserva confirmada o cancelada, se incrementa un número de versión que forma parte de cada clave, y así se invalidan todas las búsquedas guardadas de una vez.

**¿Qué pasa si cae Redis? ¿Y si cae Reservas?**
Sin Redis, la búsqueda va directo a la base: más lenta, pero funciona (Pagos, en cambio, no arranca sin Redis, porque lo usa para los avisos). Sin Reservas, la búsqueda devuelve las cocheras sin el filtro de ocupación en vez de fallar: la búsqueda es orientativa, y Reservas igual frena la doble reserva cuando vuelve. Lo que sí se rechaza sin Reservas es la baja de una cochera, porque no se puede saber si tiene reservas activas: ante la duda, no se borra.

**¿Y si cae RabbitMQ?**
El consumidor reintenta cada 3 segundos y `/ready` responde `503` mientras tanto. La búsqueda y la gestión de cocheras siguen funcionando; lo único que se demora es habilitar la dirección exacta, que llega cuando vuelve el broker, porque los eventos esperan en la cola durable.

**¿Por qué Cocheras no guarda una copia de las reservas para no consultarlas?**
Porque Reservas es la dueña del dato, y una copia podría quedar desactualizada justo en lo que más importa. El costo es una consulta de ocupación por candidata (hasta 100, en paralelo, con timeout de 2 segundos), que la caché amortigua. **Límite:** con mucho tráfico convendría un endpoint de ocupación por lote.

**¿Cómo manejan la hora?**
La disponibilidad se carga en hora de Montevideo. Una búsqueda en UTC se convierte a hora local y, si cruza la medianoche, se parte en dos días. Asumimos días de 24 horas, que es lo que pasa en Uruguay (sin horario de verano desde 2015).

**¿Por qué no hay bloqueos de fechas puntuales ni subida de fotos?**
Los dos quedaron fuera de alcance y están declarados. Los bloqueos cambiaban el contrato GraphQL, la búsqueda y el front, y la disponibilidad semanal cubre el caso principal. Subir fotos pide un almacenamiento de objetos compartido entre réplicas, con control de acceso y de tamaño, y no aporta a lo que el proyecto quiere demostrar: hoy se guardan URLs.

**¿Escala con varias réplicas?**
El diseño lo permite: no guarda estado en memoria, la caché está en Redis, las réplicas compiten por la misma cola y las migraciones toman un lock para no correr dos veces. **Pero no lo probamos con más de una réplica.**

### Observabilidad

**La letra pide un pilar, ¿por qué los tres?**
Porque un pedido recorre el gateway, varios servicios, RabbitMQ y la pasarela. Cada señal responde una pregunta distinta: las métricas dicen *que* algo anda mal, las trazas dicen *dónde*, los logs dicen *por qué*. Y como comparten el `traceId`, se pasa de una a otra.

**¿Cómo se sigue un pedido entre servicios?**
El gateway genera el `traceId` (header W3C `traceparent`). Cada servicio lo continúa, lo escribe en sus logs y lo propaga cuando llama a otro. Los eventos de RabbitMQ lo llevan dentro del mensaje, así el consumo también queda en la misma traza.

**¿Por qué el gateway no aparece en Jaeger?**
Genera el `traceId` y lo escribe en su log, pero no exporta spans: haría falta sumarle a NGINX un módulo de OpenTelemetry, y no lo hicimos. En Loki su línea es la primera del recorrido; en Jaeger, la traza empieza en el primer servicio.

**¿Qué es el aviso «invalid parent span» en Jaeger?**
Los eventos llevan el `traceId`, pero no el id del span que los publicó. El consumidor queda en la traza correcta, pero sin un padre conocido. Es un límite aceptado; se resolvería propagando el `traceparent` completo en los headers del mensaje.

**¿Pull o push? ¿Cómo llegan las métricas a Prometheus?**
Pull: Prometheus lee `GET /metrics` de cada servicio cada 15 segundos. Los servicios no saben que Prometheus existe, y si uno deja de responder, la alerta `ServicioCaido` lo detecta. Los logs, en cambio, los toma Alloy de la salida estándar de los contenedores (factor XI de 12-Factor).

**¿Por qué miden la latencia p95 y no el promedio?**
El promedio esconde a los usuarios que esperan mucho. La p95 dice cuánto espera el 95 % de los pedidos, y es la medida de calidad de servicio que usan las alertas: 500 ms para buscar y para el login, 800 ms para crear una reserva.

**¿Qué encontró la observabilidad?**
Dos errores reales. Con reservas simultáneas, algunas respondían `500` en lugar de `409` (al reproducirlo, 34 de cada 600 intentos): los logs de Reservas mostraron que PostgreSQL abortaba transacciones por *deadlock*. Nunca hubo doble reserva, pero el error era incorrecto. Se corrigió con un lock por cochera: después, 300 rondas de 10 y 60 de 40 sin ningún `500`, y la demo con 20 conductores da 1 reserva y 19 conflictos. El otro: RabbitMQ no arrancaba con un volumen nuevo, y el log mostró el motivo exacto.

**¿Cómo se suma un servicio nuevo a la observabilidad?**
Logs JSON a stdout, `GET /metrics` con los mismos nombres de métricas y el SDK de OpenTelemetry con dos variables de entorno. No hay que tocar Loki ni Grafana: los paneles de requests y latencia lo muestran solo. Está escrito en `docs/observabilidad.md`.

**¿Está listo para producción?**
No del todo. Grafana abre sin login, la retención es la de fábrica y las alertas solo se ven en Prometheus, sin un destino como un correo o un chat. Para la entrega alcanza; en producción eso es lo primero a resolver.

## Si algo falla durante la defensa

- **La búsqueda no devuelve nada:** `node scripts/sembrar-cocheras.mjs`, y buscar en uno de los barrios que siembra.
- **El tablero está vacío:** `CONDUCTORES=20 node scripts/demo.mjs` y esperar 15 a 30 segundos a que Prometheus lea las métricas.
- **Jaeger no muestra la traza:** buscar por servicio `cocheras` o `reservas` en los últimos 15 minutos; el gateway no aparece como servicio.
- **Reservas quedó apagado después de la demo de degradación:** `docker compose start reservas`.
- **Falla algo y no hay tiempo de arreglarlo:** mostrar las capturas de `docs/capturas/` (`cocheras-*`, `infra-01`, `reservas-01`, `pago-06`) y explicar con el diagrama de `docs/arquitectura.md`.
