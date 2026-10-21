import { pedir } from './http.js';

const BASE = '/api/reservas';

// La Idempotency-Key la genera quien llama, una por intento de reserva: si el pedido se
// reintenta (doble clic, timeout), el servidor devuelve la misma reserva en vez de crear otra.
export const crearReserva = ({ cocheraId, desde, hasta }, idempotencyKey) =>
  pedir(BASE, {
    method: 'POST',
    cuerpo: { cochera_id: cocheraId, desde, hasta },
    headers: { 'Idempotency-Key': idempotencyKey },
  });

export const listarReservas = (rol = 'conductor') => pedir(`${BASE}?rol=${rol}`);

export const obtenerReserva = (id) => pedir(`${BASE}/${id}`);

export const cancelarReserva = (id) => pedir(`${BASE}/${id}/cancelar`, { method: 'POST' });
