import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import {
  pool, randomUUID, crearEntorno, prepararBase, tokenDe, datosReserva, evento, avisoFirmado, aviso,
  eventosSalientes, estadoDelPago,
} from './ayuda.js';
import { EventoInvalido } from '../src/eventos.js';

const { app, pasarela, procesador, notificaciones } = crearEntorno();

before(prepararBase);
beforeEach(async () => {
  await pool.query('TRUNCATE pago, reserva_local, evento_procesado, evento_saliente');
  pasarela.ordenes.clear(); pasarela.reembolsos.clear(); pasarela.caida = false;
  notificaciones.length = 0;
});
after(() => pool.end());

const estadoLocal = async (reservaId) =>
  (await pool.query('SELECT estado FROM reserva_local WHERE reserva_id = $1', [reservaId])).rows[0]?.estado;

async function conPagoPendiente(cambios) {
  const reserva = datosReserva(cambios);
  await procesador.procesar(evento('reserva.creada', reserva));
  const r = await request(app).post('/pagos').set('Authorization', `Bearer ${tokenDe(reserva.conductorId)}`)
    .set('Idempotency-Key', randomUUID()).send({ reservaId: reserva.reservaId });
  return { reserva, pago: r.body };
}

test('reserva.creada guarda la copia local de la reserva', async () => {
  const reserva = datosReserva({ monto: 250.5 });
  assert.equal(await procesador.procesar(evento('reserva.creada', reserva)), 'aplicado');
  const { rows } = await pool.query('SELECT * FROM reserva_local WHERE reserva_id = $1', [reserva.reservaId]);
  assert.equal(rows[0].estado, 'PENDIENTE_PAGO');
  assert.equal(Number(rows[0].monto), 250.5);
  assert.equal(rows[0].conductor_id, reserva.conductorId);
  assert.equal(rows[0].propietario_id, reserva.propietarioId);
  assert.equal(rows[0].expira_en.toISOString(), reserva.expiraEn);
  assert.equal(notificaciones.length, 0);
});

test('un evento repetido se procesa una sola vez', async () => {
  const e = evento('reserva.creada', datosReserva());
  assert.equal(await procesador.procesar(e), 'aplicado');
  assert.equal(await procesador.procesar(e), 'duplicado');
  assert.equal((await pool.query('SELECT count(*)::int n FROM reserva_local')).rows[0].n, 1);
});

test('el mismo evento 10 veces en paralelo se aplica una sola vez', async () => {
  const e = evento('reserva.confirmada', datosReserva({ estado: 'CONFIRMADA' }));
  const resultados = await Promise.all(Array.from({ length: 10 }, () => procesador.procesar(e)));
  assert.equal(resultados.filter((r) => r === 'aplicado').length, 1);
  assert.equal(notificaciones.length, 2, 'un aviso por destinatario, una sola vez');
});

test('los eventos fuera de orden no hacen retroceder el estado', async () => {
  const reserva = datosReserva();
  await procesador.procesar(evento('reserva.confirmada', { ...reserva, estado: 'CONFIRMADA' }));
  await procesador.procesar(evento('reserva.creada', reserva)); // llega tarde
  assert.equal(await estadoLocal(reserva.reservaId), 'CONFIRMADA');
  await procesador.procesar(evento('reserva.cancelada', { ...reserva, estado: 'CANCELADA', motivo: 'cancelada_por_usuario' }));
  await procesador.procesar(evento('reserva.confirmada', { ...reserva, estado: 'CONFIRMADA' }));
  assert.equal(await estadoLocal(reserva.reservaId), 'CANCELADA');
});

test('reserva.confirmada avisa al conductor y al propietario', async () => {
  const reserva = datosReserva({ estado: 'CONFIRMADA' });
  await procesador.procesar(evento('reserva.confirmada', reserva));
  const datos = { reservaId: reserva.reservaId, cocheraId: reserva.cocheraId, desde: reserva.desde, hasta: reserva.hasta };
  assert.deepEqual(notificaciones, [
    { usuarioId: reserva.conductorId, evento: 'reserva:confirmada', datos },
    { usuarioId: reserva.propietarioId, evento: 'reserva:confirmada', datos },
  ]);
});

test('reserva.cancelada: al propietario solo se lo avisa si la reserva había llegado a confirmarse', async () => {
  const nunca = datosReserva();
  await procesador.procesar(evento('reserva.creada', nunca));
  await procesador.procesar(evento('reserva.cancelada', { ...nunca, estado: 'CANCELADA', motivo: 'pago_rechazado' }));
  assert.deepEqual(notificaciones.map((n) => [n.usuarioId, n.evento, n.datos.motivo]),
    [[nunca.conductorId, 'reserva:cancelada', 'pago_rechazado']]);

  notificaciones.length = 0;
  const confirmada = datosReserva();
  await procesador.procesar(evento('reserva.confirmada', { ...confirmada, estado: 'CONFIRMADA' }));
  notificaciones.length = 0;
  await procesador.procesar(evento('reserva.cancelada', { ...confirmada, estado: 'CANCELADA', motivo: 'cancelada_por_usuario' }));
  assert.deepEqual(notificaciones.map((n) => n.usuarioId).sort(), [confirmada.conductorId, confirmada.propietarioId].sort());
});

test('reserva.expirada avisa solo al conductor y anula el pago pendiente sin publicar nada', async () => {
  const { reserva, pago } = await conPagoPendiente();
  await procesador.procesar(evento('reserva.expirada', { ...reserva, estado: 'EXPIRADA', motivo: 'plazo_vencido' }));

  assert.deepEqual(notificaciones, [{
    usuarioId: reserva.conductorId, evento: 'reserva:expirada',
    datos: { reservaId: reserva.reservaId, cocheraId: reserva.cocheraId, motivo: 'plazo_vencido' },
  }]);
  const fila = await estadoDelPago(pago.pagoId);
  assert.equal(fila.estado, 'RECHAZADO');
  assert.equal(fila.motivo_rechazo, 'reserva_expirada');
  assert.equal((await eventosSalientes()).length, 0);
});

test('reserva.cancelada anula el pago pendiente', async () => {
  const { reserva, pago } = await conPagoPendiente();
  await procesador.procesar(evento('reserva.cancelada', { ...reserva, estado: 'CANCELADA', motivo: 'cancelada_por_usuario' }));
  const fila = await estadoDelPago(pago.pagoId);
  assert.equal(fila.estado, 'RECHAZADO');
  assert.equal(fila.motivo_rechazo, 'reserva_cancelada');
  assert.equal(pasarela.reembolsos.size, 0, 'no se había cobrado nada');
});

test('cancelar una reserva ya pagada reembolsa el pago', async () => {
  const { reserva, pago } = await conPagoPendiente();
  const { cuerpo, firma } = avisoFirmado(aviso(pago));
  await request(app).post('/pagos/webhook').set('Content-Type', 'application/json').set('X-Firma', firma).send(cuerpo);
  await procesador.procesar(evento('reserva.confirmada', { ...reserva, estado: 'CONFIRMADA' }));
  assert.equal((await estadoDelPago(pago.pagoId)).estado, 'APROBADO');

  await procesador.procesar(evento('reserva.cancelada', { ...reserva, estado: 'CANCELADA', motivo: 'cancelada_por_usuario' }));
  const fila = await estadoDelPago(pago.pagoId);
  assert.equal(fila.estado, 'APROBADO', 'el pago sigue aprobado: lo que cambia es que se devuelve');
  assert.ok(fila.reembolsado_en);
  assert.equal(pasarela.reembolsos.size, 1);

  const r = await request(app).get(`/pagos/${pago.pagoId}`).set('Authorization', `Bearer ${tokenDe(reserva.conductorId)}`);
  assert.deepEqual(r.body.reembolso, { estado: 'REEMBOLSADO' });
});

test('la expiración llega justo después de que la pasarela aprobó (carrera): se reembolsa', async () => {
  const { reserva, pago } = await conPagoPendiente();
  const { cuerpo, firma } = avisoFirmado(aviso(pago));
  await request(app).post('/pagos/webhook').set('Content-Type', 'application/json').set('X-Firma', firma).send(cuerpo);
  // Reservas ya había expirado la reserva y por eso ignoró pago.aprobado:
  await procesador.procesar(evento('reserva.expirada', { ...reserva, estado: 'EXPIRADA', motivo: 'plazo_vencido' }));
  assert.equal(pasarela.reembolsos.size, 1);
  assert.ok((await estadoDelPago(pago.pagoId)).reembolsado_en);
});

test('cancelación por pago rechazado: el pago ya estaba cerrado y no cambia', async () => {
  const { reserva, pago } = await conPagoPendiente();
  const { cuerpo, firma } = avisoFirmado(aviso(pago, { estado: 'rejected', motivo: 'fondos_insuficientes' }));
  await request(app).post('/pagos/webhook').set('Content-Type', 'application/json').set('X-Firma', firma).send(cuerpo);
  await procesador.procesar(evento('reserva.cancelada', { ...reserva, estado: 'CANCELADA', motivo: 'pago_rechazado' }));
  assert.equal((await estadoDelPago(pago.pagoId)).motivo_rechazo, 'fondos_insuficientes');
  assert.equal(pasarela.reembolsos.size, 0);
});

test('eventos inválidos se rechazan (van a la DLQ) y no dejan rastro', async () => {
  const base = datosReserva();
  const malos = [
    {},
    evento('reserva.creada', { ...base, reservaId: 'no-uuid' }),
    evento('reserva.creada', { ...base, monto: 0 }),
    evento('reserva.creada', { ...base, desde: 'ayer' }),
    evento('reserva.creada', { ...base, conductorId: undefined }),
    evento('pago.aprobado', base),
    { ...evento('reserva.creada', base), eventId: 'x' },
    { ...evento('reserva.creada', base), datos: null },
  ];
  for (const malo of malos) await assert.rejects(() => procesador.procesar(malo), EventoInvalido);
  assert.equal((await pool.query('SELECT count(*)::int n FROM evento_procesado')).rows[0].n, 0);
  assert.equal((await pool.query('SELECT count(*)::int n FROM reserva_local')).rows[0].n, 0);
});

test('si algo falla en la transacción, el evento no queda como procesado (se puede reintentar)', async () => {
  const reserva = datosReserva();
  const e = evento('reserva.creada', { ...reserva, monto: 99999999999999 }); // desborda NUMERIC(12,2)
  await assert.rejects(() => procesador.procesar(e));
  assert.equal((await pool.query('SELECT count(*)::int n FROM evento_procesado')).rows[0].n, 0);
  assert.equal(await procesador.procesar({ ...e, datos: { ...e.datos, monto: 180 } }), 'aplicado');
});
