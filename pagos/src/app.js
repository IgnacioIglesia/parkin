import express from 'express';
import { pool } from './db.js';
import { manejadorErrores } from './errores.js';
import { brokerConectado } from './mensajeria.js';
import { traza } from './middleware/traza.js';
import { pagosRouter } from './rutas/pagos.js';

export const app = express();
app.disable('x-powered-by');

app.use(traza);
app.use(express.json({ limit: '100kb' }));

app.get('/health', (_req, res) => res.json({ estado: 'ok' }));

app.get('/ready', async (req, res) => {
  try {
    await pool.query('SELECT 1');
  } catch (err) {
    req.log.warn({ err }, 'base de datos no disponible');
    return res.status(503).json({ estado: 'no-listo', detalle: 'postgres' });
  }
  if (!brokerConectado()) {
    return res.status(503).json({ estado: 'no-listo', detalle: 'rabbitmq' });
  }
  res.json({ estado: 'listo' });
});

app.use('/pagos', pagosRouter);

app.use((_req, res) => res.status(404).json({ error: { codigo: 'NO_ENCONTRADO', mensaje: 'Ruta inexistente' } }));
app.use(manejadorErrores);
