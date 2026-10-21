import express from 'express';
import { pool } from './db.js';
import { manejadorErrores } from './errores.js';
import { traza } from './middleware/traza.js';

export const app = express();
app.disable('x-powered-by');

app.use(traza);
app.use(express.json({ limit: '100kb' }));

app.get('/health', (_req, res) => res.json({ estado: 'ok' }));

// TODO: sumar el chequeo de RabbitMQ cuando se integre el broker (contratos §9)
app.get('/ready', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ estado: 'listo' });
  } catch (err) {
    req.log.warn({ err }, 'base de datos no disponible');
    res.status(503).json({ estado: 'no-listo' });
  }
});

app.use((_req, res) => res.status(404).json({ error: { codigo: 'NO_ENCONTRADO', mensaje: 'Ruta inexistente' } }));
app.use(manejadorErrores);
