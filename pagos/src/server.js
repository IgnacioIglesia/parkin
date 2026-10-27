import { createServer } from 'node:http';
import { config } from './config.js';
import { logger } from './logger.js';
import { pool, esperarBase, migrar } from './db.js';
import { crearApp } from './app.js';
import { crearVerificador } from './auth.js';
import { crearPasarela } from './pasarela.js';
import { crearServicioPagos } from './pagos.js';
import { crearProcesadorDeEventos } from './eventos.js';
import { crearConsumidor } from './consumidor.js';
import { crearPublicador } from './publicador.js';
import { crearNotificaciones } from './notificaciones.js';
import { metricas } from './metricas.js';
import { contarPendientesDeSalida } from './repositorio.js';
import { apagarTelemetria } from './telemetria.js';

if (!config.jwtPublicKeyPath) {
  logger.fatal('Falta JWT_PUBLIC_KEY_PATH: sin la clave pública no se pueden verificar los tokens');
  process.exit(1);
}
if (!config.pasarelaWebhookSecret) {
  logger.fatal('Falta PASARELA_WEBHOOK_SECRET: sin el secreto no se pueden verificar los avisos de la pasarela');
  process.exit(1);
}

try {
  await esperarBase();
  await migrar();
} catch (err) {
  logger.fatal({ err }, 'no se pudo preparar la base de datos');
  process.exit(1);
}

const verificar = crearVerificador({ claveRuta: config.jwtPublicKeyPath, emisor: config.jwtIssuer });
const servidor = createServer();
const notificaciones = await crearNotificaciones({
  servidor, verificar, redisUrl: config.redisUrl, logger, metricas,
}).catch((err) => {
  logger.fatal({ err }, 'no se pudo iniciar el WebSocket');
  process.exit(1);
});

const servicio = crearServicioPagos({
  pool,
  pasarela: crearPasarela({ url: config.pasarelaUrl }),
  notificar: notificaciones.notificar,
  logger,
  config,
  metricas,
});
const procesador = crearProcesadorDeEventos({ pool, servicio, metricas, logger });

// Sin RABBITMQ_URL el servicio corre sin mensajería (desarrollo y pruebas).
const consumidor = config.rabbitmqUrl ? crearConsumidor({ url: config.rabbitmqUrl, procesador, logger }) : null;
const publicador = config.rabbitmqUrl ? crearPublicador({ url: config.rabbitmqUrl, pool, logger, metricas }) : null;

const app = crearApp({
  logger, pool, servicio, verificar, metricas,
  secretoWebhook: config.pasarelaWebhookSecret,
  estado: { consumidor, publicador },
});
servidor.on('request', app);

servidor.listen(config.puerto, () => {
  logger.info({ puerto: config.puerto }, 'servicio de pagos escuchando');
  consumidor?.iniciar();
  publicador?.iniciar();
});

// Reintenta los reembolsos que la pasarela no pudo hacer y mide el outbox.
const reembolsos = setInterval(() => {
  servicio.reembolsarPendientes().catch((err) => logger.warn({ err }, 'falló el reintento de reembolsos'));
  contarPendientesDeSalida(pool).then((n) => metricas.outboxPendientes.set(n)).catch(() => {});
}, config.reembolsosIntervaloMs);

// Apagado ordenado (12-Factor IX): deja de aceptar mensajes y conexiones, y cierra la base.
async function apagar(senal) {
  logger.info({ senal }, 'apagando servicio de pagos');
  clearInterval(reembolsos);
  setTimeout(() => process.exit(1), 10_000).unref();
  await consumidor?.detener();
  await publicador?.detener();
  await notificaciones.cerrar();
  servidor.close(async () => {
    await pool.end();
    await apagarTelemetria();
    process.exit(0);
  });
}

process.on('SIGTERM', () => apagar('SIGTERM'));
process.on('SIGINT', () => apagar('SIGINT'));
