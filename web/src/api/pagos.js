import { pedir } from './http.js';

const esperar = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

// POST /api/pagos { reservaId } con Idempotency-Key (contrato §5): crea la orden en la pasarela
// y devuelve el pago con su checkoutUrl. La clave la genera quien llama, una por intento de
// pago, y se reusa en los reintentos: repetirla devuelve el mismo pago sin cobrar dos veces.
//
// Pagos arma su copia de la reserva con el evento reserva.creada; si todavía no le llegó,
// responde 404 RESERVA_DESCONOCIDA y hay que reintentar en unos segundos.
export async function iniciarPago(reservaId, idempotencyKey, { intentos = 4, pausaMs = 1500 } = {}) {
  for (let intento = 1; ; intento++) {
    try {
      return await pedir('/api/pagos', {
        method: 'POST',
        cuerpo: { reservaId },
        headers: { 'Idempotency-Key': idempotencyKey },
      });
    } catch (err) {
      if (err.codigo !== 'RESERVA_DESCONOCIDA' || intento >= intentos) throw err;
      await esperar(pausaMs);
    }
  }
}

export const urlDeCheckout = (pago) => pago?.checkoutUrl ?? pago?.urlCheckout ?? pago?.url ?? null;
