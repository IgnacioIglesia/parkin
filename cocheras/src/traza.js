import { randomBytes } from 'node:crypto';

// Header W3C: version-traceid-spanid-flags
const TRACEPARENT = /^[\da-f]{2}-([\da-f]{32})-[\da-f]{16}-[\da-f]{2}$/;
const TRACE_ID_INVALIDO = '0'.repeat(32);

// Toma el traceId del header traceparent que genera el gateway.
// Si no viene (llamada directa al servicio), genera uno nuevo.
export function traceIdDe(req) {
  const coincidencia = TRACEPARENT.exec(req.headers.traceparent ?? '');
  if (coincidencia && coincidencia[1] !== TRACE_ID_INVALIDO) return coincidencia[1];
  return randomBytes(16).toString('hex');
}
