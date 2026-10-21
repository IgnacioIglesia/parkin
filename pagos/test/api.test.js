import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import {
  pool, randomUUID, crearEntorno, prepararBase, tokenDe, reservaConocida, datosReserva, evento,
  eventosSalientes, estadoDelPago,
} from './ayuda.js';

const entorno = crearEntorno();
const { app, pasarela, procesador } = entorno;

before(prepararBase);
beforeEach(async () => {
  await pool.query('TRUNCATE pago, reserva_local, evento_procesado, evento_saliente');
  pasarela.ordenes.clear(); pasarela.llamadasCrear = 0; pasarela.caida = false;
});
after(() => pool.end());

const post = (token, reservaId, clave = randomUUID(), cuerpo) =>
  request(app).post('/pagos').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', clave).send(cuerpo ?? { reservaId });

test('health, ready, metrics y rutas inexistentes', async () => {
  assert.equal((await request(app).get('/health')).body.status, 'ok');
  assert.equal((await request(app).get('/ready')).body.status, 'ready');
  const metricas = await request(app).get('/metrics');
  assert.equal(metricas.status, 200);
  assert.match(metricas.text, /pagos_creados_total/);
  const noExiste = await request(app).get('/nada');
  assert.equal(noExiste.status, 404);
  assert.equal(noExiste.body.error.codigo, 'NO_ENCONTRADO');
});

test('sin token o con token inválido → 401', async () => {
  const sinToken = await request(app).post('/pagos').send({});
  assert.equal(sinToken.status, 401);
  assert.equal(sinToken.body.error.codigo, 'NO_AUTENTICADO');
  const malo = await post('abc.def.ghi', randomUUID());
  assert.equal(malo.status, 401);
  assert.equal(malo.body.error.codigo, 'TOKEN_INVALIDO');
  const vencido = await post(tokenDe(randomUUID(), { expiresIn: -5 }), randomUUID());
  assert.equal(vencido.status, 401);
});

test('datos inválidos → 422', async () => {
  const token = tokenDe(randomUUID());
  const sinClave = await request(app).post('/pagos').set('Authorization', `Bearer ${token}`).send({ reservaId: randomUUID() });
  assert.equal(sinClave.status, 422);
  assert.equal(sinClave.body.error.codigo, 'DATOS_INVALIDOS');
  assert.equal((await post(token, 'no-es-uuid')).status, 422);
  assert.equal((await post(token, randomUUID(), 'clave-no-uuid')).status, 422);
  assert.equal((await post(token, undefined, randomUUID(), {})).status, 422);
  const jsonRoto = await request(app).post('/pagos').set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', randomUUID()).set('Content-Type', 'application/json').send('{no es json');
  assert.equal(jsonRoto.status, 400);
});

test('reserva desconocida → 404, ajena → 403, no pagable → 409', async () => {
  const reserva = await reservaConocida(procesador);
  const conductor = reserva.conductorId;

  const desconocida = await post(tokenDe(conductor), randomUUID());
  assert.equal(desconocida.status, 404);
  assert.equal(desconocida.body.error.codigo, 'RESERVA_DESCONOCIDA');

  const ajena = await post(tokenDe(randomUUID()), reserva.reservaId);
  assert.equal(ajena.status, 403);
  assert.equal(ajena.body.error.codigo, 'NO_ES_TU_RESERVA');

  const confirmada = await reservaConocida(procesador);
  await procesador.procesar(evento('reserva.confirmada', { ...confirmada, estado: 'CONFIRMADA' }));
  const noPagable = await post(tokenDe(confirmada.conductorId), confirmada.reservaId);
  assert.equal(noPagable.status, 409);
  assert.equal(noPagable.body.error.codigo, 'RESERVA_NO_PAGABLE');

  const vencida = await reservaConocida(procesador, { expiraEn: new Date(Date.now() - 1000).toISOString() });
  const vencidaRes = await post(tokenDe(vencida.conductorId), vencida.reservaId);
  assert.equal(vencidaRes.status, 409);
  assert.equal(vencidaRes.body.error.codigo, 'RESERVA_NO_PAGABLE');
  assert.equal(pasarela.llamadasCrear, 0, 'no se debe crear ninguna orden en la pasarela');
});

test('crea el pago con el monto de la reserva (el cliente no lo manda) y devuelve el checkout', async () => {
  const reserva = await reservaConocida(procesador, { monto: 180 });
  const r = await post(tokenDe(reserva.conductorId), reserva.reservaId, randomUUID(), { reservaId: reserva.reservaId, monto: 1 });
  assert.equal(r.status, 201);
  assert.equal(r.body.estado, 'PENDIENTE');
  assert.equal(r.body.monto, 180);
  assert.equal(r.body.moneda, 'UYU');
  assert.equal(r.body.reservaId, reserva.reservaId);
  assert.match(r.body.checkoutUrl, /^http:\/\/localhost:8090\/checkout\/mock-/);
  assert.deepEqual(Object.keys(r.body).sort(), ['checkoutUrl', 'estado', 'moneda', 'monto', 'pagoId', 'reservaId']);
  assert.equal((await eventosSalientes()).length, 0, 'crear el pago no publica nada');
});

test('repetir la Idempotency-Key devuelve el mismo pago (200) sin crear otra orden', async () => {
  const reserva = await reservaConocida(procesador);
  const token = tokenDe(reserva.conductorId);
  const clave = randomUUID();
  const primero = await post(token, reserva.reservaId, clave);
  const segundo = await post(token, reserva.reservaId, clave);
  assert.equal(primero.status, 201);
  assert.equal(segundo.status, 200);
  assert.deepEqual(segundo.body, primero.body);
  assert.equal(pasarela.llamadasCrear, 1);
});

test('la misma clave para otro usuario u otra reserva → 409 IDEMPOTENCY_KEY_EN_USO', async () => {
  const reserva = await reservaConocida(procesador);
  const otra = await reservaConocida(procesador, { conductorId: reserva.conductorId });
  const clave = randomUUID();
  assert.equal((await post(tokenDe(reserva.conductorId), reserva.reservaId, clave)).status, 201);
  const otraReserva = await post(tokenDe(reserva.conductorId), otra.reservaId, clave);
  assert.equal(otraReserva.status, 409);
  assert.equal(otraReserva.body.error.codigo, 'IDEMPOTENCY_KEY_EN_USO');
  const otroUsuario = await post(tokenDe(randomUUID()), reserva.reservaId, clave);
  assert.equal(otroUsuario.status, 409);
});

test('con otra clave, mientras hay un pago pendiente → 409 PAGO_EN_CURSO', async () => {
  const reserva = await reservaConocida(procesador);
  const token = tokenDe(reserva.conductorId);
  assert.equal((await post(token, reserva.reservaId)).status, 201);
  const segundo = await post(token, reserva.reservaId);
  assert.equal(segundo.status, 409);
  assert.equal(segundo.body.error.codigo, 'PAGO_EN_CURSO');
});

test('20 pedidos simultáneos con la misma clave crean un solo pago', async () => {
  const reserva = await reservaConocida(procesador);
  const token = tokenDe(reserva.conductorId);
  const clave = randomUUID();
  const respuestas = await Promise.all(Array.from({ length: 20 }, () => post(token, reserva.reservaId, clave)));
  assert.ok(respuestas.every((r) => [200, 201].includes(r.status)), respuestas.map((r) => r.status).join());
  assert.equal(respuestas.filter((r) => r.status === 201).length, 1);
  assert.equal(new Set(respuestas.map((r) => r.body.pagoId)).size, 1);
  assert.equal((await pool.query('SELECT count(*)::int n FROM pago')).rows[0].n, 1);
  assert.equal(pasarela.ordenes.size, 1);
});

test('20 pedidos simultáneos con claves distintas: uno gana y el resto recibe PAGO_EN_CURSO', async () => {
  const reserva = await reservaConocida(procesador);
  const token = tokenDe(reserva.conductorId);
  const respuestas = await Promise.all(Array.from({ length: 20 }, () => post(token, reserva.reservaId)));
  assert.equal(respuestas.filter((r) => r.status === 201).length, 1);
  assert.equal(respuestas.filter((r) => r.status === 409).length, 19);
  assert.equal((await pool.query('SELECT count(*)::int n FROM pago')).rows[0].n, 1);
});

test('si la pasarela no responde → 503, el intento se anula sin avisar a Reservas y se puede reintentar', async () => {
  const reserva = await reservaConocida(procesador);
  const token = tokenDe(reserva.conductorId);
  pasarela.caida = true;
  const fallido = await post(token, reserva.reservaId);
  assert.equal(fallido.status, 503);
  assert.equal(fallido.body.error.codigo, 'PASARELA_NO_DISPONIBLE');

  const { rows } = await pool.query('SELECT estado, motivo_rechazo FROM pago');
  assert.deepEqual(rows, [{ estado: 'RECHAZADO', motivo_rechazo: 'pasarela_no_disponible' }]);
  assert.equal((await eventosSalientes()).length, 0, 'Reservas no debe cancelar la reserva por esto');

  pasarela.caida = false;
  const reintento = await post(token, reserva.reservaId);
  assert.equal(reintento.status, 201);
});

test('un reintento completa la orden de un pago que quedó sin orden (caída a mitad de camino)', async () => {
  const reserva = await reservaConocida(procesador);
  const clave = randomUUID();
  await pool.query(
    `INSERT INTO pago (reserva_id, usuario_id, monto, moneda, idempotency_key) VALUES ($1, $2, 180, 'UYU', $3)`,
    [reserva.reservaId, reserva.conductorId, clave],
  );
  const r = await post(tokenDe(reserva.conductorId), reserva.reservaId, clave);
  assert.equal(r.status, 200);
  assert.match(r.body.checkoutUrl, /checkout\/mock-/);
  assert.equal(pasarela.llamadasCrear, 1);
});

test('GET /pagos/{id}: el dueño lo ve; otro usuario 403; inexistente 404; id inválido 422', async () => {
  const reserva = await reservaConocida(procesador);
  const creado = (await post(tokenDe(reserva.conductorId), reserva.reservaId)).body;

  const propio = await request(app).get(`/pagos/${creado.pagoId}`).set('Authorization', `Bearer ${tokenDe(reserva.conductorId)}`);
  assert.equal(propio.status, 200);
  assert.deepEqual(propio.body, creado);

  const ajeno = await request(app).get(`/pagos/${creado.pagoId}`).set('Authorization', `Bearer ${tokenDe(randomUUID())}`);
  assert.equal(ajeno.status, 403);
  const noExiste = await request(app).get(`/pagos/${randomUUID()}`).set('Authorization', `Bearer ${tokenDe(reserva.conductorId)}`);
  assert.equal(noExiste.status, 404);
  const malo = await request(app).get('/pagos/xyz').set('Authorization', `Bearer ${tokenDe(reserva.conductorId)}`);
  assert.equal(malo.status, 422);
  assert.equal((await request(app).get(`/pagos/${creado.pagoId}`)).status, 401);
  assert.equal((await estadoDelPago(creado.pagoId)).estado, 'PENDIENTE');
});
