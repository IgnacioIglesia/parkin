import amqp from 'amqplib';
import { EventoInvalido } from './eventos.js';
import { conSpan, SpanKind } from './trazas.js';

// Declarada en infra/rabbitmq/definitions.json; los servicios no crean colas.
const COLA = 'pagos.reserva-eventos';
const PREFETCH = 10;
const REINTENTO_MS = 3000;

// Consume los eventos reserva.* con ACK manual (at-least-once) y se reconecta solo si
// RabbitMQ se cae o la cola todavía no existe.
export function crearConsumidor({ url, procesador, logger }) {
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
      // Span colgado del traceId que trae el evento: el procesamiento queda en la traza de Reservas.
      await conSpan(
        `procesar ${evento?.tipo ?? 'evento'}`,
        { kind: SpanKind.CONSUMER, traceId: evento?.traceId, atributos: { 'messaging.destination.name': COLA, 'reserva.id': evento?.datos?.reservaId } },
        () => procesador.procesar(evento),
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
      conexion.on('error', (err) => logger.warn({ err }, 'error en la conexión del consumidor con RabbitMQ'));
      conexion.on('close', () => {
        if (!detenido) logger.warn('conexión del consumidor con RabbitMQ cerrada; reintentando');
        reintentar();
      });
      const canal = await conexion.createChannel();
      await canal.checkQueue(COLA);
      await canal.prefetch(PREFETCH);
      await canal.consume(COLA, (mensaje) => mensaje && alRecibir(canal, mensaje), { noAck: false });
      conectado = true;
      logger.info({ cola: COLA }, 'consumidor conectado a RabbitMQ');
    } catch (err) {
      logger.warn({ err }, 'el consumidor no pudo conectarse a RabbitMQ; reintentando');
      if (conexion) {
        await conexion.close().catch(() => {}); // el close dispara reintentar()
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
