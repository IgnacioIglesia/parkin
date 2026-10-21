import express from 'express';
import { pinoHttp } from 'pino-http';
import { logger } from './logger.js';
import { pool } from './db.js';
import { trazabilidad } from './trazabilidad.js';

const RUTAS_SIN_LOG = new Set(['/health', '/ready']);

export function crearApp() {
  const app = express();
  app.disable('x-powered-by');

  app.use(trazabilidad);
  app.use(
    pinoHttp({
      logger,
      customProps: (req) => ({ traceId: req.traceId }),
      autoLogging: { ignore: (req) => RUTAS_SIN_LOG.has(req.url) },
    }),
  );
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  // TODO: sumar el chequeo de RabbitMQ cuando se integre el broker (contratos §9)
  app.get('/ready', async (req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ready' });
    } catch (err) {
      req.log.warn({ err }, 'servicio no listo');
      res.status(503).json({ status: 'not_ready', detalle: 'postgres' });
    }
  });

  app.use((req, res) => {
    res.status(404).json({ error: 'NO_ENCONTRADO' });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'JSON_INVALIDO' });
    }
    req.log.error({ err }, 'error no controlado');
    res.status(500).json({ error: 'ERROR_INTERNO', traceId: req.traceId });
  });

  return app;
}
