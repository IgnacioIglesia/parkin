import { pedir } from './http.js';

// POST /api/pagos crea la orden en la pasarela y devuelve la URL de checkout (contrato §5).
// Pagos exige una Idempotency-Key por intento: repetirla devuelve el mismo pago. Si el usuario
// vuelve a tocar "Pagar" con otra clave mientras hay un pago pendiente, Pagos devuelve ese mismo
// pago, así que la URL de checkout se recupera.
export async function iniciarPago(reservaId, idempotencyKey = crypto.randomUUID()) {
  const orden = await pedir('/api/pagos', {
    method: 'POST',
    cuerpo: { reservaId },
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  return orden?.checkoutUrl ?? null;
}
