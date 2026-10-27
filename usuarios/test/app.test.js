import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import jwt from 'jsonwebtoken';
import { generateKeyPairSync } from 'node:crypto';
import { levantar } from './preparar.js';

const { firmarAccessToken } = await import('../src/tokens.js');

let api;
before(async () => {
  api = await levantar();
});
after(() => api.cerrar());

const usuario = { id: '6f1d2c3b-1111-4222-8333-944455556666', email: 'test@parkin.uy', roles: ['CONDUCTOR', 'PROPIETARIO'] };

describe('salud', () => {
  test('GET /health responde 200', async () => {
    const res = await api.pedir('/health');
    assert.equal(res.status, 200);
  });

  test('GET /ready responde 503 sin base de datos', { skip: Boolean(process.env.TEST_DATABASE_URL) }, async () => {
    const res = await api.pedir('/ready');
    assert.equal(res.status, 503);
  });
});

// El gateway ya validó el token, pero Usuarios lo vuelve a verificar en sus rutas protegidas
// (defensa en profundidad). Sin base de datos se prueban los rechazos; el caso válido, en sesion.test.js.
describe('verificación del access token (GET /users/me)', () => {
  test('sin Authorization: 401', async () => {
    const res = await api.pedir('/users/me');
    assert.equal(res.status, 401);
    assert.equal((await res.json()).error.codigo, 'NO_AUTENTICADO');
  });

  test('token firmado con otra clave: 401', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const falso = jwt.sign({ roles: ['PROPIETARIO'] }, privateKey, {
      algorithm: 'RS256',
      subject: usuario.id,
      issuer: 'parkin-usuarios',
    });
    const res = await api.pedir('/users/me', { headers: { Authorization: `Bearer ${falso}` } });
    assert.equal(res.status, 401);
  });

  test('token vencido: 401', async () => {
    const vencido = jwt.sign(
      { roles: ['CONDUCTOR'], exp: Math.floor(Date.now() / 1000) - 60 },
      (await import('node:fs')).readFileSync(process.env.JWT_PRIVATE_KEY_PATH),
      { algorithm: 'RS256', subject: usuario.id, issuer: 'parkin-usuarios' },
    );
    const res = await api.pedir('/users/me', { headers: { Authorization: `Bearer ${vencido}` } });
    assert.equal(res.status, 401);
  });

  test('Authorization mal formado: 401', async () => {
    const res = await api.pedir('/users/me', { headers: { Authorization: 'Basic abc' } });
    assert.equal(res.status, 401);
  });
});

describe('validación y autenticación', () => {
  test('registro con datos inválidos: 422 con detalle por campo', async () => {
    const res = await api.pedir('/auth/register', {
      method: 'POST',
      cuerpo: { email: 'no-es-un-mail', password: '123', roles: ['ADMIN'] },
    });
    assert.equal(res.status, 422);
    const { error } = await res.json();
    assert.equal(error.codigo, 'DATOS_INVALIDOS');
    const campos = error.detalles.map((d) => d.campo);
    for (const campo of ['email', 'password', 'nombre']) assert.ok(campos.includes(campo), campo);
  });

  test('JSON roto: 400', async () => {
    const res = await fetch(`${api.base}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{roto',
    });
    assert.equal(res.status, 400);
  });

  test('GET /users/me sin token: 401', async () => {
    const res = await api.pedir('/users/me');
    assert.equal(res.status, 401);
  });

  test('ruta inexistente: 404 con el formato de error', async () => {
    const res = await api.pedir('/no-existe');
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error.codigo, 'NO_ENCONTRADO');
  });
});

describe('claves y métricas', () => {
  test('JWKS publica la clave RS256 con kid', async () => {
    const { keys } = await (await api.pedir('/.well-known/jwks.json')).json();
    assert.equal(keys[0].kty, 'RSA');
    assert.equal(keys[0].alg, 'RS256');
    assert.ok(keys[0].kid);
  });

  test('el access token lleva sub, roles, iss y kid', () => {
    const decodificado = jwt.decode(firmarAccessToken(usuario), { complete: true });
    assert.equal(decodificado.header.alg, 'RS256');
    assert.ok(decodificado.header.kid);
    assert.equal(decodificado.payload.sub, usuario.id);
    assert.deepEqual(decodificado.payload.roles, usuario.roles);
    assert.equal(decodificado.payload.iss, 'parkin-usuarios');
  });

  test('GET /metrics no responde a lo que llega por el gateway (X-Forwarded-For)', async () => {
    const res = await api.pedir('/metrics', { headers: { 'X-Forwarded-For': '203.0.113.7' } });
    assert.equal(res.status, 404);
  });

  test('GET /metrics expone las métricas en formato Prometheus', async () => {
    const texto = await (await api.pedir('/metrics')).text();
    assert.match(texto, /usuarios_http_requests_total/);
    assert.match(texto, /usuarios_logins_total/);
  });
});
