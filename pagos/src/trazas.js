import { randomBytes } from 'node:crypto';
import { context, isSpanContextValid, SpanKind, SpanStatusCode, trace, TraceFlags } from '@opentelemetry/api';

export { SpanKind };

const tracer = trace.getTracer('pagos');
const TRACE_ID = /^[\da-f]{32}$/;

// Contexto con un traceId suelto como padre: el que viaja dentro de los eventos, o el que se
// guardó con el pago para el webhook. El spanId del padre no viaja, así que Jaeger lo muestra
// como "padre desconocido", igual que en Cocheras y Reservas.
function contextoDeTraza(traceId) {
  if (!TRACE_ID.test(traceId ?? '')) return context.active();
  return trace.setSpanContext(context.active(), {
    traceId,
    spanId: randomBytes(8).toString('hex'),
    traceFlags: TraceFlags.SAMPLED,
    isRemote: true,
  });
}

// Corre `fn` dentro de un span nuevo, hijo de `traceId` si viene. Sin OpenTelemetry activo el
// tracer no hace nada y `fn` corre igual.
export function conSpan(nombre, { kind = SpanKind.INTERNAL, traceId, atributos } = {}, fn) {
  return tracer.startActiveSpan(nombre, { kind, attributes: atributos }, contextoDeTraza(traceId), async (span) => {
    try {
      return await fn(span);
    } catch (err) {
      span.recordException(err);
      span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
      throw err;
    } finally {
      span.end();
    }
  });
}

// traceId del span activo, o null si no hay (OpenTelemetry apagado o fuera de una request).
export function traceIdActivo() {
  const span = trace.getSpanContext(context.active());
  return span && isSpanContextValid(span) ? span.traceId : null;
}
