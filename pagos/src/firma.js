import { createHmac, timingSafeEqual } from 'node:crypto';

// La pasarela firma el cuerpo crudo del webhook con HMAC-SHA256 (hex) en el header X-Firma.

export function firmar(cuerpoCrudo, secreto) {
  return createHmac('sha256', secreto).update(cuerpoCrudo).digest('hex');
}

export function firmaValida(cuerpoCrudo, firmaRecibida, secreto) {
  if (!secreto || typeof firmaRecibida !== 'string') return false;
  const esperada = Buffer.from(firmar(cuerpoCrudo, secreto), 'hex');
  const recibida = Buffer.from(firmaRecibida, 'hex');
  // Comparación en tiempo constante; si el largo difiere (firma mal formada) ya no coincide.
  return recibida.length === esperada.length && timingSafeEqual(recibida, esperada);
}
