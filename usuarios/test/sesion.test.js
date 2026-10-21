// Ciclo de sesión contra una base real. Corre solo con TEST_DATABASE_URL, por ejemplo:
//   TEST_DATABASE_URL=postgres://app:app@localhost:5441/usuarios npm test
// (con docker compose up db-usuarios). Usa emails únicos, así no choca con datos existentes.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { levantar } from './preparar.js';

const conBase = Boolean(process.env.TEST_DATABASE_URL);

describe('sesión con base de datos', { skip: !conBase && 'falta TEST_DATABASE_URL' }, () => {
  let api;
  before(async () => {
    const { migrar } = await import('../src/migrar.js');
    await migrar();
    api = await levantar();
  });
  after(() => api?.cerrar());

  const email = `test.${Date.now()}@parkin.uy`;
  const json = (res) => res.json();
  const refrescar = (refreshToken) => api.pedir('/auth/refresh', { method: 'POST', cuerpo: { refreshToken } });

  test('registro, email repetido, login y perfil', async () => {
    const res = await api.pedir('/auth/register', {
      method: 'POST',
      cuerpo: { email: email.toUpperCase(), password: 'secreta123', nombre: 'Test', roles: ['CONDUCTOR'] },
    });
    assert.equal(res.status, 201);
    const sesion = await json(res);
    assert.equal(sesion.usuario.email, email, 'el email se guarda en minúsculas');

    const repetido = await api.pedir('/auth/register', {
      method: 'POST',
      cuerpo: { email, password: 'secreta123', nombre: 'Otro' },
    });
    assert.equal(repetido.status, 409);

    const malo = await api.pedir('/auth/login', { method: 'POST', cuerpo: { email, password: 'equivocada' } });
    assert.equal(malo.status, 401);

    const login = await json(await api.pedir('/auth/login', { method: 'POST', cuerpo: { email, password: 'secreta123' } }));
    const me = await json(await api.pedir('/users/me', { headers: { Authorization: `Bearer ${login.accessToken}` } }));
    assert.equal(me.email, email);
  });

  test('rotación: el token viejo vale solo dentro de la gracia y logout-todos la corta', async () => {
    const { refreshToken: rt1, accessToken } = await json(
      await api.pedir('/auth/login', { method: 'POST', cuerpo: { email, password: 'secreta123' } }),
    );
    const { refreshToken: rt2 } = await json(await refrescar(rt1));
    assert.notEqual(rt1, rt2);

    assert.equal((await refrescar(rt1)).status, 200, 'reuso dentro de la ventana de gracia');

    const todas = await api.pedir('/auth/logout-todos', { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } });
    assert.equal(todas.status, 204);
    assert.equal((await refrescar(rt1)).status, 401, 'logout-todos corta la gracia');
    assert.equal((await refrescar(rt2)).status, 401);
  });

  test('reuso fuera de la gracia revoca todas las sesiones', async () => {
    const { pool } = await import('../src/db.js');
    const { refreshToken: rt1 } = await json(
      await api.pedir('/auth/login', { method: 'POST', cuerpo: { email, password: 'secreta123' } }),
    );
    const { refreshToken: rt2 } = await json(await refrescar(rt1));
    // Simula que pasó la ventana de gracia sin esperar 30 s.
    await pool.query("UPDATE refresh_token SET rotado_en = now() - interval '1 hour' WHERE rotado_en IS NOT NULL");

    const reuso = await refrescar(rt1);
    assert.equal(reuso.status, 401);
    assert.equal((await reuso.json()).error.codigo, 'TOKEN_REUTILIZADO');
    assert.equal((await refrescar(rt2)).status, 401, 'la sesión legítima también se revoca');
  });
});
