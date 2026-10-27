import amqp from 'amqplib';
import { conSpan, SpanKind } from './trazas.js';

const EXCHANGE = 'cocheras.eventos';
const REINTENTO_MS = 3000;
const ESPERA_SIN_EVENTOS_MS = 500;

// Publica los eventos pendientes del outbox, de a uno y en orden. `publicar(routingKey, evento)`
// debe fallar si el broker no confirma: entonces la transacción se revierte y el evento queda
// pendiente (entrega at-least-once; Reservas es idempotente por eventId). SKIP LOCKED permite
// varias réplicas sin que se pisen.
export async function drenarOutbox(pool, publicar, { limite = 100 } = {}) {
  let publicados = 0;
  while (publicados < limite) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT event_id, routing_key, payload FROM evento_saliente
          WHERE publicado_en IS NULL ORDER BY creado_en, event_id LIMIT 1 FOR UPDATE SKIP LOCKED`,
      );
      if (rows.length === 0) {
        await client.query('ROLLBACK');
        return publicados;
      }
      await publicar(rows[0].routing_key, rows[0].payload);
      await client.query('UPDATE evento_saliente SET publicado_en = now() WHERE event_id = $1', [rows[0].event_id]);
      await client.query('COMMIT');
      publicados += 1;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }
  return publicados;
}

// Hilo de publicación: lee el outbox y publica en RabbitMQ con publisher confirms.
export function crearPublicador({ url, pool, logger, metricas }) {
  let conexion = null;
  let conectado = false;
  let detenido = false;
  let tarea = null;

  async function sesion() {
    conexion = await amqp.connect(url);
    const caida = new Promise((_, rechazar) => {
      conexion.on('error', rechazar);
      conexion.on('close', () => rechazar(new Error('conexión cerrada')));
    });
    caida.catch(() => {});
    const canal = await conexion.createConfirmChannel();
    const devueltos = new Set();
    // mandatory: si ninguna cola recibe el mensaje, RabbitMQ lo devuelve y se reintenta en lugar
    // de perderlo en silencio.
    canal.on('return', (mensaje) => devueltos.add(mensaje.properties.messageId));

    // Span colgado del traceId del evento: la publicación aparece en la traza que la originó.
    const publicar = (routingKey, evento) => conSpan(
      `publicar ${routingKey}`,
      { kind: SpanKind.PRODUCER, traceId: evento.traceId, atributos: { 'messaging.destination.name': EXCHANGE, 'reserva.id': evento.datos?.reservaId } },
      () => new Promise((resolver, rechazar) => {
        canal.publish(
          EXCHANGE, routingKey, Buffer.from(JSON.stringify(evento)),
          { persistent: true, mandatory: true, contentType: 'application/json', messageId: evento.eventId },
          (err) => {
            if (err) return rechazar(err);
            if (devueltos.delete(evento.eventId)) return rechazar(new Error('mensaje no ruteable'));
            metricas?.eventosPublicados.labels(routingKey).inc();
            resolver();
          },
        );
      }),
    );

    conectado = true;
    logger.info('publicador conectado a RabbitMQ');
    while (!detenido) {
      const publicados = await Promise.race([drenarOutbox(pool, publicar), caida]);
      if (publicados === 0) await new Promise((r) => setTimeout(r, ESPERA_SIN_EVENTOS_MS));
    }
  }

  async function ciclo() {
    while (!detenido) {
      try {
        await sesion();
      } catch (err) {
        if (!detenido) logger.warn({ err }, 'publicador desconectado; reintentando');
      } finally {
        conectado = false;
        await conexion?.close().catch(() => {});
        conexion = null;
      }
      if (!detenido) await new Promise((r) => setTimeout(r, REINTENTO_MS));
    }
  }

  return {
    get conectado() {
      return conectado;
    },
    iniciar() {
      tarea = ciclo();
    },
    async detener() {
      detenido = true;
      await conexion?.close().catch(() => {});
      await tarea;
    },
  };
}
