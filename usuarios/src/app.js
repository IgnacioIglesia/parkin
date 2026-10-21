import express from 'express';
import { pool } from './db.js';
import { manejadorErrores } from './errores.js';
import { traza } from './middleware/traza.js';
import { authRouter } from './rutas/auth.js';
import { usuariosRouter } from './rutas/usuarios.js';
import { jwks, publicKeyPem } from './tokens.js';

export const app = express();
app.disable('x-powered-by');

app.use(traza);
app.use(express.json({ limit: '100kb' }));

app.get('/health', (_req, res) => res.json({ estado: 'ok' }));

app.get('/ready', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ estado: 'listo' });
  } catch (err) {
    req.log.warn({ err }, 'base de datos no disponible');
    res.status(503).json({ estado: 'no-listo' });
  }
});

// Clave pública para que el gateway (u otro servicio) verifique los JWT.
app.get('/.well-known/jwks.json', (_req, res) => res.json(jwks()));
app.get('/auth/public-key', (_req, res) => res.type('application/x-pem-file').send(publicKeyPem));

app.use('/auth', authRouter);
app.use('/users', usuariosRouter);

app.use((_req, res) => res.status(404).json({ error: { codigo: 'NO_ENCONTRADO', mensaje: 'Ruta inexistente' } }));
app.use(manejadorErrores);
