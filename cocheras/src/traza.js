import { randomBytes } from 'node:crypto';
import { context, isSpanContextValid, trace } from '@opentelemetry/api';

// Header W3C: version-traceid-spanid-flags
const TRACEPARENT = /^[\da-f]{2}-([\da-f]{32})-[\da-f]{16}-[\da-f]{2}$/;
const TRACE_ID_INVALIDO = '0'.repeat(32);

// traceId de la request, el mismo que se ve en Jaeger y en los logs.
// Con OpenTelemetry activo sale del span de la request (que continúa el traceparent del
// gateway). Sin OpenTelemetry se toma del header, y si no viene se genera uno nuevo.
export function traceIdDe(req) {
  const span = trace.getSpanContext(context.active());
  if (span && isSpanContextValid(span)) return span.traceId;
  const coincidencia = TRACEPARENT.exec(req.headers.traceparent ?? '');
  if (coincidencia && coincidencia[1] !== TRACE_ID_INVALIDO) return coincidencia[1];
  return randomBytes(16).toString('hex');
}
