import { test, describe, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as esperar } from 'node:timers/promises';
import amqp from 'amqplib';
import { createClient } from 'redis';
import { crearCache } from '../src/cache.js';
import { crearConsumidor } from '../src/consumidor.js';
import { crearPool, migrar } from '../src/db.js';
import { crearLogger } from '../src/logger.js';

// Necesitan PostGIS, RabbitMQ (con infra/rabbitmq/definitions.json cargado) y Redis:
// TEST_DATABASE_URL=... TEST_RABBITMQ_URL=amqp://guest:guest@localhost:5672 TEST_REDIS_URL=redis://localhost:6379 npm test
const { TEST_DATABASE_URL, TEST_RABBITMQ_URL, TEST_REDIS_URL } = process.env;
const faltan = !(TEST_DATABASE_URL && TEST_RABBITMQ_URL && TEST_REDIS_URL);
const logger = crearLogger('silent');

async function hasta(condicion, mensaje, timeoutMs = 5000) {
  const limite = Date.now() + timeoutMs;
  while (Date.now() < limite) {
    if (await condicion()) return;
    await esperar(50);
  }
  assert.fail(mensaje);
}

describe('Consumidor de RabbitMQ', { skip: faltan && 'Definir TEST_DATABASE_URL, TEST_RABBITMQ_URL y TEST_REDIS_URL' }, () => {
  let pool;
  let conexion;
  let canal;
  let consumidor;
  const cache = { invalidarBusquedas: async () => {} };

  before(async () => {
    pool = crearPool(TEST_DATABASE_URL);
    await migrar(pool, logger);
    conexion = await amqp.connect(TEST_RABBITMQ_URL);
    canal = await conexion.createConfirmChannel();
    await canal.purgeQueue('cocheras.reserva-eventos');
    await canal.purgeQueue('cocheras.dlq');
    consumidor = crearConsumidor({ url: TEST_RABBITMQ_URL, pool, cache, logger });
    await consumidor.iniciar();
  });

  beforeEach(() => pool.query('TRUNCATE acceso_direccion, evento_procesado'));

  after(async () => {
    await consumidor?.detener();
    await conexion?.close();
    await pool?.end();
  });

  function publicar(routingKey, cuerpo) {
    const contenido = Buffer.from(typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo));
    canal.publish('cocheras.eventos', routingKey, contenido, { persistent: true, contentType: 'application/json' });
    return canal.waitForConfirms();
  }

  test('conecta y queda listo', () => {
    assert.equal(consumidor.conectado, true);
  });

  test('un reserva.confirmada publicado en el exchange habilita la dirección', async () => {
    const reservaId = randomUUID();
    await publicar('reserva.confirmada', {
      eventId: randomUUID(),
      tipo: 'reserva.confirmada',
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      datos: { reservaId, cocheraId: randomUUID(), conductorId: randomUUID(), hasta: new Date(Date.now() + 3_600_000).toISOString() },
    });
    await hasta(
      async () => (await pool.query('SELECT 1 FROM acceso_direccion WHERE reserva_id = $1', [reservaId])).rowCount === 1,
      'el evento no se procesó',
    );
  });

  test('un mensaje inválido termina en la DLQ', async () => {
    await publicar('reserva.cancelada', 'esto no es JSON');
    await hasta(async () => (await canal.checkQueue('cocheras.dlq')).messageCount === 1, 'el mensaje no llegó a la DLQ');
    const mensaje = await canal.get('cocheras.dlq', { noAck: true });
    assert.equal(mensaje.content.toString(), 'esto no es JSON');
  });
});

describe('Caché de búsquedas en Redis', { skip: faltan && 'Definir TEST_REDIS_URL' }, () => {
  let cache;
  let redis;
  const parametros = { lat: -34.9, lng: -56.15, radioMetros: 1000, desde: '2026-11-02T17:00:00.000Z' };

  before(async () => {
    redis = createClient({ url: TEST_REDIS_URL });
    await redis.connect();
    cache = crearCache({ url: TEST_REDIS_URL, logger, ttlSegundos: 5 });
    await cache.iniciar();
    await hasta(() => cache.disponible, 'Redis no conectó');
  });

  beforeEach(() => redis.flushDb());

  after(async () => {
    await cache?.detener();
    await redis?.close();
  });

  test('guarda y devuelve una búsqueda', async () => {
    assert.equal(await cache.obtenerBusqueda(parametros), null);
    await cache.guardarBusqueda(parametros, [{ id: 'a' }]);
    assert.deepEqual(await cache.obtenerBusqueda(parametros), [{ id: 'a' }]);
    assert.equal(await cache.obtenerBusqueda({ ...parametros, radioMetros: 2000 }), null);
  });

  test('invalidar deja viejas todas las búsquedas guardadas', async () => {
    await cache.guardarBusqueda(parametros, [{ id: 'a' }]);
    await cache.invalidarBusquedas();
    assert.equal(await cache.obtenerBusqueda(parametros), null);
  });

  test('las entradas vencen por TTL', async () => {
    await cache.guardarBusqueda(parametros, [{ id: 'a' }]);
    const [clave] = await redis.keys('cocheras:busqueda:*:*');
    const ttl = await redis.ttl(clave);
    assert.ok(ttl > 0 && ttl <= 5, `ttl ${ttl}`);
  });

  test('con Redis caído no falla: se comporta como caché vacía', async () => {
    const caida = crearCache({ url: 'redis://localhost:1', logger });
    await caida.iniciar();
    assert.equal(await caida.obtenerBusqueda(parametros), null);
    assert.equal(await caida.guardarBusqueda(parametros, []), null);
    assert.equal(await caida.invalidarBusquedas(), null);
    await caida.detener();
  });
});
