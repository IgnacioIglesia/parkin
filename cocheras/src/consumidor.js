import amqp from 'amqplib';
import { EventoInvalido, procesarEvento } from './eventos.js';

// Declarada en infra/rabbitmq/definitions.json; los servicios no crean colas.
const COLA = 'cocheras.reserva-eventos';
const PREFETCH = 10;
const REINTENTO_MS = 3000;

// Consume los eventos de Reservas con ACK manual (at-least-once) y se reconecta solo si
// RabbitMQ se cae o la cola todavía no existe.
export function crearConsumidor({ url, pool, cache, logger }) {
  let conexion = null;
  let conectado = false;
  let detenido = false;
  let temporizador = null;

  function reintentar() {
    conectado = false;
    conexion = null;
    if (!detenido) temporizador = setTimeout(conectar, REINTENTO_MS);
  }

  async function alRecibir(canal, mensaje) {
    let evento;
    try {
      evento = JSON.parse(mensaje.content.toString());
      const resultado = await procesarEvento(pool, cache, evento);
      logger.info(
        { traceId: evento.traceId, eventId: evento.eventId, tipo: evento.tipo, reservaId: evento.datos?.reservaId, resultado },
        'evento procesado',
      );
      canal.ack(mensaje);
    } catch (err) {
      if (err instanceof SyntaxError || err instanceof EventoInvalido) {
        // Nunca se va a poder procesar: directo a la DLQ.
        logger.error({ err, traceId: evento?.traceId }, 'evento inválido, se envía a la DLQ');
        canal.nack(mensaje, false, false);
      } else {
        // Falla transitoria: vuelve a la cola. Tras 3 entregas (x-delivery-limit) va a la DLQ.
        logger.warn({ err, traceId: evento?.traceId }, 'error procesando el evento, se reencola');
        canal.nack(mensaje, false, true);
      }
    }
  }

  async function conectar() {
    try {
      conexion = await amqp.connect(url);
      conexion.on('error', (err) => logger.warn({ err }, 'error en la conexión con RabbitMQ'));
      conexion.on('close', () => {
        if (!detenido) logger.warn('conexión con RabbitMQ cerrada; reintentando');
        reintentar();
      });
      const canal = await conexion.createChannel();
      await canal.checkQueue(COLA);
      await canal.prefetch(PREFETCH);
      await canal.consume(COLA, (mensaje) => mensaje && alRecibir(canal, mensaje), { noAck: false });
      conectado = true;
      logger.info({ cola: COLA }, 'consumidor conectado a RabbitMQ');
    } catch (err) {
      logger.warn({ err }, 'no se pudo conectar a RabbitMQ; reintentando');
      if (conexion) {
        // El close dispara reintentar().
        await conexion.close().catch(() => {});
      } else {
        reintentar();
      }
    }
  }

  return {
    get conectado() {
      return conectado;
    },
    iniciar: conectar,
    async detener() {
      detenido = true;
      clearTimeout(temporizador);
      await conexion?.close().catch(() => {});
    },
  };
}
