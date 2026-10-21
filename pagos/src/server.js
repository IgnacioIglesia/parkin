import { config } from './config.js';
import { logger } from './logger.js';
import { pool, esperarBase, migrar } from './db.js';
import { crearApp } from './app.js';

try {
  await esperarBase();
  await migrar();
} catch (err) {
  logger.fatal({ err }, 'no se pudo preparar la base de datos');
  process.exit(1);
}

const server = crearApp().listen(config.puerto, () => {
  logger.info({ puerto: config.puerto }, 'servicio de pagos escuchando');
});

function apagar(senal) {
  logger.info({ senal }, 'apagando servicio de pagos');
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => apagar('SIGTERM'));
process.on('SIGINT', () => apagar('SIGINT'));
