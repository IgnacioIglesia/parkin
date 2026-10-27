import { app } from './app.js';
import { config } from './config.js';
import { pool } from './db.js';
import { logger } from './logger.js';
import { migrar } from './migrar.js';
import { apagarTelemetria } from './telemetria.js';

await migrar();

const server = app.listen(config.port, () => {
  logger.info({ puerto: config.port }, 'usuarios escuchando');
});

// Apagado ordenado (12-Factor IX): deja de aceptar conexiones, termina las abiertas y cierra la base.
function apagar(senal) {
  logger.info({ senal }, 'apagando');
  server.close(async () => {
    await pool.end();
    await apagarTelemetria();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', apagar);
process.on('SIGINT', apagar);
