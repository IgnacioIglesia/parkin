import { randomBytes } from 'node:crypto';
import amqp from 'amqplib';
import { context, SpanKind, SpanStatusCode, trace, TraceFlags } from '@opentelemetry/api';
import { EventoInvalido, procesarEvento } from './eventos.js';
import { eventosProcesados } from './metricas.js';

// Declarada en infra/rabbitmq/definitions.json; los servicios no crean colas.
const COLA = 'cocheras.reserva-eventos';
const PREFETCH = 10;
const REINTENTO_MS = 3000;
const TRACE_ID = /^[\da-f]{32}$/;

const tracer = trace.getTracer('cocheras');

// Reservas manda el traceId dentro del evento, no en headers AMQP. Para que el
// procesamiento aparezca en la misma traza en Jaeger, se usa ese traceId como padre.
// El spanId del padre no viaja, así que Jaeger lo muestra como "padre desconocido".
function contextoDelEvento(evento) {
  if (!TRACE_ID.test(evento?.traceId ?? '')) return context.active();
  return trace.setSpanContext(context.active(), {
    traceId: evento.traceId,
    spanId: randomBytes(8).toString('hex'),
    traceFlags: TraceFlags.SAMPLED,
    isRemote: true,
  });
}

function tipoParaMetrica(evento) {
  return ['reserva.confirmada', 'reserva.cancelada'].includes(evento?.tipo) ? evento.tipo : 'desconocido';
}

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

  async function procesar(canal, mensaje, evento, span) {
    try {
      if (evento === undefined) throw new EventoInvalido('El mensaje no es JSON');
      const resultado = await procesarEvento(pool, cache, evento);
      eventosProcesados.inc({ tipo: tipoParaMetrica(evento), resultado });
      logger.info(
        { traceId: evento.traceId, eventId: evento.eventId, tipo: evento.tipo, reservaId: evento.datos?.reservaId, resultado },
        'evento procesado',
      );
      canal.ack(mensaje);
    } catch (err) {
      span.recordException(err);
      span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
      if (err instanceof EventoInvalido) {
        // Nunca se va a poder procesar: directo a la DLQ.
        eventosProcesados.inc({ tipo: tipoParaMetrica(evento), resultado: 'invalido' });
        logger.error({ err, traceId: evento?.traceId }, 'evento inválido, se envía a la DLQ');
        canal.nack(mensaje, false, false);
      } else {
        // Falla transitoria: vuelve a la cola. Tras 3 entregas (x-delivery-limit) va a la DLQ.
        eventosProcesados.inc({ tipo: tipoParaMetrica(evento), resultado: 'error' });
        logger.warn({ err, traceId: evento?.traceId }, 'error procesando el evento, se reencola');
        canal.nack(mensaje, false, true);
      }
    } finally {
      span.end();
    }
  }

  function alRecibir(canal, mensaje) {
    let evento;
    try {
      evento = JSON.parse(mensaje.content.toString());
    } catch {
      evento = undefined;
    }
    return tracer.startActiveSpan(
      `procesar ${tipoParaMetrica(evento)}`,
      { kind: SpanKind.CONSUMER, attributes: { 'messaging.destination.name': COLA, 'reserva.id': evento?.datos?.reservaId } },
      contextoDelEvento(evento),
      (span) => procesar(canal, mensaje, evento, span),
    );
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
