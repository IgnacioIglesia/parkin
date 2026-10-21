# Características de Sistemas Distribuidos

Definidas en la preentrega. Completar la columna "Cómo lo abordamos" con lo realmente implementado.

| Característica | Por qué importa en parkIN | Cómo lo abordamos |
|---|---|---|
| Concurrencia | Varios conductores reservando la misma cochera/franja a la vez | _constraint de exclusión en Postgres / bloqueo; a completar_ |
| Fallos de seguridad | Datos personales y medios de pago | _JWT, validación de entrada, secretos por entorno; a completar_ |
| Confidencialidad | Dirección exacta, contacto, método de pago solo para las partes de una reserva | _autorización por rol/reserva; ubicación aproximada hasta confirmar; a completar_ |
| Integridad | Horario, precio y estado de pago no se alteran tras confirmar | _reservas confirmadas inmutables; a completar_ |
| Disponibilidad | Uso a toda hora, picos urbanos | _servicios sin estado, health checks, réplicas; a completar_ |
| Transparencia | El usuario solo ve buscar → reservar → pagar | _a completar_ |
| Heterogeneidad | iOS, Android, web | _API REST agnóstica de cliente; a completar_ |
| Escalabilidad | Expansión a otras ciudades / temporada (Punta del Este) | _servicios escalables horizontalmente; a completar_ |
| Extensibilidad | Motos, bicicletas, nuevos medios de pago | _a completar_ |
