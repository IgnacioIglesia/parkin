import { randomBytes } from 'node:crypto';

// W3C Trace Context: 00-<trace-id 32 hex>-<span-id 16 hex>-<flags 2 hex>
const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

export function trazabilidad(req, res, next) {
  const match = TRACEPARENT.exec(req.get('traceparent') ?? '');
  req.traceId = match ? match[1] : randomBytes(16).toString('hex');
  res.set('traceparent', `00-${req.traceId}-${randomBytes(8).toString('hex')}-01`);
  next();
}
