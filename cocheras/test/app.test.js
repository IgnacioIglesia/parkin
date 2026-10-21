import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { crearApp } from '../src/app.js';
import { crearLogger } from '../src/logger.js';
import { traceIdDe } from '../src/traza.js';
import { cacheNula } from '../src/cache.js';

const logger = crearLogger('silent');
const poolSano = { query: async () => ({ rows: [] }) };
const poolCaido = {
  query: async () => {
    throw new Error('connection refused');
  },
};

const reservas = { ocupacion: async () => [] };
const consumidor = { conectado: true };
const deps = { logger, reservas, cache: cacheNula, consumidor };

const { app, apollo } = await crearApp({ ...deps, pool: poolSano });
const caida = await crearApp({ ...deps, pool: poolCaido });
const sinRabbit = await crearApp({ ...deps, pool: poolSano, consumidor: { conectado: false } });

after(async () => {
  await apollo.stop();
  await caida.apollo.stop();
  await sinRabbit.apollo.stop();
});

test('GET /health responde ok', async () => {
  const res = await request(app).get('/health');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { status: 'ok' });
});

test('GET /ready responde 200 si llega a la base y a RabbitMQ', async () => {
  const res = await request(app).get('/ready');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { status: 'ok', db: 'ok', rabbitmq: 'ok' });
});

test('GET /ready responde 503 si el consumidor no está conectado a RabbitMQ', async () => {
  const res = await request(sinRabbit.app).get('/ready');
  assert.equal(res.status, 503);
  assert.equal(res.body.rabbitmq, 'error');
});

test('GET /ready responde 503 si no llega a la base', async () => {
  const res = await request(caida.app).get('/ready');
  assert.equal(res.status, 503);
  assert.equal(res.body.db, 'error');
});

test('POST /graphql resuelve misCocheras', async () => {
  const res = await request(app)
    .post('/graphql')
    .set('X-User-Id', '11111111-1111-4111-8111-111111111111')
    .set('X-User-Roles', 'PROPIETARIO')
    .send({ query: '{ misCocheras { id titulo ubicacionAproximada { lat lng } } }' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data, { misCocheras: [] });
});

test('un error interno no expone detalles al cliente', async () => {
  const res = await request(caida.app)
    .post('/graphql')
    .set('X-User-Id', '11111111-1111-4111-8111-111111111111')
    .set('X-User-Roles', 'PROPIETARIO')
    .send({ query: '{ misCocheras { id } }' });
  assert.equal(res.body.errors[0].message, 'Error interno');
  assert.equal(res.body.errors[0].extensions.code, 'INTERNAL_SERVER_ERROR');
  assert.ok(!JSON.stringify(res.body).includes('connection refused'));
});

test('POST /graphql rechaza queries con profundidad mayor a 5', async () => {
  const res = await request(app)
    .post('/graphql')
    .send({ query: '{ misCocheras { a { b { c { d { e { f } } } } } } }' });
  assert.equal(res.status, 400);
  const mensajes = res.body.errors.map((e) => e.message);
  assert.ok(mensajes.some((m) => m.includes('exceeds maximum operation depth of 5')), mensajes.join('\n'));
});

test('traceIdDe toma el traceId del header traceparent', () => {
  const req = { headers: { traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01' } };
  assert.equal(traceIdDe(req), '4bf92f3577b34da6a3ce929d0e0e4736');
});

test('traceIdDe genera uno nuevo si el header falta o es inválido', () => {
  for (const traceparent of [undefined, 'basura', '00-00000000000000000000000000000000-00f067aa0ba902b7-01']) {
    const traceId = traceIdDe({ headers: { traceparent } });
    assert.match(traceId, /^[\da-f]{32}$/);
    assert.notEqual(traceId, '0'.repeat(32));
  }
});
