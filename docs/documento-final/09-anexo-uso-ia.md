# Anexo: uso de inteligencia artificial

> Resumen para el documento final. El registro completo, fila por fila y con fechas, está en `docs/uso-ia.md`.

## Cómo la usamos

Usamos **Claude Code**, el asistente de programación de Anthropic, desde la terminal y sobre el repositorio del proyecto. Los cuatro integrantes lo usamos en nuestra parte.

1. **Primero el contrato, después el código.** Los endpoints, los eventos y el esquema GraphQL quedaron escritos en `docs/contratos.md` antes de implementar. La IA implementó contra ese contrato y los cambios al contrato se discutieron en el equipo.
2. **La IA escribe, la persona revisa y publica.** La IA crea código, pruebas y documentos; cada persona revisa el trabajo, lo publica con su usuario y responde por él. Por eso la IA no figura como autora de los commits: su uso queda declarado acá y en el registro detallado.
3. **Se verifica corriendo, no leyendo.** Cada pieza se probó con pruebas automáticas contra bases de datos y un broker reales, y con recorridos de punta a punta por el gateway. Cuando una prueba falló, se corrigió la causa.
4. **Una rama por tarea.** Cada cambio entró a la rama principal por una solicitud de integración (*pull request*) revisada.

**Para qué la usamos:** implementar servicios sobre un contrato, escribir pruebas, reproducir y diagnosticar errores, revisar seguridad, armar la infraestructura y mantener la documentación al día.

**Qué decidimos nosotros:** el reparto de servicios, la arquitectura, el stack y la elección entre alternativas. En esos casos la IA presentó las opciones con sus costos y el equipo eligió.

**Límite que conocemos:** la IA puede producir código que parece correcto y no lo es. Varias de las filas de abajo son casos así, y por eso cada decisión indica qué se verificó y qué se cambió.

## Veinte decisiones concretas

| # | Integrante | Qué se consultó o se decidió | Qué se aceptó, se corrigió o se descartó |
|---|---|---|---|
| 1 | Ignacio | Dónde validar el JWT: en el gateway con la clave pública (njs) o consultando a Usuarios en cada pedido | Se eligió el gateway: no depende de Usuarios en cada pedido, como planteaba la segunda entrega. Se probó con 40 verificaciones, incluidos tokens vencidos, falsificados, `alg: none` y cambio de algoritmo. El equipo votó esa opción |
| 2 | Ignacio | Cómo evitar la doble reserva: código de la aplicación o base de datos | Una restricción de exclusión en PostgreSQL, porque la regla tiene que vivir donde coinciden todas las réplicas. Con 100 clientes simultáneos entra una reserva y hay 99 conflictos; sin la restricción, la misma prueba falla |
| 3 | Ignacio | Publicar el evento directamente después de guardar, o con un *outbox* transaccional | Se adoptó el *outbox* para no perder eventos si RabbitMQ cae. La prueba con RabbitMQ real mostró que la configuración no creaba el *virtual host* y se corrigió |
| 4 | Ignacio | Reservas simultáneas respondían `500` en lugar de `409` (error reportado por Diego) | Se reprodujo con PostgreSQL 16: 34 de cada 600 intentos. Reintentar no alcanzaba (18 de 250 seguían fallando), así que se agregó un bloqueo por cochera. Después, 0 errores en 3000 intentos. Se rehízo la prueba para que detectara el problema |
| 5 | Ignacio | Qué hacer con un pago que llega cuando la reserva ya venció | Reembolso automático, decidido por el equipo frente a otras alternativas |
| 6 | Ignacio | Arranque desde cero en un clon limpio | Falló: el gateway y Pagos buscaban la clave pública antes de que existiera. Se agregó un servicio que genera las claves la primera vez y los demás esperan. Se sumó reinicio automático a las bases y a RabbitMQ |
| 7 | Ignacio | Mostrar el sistema desde otro dispositivo con un túnel público | Decisión de seguridad: publicar solo la página de pago de la pasarela de prueba y no el resto de sus rutas |
| 8 | Romina | Contrato de Pagos: endpoint, webhook firmado, eventos | Se adoptó, pero los datos de los eventos se alinearon con los que Reservas ya publicaba en vez de la propuesta inicial |
| 9 | Romina | Implementación propia de Pagos, hecha en paralelo | Se descartó porque quedó duplicada con la que ya estaba integrada. Lo aprendido sirvió para verificar la otra y para detectar que la traza de la saga se cortaba en el webhook, que se resolvió guardando el identificador de traza con el pago |
| 10 | Romina | Métricas propias del gateway y nivel de sus logs de error | Al probarlo se vio que el log de errores no registraba los tokens rechazados y se corrigió. Se descartó una alerta de errores 5xx porque la fuente de métricas no los separa por código |
| 11 | Romina | Cerrar el puerto propio de Pagos | Se verificó que nada lo usaba y que todo sigue entrando por el gateway, con la prueba de punta a punta en verde |
| 12 | Romina | Revisión de la sección de Pagos | Se verificó cada punto contra el código. Se corrigió la cantidad de pruebas (60, no 61): un archivo de ayuda se contaba como prueba |
| 13 | Martina | Sesiones con renovación rotativa del token | Al probar la web apareció un error: recargar durante una renovación cerraba todas las sesiones. Se agregó una ventana de gracia de 30 segundos y se probó que la detección de robo sigue funcionando fuera de ella |
| 14 | Martina | Dirección visual de la web | La IA propuso varias; se eligió una y un segundo agente la revisó. Se aplicaron las 7 correcciones |
| 15 | Martina | Qué hacer con el endpoint de verificación de Usuarios, que dejó de usarse | La IA presentó dejarlo o borrarlo; se borró, y sus pruebas se pasaron a otro endpoint para no perder cobertura |
| 16 | Martina | Prueba de la web en un navegador real contra el sistema desde cero | Aparecieron dos detalles que se corrigieron: un pago rechazado mostraba dos avisos y la hora quedaba cortada en la barra |
| 17 | Diego | Ubicación de las cocheras en el mapa | Ubicación aproximada fija, desplazada 100 a 300 m de la real. Si Reservas no responde, la búsqueda sigue sin filtrar ocupación, pero la baja de una cochera se rechaza |
| 18 | Diego | Bloqueos de fechas puntuales y fotos | La IA presentó implementarlos o declararlos fuera de alcance, con el costo de cada opción; se eligió declararlos como límite. La IA había propuesto «pausar la cochera» como alternativa, pero ese campo no existe en el contrato, y se corrigió el texto |
| 19 | Diego | Secciones de Tecnologías y Observabilidad | Se verificaron versiones y dependencias contra el código. Los motivos de RabbitMQ frente a Kafka y de PostgreSQL frente a NoSQL los redactó la IA y quedaron para que el equipo los confirme. Se corrigió una afirmación que decía más de lo que se había medido |
| 20 | Diego | Guion de defensa de Cocheras | Al verificarlo contra el código se corrigió qué representa el círculo del mapa (el radio de búsqueda, no la ubicación aproximada) y por qué el gateway no exporta tramos de traza |
