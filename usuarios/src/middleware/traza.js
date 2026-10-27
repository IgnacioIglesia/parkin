import crypto from 'node:crypto';
import { context, isSpanContextValid, trace } from '@opentelemetry/api';
import { logger } from '../logger.js';
import { latencia, solicitudes } from '../metricas.js';

// traceparent W3C: 00-<traceId 32 hex>-<spanId 16 hex>-<flags>
const TRACEPARENT = /^[\da-f]{2}-([\da-f]{32})-[\da-f]{16}-[\da-f]{2}$/;
const TRACE_ID_INVALIDO = '0'.repeat(32);

// Sin línea de log: los llaman Docker y Prometheus cada pocos segundos.
const SIN_LOG = new Set(['/health', '/ready', '/metrics']);

export function traza(req, res, next) {
  req.traceId = traceIdDe(req);
  req.log = logger.child({ traceId: req.traceId });
  res.set('X-Trace-Id', req.traceId);

  // Se guarda acá: al terminar, dentro de un router, req.path ya es relativo (/login, no /auth/login).
  const path = req.path;
  const inicio = process.hrtime.bigint();
  res.on('finish', () => {
    const segundos = Number(process.hrtime.bigint() - inicio) / 1e9;
    // La ruta es la plantilla (/users/:id), no el id, para no multiplicar las series.
    const ruta = req.route ? `${req.baseUrl}${req.route.path}` : 'no_encontrada';
    solicitudes.labels(req.method, ruta, String(res.statusCode)).inc();
    latencia.labels(req.method, ruta).observe(segundos);

    if (SIN_LOG.has(path)) return;
    req.log.info(
      {
        metodo: req.method,
        ruta: req.originalUrl,
        estado: res.statusCode,
        duracionMs: segundos * 1000,
        usuarioId: req.usuario?.id,
      },
      'request',
    );
  });
  next();
}

// Con OpenTelemetry activo, el traceId sale del span de la request (que continúa el traceparent
// del gateway), así el de los logs es el mismo que se ve en Jaeger. Si no, se toma del header,
// y si no viene se genera uno nuevo.
function traceIdDe(req) {
  const span = trace.getSpanContext(context.active());
  if (span && isSpanContextValid(span)) return span.traceId;
  const match = TRACEPARENT.exec(req.get('traceparent') ?? '');
  if (match && match[1] !== TRACE_ID_INVALIDO) return match[1];
  return crypto.randomBytes(16).toString('hex');
}
