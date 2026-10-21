import { test, describe, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { crearPool, migrar } from '../src/db.js';
import { crearLogger } from '../src/logger.js';
import { EventoInvalido, procesarEvento } from '../src/eventos.js';

const TEST_DB = process.env.TEST_DATABASE_URL;

function evento(tipo, datos) {
  return {
    eventId: randomUUID(),
    tipo,
    ocurridoEn: new Date().toISOString(),
    traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
    datos: { estado: 'CONFIRMADA', monto: 180, moneda: 'UYU', ...datos },
  };
}

describe('procesarEvento', { skip: !TEST_DB && 'Definir TEST_DATABASE_URL' }, () => {
  let pool;
  let invalidaciones;
  const cache = { invalidarBusquedas: async () => invalidaciones++ };
  const reserva = () => ({ reservaId: randomUUID(), cocheraId: randomUUID(), conductorId: randomUUID() });

  async function acceso(reservaId) {
    const { rows } = await pool.query('SELECT revocado FROM acceso_direccion WHERE reserva_id = $1', [reservaId]);
    return rows[0] ?? null;
  }

  before(async () => {
    pool = crearPool(TEST_DB);
    await migrar(pool, crearLogger('silent'));
  });

  beforeEach(async () => {
    invalidaciones = 0;
    await pool.query('TRUNCATE acceso_direccion, evento_procesado');
  });

  after(() => pool?.end());

  test('reserva.confirmada habilita la dirección e invalida la caché', async () => {
    const r = reserva();
    assert.equal(await procesarEvento(pool, cache, evento('reserva.confirmada', r)), 'aplicado');
    assert.deepEqual(await acceso(r.reservaId), { revocado: false });
    assert.equal(invalidaciones, 1);
  });

  test('un evento repetido se descarta sin volver a aplicarse', async () => {
    const e = evento('reserva.confirmada', reserva());
    await procesarEvento(pool, cache, e);
    assert.equal(await procesarEvento(pool, cache, e), 'duplicado');
    assert.equal(invalidaciones, 1);
  });

  test('reserva.cancelada revoca el acceso', async () => {
    const r = reserva();
    await procesarEvento(pool, cache, evento('reserva.confirmada', r));
    await procesarEvento(pool, cache, evento('reserva.cancelada', { ...r, motivo: 'cancelada_por_usuario' }));
    assert.deepEqual(await acceso(r.reservaId), { revocado: true });
  });

  test('una confirmación que llega después de la cancelación no reabre el acceso', async () => {
    const r = reserva();
    await procesarEvento(pool, cache, evento('reserva.cancelada', r));
    await procesarEvento(pool, cache, evento('reserva.confirmada', r));
    assert.deepEqual(await acceso(r.reservaId), { revocado: true });
  });

  test('rechaza eventos mal formados o de un tipo que no consume', async () => {
    for (const malo of [
      { ...evento('reserva.confirmada', reserva()), eventId: 'x' },
      evento('reserva.confirmada', { ...reserva(), cocheraId: undefined }),
      evento('pago.aprobado', reserva()),
      null,
    ]) {
      await assert.rejects(procesarEvento(pool, cache, malo), EventoInvalido);
    }
    assert.equal(invalidaciones, 0);
  });
});
