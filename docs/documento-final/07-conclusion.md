# Conclusión

> Borrador para el documento final. Propuesta para que la revisen y completen los cuatro; cada afirmación sale de lo que está implementado y documentado en las secciones anteriores.

## Qué logramos

El objetivo era resolver un problema concreto de sistemas distribuidos: que muchas personas, desde distintos dispositivos y al mismo tiempo, puedan reservar y pagar cocheras sin dobles reservas ni cocheras fantasma. parkIN lo cumple de punta a punta:

- **Cuatro funcionalidades operativas y demostrables:** registro y autenticación; alta y gestión de cocheras; búsqueda y reserva por franja; pago con avisos en tiempo real.
- **Cuatro formas de comunicación**, cada una elegida por su caso de uso: REST, GraphQL, mensajería con RabbitMQ y WebSocket.
- **Persistencia** con una base PostgreSQL por servicio, y PostGIS para la búsqueda geográfica.
- **Los doce factores de 12-Factor**, uno de ellos (los procesos de administración) de forma parcial.
- **Los tres pilares de la observabilidad**, unidos por un mismo identificador de traza.

La garantía central se probó y no solo se diseñó. En la prueba con 20 conductores reservando la misma franja en el mismo instante, entra uno solo y los otros 19 reciben «franja ocupada». La garantía se sostiene aunque se caiga un servicio, se repita un mensaje o el pago llegue tarde.

## Lo que aprendimos

**La consistencia se pone donde todos coinciden.** La primera intuición era verificar en el código si la franja estaba libre antes de guardarla, y eso falla con concurrencia: dos pedidos pueden ver la franja libre a la vez. La regla terminó en la base de datos, el único lugar que comparten todas las réplicas. Es el esquema de exclusión mutua con servidor central visto en el curso, con la base como coordinador.

**No todo necesita consistencia fuerte.** Exigirla en todo el sistema lo habría vuelto lento y frágil. La aplicamos al reservar y al pagar, y aceptamos consistencia eventual en la búsqueda (30 segundos de caché). La pantalla puede quedar un poco vieja, pero el sistema nunca acepta una reserva incorrecta.

**Sin transacciones entre servicios, hay que diseñar las fallas.** Reservar y pagar ocurren en servicios con bases distintas. La saga obligó a pensar cada caso antes de que pasara: el pago se rechaza, nadie paga, se paga tarde, se cancela después de pagar. El outbox y la idempotencia fueron lo que permitió que «nada se pierde y nada se aplica dos veces» fuera cierto y no una aspiración.

**Lo que no se observa, no se puede arreglar.** Con cuatro servicios y un broker, un error sin trazas es casi imposible de ubicar. La observabilidad no quedó para la demo: encontró errores reales mientras desarrollábamos.

**Los contratos escritos permiten trabajar en paralelo.** Cuatro personas, dos lenguajes y cuatro servicios se integraron porque los endpoints, los eventos y el esquema GraphQL estaban escritos antes de implementarlos.

## Problemas encontrados y cómo los resolvimos

| Problema | Cómo apareció | Solución |
|---|---|---|
| Con reservas simultáneas, algunas respondían `500` en lugar de `409` | La prueba de punta a punta y los logs de Reservas (ver Observabilidad) | Un lock por cochera, y reintento de la transacción abortada. Nunca hubo doble reserva, pero el error era incorrecto |
| RabbitMQ no arrancaba en una máquina limpia | Al levantar el sistema desde cero con un volumen nuevo | Se declaró el virtual host en la configuración del broker |
| El sistema no arrancaba en frío: el gateway y Pagos buscaban la clave pública antes de que existiera, y Docker creaba una carpeta en su lugar | Al probar en un clon limpio del repositorio | Un servicio genera las claves la primera vez, y los demás esperan a que termine |
| La traza del pago se cortaba en el webhook, porque el aviso de la pasarela llega desde afuera y sin contexto | Al seguir una reserva en Jaeger | Pagos guarda el identificador de traza al crear el pago y cuelga de él el aviso y todo lo que sigue |
| Validar el token consultando a Usuarios sumaba una llamada en cada request y hacía de Usuarios un punto único de falla | Al revisar el diseño de la segunda entrega | El gateway verifica la firma del JWT con la clave pública, sin llamar a Usuarios |

## Límites de esta entrega

Los declaramos en cada sección; los principales son:

- **Una sola réplica.** El diseño permite varias réplicas por servicio, pero no lo probamos.
- **Puertos de desarrollo.** El compose publica puertos que permiten saltearse el gateway; en un despliegue real se cerrarían.
- **Pasarela simulada.** No se mueve dinero real.
- **Cancelación sin plazos.** La política de cancelación todavía no los define.
- **Fuera de alcance:** los bloqueos de fechas puntuales y la subida de fotos.

## Trabajo futuro

- Probar y medir el sistema con varias réplicas de cada servicio, y desplegarlo con un orquestador como Kubernetes, con autoescalado.
- Reemplazar la pasarela simulada por Mercado Pago. Está aislada en un solo archivo, así que la saga no cambia.
- Definir una política de cancelación con plazos y reembolsos parciales.
- Sumar bloqueos de fechas puntuales y la subida de fotos a un almacenamiento de objetos compartido.
- Un servicio de calificaciones que escuche los eventos de reserva, sin tocar los servicios existentes.
- Una consulta de ocupación por lote entre Cocheras y Reservas, para búsquedas con mucho tráfico.
- Propagar el contexto de traza completo en los eventos y sumar el gateway a las trazas, y mandar las alertas a un canal del equipo.
- Apps nativas para iOS y Android sobre la misma API.

## Sobre el uso de inteligencia artificial

La IA aceleró sobre todo la implementación, las pruebas y la documentación. El valor estuvo en usarla con un criterio claro: el contrato primero, la persona revisa y decide, y todo se verifica corriendo. Varias de las correcciones registradas en el anexo son casos en los que la IA propuso algo que parecía correcto y no lo era. Las decisiones de arquitectura y la elección entre alternativas fueron del equipo.

## Cierre

parkIN muestra que las características de los sistemas distribuidos se vuelven concretas cuando hay un problema real detrás:
- **la concurrencia** es que una sola reserva gane;
- **la tolerancia a fallos** es que un pago no se pierda si se cae un servicio;
- **la confidencialidad** es que nadie más que quien reservó sepa dónde vive el propietario.

El sistema completo se levanta con un solo comando y cada una de esas garantías se puede demostrar en vivo.
