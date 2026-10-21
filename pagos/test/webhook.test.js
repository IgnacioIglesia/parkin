import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { firmar } from '../src/firma.js';
import {
  pool, SECRETO, randomUUID, crearEntorno, prepararBase, tokenDe, reservaConocida, evento, avisoFirmado, aviso,
  eventosSalientes, estadoDelPago,
} from './ayuda.js';

const { app, pasarela, procesador, servicio, notificaciones } = crearEntorno();

before(prepararBase);
beforeEach(async () => {
  await pool.query('TRUNCATE pago, reserva_local, evento_procesado, evento_saliente');
  pasarela.ordenes.clear(); pasarela.reembolsos.clear(); pasarela.llamadasCrear = 0; pasarela.caida = false;
  notificaciones.length = 0;
});
after(() => pool.end());

// Reserva conocida + pago pendiente listo para recibir el aviso de la pasarela.
async function pagoPendiente(cambiosReserva) {
  const reserva = await reservaConocida(procesador, cambiosReserva);
  const r = await request(app).post('/pagos').set('Authorization', `Bearer ${tokenDe(reserva.conductorId)}`)
    .set('Idempotency-Key', randomUUID()).send({ reservaId: reserva.reservaId });
  assert.equal(r.status, 201);
  return { reserva, pago: r.body };
}

const webhook = (cuerpo, firma) => {
  const r = request(app).post('/pagos/webhook').set('Content-Type', 'application/json');
  if (firma !== undefined) r.set('X-Firma', firma);
  return r.send(cuerpo);
};
const enviar = (a, secreto) => {
  const { cuerpo, firma } = avisoFirmado(a, secreto);
  return webhook(cuerpo, firma);
};

test('firma inválida, ausente o de otro secreto → 401 y no cambia nada', async () => {
  const { pago } = await pagoPendiente();
  const { cuerpo } = avisoFirmado(aviso(pago));
  assert.equal((await webhook(cuerpo)).status, 401);
  assert.equal((await webhook(cuerpo, 'a'.repeat(64))).status, 401);
  assert.equal((await enviar(aviso(pago), 'otro-secreto')).status, 401);
  const r = await webhook(cuerpo, 'no es hex');
  assert.equal(r.status, 401);
  assert.equal(r.body.error.codigo, 'FIRMA_INVALIDA');
  assert.equal((await estadoDelPago(pago.pagoId)).estado, 'PENDIENTE');
  assert.equal((await eventosSalientes()).length, 0);
});

test('un cuerpo con firma válida pero formato incorrecto → 422; no JSON → 422', async () => {
  const { pago } = await pagoPendiente();
  for (const malo of [
    { ...aviso(pago), estado: 'quizas' }, { ...aviso(pago), referencia: 'no-uuid' },
    { ...aviso(pago), monto: '180' }, { ...aviso(pago), idExterno: '' }, {},
  ]) {
    const r = await enviar(malo);
    assert.equal(r.status, 422, JSON.stringify(malo));
    assert.equal(r.body.error.codigo, 'DATOS_INVALIDOS');
  }
  const crudo = 'esto no es json';
  const r = await request(app).post('/pagos/webhook').set('X-Firma', firmar(Buffer.from(crudo), SECRETO))
    .set('Content-Type', 'text/plain').send(crudo);
  assert.equal(r.status, 422);
});

test('aviso aprobado: pago APROBADO y se publica pago.aprobado', async () => {
  const { reserva, pago } = await pagoPendiente();
  const r = await enviar(aviso(pago));
  assert.equal(r.status, 200);
  assert.equal(r.body.resultado, 'aprobado');
  assert.equal((await estadoDelPago(pago.pagoId)).estado, 'APROBADO');

  const [salida] = await eventosSalientes();
  assert.equal(salida.routing_key, 'pago.aprobado');
  assert.equal(salida.payload.tipo, 'pago.aprobado');
  assert.deepEqual(salida.payload.datos, { reservaId: reserva.reservaId, pagoId: pago.pagoId, monto: 180, moneda: 'UYU' });
  assert.match(salida.payload.eventId, /^[0-9a-f-]{36}$/);
  assert.ok(salida.payload.ocurridoEn);
  assert.equal(notificaciones.length, 0, 'el aviso al conductor lo da reserva.confirmada, no el pago');
});

test('aviso rechazado: pago RECHAZADO con motivo, se publica pago.rechazado y se avisa al conductor', async () => {
  const { reserva, pago } = await pagoPendiente();
  const r = await enviar(aviso(pago, { estado: 'rejected', motivo: 'fondos_insuficientes' }));
  assert.equal(r.body.resultado, 'rechazado');

  const fila = await estadoDelPago(pago.pagoId);
  assert.equal(fila.estado, 'RECHAZADO');
  assert.equal(fila.motivo_rechazo, 'fondos_insuficientes');
  const [salida] = await eventosSalientes();
  assert.equal(salida.routing_key, 'pago.rechazado');
  assert.equal(salida.payload.datos.motivo, 'fondos_insuficientes');
  assert.deepEqual(notificaciones, [{
    usuarioId: reserva.conductorId, evento: 'pago:rechazado',
    datos: { reservaId: reserva.reservaId, pagoId: pago.pagoId, motivo: 'fondos_insuficientes' },
  }]);

  const consulta = await request(app).get(`/pagos/${pago.pagoId}`).set('Authorization', `Bearer ${tokenDe(reserva.conductorId)}`);
  assert.equal(consulta.body.estado, 'RECHAZADO');
  assert.equal(consulta.body.motivo, 'fondos_insuficientes');
});

test('rechazo sin motivo usa uno por defecto', async () => {
  const { pago } = await pagoPendiente();
  await enviar(aviso(pago, { estado: 'rejected', motivo: null }));
  assert.equal((await estadoDelPago(pago.pagoId)).motivo_rechazo, 'rechazado_por_pasarela');
});

test('un aviso repetido devuelve 200 y no cambia nada ni publica dos veces', async () => {
  const { pago } = await pagoPendiente();
  const a = aviso(pago);
  assert.equal((await enviar(a)).body.resultado, 'aprobado');
  assert.equal((await enviar(a)).body.resultado, 'repetido');
  assert.equal((await enviar(a)).status, 200);
  assert.equal((await eventosSalientes()).length, 1);
});

test('un aviso contradictorio posterior se ignora: el primero manda', async () => {
  const { pago } = await pagoPendiente();
  await enviar(aviso(pago));
  const r = await enviar(aviso(pago, { estado: 'rejected', motivo: 'x' }));
  assert.equal(r.body.resultado, 'repetido');
  assert.equal((await estadoDelPago(pago.pagoId)).estado, 'APROBADO');
  assert.equal((await eventosSalientes()).length, 1);
});

test('10 avisos idénticos en paralelo cambian el estado una sola vez', async () => {
  const { pago } = await pagoPendiente();
  const respuestas = await Promise.all(Array.from({ length: 10 }, () => enviar(aviso(pago))));
  assert.ok(respuestas.every((r) => r.status === 200));
  assert.equal(respuestas.filter((r) => r.body.resultado === 'aprobado').length, 1);
  assert.equal(respuestas.filter((r) => r.body.resultado === 'repetido').length, 9);
  assert.equal((await eventosSalientes()).length, 1);
});

test('avisos opuestos en paralelo: gana uno solo y queda un único evento', async () => {
  const { pago } = await pagoPendiente();
  await Promise.all([
    ...Array.from({ length: 5 }, () => enviar(aviso(pago))),
    ...Array.from({ length: 5 }, () => enviar(aviso(pago, { estado: 'rejected', motivo: 'x' }))),
  ]);
  assert.equal((await eventosSalientes()).length, 1);
});

test('referencia desconocida → 200 "desconocido"; monto, moneda u orden que no coinciden → no se toca el pago', async () => {
  const { pago } = await pagoPendiente();
  assert.equal((await enviar(aviso(pago, { referencia: randomUUID() }))).body.resultado, 'desconocido');
  for (const cambio of [{ monto: 1 }, { moneda: 'USD' }, { idExterno: 'mock-otra-orden' }]) {
    assert.equal((await enviar(aviso(pago, cambio))).body.resultado, 'no_coincide');
  }
  assert.equal((await estadoDelPago(pago.pagoId)).estado, 'PENDIENTE');
  assert.equal((await eventosSalientes()).length, 0);
});

// --- Pagos tardíos y reembolsos ---

test('aprobado cuando la reserva ya fue cancelada o expiró: se rechaza y se reembolsa', async () => {
  const { reserva, pago } = await pagoPendiente();
  await pool.query(`UPDATE reserva_local SET estado = 'EXPIRADA' WHERE reserva_id = $1`, [reserva.reservaId]);

  const r = await enviar(aviso(pago));
  assert.equal(r.body.resultado, 'reembolso');
  const fila = await estadoDelPago(pago.pagoId);
  assert.equal(fila.estado, 'RECHAZADO');
  assert.equal(fila.motivo_rechazo, 'reserva_no_vigente');
  assert.equal(fila.reembolso_pendiente, false);
  assert.ok(fila.reembolsado_en, 'el reembolso se hizo');
  assert.equal(pasarela.reembolsos.size, 1);

  const [salida] = await eventosSalientes();
  assert.equal(salida.routing_key, 'pago.rechazado');
  assert.equal(salida.payload.datos.motivo, 'reserva_no_vigente');
  assert.equal(notificaciones[0].evento, 'pago:rechazado');

  const consulta = await request(app).get(`/pagos/${pago.pagoId}`).set('Authorization', `Bearer ${tokenDe(reserva.conductorId)}`);
  assert.deepEqual(consulta.body.reembolso, { estado: 'REEMBOLSADO' });
});

test('cobro tardío: la reserva expiró (el pago ya estaba anulado) y la pasarela cobra igual → reembolso', async () => {
  const { reserva, pago } = await pagoPendiente();
  await procesador.procesar(evento('reserva.expirada', { ...reserva, estado: 'EXPIRADA', motivo: 'plazo_vencido' }));
  assert.equal((await estadoDelPago(pago.pagoId)).motivo_rechazo, 'reserva_expirada');
  assert.equal(pasarela.reembolsos.size, 0);

  const r = await enviar(aviso(pago));
  assert.equal(r.body.resultado, 'reembolso');
  assert.equal(pasarela.reembolsos.size, 1);
  assert.ok((await estadoDelPago(pago.pagoId)).reembolsado_en);
  assert.equal((await eventosSalientes()).length, 0, 'no se publica nada: Reservas ya cerró esa reserva');

  assert.equal((await enviar(aviso(pago))).body.resultado, 'repetido', 'y un nuevo aviso no reembolsa de nuevo');
  assert.equal(pasarela.reembolsos.size, 1);
});

test('si la pasarela falla al reembolsar, queda pendiente y se reintenta sin devolver dos veces', async () => {
  const { reserva, pago } = await pagoPendiente();
  await pool.query(`UPDATE reserva_local SET estado = 'CANCELADA' WHERE reserva_id = $1`, [reserva.reservaId]);
  pasarela.caida = true;

  assert.equal((await enviar(aviso(pago))).body.resultado, 'reembolso');
  let fila = await estadoDelPago(pago.pagoId);
  assert.equal(fila.reembolso_pendiente, true);
  assert.equal(fila.reembolsado_en, null);
  const consulta = await request(app).get(`/pagos/${pago.pagoId}`).set('Authorization', `Bearer ${tokenDe(reserva.conductorId)}`);
  assert.deepEqual(consulta.body.reembolso, { estado: 'PENDIENTE' });

  pasarela.caida = false;
  await servicio.reembolsarPendientes();
  await servicio.reembolsarPendientes();
  fila = await estadoDelPago(pago.pagoId);
  assert.equal(fila.reembolso_pendiente, false);
  assert.ok(fila.reembolsado_en);
  assert.equal(pasarela.reembolsos.size, 1);
});

test('reembolsos concurrentes del mismo pago: se devuelve una sola vez', async () => {
  const { reserva, pago } = await pagoPendiente();
  await pool.query(`UPDATE reserva_local SET estado = 'CANCELADA' WHERE reserva_id = $1`, [reserva.reservaId]);
  pasarela.caida = true;
  await enviar(aviso(pago));
  pasarela.caida = false;

  let llamadas = 0;
  const original = pasarela.reembolsar;
  pasarela.reembolsar = async (...args) => { llamadas += 1; await new Promise((r) => setTimeout(r, 30)); return original(...args); };
  await Promise.all(Array.from({ length: 6 }, () => servicio.reembolsar(pago.pagoId)));
  pasarela.reembolsar = original;
  assert.equal(llamadas, 1);
  assert.ok((await estadoDelPago(pago.pagoId)).reembolsado_en);
});
