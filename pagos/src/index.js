import { app } from './app.js';
import { config } from './config.js';
import { pool } from './db.js';
import { logger } from './logger.js';
import { detenerConsumidor, iniciarConsumidor } from './mensajeria.js';
import { migrar } from './migrar.js';

await migrar();

const server = app.listen(config.port, () => {
  logger.info({ puerto: config.port }, 'pagos escuchando');
});

// Corre en segundo plano y se reconecta solo; /ready refleja si está conectado.
iniciarConsumidor();

// Apagado ordenado (12-Factor IX): deja de aceptar conexiones, cierra el broker y la base.
function apagar(senal) {
  logger.info({ senal }, 'apagando');
  server.close(async () => {
    await detenerConsumidor();
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', apagar);
process.on('SIGINT', apagar);
