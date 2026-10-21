import { randomBytes } from 'node:crypto';

export class PasarelaNoDisponible extends Error {}

// Cliente de la pasarela de pagos. En desarrollo habla con pasarela-mock; para usar Mercado Pago
// u otra bastaría con otra implementación de crearOrden y reembolsar.
export function crearPasarela({ url, timeoutMs = 5000 }) {
  async function llamar(metodo, ruta, cuerpo, traceId) {
    const headers = { 'content-type': 'application/json' };
    if (traceId) headers.traceparent = `00-${traceId}-${randomBytes(8).toString('hex')}-01`;
    let respuesta;
    try {
      respuesta = await fetch(`${url}${ruta}`, {
        method: metodo,
        headers,
        body: cuerpo ? JSON.stringify(cuerpo) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new PasarelaNoDisponible(`No se pudo contactar a la pasarela: ${err.message}`);
    }
    if (!respuesta.ok) throw new PasarelaNoDisponible(`La pasarela respondió ${respuesta.status}`);
    return respuesta.json();
  }

  return {
    // Idempotente por `referencia` (el pagoId): repetirla devuelve la misma orden.
    crearOrden: ({ referencia, monto, moneda, webhookUrl }, traceId) =>
      llamar('POST', '/ordenes', { referencia, monto, moneda, webhookUrl }, traceId),
    // Idempotente por orden: repetirlo no devuelve la plata dos veces.
    reembolsar: (idExterno, monto, traceId) =>
      llamar('POST', `/ordenes/${encodeURIComponent(idExterno)}/reembolso`, { monto }, traceId),
  };
}
