import crypto from 'node:crypto';
import { logger } from '../logger.js';

// traceparent W3C: 00-<traceId 32 hex>-<spanId 16 hex>-<flags>
const TRACEPARENT = /^[\da-f]{2}-([\da-f]{32})-[\da-f]{16}-[\da-f]{2}$/;

export function traza(req, res, next) {
  const match = TRACEPARENT.exec(req.get('traceparent') ?? '');
  req.traceId = match?.[1] ?? crypto.randomBytes(16).toString('hex');
  req.log = logger.child({ traceId: req.traceId });
  res.set('X-Trace-Id', req.traceId);

  const inicio = process.hrtime.bigint();
  res.on('finish', () => {
    if (req.path === '/health' || req.path === '/ready') return;
    req.log.info(
      {
        metodo: req.method,
        ruta: req.originalUrl,
        estado: res.statusCode,
        duracionMs: Number(process.hrtime.bigint() - inicio) / 1e6,
        usuarioId: req.usuario?.id,
      },
      'request',
    );
  });
  next();
}
