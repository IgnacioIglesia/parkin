# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Delegated: React + Vite (JavaScript), React Router, Tailwind CSS, Leaflet con teselas de OpenStreetMap, socket.io-client. Elegido para usar el mismo lenguaje que el servicio de Usuarios, no depender de API keys y desplegar en Vercel. La web solo habla con el API Gateway (`/api/usuarios`, `/graphql`, `/api/reservas`, `/api/pagos`, `/ws`).

## Users

- **Conductor**: busca dónde estacionar cerca de un destino en una franja horaria concreta (por ejemplo, Pocitos un martes de 9 a 13), reserva y paga. Suele estar en movimiento, desde el celular, o planificando desde la compu.
- **Propietario**: tiene una cochera privada (edificio o casa) que queda vacía parte del día. Publica la cochera, define su disponibilidad semanal, bloquea fechas y ve las reservas y cobros. Suele administrar desde la compu.
- Un mismo usuario puede tener los dos roles.
- Uso en celular y en escritorio por igual (confirmado).
- Audiencia secundaria: docentes de Sistemas Distribuidos de la Universidad de Montevideo en la defensa oral, que ven la demo en una laptop o un proyector.

## Product Purpose

ParkIN conecta cocheras privadas ociosas con conductores que necesitan estacionar, en tiempo real y por franjas horarias. Éxito: el conductor encuentra, reserva y paga una cochera en minutos, y nunca existe una doble reserva ni una "cochera fantasma".

## Positioning

La reserva es una garantía, no una solicitud: la franja queda retenida 10 minutos mientras se paga y la base de datos hace imposible que dos personas reserven la misma cochera en el mismo horario. La confirmación llega al instante por WebSocket y, recién ahí, se revela la dirección exacta.

## Operating Context

- Flujo del conductor: buscar cerca de un punto, para una franja y un tipo de vehículo → elegir → reservar (franja retenida 10 min, estado PENDIENTE_PAGO) → pagar en la pasarela externa (tipo Mercado Pago) → confirmación en tiempo real con la dirección exacta → puede cancelar según la política.
- Flujo del propietario: publicar cochera (dirección, ubicación en el mapa, tipo de vehículo, precio por hora, fotos) → disponibilidad semanal y bloqueos → notificación en tiempo real de cada reserva confirmada y su cobro.
- Estados de reserva: PENDIENTE_PAGO, CONFIRMADA, CANCELADA, EXPIRADA, FINALIZADA.
- Errores con significado para el usuario: 409 "Esa franja acaba de ser reservada", 422 datos inválidos.
- Moneda UYU. Mercado Uruguay, con Montevideo como ciudad principal.

## Capabilities and Constraints

- Alcance de la entrega: registro y login, alta y búsqueda de cocheras, reserva con control de concurrencia, pago con pasarela externa, notificaciones en tiempo real. Calificaciones, motos y bicicletas y otros medios de pago quedan para iteraciones futuras.
- La búsqueda muestra solo ubicación aproximada; la dirección exacta se ve únicamente con la reserva confirmada.
- Los servicios de Cocheras, Reservas y Pagos los desarrollan otros integrantes en paralelo: la web trabaja con mocks que respetan los contratos hasta que estén listos.
- Entrega final: 15/11/2026.

## Brand Commitments

- Nombre: **ParkIN**. Todavía no hay logo ni colores.
- Tono: voseo uruguayo, cercano y directo ("Buscá tu cochera", "Reservá", "Ingresá").

## Evidence on Hand

No hay usuarios reales, testimonios, métricas ni cocheras reales. Los datos de demo (cocheras, precios, barrios) son sintéticos y se marcan como tales. No inventar cifras de uso ni clientes.

## Product Principles

1. La certeza primero: cada estado de la reserva (retenida, pagada, confirmada, vencida) se muestra sin ambigüedad.
2. El tiempo es visible: la retención de 10 minutos y las franjas horarias se ven, no se explican.
3. La privacidad del propietario es parte del producto: la dirección exacta se gana con la confirmación.
4. Dos roles en una sola cuenta, sin fricción para pasar de uno a otro.
