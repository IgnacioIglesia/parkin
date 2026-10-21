import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, randomUUID, prepararBase } from './ayuda.js';
import { drenarOutbox } from '../src/publicador.js';
import { encolarEvento, contarPendientesDeSalida } from '../src/repositorio.js';

before(prepararBase);
beforeEach(() => pool.query('TRUNCATE evento_saliente'));
after(() => pool.end());

const encolar = (n = 1) => Promise.all(Array.from({ length: n }, (_, i) =>
  encolarEvento(pool, i % 2 ? 'pago.rechazado' : 'pago.aprobado', { reservaId: randomUUID(), i }, 'traza')));

test('publica los eventos pendientes y los marca como publicados', async () => {
  await encolar(3);
  const enviados = [];
  assert.equal(await drenarOutbox(pool, async (clave, evento) => enviados.push([clave, evento.eventId])), 3);
  assert.equal(enviados.length, 3);
  assert.equal(await contarPendientesDeSalida(pool), 0);
  assert.equal(await drenarOutbox(pool, async () => assert.fail('no debería haber nada que publicar')), 0);
});

test('el evento lleva el formato del contrato', async () => {
  const guardado = await encolarEvento(pool, 'pago.aprobado', { reservaId: 'r' }, '4bf92f3577b34da6a3ce929d0e0e4736');
  let recibido;
  await drenarOutbox(pool, async (clave, evento) => { recibido = { clave, evento }; });
  assert.equal(recibido.clave, 'pago.aprobado');
  assert.deepEqual(Object.keys(recibido.evento).sort(), ['datos', 'eventId', 'ocurridoEn', 'tipo', 'traceId']);
  assert.equal(recibido.evento.eventId, guardado.eventId);
  assert.equal(recibido.evento.traceId, '4bf92f3577b34da6a3ce929d0e0e4736');
});

test('si el broker no confirma, el evento queda pendiente y se reintenta', async () => {
  await encolar(1);
  await assert.rejects(() => drenarOutbox(pool, async () => { throw new Error('broker caído'); }), /broker caído/);
  assert.equal(await contarPendientesDeSalida(pool), 1);
  const enviados = [];
  await drenarOutbox(pool, async (clave) => enviados.push(clave));
  assert.equal(enviados.length, 1);
  assert.equal(await contarPendientesDeSalida(pool), 0);
});

test('un fallo a mitad de camino no pierde ni duplica: publica en orden hasta el que falla', async () => {
  await encolar(4);
  let n = 0;
  await assert.rejects(() => drenarOutbox(pool, async () => { n += 1; if (n === 3) throw new Error('falla'); }));
  assert.equal(await contarPendientesDeSalida(pool), 2, 'los dos primeros salieron; el 3º y el 4º siguen pendientes');
});

test('varias réplicas drenando a la vez no publican el mismo evento dos veces', async () => {
  await encolar(30);
  const enviados = [];
  const publicar = async (clave, evento) => { await new Promise((r) => setTimeout(r, 2)); enviados.push(evento.eventId); };
  await Promise.all(Array.from({ length: 4 }, () => drenarOutbox(pool, publicar)));
  assert.equal(enviados.length, 30);
  assert.equal(new Set(enviados).size, 30);
  assert.equal(await contarPendientesDeSalida(pool), 0);
});
