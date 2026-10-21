import { cargarConfig } from './config.js';
import { crearPool, migrar } from './db.js';
import { crearLogger } from './logger.js';
import { crearApp } from './app.js';
import { crearClienteReservas } from './reservas.js';

const config = cargarConfig();
const logger = crearLogger(config.nivelLog);
const pool = crearPool(config.databaseUrl);

// Sin este handler, un error en una conexión ociosa del pool tira abajo el proceso.
pool.on('error', (err) => logger.error({ err }, 'error en una conexión ociosa del pool'));

await migrar(pool, logger);

const reservas = crearClienteReservas({ baseUrl: config.reservasUrl });
const { app, apollo } = await crearApp({ logger, pool, reservas });

const server = app.listen(config.puerto, () => {
  logger.info({ puerto: config.puerto }, 'cocheras escuchando');
});

// Apagado ordenado (12-Factor IX): deja de aceptar requests y cierra conexiones.
let apagando = false;
async function apagar(senal) {
  if (apagando) return;
  apagando = true;
  logger.info({ senal }, 'apagando cocheras');
  await new Promise((resolve) => server.close(resolve));
  await apollo.stop();
  await pool.end();
  process.exit(0);
}

process.on('SIGTERM', () => apagar('SIGTERM'));
process.on('SIGINT', () => apagar('SIGINT'));
