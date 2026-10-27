import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { io as conectarCliente } from 'socket.io-client';
import { crearNotificaciones } from '../src/notificaciones.js';
import { clavePublica, tokenDe, EMISOR, randomUUID, pool } from './ayuda.js';
import { crearVerificador } from '../src/auth.js';
import { logger } from '../src/logger.js';

const verificar = crearVerificador({ clavePublica, emisor: EMISOR });
const notificaciones = await crearNotificaciones({ verificar, logger });
await new Promise((r) => notificaciones.servidor.listen(0, r));
const url = `http://localhost:${notificaciones.servidor.address().port}`;
const clientes = [];

after(async () => {
  clientes.forEach((c) => c.close());
  await notificaciones.cerrar();
  await pool.end();
});

const conectar = (token) => {
  const c = conectarCliente(url, { path: '/ws', auth: { token }, transports: ['websocket'], reconnection: false });
  clientes.push(c);
  return c;
};

test('con un token válido se conecta y recibe los avisos dirigidos a su usuario', async () => {
  const usuario = randomUUID();
  const cliente = conectar(tokenDe(usuario));
  await once(cliente, 'connect');
  const recibido = once(cliente, 'reserva:confirmada');
  notificaciones.notificar(usuario, 'reserva:confirmada', { reservaId: 'r-1' });
  assert.deepEqual((await recibido)[0], { reservaId: 'r-1' });
});

test('un usuario no recibe los avisos de otro', async () => {
  const [a, b] = [randomUUID(), randomUUID()];
  const clienteA = conectar(tokenDe(a));
  const clienteB = conectar(tokenDe(b));
  await Promise.all([once(clienteA, 'connect'), once(clienteB, 'connect')]);
  const recibidosPorB = [];
  clienteB.on('pago:rechazado', (d) => recibidosPorB.push(d));
  const paraA = once(clienteA, 'pago:rechazado');
  notificaciones.notificar(a, 'pago:rechazado', { motivo: 'x' });
  await paraA;
  await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(recibidosPorB, []);
});

test('el mismo usuario en dos pestañas las recibe en ambas', async () => {
  const usuario = randomUUID();
  const [uno, dos] = [conectar(tokenDe(usuario)), conectar(tokenDe(usuario))];
  await Promise.all([once(uno, 'connect'), once(dos, 'connect')]);
  const ambos = Promise.all([once(uno, 'reserva:expirada'), once(dos, 'reserva:expirada')]);
  notificaciones.notificar(usuario, 'reserva:expirada', { reservaId: 'r' });
  await ambos;
});

test('con Redis caído arranca igual, sin el adaptador, y los avisos llegan', async () => {
  // Nada escucha en el puerto 1: Redis no responde.
  const sinRedis = await crearNotificaciones({ verificar, logger, redisUrl: 'redis://127.0.0.1:1', esperaRedisMs: 300 });
  await new Promise((r) => sinRedis.servidor.listen(0, r));
  try {
    const usuario = randomUUID();
    const cliente = conectarCliente(`http://localhost:${sinRedis.servidor.address().port}`, {
      path: '/ws', auth: { token: tokenDe(usuario) }, transports: ['websocket'], reconnection: false,
    });
    clientes.push(cliente);
    await once(cliente, 'connect');
    const recibido = once(cliente, 'reserva:confirmada');
    sinRedis.notificar(usuario, 'reserva:confirmada', { reservaId: 'r-2' });
    assert.deepEqual((await recibido)[0], { reservaId: 'r-2' });
  } finally {
    await sinRedis.cerrar();
  }
});

test('sin token, con token vencido o inválido: connect_error TOKEN_INVALIDO', async () => {
  const tokens = [undefined, '', 'abc.def.ghi', tokenDe(randomUUID(), { expiresIn: -10 }), 12345];
  for (const token of tokens) {
    const cliente = conectar(token);
    const [error] = await once(cliente, 'connect_error');
    assert.equal(error.message, 'TOKEN_INVALIDO', `token: ${String(token)}`);
    assert.equal(cliente.connected, false);
  }
});
