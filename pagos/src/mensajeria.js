import amqp from 'amqplib';
import { setTimeout as esperar } from 'node:timers/promises';
import { config } from './config.js';
import { logger } from './logger.js';
import { EventoInvalido, procesarEvento } from './procesador.js';

// Declarada en infra/rabbitmq/definitions.json: el servicio no crea colas, solo consume la suya.
const COLA = 'pagos.reserva-eventos';
const REINTENTO_MS = 3000;

let conexion = null;
let conectado = false;
let detenido = false;

export const brokerConectado = () => conectado;

async function alRecibir(canal, msg) {
  if (!msg) return; // el broker canceló el consumidor; la conexión se reabre sola

  let evento;
  try {
    evento = JSON.parse(msg.content.toString());
    await procesarEvento(evento);
    canal.ack(msg);
  } catch (err) {
    if (err instanceof SyntaxError || err instanceof EventoInvalido) {
      // Nunca se va a poder procesar: directo a la Dead Letter Queue.
      logger.error({ error: err.message, eventId: evento?.eventId }, 'mensaje inválido, se envía a la DLQ');
      canal.nack(msg, false, false);
    } else {
      // Falla transitoria: vuelve a la cola. Tras 3 entregas (x-delivery-limit) va a la DLQ.
      logger.error({ err, eventId: evento?.eventId }, 'error procesando el evento, se reencola');
      canal.nack(msg, false, true);
    }
  }
}

// Mantiene el consumidor conectado: si RabbitMQ se cae o la cola todavía no existe, reintenta.
export async function iniciarConsumidor() {
  while (!detenido) {
    try {
      conexion = await amqp.connect(config.rabbitmqUrl);
      conexion.on('error', (err) => logger.warn({ error: err.message }, 'error en la conexión a RabbitMQ'));
      const cerrada = new Promise((resolve) => conexion.once('close', resolve));

      const canal = await conexion.createChannel();
      canal.on('error', (err) => logger.warn({ error: err.message }, 'error en el canal de RabbitMQ'));
      await canal.checkQueue(COLA);
      await canal.prefetch(10);
      await canal.consume(COLA, (msg) => alRecibir(canal, msg), { noAck: false });

      conectado = true;
      logger.info({ cola: COLA }, 'consumidor conectado');
      await cerrada;
    } catch (err) {
      logger.warn({ error: err.message }, 'RabbitMQ no disponible, reintentando');
      await conexion?.close().catch(() => {});
    }
    conectado = false;
    if (!detenido) await esperar(REINTENTO_MS);
  }
}

export async function detenerConsumidor() {
  detenido = true;
  await conexion?.close().catch(() => {});
}
