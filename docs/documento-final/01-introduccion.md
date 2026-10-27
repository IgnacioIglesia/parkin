# Introducción

> Borrador para el documento final. Está escrito con lo que el sistema hace hoy; conviene que lo lean los cuatro y ajusten el tono.

## La idea

parkIN es una plataforma distribuida de alquiler de cocheras por franja horaria. Los propietarios publican las cocheras que no usan, y los conductores las buscan en un mapa, las reservan por horas y las pagan, con confirmación en tiempo real para las dos partes.

## El problema

Encontrar estacionamiento en zonas de alta densidad urbana genera congestión y pérdida de tiempo. A la vez, existen muchas cocheras en edificios y casas que quedan vacías durante varias horas del día. No hay un mecanismo seguro y eficiente que conecte ambas puntas y, sobre todo, que gestione **reservas concurrentes**: si dos conductores intentan reservar la misma cochera a la misma hora, el sistema no puede dejar que ambos lo consigan (una doble reserva) ni mostrar como libre una cochera que ya está tomada (una "cochera fantasma").

Ese es el corazón técnico del proyecto, y lo que lo vuelve un problema de **sistemas distribuidos**: varias personas, desde distintos dispositivos y contra distintas instancias del sistema, deben ver un estado consistente sin sacrificar disponibilidad ni tiempos de respuesta.

## La solución propuesta

Un sistema de microservicios orientado a eventos, con cuatro servicios de negocio, cada uno con su propia base de datos:

- **Usuarios:** registro, inicio de sesión y roles (propietario y conductor). Emite los tokens de autenticación.
- **Cocheras:** alta y gestión de cocheras, disponibilidad semanal y búsqueda geográfica.
- **Reservas:** reserva por franja horaria, con la garantía de que nunca haya dos reservas activas solapadas.
- **Pagos y notificaciones:** cobro mediante una pasarela, reembolsos y avisos en tiempo real.

Delante de ellos hay un **API Gateway** que es el único punto de entrada y valida la identidad de cada pedido, y un broker de mensajes (RabbitMQ) que coordina el flujo de reserva y pago sin que los servicios dependan unos de otros en el momento. Una web (React) es el único cliente.

## Alcance

Está implementado de punta a punta:

- registro e inicio de sesión de propietarios y conductores;
- publicación de cocheras con su disponibilidad y búsqueda por zona, tipo de vehículo y franja;
- reserva con control de concurrencia, retención de 10 minutos mientras se paga, cancelación y expiración;
- pago con una pasarela simulada, aprobación o rechazo, reembolso automático cuando corresponde y avisos en tiempo real;
- observabilidad con logs, métricas y trazas distribuidas.

Quedan fuera de esta entrega, y se declaran como límites en cada sección: la calificación de cocheras, otros medios de pago y pasarelas reales, los bloqueos de fechas puntuales, la subida de fotos, una política de cancelación con plazos, y el despliegue en la nube con varias réplicas.

## Relevancia

El problema es real y cotidiano: pérdida de tiempo y tránsito de personas dando vueltas buscando lugar, y un recurso (espacio construido) que se desaprovecha buena parte del día. En Montevideo y en zonas de demanda estacional como Punta del Este en verano, aprovechar mejor ese espacio tiene valor para quien lo necesita y para quien lo ofrece.

Desde lo académico, es un caso donde las características de los sistemas distribuidos se vuelven concretas y se pueden demostrar: concurrencia (que una sola reserva gane), tolerancia a fallos (que nada se pierda si un servicio cae), seguridad y confidencialidad (la dirección exacta solo la ve quien reservó), transparencia (el usuario solo ve "buscar, reservar y pagar") y escalabilidad. La sección de diseño explica cómo se aborda cada una.

## Uso de inteligencia artificial

Usamos Claude Code durante todo el proyecto para implementar servicios, escribir pruebas, reproducir y diagnosticar errores, revisar la seguridad del gateway y mantener la documentación al día. Nuestro criterio fue que **la IA escribe y la persona revisa, decide y publica**: la arquitectura, el reparto de servicios y las decisiones entre alternativas fueron del equipo, y cada cambio se verificó corriendo (pruebas contra bases de datos y un broker reales, y recorridos de punta a punta). La metodología y el registro de decisiones concretas, con lo que se aceptó y lo que se corrigió, están en `docs/uso-ia.md`.

## Equipo

Martina Berrutti, Ignacio Iglesia, Romina Lubniski y Diego Marin. Asignatura: Sistemas Distribuidos, Universidad de Montevideo. Docentes: Daniel Canoniero y Josefina Gallinal.
