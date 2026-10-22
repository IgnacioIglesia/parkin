import { config } from './config.js';

// Adaptador de la pasarela de pago. Por ahora arma el checkout de la pasarela simulada;
// para usar Mercado Pago se reemplaza esta función sin tocar las rutas.
export function crearCheckout(pagoId) {
  const idExterno = `mock-${pagoId}`;
  return { idExterno, checkoutUrl: `${config.pasarelaUrlPublica}/checkout/${idExterno}` };
}
