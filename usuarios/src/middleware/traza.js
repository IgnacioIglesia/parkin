import crypto from 'node:crypto';
import { logger } from '../logger.js';
import { latencia, solicitudes } from '../metricas.js';

// traceparent W3C: 00-<traceId 32 hex>-<spanId 16 hex>-<flags>
const TRACEPARENT = /^[\da-f]{2}-([\da-f]{32})-[\da-f]{16}-[\da-f]{2}$/;

// Sin línea de log: los llaman Docker, Prometheus y el gateway (una verificación por request).
const SIN_LOG = new Set(['/health', '/ready', '/metrics', '/auth/verificar']);

export function traza(req, res, next) {
  const match = TRACEPARENT.exec(req.get('traceparent') ?? '');
  req.traceId = match?.[1] ?? crypto.randomBytes(16).toString('hex');
  req.log = logger.child({ traceId: req.traceId });
  res.set('X-Trace-Id', req.traceId);

  const inicio = process.hrtime.bigint();
  res.on('finish', () => {
    const segundos = Number(process.hrtime.bigint() - inicio) / 1e9;
    // La ruta es la plantilla (/users/:id), no el id, para no multiplicar las series.
    const ruta = req.route ? `${req.baseUrl}${req.route.path}` : 'no_encontrada';
    solicitudes.labels(req.method, ruta, String(res.statusCode)).inc();
    latencia.labels(req.method, ruta).observe(segundos);

    if (SIN_LOG.has(req.path)) return;
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
