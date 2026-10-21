import { pedir } from './http.js';

// POST /api/pagos crea la orden en la pasarela y devuelve la URL de checkout (contrato §5).
// El nombre exacto del campo lo define Pagos; se aceptan los habituales hasta fijarlo.
export async function iniciarPago(reservaId) {
  const orden = await pedir('/api/pagos', { method: 'POST', cuerpo: { reservaId } });
  return orden?.urlCheckout ?? orden?.checkoutUrl ?? orden?.url ?? orden?.init_point ?? null;
}
