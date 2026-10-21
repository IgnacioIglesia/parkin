import express from 'express';
import { pinoHttp } from 'pino-http';
import { cuerpoDeError, ErrorHttp } from './errores.js';
import { crearRutas } from './rutas.js';
import { trazabilidad } from './trazabilidad.js';
import { registro } from './metricas.js';

const RUTAS_SIN_LOG = new Set(['/health', '/ready', '/metrics']);

// `estado` expone si cada pieza opcional está conectada: { consumidor, publicador } (o null si
// no está configurada, p. ej. sin RABBITMQ_URL).
export function crearApp({ logger, pool, servicio, verificar, secretoWebhook, metricas, estado = {} }) {
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

  app.use((req, res, next) => {
    const inicio = process.hrtime.bigint();
    res.on('finish', () => {
      const ruta = req.route ? `${req.baseUrl}${req.route.path}` : 'no_encontrada';
      metricas.solicitudes.labels(req.method, ruta, String(res.statusCode)).inc();
      metricas.latencia.labels(req.method, ruta).observe(Number(process.hrtime.bigint() - inicio) / 1e9);
    });
    next();
  });

  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/ready', async (req, res) => {
    const faltan = [];
    try {
      await pool.query('SELECT 1');
    } catch (err) {
      req.log.warn({ err }, 'servicio no listo');
      faltan.push('postgres');
    }
    if (estado.consumidor && !estado.consumidor.conectado) faltan.push('rabbitmq-consumidor');
    if (estado.publicador && !estado.publicador.conectado) faltan.push('rabbitmq-publicador');
    if (faltan.length) return res.status(503).json({ status: 'not_ready', detalle: faltan });
    res.json({ status: 'ready' });
  });

  app.get('/metrics', async (req, res) => {
    res.set('Content-Type', registro.contentType).send(await registro.metrics());
  });

  app.use('/pagos', crearRutas({ servicio, verificar, secretoWebhook }));

  app.use((req, res) => {
    res.status(404).json({ error: { codigo: 'NO_ENCONTRADO', mensaje: 'Esa ruta no existe' } });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof ErrorHttp) {
      return res.status(err.estado).json(cuerpoDeError(err, req.traceId));
    }
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: { codigo: 'JSON_INVALIDO', mensaje: 'El cuerpo no es JSON válido' } });
    }
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ error: { codigo: 'CUERPO_DEMASIADO_GRANDE', mensaje: 'El cuerpo es demasiado grande' } });
    }
    req.log.error({ err }, 'error no controlado');
    res.status(500).json({ error: { codigo: 'ERROR_INTERNO', mensaje: 'Error interno', traceId: req.traceId } });
  });

  return app;
}
